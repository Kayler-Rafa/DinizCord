/**
 * Verifica se a connection string suporta LISTEN/NOTIFY.
 *
 * O barramento realtime do DinizCord depende disso: o gateway fica em
 * `LISTEN dinizcord_events` e recebe o id de cada evento publicado. Bancos
 * atrás de um pooler em modo transaction (PgBouncer, usado pelo endpoint
 * "pooled" do Neon) aceitam o comando LISTEN mas **nunca entregam** as
 * notificações — o chat carrega o histórico e nada mais chega em tempo real.
 *
 * Rode isto ANTES de subir o gateway, com a URL que ele vai usar:
 *   DATABASE_URL="..." npx tsx scripts/check-realtime.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { PG_NOTIFY_CHANNEL } from '../lib/realtime/topics';

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('Defina DATABASE_URL antes de rodar.');
  process.exit(1);
}

const host = new URL(url).host;
console.log(`Testando LISTEN/NOTIFY em ${host}`);

const listener = new Client({ connectionString: url });
const publisher = new Client({ connectionString: url });

const received = new Promise<boolean>((resolve) => {
  listener.on('notification', (message) => {
    if (message.channel === PG_NOTIFY_CHANNEL) resolve(true);
  });
  setTimeout(() => resolve(false), 8_000);
});

try {
  await listener.connect();
  await listener.query(`LISTEN ${PG_NOTIFY_CHANNEL}`);

  await publisher.connect();
  await publisher.query(`SELECT pg_notify($1, $2)`, [PG_NOTIFY_CHANNEL, 'teste']);

  if (await received) {
    console.log('OK — as notificações chegam. O realtime vai funcionar.');
  } else {
    console.error('FALHOU — o LISTEN foi aceito mas nenhuma notificação chegou.');
    console.error('');
    console.error('Causa quase certa: esta URL passa por um pooler em modo transaction.');
    console.error('Use a connection string DIRETA no gateway (no Neon, é a mesma URL');
    console.error('sem o sufixo "-pooler" no host).');
    process.exitCode = 1;
  }
} catch (error) {
  console.error('Erro ao testar:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await listener.end().catch(() => undefined);
  await publisher.end().catch(() => undefined);
}
