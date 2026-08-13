import { Client } from 'pg';
import { db } from './db';
import { scopedLogger } from '../lib/logger';
import { PG_NOTIFY_CHANNEL, PG_SELFTEST_CHANNEL } from '../lib/realtime/topics';
import type { ServerEvent } from '../lib/websocket/protocol';

const log = scopedLogger('bus');

/** Host da connection string, sem usuário nem senha — seguro para log. */
function safeHost(connectionString: string): string {
  try {
    return new URL(connectionString).host;
  } catch {
    return 'desconhecido';
  }
}

export interface BusMessage {
  topic: string;
  event: ServerEvent;
}

type BusHandler = (message: BusMessage) => void;

/**
 * Assinante do barramento realtime.
 *
 * Mantém uma conexão dedicada em `LISTEN dinizcord_events`. Uma conexão só para
 * isso, e não do pool do Prisma: o LISTEN precisa de uma sessão estável e
 * exclusiva, enquanto o pool recicla conexões livremente.
 *
 * As notificações trazem só o id do evento. Os ids chegando em rajada são
 * agrupados numa janela curta e buscados em uma única consulta — é a diferença
 * entre uma query por candidato ICE e uma query por rajada.
 */
export class RealtimeBus {
  private client: Client | null = null;
  private handler: BusHandler | null = null;
  private pendingIds = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = false;

  private selfTestToken: string | null = null;
  private selfTestPassed = false;

  /** Janela de agrupamento antes de buscar os eventos. */
  private static readonly BATCH_WINDOW_MS = 5;

  /** Quanto esperar pela notificação do autoteste antes de considerar falha. */
  private static readonly SELF_TEST_TIMEOUT_MS = 6_000;

  constructor(private readonly connectionString: string) {}

  onEvent(handler: BusHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const client = new Client({ connectionString: this.connectionString });
    this.client = client;

    client.on('notification', (message) => {
      if (message.channel === PG_SELFTEST_CHANNEL) {
        if (message.payload === this.selfTestToken) this.selfTestPassed = true;
        return;
      }

      if (message.channel !== PG_NOTIFY_CHANNEL || !message.payload) return;
      this.pendingIds.add(message.payload);
      this.scheduleFlush();
    });

    client.on('error', (error) => {
      log.error({ err: error, event: 'bus.error' }, 'Conexão do barramento falhou');
      void this.reconnect();
    });

    client.on('end', () => {
      if (!this.stopped) {
        log.warn({ event: 'bus.disconnected' }, 'Conexão do barramento encerrada');
        void this.reconnect();
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${PG_NOTIFY_CHANNEL}`);
      await client.query(`LISTEN ${PG_SELFTEST_CHANNEL}`);
      this.reconnectAttempt = 0;
      log.info({ event: 'bus.connected' }, 'Barramento realtime conectado');

      // Não bloqueia a inicialização: o gateway sobe e atende, e o resultado do
      // teste aparece no log alguns segundos depois.
      void this.runSelfTest();
    } catch (error) {
      log.error({ err: error, event: 'bus.connect_failed' }, 'Falha ao conectar o barramento');
      void this.reconnect();
    }
  }

  /**
   * Confere que as notificações realmente chegam.
   *
   * Existe por causa de um modo de falha silencioso: um pooler em modo
   * transaction (PgBouncer, usado pelos endpoints "pooled" do Neon, Supabase e
   * afins) **aceita** o comando LISTEN sem erro e simplesmente nunca entrega
   * nada. O gateway sobe, os logs ficam limpos, e o chat parece funcionar —
   * até alguém notar que mensagem nova só aparece recarregando a página.
   *
   * Como isso não gera exceção, a única forma de detectar é enviar uma
   * notificação para si mesmo e verificar se ela volta.
   */
  private async runSelfTest(): Promise<void> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.selfTestToken = token;
    this.selfTestPassed = false;

    try {
      // O NOTIFY precisa sair de OUTRA conexão — aqui, a mesma pool do Prisma
      // que a aplicação usa para publicar. Emitir pelo próprio cliente que está
      // escutando não testaria nada: através de um pooler, a notificação volta
      // para o próprio remetente mesmo quando não chegaria a mais ninguém.
      // `$executeRaw` e não `$queryRaw`: pg_notify retorna void, e o
      // desserializador de resultados do Prisma não sabe lidar com esse tipo.
      await db().$executeRaw`SELECT pg_notify(${PG_SELFTEST_CHANNEL}, ${token})`;
    } catch (error) {
      log.error({ err: error, event: 'bus.selftest_failed' }, 'Falha ao enviar o autoteste do barramento');
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, RealtimeBus.SELF_TEST_TIMEOUT_MS));

    if (this.selfTestPassed) {
      log.info({ event: 'bus.selftest_ok' }, 'Autoteste do barramento: notificações chegando');
      return;
    }

    log.error(
      { event: 'bus.selftest_failed', host: safeHost(this.connectionString) },
      'BARRAMENTO REALTIME INOPERANTE: o LISTEN foi aceito mas nenhuma notificação chegou. ' +
        'O chat vai carregar o histórico e nunca receber mensagens novas em tempo real. ' +
        'Causa quase certa: esta DATABASE_URL passa por um pooler em modo transaction. ' +
        'Use a connection string DIRETA no gateway (no Neon, a mesma URL sem "-pooler" no host).',
    );
  }

  /**
   * Reconexão com backoff exponencial e teto.
   *
   * Sem o teto, uma queda longa do banco viraria uma tempestade de tentativas;
   * sem o backoff, o primeiro erro viraria um laço apertado.
   */
  private async reconnect(): Promise<void> {
    if (this.stopped) return;

    const client = this.client;
    this.client = null;

    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
    }

    this.reconnectAttempt += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt, 6));

    log.warn(
      { attempt: this.reconnectAttempt, delay, event: 'bus.reconnecting' },
      'Reconectando ao barramento realtime',
    );

    setTimeout(() => void this.connect(), delay);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, RealtimeBus.BATCH_WINDOW_MS);
  }

  private async flush(): Promise<void> {
    if (this.pendingIds.size === 0 || !this.handler) return;

    const ids = [...this.pendingIds].map((id) => BigInt(id));
    this.pendingIds.clear();

    try {
      const rows = await db().realtimeEvent.findMany({
        where: { id: { in: ids } },
        select: { id: true, topic: true, payload: true },
        orderBy: { id: 'asc' },
      });

      for (const row of rows) {
        this.handler({ topic: row.topic, event: row.payload as unknown as ServerEvent });
      }
    } catch (error) {
      log.error({ err: error, event: 'bus.fetch_failed' }, 'Falha ao buscar eventos do barramento');
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const client = this.client;
    this.client = null;

    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
    }
  }
}

/** Publica um evento a partir do gateway (mesmo outbox usado pela API Next). */
export async function publish(topic: string, event: ServerEvent): Promise<void> {
  try {
    await db().realtimeEvent.create({ data: { topic, payload: event as unknown as object } });
  } catch (error) {
    log.error(
      { err: error, topic, type: event.t, event: 'bus.publish_failed' },
      'Falha ao publicar evento',
    );
  }
}

export async function publishMany(entries: Array<{ topic: string; event: ServerEvent }>): Promise<void> {
  if (entries.length === 0) return;

  try {
    await db().realtimeEvent.createMany({
      data: entries.map((entry) => ({
        topic: entry.topic,
        payload: entry.event as unknown as object,
      })),
    });
  } catch (error) {
    log.error({ err: error, event: 'bus.publish_failed' }, 'Falha ao publicar eventos');
  }
}
