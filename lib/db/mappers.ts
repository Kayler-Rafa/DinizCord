import type {
  ChannelDTO,
  MemberDTO,
  MessageDTO,
  PublicUser,
  ReactionGroup,
  VoiceParticipantDTO,
} from '@/lib/types';

/**
 * Conversão de linhas do banco para DTOs.
 *
 * Módulo puro e sem `server-only`: o gateway WebSocket (processo separado)
 * precisa produzir exatamente os mesmos objetos que a API REST, senão o cliente
 * receberia formatos diferentes para a mesma entidade.
 *
 * As constantes `*_SELECT` são a garantia de que campos sensíveis (passwordHash,
 * email de terceiros) nunca entram na consulta — não há como esquecer de
 * removê-los depois se nunca foram buscados.
 */

export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  avatarUpdatedAt: true,
} as const;

export const MESSAGE_INCLUDE = {
  author: { select: PUBLIC_USER_SELECT },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      author: { select: PUBLIC_USER_SELECT },
    },
  },
  reactions: {
    select: {
      emoji: true,
      userId: true,
      user: { select: { displayName: true } },
    },
  },
} as const;

interface RawUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUpdatedAt?: Date | null;
}

/**
 * URL da foto, versionada pelo instante do upload.
 *
 * O `?v=` é o que torna seguro o cache imutável no navegador: trocar a foto
 * gera uma URL diferente, então nunca se vê a imagem antiga.
 */
export function avatarUrlFor(user: { id: string; avatarUpdatedAt?: Date | null }): string | null {
  if (!user.avatarUpdatedAt) return null;
  return `/api/users/${user.id}/avatar?v=${user.avatarUpdatedAt.getTime()}`;
}

interface RawReaction {
  emoji: string;
  userId: string;
  user: { displayName: string };
}

interface RawMessage {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  mentions: string[];
  author: RawUser;
  replyTo: {
    id: string;
    content: string;
    deletedAt: Date | null;
    author: RawUser | null;
  } | null;
  reactions: RawReaction[];
}

export function toPublicUser(user: RawUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    avatarUrl: avatarUrlFor(user),
  };
}

/** Texto exibido no lugar de uma mensagem apagada. */
export const DELETED_MESSAGE_PLACEHOLDER = 'Mensagem apagada';

/** Quantos nomes acompanham cada reação no tooltip. */
const REACTION_TOOLTIP_LIMIT = 8;

export function groupReactions(reactions: RawReaction[], viewerId: string | null): ReactionGroup[] {
  const groups = new Map<string, { count: number; users: string[]; reactedByMe: boolean }>();

  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? { count: 0, users: [], reactedByMe: false };
    group.count += 1;
    if (group.users.length < REACTION_TOOLTIP_LIMIT) {
      group.users.push(reaction.user.displayName);
    }
    if (viewerId && reaction.userId === viewerId) {
      group.reactedByMe = true;
    }
    groups.set(reaction.emoji, group);
  }

  return [...groups.entries()]
    .map(([emoji, group]) => ({ emoji, ...group }))
    // Mais reagidas primeiro; empate resolvido pelo emoji para manter ordem estável.
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function toMessageDTO(message: RawMessage, viewerId: string | null): MessageDTO {
  const deleted = message.deletedAt !== null;

  return {
    id: message.id,
    channelId: message.channelId,
    // O conteúdo original nunca sai do banco depois do delete lógico.
    content: deleted ? '' : message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deleted,
    author: toPublicUser(message.author),
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          content: message.replyTo.deletedAt ? '' : message.replyTo.content.slice(0, 160),
          deleted: message.replyTo.deletedAt !== null,
          author: message.replyTo.author ? toPublicUser(message.replyTo.author) : null,
        }
      : null,
    reactions: deleted ? [] : groupReactions(message.reactions, viewerId),
    mentions: deleted ? [] : message.mentions,
  };
}

export function toChannelDTO(channel: {
  id: string;
  serverId: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  topic: string | null;
  position: number;
}): ChannelDTO {
  return {
    id: channel.id,
    serverId: channel.serverId,
    name: channel.name,
    type: channel.type,
    topic: channel.topic,
    position: channel.position,
  };
}

export function toMemberDTO(member: {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  nickname: string | null;
  joinedAt: Date;
  user: RawUser;
}): MemberDTO {
  return {
    id: member.id,
    role: member.role,
    nickname: member.nickname,
    joinedAt: member.joinedAt.toISOString(),
    user: toPublicUser(member.user),
  };
}

export function toVoiceParticipantDTO(session: {
  id: string;
  channelId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  screenSharing: boolean;
  joinedAt: Date;
  user: RawUser;
}): VoiceParticipantDTO {
  return {
    sessionId: session.id,
    channelId: session.channelId,
    user: toPublicUser(session.user),
    selfMute: session.selfMute,
    selfDeaf: session.selfDeaf,
    screenSharing: session.screenSharing,
    joinedAt: session.joinedAt.toISOString(),
  };
}
