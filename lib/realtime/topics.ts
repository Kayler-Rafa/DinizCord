/**
 * Tópicos do barramento realtime.
 *
 * Três escopos, do mais amplo ao mais estreito:
 *  - `server:<id>`  → todos os membros conectados daquele servidor;
 *  - `user:<id>`    → todas as conexões de um usuário (várias abas);
 *  - `session:<id>` → uma conexão específica (usado no signaling WebRTC, onde a
 *                     mensagem é endereçada a um peer e não a uma pessoa).
 */
export const Topic = {
  server: (serverId: string) => `server:${serverId}`,
  user: (userId: string) => `user:${userId}`,
  session: (sessionId: string) => `session:${sessionId}`,
} as const;

export type TopicScope = 'server' | 'user' | 'session';

export function parseTopic(topic: string): { scope: TopicScope; id: string } | null {
  const separator = topic.indexOf(':');
  if (separator === -1) return null;

  const scope = topic.slice(0, separator);
  const id = topic.slice(separator + 1);
  if (!id) return null;

  if (scope === 'server' || scope === 'user' || scope === 'session') {
    return { scope, id };
  }
  return null;
}

/** Canal do PostgreSQL usado no LISTEN/NOTIFY. */
export const PG_NOTIFY_CHANNEL = 'dinizcord_events';

/**
 * Canal usado só para o autoteste de inicialização do gateway.
 *
 * Separado do canal real para que a mensagem de teste não seja confundida com
 * o id de um evento do outbox.
 */
export const PG_SELFTEST_CHANNEL = 'dinizcord_selftest';

/** Eventos mais antigos que isto são descartados pelo sweeper. */
export const EVENT_RETENTION_MS = 5 * 60 * 1000;
