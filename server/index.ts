import 'dotenv/config';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Gateway } from './gateway';
import { RealtimeBus } from './bus';
import { startSweeper } from './sweeper';
import { disconnectDb } from './db';
import { serverEnv } from '../lib/env.server';
import { scopedLogger } from '../lib/logger';
import { CLOSE_CODES, MAX_INBOUND_MESSAGE_BYTES } from '../lib/websocket/protocol';

const log = scopedLogger('gateway');

/**
 * Entrypoint do gateway WebSocket.
 *
 * Processo SEPARADO da aplicação Next, de propósito: funções serverless não
 * mantêm conexões de longa duração, então o WebSocket precisa de um host que
 * segure processos (Railway, Fly.io, Render, uma VPS). O frontend só conhece o
 * `NEXT_PUBLIC_WS_URL`, então mudar de host não exige tocar no cliente.
 * Ver README > "WebSockets e Vercel".
 */
async function main() {
  const env = serverEnv();

  const httpServer = createServer((request, response) => {
    // Health check para o orquestrador saber se o processo está vivo.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', connections: gateway.connectionCount }));
      return;
    }

    response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Este endereço aceita apenas conexões WebSocket.');
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_INBOUND_MESSAGE_BYTES,
  });

  const bus = new RealtimeBus(env.DATABASE_URL);
  const gateway = new Gateway({ wss, bus, allowedOrigins: env.WS_ALLOWED_ORIGINS });

  // A validação de origem acontece ANTES do handshake: uma conexão recusada aqui
  // nunca chega a existir como WebSocket.
  httpServer.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;

    if (!gateway.isOriginAllowed(origin)) {
      log.warn({ origin, event: 'gateway.origin_rejected' }, 'Origem não autorizada recusada');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  await bus.start();
  gateway.start();
  const stopSweeper = startSweeper();

  // Ping do protocolo WebSocket, complementar ao heartbeat da aplicação: detecta
  // sockets mortos que nem chegam a enviar mensagens.
  const pingTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.ping();
    }
  }, 30_000);

  httpServer.listen(env.WS_PORT, () => {
    log.info(
      { port: env.WS_PORT, instanceId: gateway.instanceId, origins: env.WS_ALLOWED_ORIGINS, event: 'gateway.started' },
      `Gateway WebSocket ouvindo na porta ${env.WS_PORT}`,
    );
  });

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal, event: 'gateway.shutdown' }, 'Encerrando gateway');

    clearInterval(pingTimer);
    stopSweeper();

    await gateway.shutdown();
    await bus.stop();

    for (const client of wss.clients) {
      client.close(CLOSE_CODES.GOING_AWAY, 'Servidor encerrando');
    }

    httpServer.close();
    await disconnectDb();

    // Dá uma janela curta para os closes saírem antes de matar o processo.
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason, event: 'gateway.unhandled_rejection' }, 'Promise rejeitada sem tratamento');
  });
}

main().catch((error: unknown) => {
  log.error({ err: error, event: 'gateway.fatal' }, 'Falha fatal ao iniciar o gateway');
  process.exit(1);
});
