import 'server-only';

import { prisma } from '@/lib/db/client';
import { scopedLogger } from '@/lib/logger';
import type { ServerEvent } from '@/lib/websocket/protocol';

const log = scopedLogger('realtime');

/**
 * Publica um evento realtime a partir da aplicação Next (route handlers).
 *
 * A publicação é deliberadamente *não bloqueante em caso de falha*: se o
 * barramento cair, a mensagem já foi gravada e o cliente a recebe ao recarregar
 * o histórico. Derrubar o POST porque o broadcast falhou seria trocar uma
 * degradação por um erro.
 */
export async function publishEvent(topic: string, event: ServerEvent): Promise<void> {
  try {
    await prisma.realtimeEvent.create({
      data: { topic, payload: event as unknown as object },
    });
  } catch (error) {
    log.error(
      { err: error, topic, type: event.t, event: 'realtime.publish_failed' },
      'Falha ao publicar evento realtime',
    );
  }
}

/** Publica o mesmo evento em vários tópicos (ex.: um por sessão de voz). */
export async function publishToMany(topics: string[], event: ServerEvent): Promise<void> {
  if (topics.length === 0) return;

  try {
    await prisma.realtimeEvent.createMany({
      data: topics.map((topic) => ({ topic, payload: event as unknown as object })),
    });
  } catch (error) {
    log.error(
      { err: error, count: topics.length, type: event.t, event: 'realtime.publish_failed' },
      'Falha ao publicar eventos realtime',
    );
  }
}
