import 'server-only';

import { prisma } from '@/lib/db/client';
import { ApiError } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import { toChannelDTO, toMemberDTO, PUBLIC_USER_SELECT } from '@/lib/db/mappers';
import { slugifyChannelName } from '@/lib/utils';
import { scopedLogger } from '@/lib/logger';
import type { ChannelDTO, ChannelType, MemberDTO, MemberRole, ServerDTO } from '@/lib/types';

const log = scopedLogger('servers');

const CHANNEL_SELECT = {
  id: true,
  serverId: true,
  name: true,
  type: true,
  topic: true,
  position: true,
} as const;

/**
 * Servidores de que o usuário participa, já com os canais.
 *
 * Uma consulta só: a sidebar precisa de tudo isso junto, e o app é pequeno o
 * bastante para que carregar os canais de todos os servidores do usuário seja
 * mais barato do que uma requisição por servidor.
 */
export async function listServersForUser(userId: string): Promise<ServerDTO[]> {
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: {
      role: true,
      server: {
        select: {
          id: true,
          name: true,
          slug: true,
          iconEmoji: true,
          ownerId: true,
          channels: {
            select: CHANNEL_SELECT,
            orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });

  return memberships.map((membership) => ({
    id: membership.server.id,
    name: membership.server.name,
    slug: membership.server.slug,
    iconEmoji: membership.server.iconEmoji,
    ownerId: membership.server.ownerId,
    viewerRole: membership.role,
    channels: membership.server.channels.map(toChannelDTO),
  }));
}

export async function listMembers(serverId: string): Promise<MemberDTO[]> {
  const members = await prisma.serverMember.findMany({
    where: { serverId },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    select: {
      id: true,
      role: true,
      nickname: true,
      joinedAt: true,
      user: { select: PUBLIC_USER_SELECT },
    },
  });

  return members.map(toMemberDTO);
}

export async function createChannel(params: {
  serverId: string;
  name: string;
  type: ChannelType;
  topic?: string | null;
}): Promise<ChannelDTO> {
  // Canais de texto usam slug (`# jogos-em-geral`); os de voz mantêm o nome como
  // escrito, já que são rótulos de sala e não menções.
  const name = params.type === 'TEXT' ? slugifyChannelName(params.name) : params.name.trim();

  if (!name) {
    throw ApiError.validation({
      name: 'Use ao menos uma letra ou número no nome do canal.',
    });
  }

  const duplicate = await prisma.channel.findUnique({
    where: { serverId_type_name: { serverId: params.serverId, type: params.type, name } },
    select: { id: true },
  });

  if (duplicate) {
    throw ApiError.validation({ name: 'Já existe um canal com esse nome.' });
  }

  const last = await prisma.channel.findFirst({
    where: { serverId: params.serverId, type: params.type },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const channel = await prisma.channel.create({
    data: {
      serverId: params.serverId,
      name,
      type: params.type,
      topic: params.topic?.trim() || null,
      position: (last?.position ?? -1) + 1,
    },
    select: CHANNEL_SELECT,
  });

  const dto = toChannelDTO(channel);
  await publishEvent(Topic.server(params.serverId), { t: 'channel:create', channel: dto });

  log.info(
    { serverId: params.serverId, channelId: channel.id, type: channel.type, event: 'channel.created' },
    'Canal criado',
  );

  return dto;
}

export async function updateChannel(
  channelId: string,
  serverId: string,
  currentType: ChannelType,
  patch: { name?: string; topic?: string | null; position?: number },
): Promise<ChannelDTO> {
  const data: { name?: string; topic?: string | null; position?: number } = {};

  if (patch.name !== undefined) {
    const name = currentType === 'TEXT' ? slugifyChannelName(patch.name) : patch.name.trim();
    if (!name) {
      throw ApiError.validation({ name: 'Use ao menos uma letra ou número no nome do canal.' });
    }

    const duplicate = await prisma.channel.findUnique({
      where: { serverId_type_name: { serverId, type: currentType, name } },
      select: { id: true },
    });

    if (duplicate && duplicate.id !== channelId) {
      throw ApiError.validation({ name: 'Já existe um canal com esse nome.' });
    }

    data.name = name;
  }

  if (patch.topic !== undefined) data.topic = patch.topic?.trim() || null;
  if (patch.position !== undefined) data.position = patch.position;

  const channel = await prisma.channel.update({
    where: { id: channelId },
    data,
    select: CHANNEL_SELECT,
  });

  const dto = toChannelDTO(channel);
  await publishEvent(Topic.server(serverId), { t: 'channel:update', channel: dto });

  return dto;
}

export async function deleteChannel(channelId: string, serverId: string): Promise<void> {
  const remaining = await prisma.channel.count({ where: { serverId, type: 'TEXT' } });
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { type: true },
  });

  // Um servidor sem nenhum canal de texto vira uma tela vazia sem saída — o app
  // não teria onde colocar o usuário ao entrar.
  if (channel?.type === 'TEXT' && remaining <= 1) {
    throw ApiError.conflict('O servidor precisa de pelo menos um canal de texto.');
  }

  await prisma.channel.delete({ where: { id: channelId } });
  await publishEvent(Topic.server(serverId), { t: 'channel:delete', serverId, channelId });

  log.info({ serverId, channelId, event: 'channel.deleted' }, 'Canal excluído');
}

export async function updateServer(
  serverId: string,
  patch: { name?: string; iconEmoji?: string },
): Promise<{ id: string; name: string; iconEmoji: string; slug: string }> {
  const server = await prisma.server.update({
    where: { id: serverId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.iconEmoji !== undefined ? { iconEmoji: patch.iconEmoji } : {}),
    },
    select: { id: true, name: true, iconEmoji: true, slug: true },
  });

  await publishEvent(Topic.server(serverId), {
    t: 'server:update',
    serverId,
    name: server.name,
    iconEmoji: server.iconEmoji,
  });

  return server;
}

/**
 * Remove um membro.
 *
 * O dono não pode ser removido nem sair — antes ele precisaria transferir a
 * propriedade, o que evita servidor órfão. Administradores só removem membros
 * comuns; hierarquia igual não se remove.
 */
export async function removeMember(params: {
  serverId: string;
  targetUserId: string;
  actorUserId: string;
  actorRole: MemberRole;
}): Promise<void> {
  const target = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: params.serverId, userId: params.targetUserId } },
    select: { role: true },
  });

  if (!target) {
    throw ApiError.notFound('Este membro não faz parte do servidor.');
  }

  if (target.role === 'OWNER') {
    throw ApiError.forbidden('O dono do servidor não pode ser removido.');
  }

  const isSelf = params.targetUserId === params.actorUserId;

  if (!isSelf) {
    if (params.actorRole === 'MEMBER') {
      throw ApiError.forbidden('Você não tem permissão para remover membros.');
    }
    if (params.actorRole === 'ADMIN' && target.role === 'ADMIN') {
      throw ApiError.forbidden('Administradores não podem remover outros administradores.');
    }
  }

  await prisma.serverMember.delete({
    where: { serverId_userId: { serverId: params.serverId, userId: params.targetUserId } },
  });

  // Se estava em um canal de voz deste servidor, a sessão precisa cair junto.
  await prisma.voiceSession.deleteMany({
    where: { userId: params.targetUserId, channel: { serverId: params.serverId } },
  });

  await publishEvent(Topic.server(params.serverId), {
    t: 'member:leave',
    serverId: params.serverId,
    userId: params.targetUserId,
  });

  log.info(
    {
      serverId: params.serverId,
      targetUserId: params.targetUserId,
      actorUserId: params.actorUserId,
      event: 'member.removed',
    },
    isSelf ? 'Membro saiu do servidor' : 'Membro removido do servidor',
  );
}

/** Promove/rebaixa um membro. Só o dono mexe em papéis. */
export async function updateMemberRole(params: {
  serverId: string;
  targetUserId: string;
  role: 'ADMIN' | 'MEMBER';
}): Promise<MemberDTO> {
  const target = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: params.serverId, userId: params.targetUserId } },
    select: { role: true },
  });

  if (!target) {
    throw ApiError.notFound('Este membro não faz parte do servidor.');
  }

  if (target.role === 'OWNER') {
    throw ApiError.forbidden('O papel do dono não pode ser alterado.');
  }

  const member = await prisma.serverMember.update({
    where: { serverId_userId: { serverId: params.serverId, userId: params.targetUserId } },
    data: { role: params.role },
    select: {
      id: true,
      role: true,
      nickname: true,
      joinedAt: true,
      user: { select: PUBLIC_USER_SELECT },
    },
  });

  const dto = toMemberDTO(member);
  await publishEvent(Topic.server(params.serverId), {
    t: 'member:update',
    serverId: params.serverId,
    member: dto,
  });

  log.info(
    { serverId: params.serverId, targetUserId: params.targetUserId, role: params.role, event: 'member.role_changed' },
    'Papel de membro alterado',
  );

  return dto;
}
