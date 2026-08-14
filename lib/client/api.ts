import type {
  ChannelDTO,
  ChannelType,
  InviteDTO,
  InvitePreviewDTO,
  MemberDTO,
  MessageDTO,
  MessagePage,
  SelectableStatus,
  ServerDTO,
  SessionUser,
  UnreadStateDTO,
} from '@/lib/types';

/**
 * Cliente HTTP do navegador.
 *
 * Toda falha vira um `ApiClientError` com mensagem já legível, para que os
 * componentes nunca precisem interpretar status HTTP — eles só exibem
 * `error.message`.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** true quando o problema é a sessão e a UI deve mandar o usuário para o login. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface ErrorPayload {
  error?: { message?: string; code?: string; fields?: Record<string, string> };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      // O cookie de sessão precisa acompanhar toda chamada.
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    // Falha de rede: nem chegou ao servidor.
    throw new ApiClientError(
      'Não foi possível falar com o servidor. Verifique sua conexão.',
      0,
      'NETWORK_ERROR',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const body = payload as ErrorPayload | null;
    throw new ApiClientError(
      body?.error?.message ?? 'Algo deu errado. Tente novamente.',
      response.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.fields ?? {},
    );
  }

  return payload as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  auth: {
    register: (body: {
      email: string;
      username: string;
      displayName: string;
      password: string;
      inviteCode?: string;
    }) => post<{ user: SessionUser; joinedServerId: string | null }>('/api/auth/register', body),

    login: (body: { identifier: string; password: string }) =>
      post<{ user: SessionUser }>('/api/auth/login', body),

    logout: () => post<{ ok: true }>('/api/auth/logout'),

    me: () => get<{ user: SessionUser | null }>('/api/auth/me'),
  },

  me: {
    update: (body: {
      displayName?: string;
      activity?: string | null;
      preferredStatus?: SelectableStatus;
    }) => patch<{ user: SessionUser }>('/api/me', body),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      post<{ ok: true }>('/api/me/password', body),

    /** Envia os bytes crus da imagem já reduzida no navegador. */
    uploadAvatar: async (imagem: Blob) => {
      const resposta = await fetch('/api/me/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': imagem.type || 'application/octet-stream' },
        body: imagem,
      });

      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        const mensagem =
          (corpo as { error?: { message?: string } } | null)?.error?.message ??
          'Não foi possível enviar a foto.';
        throw new ApiClientError(mensagem, resposta.status, 'AVATAR_UPLOAD');
      }

      return (await resposta.json()) as { avatarUrl: string };
    },

    removeAvatar: () => del<{ avatarUrl: null }>('/api/me/avatar'),
  },

  servers: {
    list: () => get<{ servers: ServerDTO[] }>('/api/servers'),

    update: (serverId: string, body: { name?: string; iconEmoji?: string }) =>
      patch<{ server: { id: string; name: string; iconEmoji: string } }>(
        `/api/servers/${serverId}`,
        body,
      ),

    members: (serverId: string) => get<{ members: MemberDTO[] }>(`/api/servers/${serverId}/members`),

    updateMember: (serverId: string, userId: string, body: { role: 'ADMIN' | 'MEMBER' }) =>
      patch<{ member: MemberDTO }>(`/api/servers/${serverId}/members/${userId}`, body),

    removeMember: (serverId: string, userId: string) =>
      del<{ ok: true }>(`/api/servers/${serverId}/members/${userId}`),

    unreads: (serverId: string) =>
      get<{ unreads: UnreadStateDTO[] }>(`/api/servers/${serverId}/unreads`),

    createChannel: (serverId: string, body: { name: string; type: ChannelType; topic?: string | null }) =>
      post<{ channel: ChannelDTO }>(`/api/servers/${serverId}/channels`, body),
  },

  channels: {
    update: (channelId: string, body: { name?: string; topic?: string | null }) =>
      patch<{ channel: ChannelDTO }>(`/api/channels/${channelId}`, body),

    remove: (channelId: string) => del<{ ok: true }>(`/api/channels/${channelId}`),

    messages: (channelId: string, options: { cursor?: string | null; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.limit) params.set('limit', String(options.limit));
      const query = params.toString();
      return get<MessagePage>(`/api/channels/${channelId}/messages${query ? `?${query}` : ''}`);
    },

    send: (channelId: string, body: { content: string; replyToId?: string | null }) =>
      post<{ message: MessageDTO }>(`/api/channels/${channelId}/messages`, body),

    markRead: (channelId: string) => post<{ ok: true }>(`/api/channels/${channelId}/read`),
  },

  messages: {
    edit: (messageId: string, content: string) =>
      patch<{ message: MessageDTO }>(`/api/messages/${messageId}`, { content }),

    remove: (messageId: string) => del<{ ok: true }>(`/api/messages/${messageId}`),

    toggleReaction: (messageId: string, emoji: string) =>
      post<{ reactions: MessageDTO['reactions'] }>(`/api/messages/${messageId}/reactions`, { emoji }),
  },

  invites: {
    list: (serverId: string) => get<{ invites: InviteDTO[] }>(`/api/servers/${serverId}/invites`),

    create: (serverId: string, body: { expiresInSeconds: number | null; maxUses: number | null }) =>
      post<{ invite: InviteDTO }>(`/api/servers/${serverId}/invites`, body),

    revoke: (inviteId: string) => del<{ ok: true }>(`/api/invites/${inviteId}`),

    preview: (code: string) =>
      get<{ invite: InvitePreviewDTO; authenticated: boolean }>(`/api/invites/code/${code}`),

    accept: (code: string) =>
      post<{ serverId: string; joined: boolean }>(`/api/invites/code/${code}`),
  },

  terms: {
    accept: () => post<{ acceptedAt: string; version: string }>('/api/terms/accept'),
  },

  gateway: {
    ticket: () => post<{ ticket: string; expiresIn: number }>('/api/gateway/ticket'),
  },

  webrtc: {
    iceConfig: () =>
      get<{ iceServers: RTCIceServer[]; hasTurn: boolean }>('/api/webrtc/ice'),
  },
};
