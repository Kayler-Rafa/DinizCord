import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { Gateway } from '@/server/gateway';
import { RealtimeBus } from '@/server/bus';
import { testDatabaseUrl } from './db';
import type { ClientEvent, ServerEvent } from '@/lib/websocket/protocol';

/**
 * Sobe um gateway de verdade (HTTP + ws + barramento) numa porta livre.
 *
 * Nada de simular o WebSocket: os testes falam o protocolo real, com handshake,
 * ticket, LISTEN/NOTIFY e tudo mais. É a única forma de provar que reconexão,
 * presença e signaling funcionam de ponta a ponta.
 */
export interface TestGateway {
  gateway: Gateway;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export async function startTestGateway(): Promise<TestGateway> {
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const bus = new RealtimeBus(testDatabaseUrl());

  const gateway = new Gateway({
    wss,
    bus,
    allowedOrigins: ['http://localhost:3000'],
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (!gateway.isOriginAllowed(request.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  await bus.start();
  gateway.start();

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;

  return {
    gateway,
    port,
    url: `ws://127.0.0.1:${port}`,
    async stop() {
      await gateway.shutdown();
      await bus.stop();
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/**
 * Cliente de teste que guarda todos os eventos recebidos e permite esperar por
 * um evento específico com timeout — nada de `sleep` arbitrário nos testes.
 */
export class TestClient {
  readonly received: ServerEvent[] = [];
  closeCode: number | null = null;

  private constructor(private readonly socket: WebSocket) {}

  static async connect(
    url: string,
    ticket: string,
    options: { origin?: string | null } = {},
  ): Promise<TestClient> {
    const origin = options.origin === undefined ? 'http://localhost:3000' : options.origin;

    const socket = new WebSocket(`${url}/?ticket=${encodeURIComponent(ticket)}`, {
      ...(origin ? { origin } : {}),
    });

    const client = new TestClient(socket);

    socket.on('message', (raw) => {
      client.received.push(JSON.parse(String(raw)) as ServerEvent);
    });
    socket.on('close', (code) => {
      client.closeCode = code;
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout ao abrir o WebSocket')), 10_000);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('close', (code) => {
        clearTimeout(timer);
        // Fechamento imediato é um resultado legítimo (ticket inválido); quem
        // chamou inspeciona `closeCode`.
        resolve();
        client.closeCode = code;
      });
      socket.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    return client;
  }

  send(event: ClientEvent): void {
    this.socket.send(JSON.stringify(event));
  }

  /** Espera pelo primeiro evento que casar com o predicado. */
  async waitFor<T extends ServerEvent['t']>(
    type: T,
    predicate: (event: Extract<ServerEvent, { t: T }>) => boolean = () => true,
    timeoutMs = 8_000,
  ): Promise<Extract<ServerEvent, { t: T }>> {
    const found = this.received.find(
      (event): event is Extract<ServerEvent, { t: T }> =>
        event.t === type && predicate(event as Extract<ServerEvent, { t: T }>),
    );
    if (found) return found;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off('message', onMessage);
        reject(
          new Error(
            `Timeout esperando o evento "${type}". Recebidos: ${this.received.map((e) => e.t).join(', ')}`,
          ),
        );
      }, timeoutMs);

      const onMessage = (raw: unknown) => {
        const event = JSON.parse(String(raw)) as ServerEvent;
        if (event.t === type && predicate(event as Extract<ServerEvent, { t: T }>)) {
          clearTimeout(timer);
          this.socket.off('message', onMessage);
          resolve(event as Extract<ServerEvent, { t: T }>);
        }
      };

      this.socket.on('message', onMessage);
    });
  }

  async waitForClose(timeoutMs = 8_000): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout esperando o fechamento')), timeoutMs);
      this.socket.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  async close(): Promise<void> {
    if (this.socket.readyState === this.socket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()));
    this.socket.close();
    await closed;
  }
}
