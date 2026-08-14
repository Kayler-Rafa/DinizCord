/**
 * Tipos de domínio compartilhados entre servidor e cliente.
 *
 * Estes são os DTOs que trafegam pela API REST e pelo WebSocket — deliberadamente
 * separados dos modelos do Prisma para que nada sensível (passwordHash, tokenHash)
 * escape por acidente para o navegador.
 */

export const PRESENCE_STATUSES = ['ONLINE', 'IDLE', 'DO_NOT_DISTURB', 'OFFLINE'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** Status que o usuário pode escolher (OFFLINE é derivado, não escolhido). */
export const SELECTABLE_STATUSES = ['ONLINE', 'IDLE', 'DO_NOT_DISTURB'] as const;
export type SelectableStatus = (typeof SELECTABLE_STATUSES)[number];

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  ONLINE: 'Online',
  IDLE: 'Ausente',
  DO_NOT_DISTURB: 'Não perturbe',
  OFFLINE: 'Offline',
};

export const CHANNEL_TYPES = ['TEXT', 'VOICE'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const MEMBER_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: 'Dono',
  ADMIN: 'Administrador',
  MEMBER: 'Membro',
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /** null quando a pessoa não enviou foto — a interface cai nas iniciais. */
  avatarUrl: string | null;
}

export interface SessionUser extends PublicUser {
  email: string;
  preferredStatus: SelectableStatus;
  activity: string | null;
  /** false enquanto a pessoa não aceitar a versão vigente dos termos. */
  termsAccepted: boolean;
}

export interface MemberDTO {
  id: string;
  role: MemberRole;
  nickname: string | null;
  joinedAt: string;
  user: PublicUser;
}

export interface ChannelDTO {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
}

export interface ServerDTO {
  id: string;
  name: string;
  slug: string;
  iconEmoji: string;
  ownerId: string;
  /** Papel do usuário autenticado neste servidor. */
  viewerRole: MemberRole;
  channels: ChannelDTO[];
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Se o usuário autenticado reagiu com este emoji. */
  reactedByMe: boolean;
  /** Nomes de quem reagiu, para o tooltip (limitado no servidor). */
  users: string[];
}

export interface MessageReplyPreview {
  id: string;
  content: string;
  deleted: boolean;
  author: PublicUser | null;
}

export interface MessageDTO {
  id: string;
  channelId: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: PublicUser;
  replyTo: MessageReplyPreview | null;
  reactions: ReactionGroup[];
  /** Ids dos membros citados com @, já resolvidos pelo servidor. */
  mentions: string[];
}

export interface MessagePage {
  messages: MessageDTO[];
  /** Cursor para buscar a página anterior (mensagens mais antigas). */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PresenceDTO {
  userId: string;
  status: PresenceStatus;
  activity: string | null;
}

export interface VoiceParticipantDTO {
  /** Id da sessão de voz — é também o identificador do peer no mesh WebRTC. */
  sessionId: string;
  channelId: string;
  user: PublicUser;
  selfMute: boolean;
  selfDeaf: boolean;
  screenSharing: boolean;
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  code: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revoked: boolean;
  /** false quando expirou, foi revogado ou esgotou os usos. */
  active: boolean;
  creator: PublicUser;
}

export interface InvitePreviewDTO {
  code: string;
  server: { id: string; name: string; iconEmoji: string; memberCount: number };
  inviter: PublicUser;
  expiresAt: string | null;
  /** Motivo pelo qual o convite não pode ser usado, quando aplicável. */
  invalidReason: 'EXPIRED' | 'REVOKED' | 'MAX_USES' | null;
  /** true quando o visitante já é membro do servidor. */
  alreadyMember: boolean;
}

export interface UnreadStateDTO {
  channelId: string;
  unreadCount: number;
  lastReadAt: string | null;
}
