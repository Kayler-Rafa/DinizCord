import { db } from './db';
import { PUBLIC_USER_SELECT, toVoiceParticipantDTO } from '../lib/db/mappers';
import type { PresenceDTO, PresenceStatus, VoiceParticipantDTO } from '../lib/types';

/**
 * Camada de estado efêmero da presença.
 *
 * Tudo aqui vive em tabelas com heartbeat e TTL, não em memória do processo.
 * Isso é o que permite rodar mais de uma instância do gateway e sobreviver a um
 * `kill -9`: quem morre para de dar heartbeat e o sweeper limpa.
 */

/**
 * Como combinar as várias conexões de uma mesma pessoa.
 *
 * Vence a sessão MAIS disponível. O motivo é a ausência automática: quem deixa
 * uma aba em segundo plano e conversa em outra continua disponível, e a aba
 * esquecida não deve arrastar a pessoa para "ausente".
 *
 * Isso não enfraquece o "não perturbe": uma escolha explícita é propagada para
 * todas as sessões do usuário (ver `setPresenceStatus` com escopo `user`), então
 * não sobra nenhuma sessão "mais disponível" para vencer.
 */
const AVAILABILITY_RANK: Record<PresenceStatus, number> = {
  ONLINE: 3,
  IDLE: 2,
  DO_NOT_DISTURB: 1,
  OFFLINE: 0,
};

export function mostAvailableStatus(statuses: PresenceStatus[]): PresenceStatus {
  return statuses.reduce<PresenceStatus>(
    (best, current) => (AVAILABILITY_RANK[current] > AVAILABILITY_RANK[best] ? current : best),
    'OFFLINE',
  );
}

export async function registerPresence(params: {
  connectionId: string;
  userId: string;
  instanceId: string;
  status: PresenceStatus;
  activity: string | null;
}): Promise<void> {
  await db().presenceSession.create({
    data: {
      id: params.connectionId,
      userId: params.userId,
      instanceId: params.instanceId,
      status: params.status,
      activity: params.activity,
    },
  });
}

/** Renova o heartbeat de várias conexões de uma vez. */
export async function touchPresence(connectionIds: string[]): Promise<void> {
  if (connectionIds.length === 0) return;

  const now = new Date();

  await db().presenceSession.updateMany({
    where: { id: { in: connectionIds } },
    data: { lastHeartbeatAt: now },
  });

  await db().voiceSession.updateMany({
    where: { id: { in: connectionIds } },
    data: { lastHeartbeatAt: now },
  });
}

export async function setPresenceStatus(params: {
  connectionId: string;
  userId: string;
  status: PresenceStatus;
  activity: string | null | undefined;
  /**
   * `user` propaga para todas as conexões da pessoa (escolha explícita);
   * `connection` afeta só esta aba (ausência automática por inatividade).
   */
  scope: 'user' | 'connection';
}): Promise<void> {
  const data = {
    status: params.status,
    ...(params.activity !== undefined ? { activity: params.activity } : {}),
  };

  if (params.scope === 'user') {
    await db().presenceSession.updateMany({ where: { userId: params.userId }, data });
    return;
  }

  await db().presenceSession.updateMany({ where: { id: params.connectionId }, data });
}

export async function removePresence(connectionId: string): Promise<void> {
  await db()
    .presenceSession.delete({ where: { id: connectionId } })
    .catch(() => undefined);
}

/**
 * Presença efetiva de um usuário: OFFLINE quando não sobrou nenhuma sessão viva.
 */
export async function computePresence(userId: string): Promise<PresenceDTO> {
  const sessions = await db().presenceSession.findMany({
    where: { userId },
    select: { status: true, activity: true, lastHeartbeatAt: true },
    orderBy: { lastHeartbeatAt: 'desc' },
  });

  if (sessions.length === 0) {
    const user = await db().user.findUnique({ where: { id: userId }, select: { activity: true } });
    return { userId, status: 'OFFLINE', activity: user?.activity ?? null };
  }

  return {
    userId,
    status: mostAvailableStatus(sessions.map((session) => session.status)),
    activity: sessions[0]?.activity ?? null,
  };
}

/** Presença de todos os membros dos servidores informados. */
export async function presencesForServers(serverIds: string[]): Promise<PresenceDTO[]> {
  if (serverIds.length === 0) return [];

  const members = await db().serverMember.findMany({
    where: { serverId: { in: serverIds } },
    select: { userId: true, user: { select: { activity: true } } },
    distinct: ['userId'],
  });

  const sessions = await db().presenceSession.findMany({
    where: { userId: { in: members.map((member) => member.userId) } },
    select: { userId: true, status: true, activity: true, lastHeartbeatAt: true },
    orderBy: { lastHeartbeatAt: 'desc' },
  });

  const byUser = new Map<string, { statuses: PresenceStatus[]; activity: string | null }>();
  for (const session of sessions) {
    const entry = byUser.get(session.userId) ?? { statuses: [], activity: session.activity };
    entry.statuses.push(session.status);
    byUser.set(session.userId, entry);
  }

  return members.map((member) => {
    const entry = byUser.get(member.userId);
    return {
      userId: member.userId,
      status: entry ? mostAvailableStatus(entry.statuses) : 'OFFLINE',
      activity: entry?.activity ?? member.user.activity,
    };
  });
}

export async function voiceParticipantsForServers(
  serverIds: string[],
): Promise<VoiceParticipantDTO[]> {
  if (serverIds.length === 0) return [];

  const sessions = await db().voiceSession.findMany({
    where: { channel: { serverId: { in: serverIds } } },
    select: {
      id: true,
      channelId: true,
      selfMute: true,
      selfDeaf: true,
      screenSharing: true,
      joinedAt: true,
      user: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return sessions.map(toVoiceParticipantDTO);
}

/** Ids dos servidores de que o usuário participa. */
export async function serverIdsForUser(userId: string): Promise<string[]> {
  const memberships = await db().serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  return memberships.map((membership) => membership.serverId);
}
