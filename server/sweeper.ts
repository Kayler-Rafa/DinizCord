import { db } from './db';
import { publishMany } from './bus';
import { computePresence } from './presence';
import { scopedLogger } from '../lib/logger';
import { Topic, EVENT_RETENTION_MS } from '../lib/realtime/topics';
import { PRESENCE_STALE_MS, SWEEP_INTERVAL_MS } from '../lib/websocket/protocol';
import type { ServerEvent } from '../lib/websocket/protocol';

const log = scopedLogger('sweeper');

/**
 * Chave do advisory lock do PostgreSQL.
 *
 * Com várias instâncias do gateway, todas rodariam o sweeper ao mesmo tempo e
 * publicariam eventos duplicados. O lock garante que apenas uma varre por vez;
 * as outras simplesmente pulam a rodada.
 */
const SWEEP_LOCK_KEY = 728_411_903;

/**
 * Remove sessões efêmeras órfãs.
 *
 * Uma sessão fica órfã quando o processo que a criou morreu sem encerrar
 * (kill -9, queda da máquina, deploy abrupto). Sem esta varredura, o usuário
 * ficaria "online" para sempre e o canal de voz mostraria um fantasma.
 */
export async function sweepOnce(): Promise<{ presence: number; voice: number; events: number }> {
  const prisma = db();

  const [lock] = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS acquired
  `;

  if (!lock?.acquired) {
    return { presence: 0, voice: 0, events: 0 };
  }

  try {
    const cutoff = new Date(Date.now() - PRESENCE_STALE_MS);

    const staleVoice = await prisma.voiceSession.findMany({
      where: { lastHeartbeatAt: { lt: cutoff } },
      select: {
        id: true,
        userId: true,
        channelId: true,
        channel: { select: { serverId: true } },
      },
    });

    const stalePresence = await prisma.presenceSession.findMany({
      where: { lastHeartbeatAt: { lt: cutoff } },
      select: { id: true, userId: true },
    });

    const events: Array<{ topic: string; event: ServerEvent }> = [];

    if (staleVoice.length > 0) {
      await prisma.voiceSession.deleteMany({
        where: { id: { in: staleVoice.map((session) => session.id) } },
      });

      for (const session of staleVoice) {
        events.push({
          topic: Topic.server(session.channel.serverId),
          event: {
            t: 'voice:leave',
            sessionId: session.id,
            channelId: session.channelId,
            userId: session.userId,
          },
        });
      }
    }

    if (stalePresence.length > 0) {
      await prisma.presenceSession.deleteMany({
        where: { id: { in: stalePresence.map((session) => session.id) } },
      });

      // Só anuncia quem realmente ficou sem nenhuma conexão viva.
      const affectedUsers = [...new Set(stalePresence.map((session) => session.userId))];

      for (const userId of affectedUsers) {
        const presence = await computePresence(userId);
        const memberships = await prisma.serverMember.findMany({
          where: { userId },
          select: { serverId: true },
        });

        for (const membership of memberships) {
          events.push({
            topic: Topic.server(membership.serverId),
            event: { t: 'presence:update', presence },
          });
        }
      }
    }

    await publishMany(events);

    // O outbox só precisa reter o suficiente para a entrega; nada aqui é
    // histórico. Deixar crescer seria vazamento de espaço em disco.
    const { count: events_removed } = await prisma.realtimeEvent.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - EVENT_RETENTION_MS) } },
    });

    if (staleVoice.length > 0 || stalePresence.length > 0) {
      log.info(
        {
          presence: stalePresence.length,
          voice: staleVoice.length,
          event: 'sweeper.cleaned',
        },
        'Sessões órfãs removidas',
      );
    }

    return { presence: stalePresence.length, voice: staleVoice.length, events: events_removed };
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`.catch(() => undefined);
  }
}

/** Manutenção menos frequente: sessões de login e tentativas antigas. */
export async function pruneOnce(): Promise<void> {
  const prisma = db();

  await prisma.userSession
    .deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        ],
      },
    })
    .catch((error: unknown) => {
      log.warn({ err: error, event: 'sweeper.prune_sessions_failed' }, 'Falha ao limpar sessões');
    });

  await prisma.loginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    .catch((error: unknown) => {
      log.warn({ err: error, event: 'sweeper.prune_attempts_failed' }, 'Falha ao limpar tentativas');
    });
}

export function startSweeper(): () => void {
  const sweepTimer = setInterval(() => {
    void sweepOnce().catch((error: unknown) => {
      log.error({ err: error, event: 'sweeper.failed' }, 'Falha na varredura de sessões');
    });
  }, SWEEP_INTERVAL_MS);

  // Manutenção pesada uma vez por hora.
  const pruneTimer = setInterval(
    () => {
      void pruneOnce();
    },
    60 * 60 * 1000,
  );

  return () => {
    clearInterval(sweepTimer);
    clearInterval(pruneTimer);
  };
}
