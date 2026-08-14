import 'server-only';

import { prisma } from '@/lib/db/client';
import { ApiError } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import { MESSAGE_INCLUDE, groupReactions, toMessageDTO } from '@/lib/db/mappers';
import { extrairMencoes } from '@/lib/mentions';
import { scopedLogger } from '@/lib/logger';
import type { MessageDTO, MessagePage, UnreadStateDTO } from '@/lib/types';

const log = scopedLogger('messages');

/**
 * Histórico paginado por cursor.
 *
 * Cursor (e não OFFSET) porque o canal recebe mensagens novas enquanto o usuário
 * rola: com OFFSET, cada mensagem nova empurraria a janela e o leitor veria
 * itens repetidos ou pulados. O cursor ancora numa mensagem concreta.
 *
 * Mensagens apagadas não entram na listagem; elas continuam no banco só para que
 * respostas a elas não percam a referência.
 */
export async function listMessages(params: {
  channelId: string;
  viewerId: string;
  cursor?: string | null;
  limit: number;
}): Promise<MessagePage> {
  const { channelId, viewerId, cursor, limit } = params;

  const rows = await prisma.message.findMany({
    where: { channelId, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: MESSAGE_INCLUDE,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

  return {
    // A consulta vem do mais novo para o mais antigo; a UI renderiza ao contrário.
    messages: page.reverse().map((message) => toMessageDTO(message, viewerId)),
    nextCursor,
    hasMore,
  };
}

export async function createMessage(params: {
  channelId: string;
  serverId: string;
  authorId: string;
  content: string;
  replyToId?: string | null;
}): Promise<MessageDTO> {
  // A resposta precisa apontar para uma mensagem do MESMO canal — sem essa
  // checagem daria para citar mensagem de canal alheio e vazar o conteúdo dela.
  if (params.replyToId) {
    const target = await prisma.message.findUnique({
      where: { id: params.replyToId },
      select: { channelId: true },
    });

    if (!target || target.channelId !== params.channelId) {
      throw ApiError.badRequest('A mensagem que você respondeu não existe mais neste canal.');
    }
  }

  const message = await prisma.message.create({
    data: {
      channelId: params.channelId,
      authorId: params.authorId,
      content: params.content,
      replyToId: params.replyToId ?? null,
      mentions: await resolverMencoes(params.content, params.serverId, params.authorId),
    },
    include: MESSAGE_INCLUDE,
  });

  // O DTO do broadcast não tem "viewer": cada cliente calcula `reactedByMe`
  // localmente a partir do próprio id.
  await publishEvent(Topic.server(params.serverId), {
    t: 'message:create',
    message: toMessageDTO(message, null),
  });

  return toMessageDTO(message, params.authorId);
}

/**
 * Converte `@nome` em ids de usuário.
 *
 * Só resolve nomes de quem é MEMBRO do servidor: citar alguém de fora não pode
 * gerar notificação nem revelar que aquela conta existe. O próprio autor é
 * descartado — ninguém precisa ser notificado da própria mensagem.
 */
async function resolverMencoes(
  conteudo: string,
  serverId: string,
  authorId: string,
): Promise<string[]> {
  const nomes = extrairMencoes(conteudo);
  if (nomes.length === 0) return [];

  const membros = await prisma.serverMember.findMany({
    where: { serverId, user: { username: { in: nomes } } },
    select: { userId: true },
  });

  return membros.map((membro) => membro.userId).filter((id) => id !== authorId);
}

export async function editMessage(params: {
  messageId: string;
  serverId: string;
  viewerId: string;
  content: string;
}): Promise<MessageDTO> {
  const message = await prisma.message.update({
    where: { id: params.messageId },
    data: {
      content: params.content,
      editedAt: new Date(),
      mentions: await resolverMencoes(params.content, params.serverId, params.viewerId),
    },
    include: MESSAGE_INCLUDE,
  });

  await publishEvent(Topic.server(params.serverId), {
    t: 'message:update',
    message: toMessageDTO(message, null),
  });

  return toMessageDTO(message, params.viewerId);
}

export async function deleteMessage(params: {
  messageId: string;
  channelId: string;
  serverId: string;
  actorId: string;
}): Promise<void> {
  // Exclusão lógica: o conteúdo é zerado (não fica "apagado" só na interface) e
  // as reações somem, mas a linha permanece para não quebrar quem respondeu.
  await prisma.$transaction([
    prisma.message.update({
      where: { id: params.messageId },
      data: { deletedAt: new Date(), content: '' },
    }),
    prisma.messageReaction.deleteMany({ where: { messageId: params.messageId } }),
  ]);

  await publishEvent(Topic.server(params.serverId), {
    t: 'message:delete',
    channelId: params.channelId,
    messageId: params.messageId,
  });

  log.info(
    { messageId: params.messageId, actorId: params.actorId, event: 'message.deleted' },
    'Mensagem excluída',
  );
}

/**
 * Alterna a reação do usuário e devolve o estado consolidado.
 *
 * O `delete` é tentado primeiro: se existia, some; se não existia, cria. A
 * unique key (messageId, userId, emoji) impede duplicata mesmo com dois cliques
 * simultâneos.
 */
export async function toggleReaction(params: {
  messageId: string;
  channelId: string;
  serverId: string;
  userId: string;
  emoji: string;
}): Promise<MessageDTO['reactions']> {
  const message = await prisma.message.findUnique({
    where: { id: params.messageId },
    select: { deletedAt: true },
  });

  if (!message || message.deletedAt) {
    throw ApiError.notFound('Esta mensagem não existe mais.');
  }

  const removed = await prisma.messageReaction.deleteMany({
    where: { messageId: params.messageId, userId: params.userId, emoji: params.emoji },
  });

  if (removed.count === 0) {
    await prisma.messageReaction.create({
      data: { messageId: params.messageId, userId: params.userId, emoji: params.emoji },
    });
  }

  const reactions = await prisma.messageReaction.findMany({
    where: { messageId: params.messageId },
    select: { emoji: true, userId: true, user: { select: { displayName: true } } },
  });

  const grouped = groupReactions(reactions, null);

  await publishEvent(Topic.server(params.serverId), {
    t: 'message:reactions',
    channelId: params.channelId,
    messageId: params.messageId,
    // `userIds` deixa cada cliente decidir se ele mesmo reagiu, sem uma consulta
    // extra por usuário.
    reactions: grouped.map((group) => ({
      emoji: group.emoji,
      count: group.count,
      users: group.users,
      userIds: reactions.filter((r) => r.emoji === group.emoji).map((r) => r.userId),
    })),
  });

  return groupReactions(reactions, params.userId);
}

/** Marca o canal como lido até agora. */
export async function markChannelRead(userId: string, channelId: string): Promise<void> {
  const now = new Date();
  await prisma.channelReadState.upsert({
    where: { userId_channelId: { userId, channelId } },
    update: { lastReadAt: now },
    create: { userId, channelId, lastReadAt: now },
  });
}

/**
 * Quantidade de mensagens não lidas por canal de texto do servidor.
 *
 * Mensagens do próprio usuário não contam — ninguém tem notificação da própria
 * fala. Canais nunca abertos contam tudo desde a entrada no servidor.
 */
export async function unreadStates(userId: string, serverId: string): Promise<UnreadStateDTO[]> {
  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    select: { joinedAt: true },
  });

  if (!membership) return [];

  const channels = await prisma.channel.findMany({
    where: { serverId, type: 'TEXT' },
    select: {
      id: true,
      readStates: { where: { userId }, select: { lastReadAt: true }, take: 1 },
    },
  });

  return Promise.all(
    channels.map(async (channel) => {
      const lastReadAt = channel.readStates[0]?.lastReadAt ?? membership.joinedAt;

      const unreadCount = await prisma.message.count({
        where: {
          channelId: channel.id,
          deletedAt: null,
          authorId: { not: userId },
          createdAt: { gt: lastReadAt },
        },
      });

      return {
        channelId: channel.id,
        unreadCount,
        lastReadAt: channel.readStates[0]?.lastReadAt.toISOString() ?? null,
      };
    }),
  );
}
