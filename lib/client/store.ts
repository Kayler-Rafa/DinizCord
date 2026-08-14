import type {
  ChannelDTO,
  MemberDTO,
  MessageDTO,
  PresenceDTO,
  PresenceStatus,
  ServerDTO,
  VoiceParticipantDTO,
} from '@/lib/types';
import type { ServerEvent } from '@/lib/websocket/protocol';
import { TYPING_TIMEOUT_MS } from '@/lib/websocket/protocol';

/**
 * Store da aplicação.
 *
 * Uma classe simples com `subscribe`/`getSnapshot`, consumida pelo React via
 * `useSyncExternalStore`. Sem biblioteca de estado por três motivos: o formato
 * dos dados é ditado pelo protocolo do WebSocket (não por um framework), os
 * componentes assinam fatias específicas (então não há re-render em cascata), e
 * a mesma instância pode ser exercitada em teste sem montar React.
 *
 * Regra de ouro: o store NUNCA é fonte de verdade. Ele é um cache do que o
 * servidor mandou; qualquer coisa que precise sobreviver a um F5 vem do banco.
 */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ChannelMessages {
  messages: MessageDTO[];
  /** Cursor para carregar mensagens mais antigas. */
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface TypingEntry {
  userId: string;
  expiresAt: number;
}

export interface AppState {
  connection: ConnectionState;
  /** Id desta conexão — é o endereço do peer no mesh WebRTC. */
  sessionId: string | null;

  servers: ServerDTO[];
  members: Record<string, MemberDTO[]>;
  presences: Record<string, PresenceDTO>;
  voice: Record<string, VoiceParticipantDTO>;
  messages: Record<string, ChannelMessages>;
  typing: Record<string, TypingEntry[]>;
  unreads: Record<string, number>;
}

const EMPTY_CHANNEL: ChannelMessages = {
  messages: [],
  nextCursor: null,
  hasMore: false,
  loading: false,
  loaded: false,
  error: null,
};

export const initialState: AppState = {
  connection: 'connecting',
  sessionId: null,
  servers: [],
  members: {},
  presences: {},
  voice: {},
  messages: {},
  typing: {},
  unreads: {},
};

type Listener = () => void;

export class AppStore {
  private state: AppState = initialState;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly viewerId: string) {}

  getSnapshot = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(updater: (state: AppState) => AppState): void {
    const next = updater(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  // -------------------------------------------------------------------------
  // Conexão
  // -------------------------------------------------------------------------

  setConnection(connection: ConnectionState): void {
    this.set((state) => (state.connection === connection ? state : { ...state, connection }));
  }

  // -------------------------------------------------------------------------
  // Dados carregados por REST
  // -------------------------------------------------------------------------

  setServers(servers: ServerDTO[]): void {
    this.set((state) => ({ ...state, servers }));
  }

  setMembers(serverId: string, members: MemberDTO[]): void {
    this.set((state) => ({ ...state, members: { ...state.members, [serverId]: members } }));
  }

  setUnreads(entries: Array<{ channelId: string; unreadCount: number }>): void {
    this.set((state) => {
      const unreads = { ...state.unreads };
      for (const entry of entries) unreads[entry.channelId] = entry.unreadCount;
      return { ...state, unreads };
    });
  }

  clearUnread(channelId: string): void {
    this.set((state) => {
      if (!state.unreads[channelId]) return state;
      return { ...state, unreads: { ...state.unreads, [channelId]: 0 } };
    });
  }

  setChannelLoading(channelId: string, loading: boolean): void {
    this.set((state) => ({
      ...state,
      messages: {
        ...state.messages,
        [channelId]: { ...(state.messages[channelId] ?? EMPTY_CHANNEL), loading, error: null },
      },
    }));
  }

  setChannelError(channelId: string, error: string): void {
    this.set((state) => ({
      ...state,
      messages: {
        ...state.messages,
        [channelId]: { ...(state.messages[channelId] ?? EMPTY_CHANNEL), loading: false, error },
      },
    }));
  }

  /** Primeira página do canal — substitui o que houver. */
  setChannelMessages(
    channelId: string,
    page: { messages: MessageDTO[]; nextCursor: string | null; hasMore: boolean },
  ): void {
    this.set((state) => ({
      ...state,
      messages: {
        ...state.messages,
        [channelId]: {
          messages: page.messages,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loading: false,
          loaded: true,
          error: null,
        },
      },
    }));
  }

  /** Página anterior (histórico) — vai para o começo da lista. */
  prependChannelMessages(
    channelId: string,
    page: { messages: MessageDTO[]; nextCursor: string | null; hasMore: boolean },
  ): void {
    this.set((state) => {
      const current = state.messages[channelId] ?? EMPTY_CHANNEL;
      const known = new Set(current.messages.map((message) => message.id));
      const fresh = page.messages.filter((message) => !known.has(message.id));

      return {
        ...state,
        messages: {
          ...state.messages,
          [channelId]: {
            messages: [...fresh, ...current.messages],
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
            loading: false,
            loaded: true,
            error: null,
          },
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Eventos do WebSocket
  // -------------------------------------------------------------------------

  applyEvent(event: ServerEvent): void {
    switch (event.t) {
      case 'ready':
        this.onReady(event);
        return;

      case 'presence:update':
        this.set((state) => ({
          ...state,
          presences: { ...state.presences, [event.presence.userId]: event.presence },
        }));
        return;

      case 'message:create':
        this.upsertMessage(event.message, { countUnread: true });
        return;

      case 'message:update':
        this.upsertMessage(event.message, { countUnread: false });
        return;

      case 'message:delete':
        this.removeMessage(event.channelId, event.messageId);
        return;

      case 'message:reactions':
        this.applyReactions(event);
        return;

      case 'channel:create':
      case 'channel:update':
        this.upsertChannel(event.channel);
        return;

      case 'channel:delete':
        this.removeChannel(event.serverId, event.channelId);
        return;

      case 'server:update':
        this.set((state) => ({
          ...state,
          servers: state.servers.map((server) =>
            server.id === event.serverId
              ? { ...server, name: event.name, iconEmoji: event.iconEmoji }
              : server,
          ),
        }));
        return;

      case 'member:join':
      case 'member:update':
        this.upsertMember(event.serverId, event.member);
        return;

      case 'member:leave':
        this.removeMember(event.serverId, event.userId);
        return;

      case 'typing':
        this.registerTyping(event.channelId, event.userId);
        return;

      case 'voice:join':
      case 'voice:update':
        this.set((state) => ({
          ...state,
          voice: { ...state.voice, [event.participant.sessionId]: event.participant },
        }));
        return;

      case 'user:avatar':
        this.applyAvatarChange(event.userId, event.avatarUrl);
        return;

      case 'voice:leave':
        this.set((state) => {
          if (!state.voice[event.sessionId]) return state;
          const voice = { ...state.voice };
          delete voice[event.sessionId];
          return { ...state, voice };
        });
        return;

      // Tratados fora do store (conexão e WebRTC).
      case 'heartbeat:ack':
      case 'webrtc:signal':
      case 'session:revoked':
      case 'error':
        return;
    }
  }

  private onReady(event: Extract<ServerEvent, { t: 'ready' }>): void {
    this.set((state) => ({
      ...state,
      connection: 'connected',
      sessionId: event.sessionId,
      presences: Object.fromEntries(
        event.presences.map((presence) => [presence.userId, presence] as const),
      ),
      voice: Object.fromEntries(
        event.voice.map((participant) => [participant.sessionId, participant] as const),
      ),
    }));
  }

  /**
   * Insere ou atualiza uma mensagem mantendo a ordem cronológica.
   *
   * A busca do ponto de inserção começa pelo fim porque o caso comum é a
   * mensagem nova ser a mais recente — inserir no fim é O(1) na prática.
   */
  private upsertMessage(message: MessageDTO, options: { countUnread: boolean }): void {
    this.set((state) => {
      const channel = state.messages[message.channelId];

      // Canal ainda não carregado: nada a inserir, mas o não lido conta.
      if (!channel?.loaded) {
        return options.countUnread && message.author.id !== this.viewerId
          ? {
              ...state,
              unreads: {
                ...state.unreads,
                [message.channelId]: (state.unreads[message.channelId] ?? 0) + 1,
              },
            }
          : state;
      }

      const existingIndex = channel.messages.findIndex((item) => item.id === message.id);

      let messages: MessageDTO[];
      if (existingIndex >= 0) {
        messages = [...channel.messages];
        // Preserva `reactedByMe`, que o broadcast não carrega.
        messages[existingIndex] = { ...message, reactions: channel.messages[existingIndex]!.reactions };
      } else {
        const timestamp = new Date(message.createdAt).getTime();
        let index = channel.messages.length;
        while (index > 0 && new Date(channel.messages[index - 1]!.createdAt).getTime() > timestamp) {
          index -= 1;
        }
        messages = [
          ...channel.messages.slice(0, index),
          message,
          ...channel.messages.slice(index),
        ];
      }

      const shouldCount =
        options.countUnread && existingIndex < 0 && message.author.id !== this.viewerId;

      return {
        ...state,
        messages: { ...state.messages, [message.channelId]: { ...channel, messages } },
        ...(shouldCount
          ? {
              unreads: {
                ...state.unreads,
                [message.channelId]: (state.unreads[message.channelId] ?? 0) + 1,
              },
            }
          : {}),
        // Quem enviou parou de digitar.
        typing: {
          ...state.typing,
          [message.channelId]: (state.typing[message.channelId] ?? []).filter(
            (entry) => entry.userId !== message.author.id,
          ),
        },
      };
    });
  }

  private removeMessage(channelId: string, messageId: string): void {
    this.set((state) => {
      const channel = state.messages[channelId];
      if (!channel) return state;

      const messages = channel.messages.filter((message) => message.id !== messageId);
      if (messages.length === channel.messages.length) return state;

      return { ...state, messages: { ...state.messages, [channelId]: { ...channel, messages } } };
    });
  }

  private applyReactions(event: Extract<ServerEvent, { t: 'message:reactions' }>): void {
    this.set((state) => {
      const channel = state.messages[event.channelId];
      if (!channel) return state;

      const messages = channel.messages.map((message) =>
        message.id === event.messageId
          ? {
              ...message,
              reactions: event.reactions.map((group) => ({
                emoji: group.emoji,
                count: group.count,
                users: group.users,
                reactedByMe: group.userIds.includes(this.viewerId),
              })),
            }
          : message,
      );

      return { ...state, messages: { ...state.messages, [event.channelId]: { ...channel, messages } } };
    });
  }

  /** Substitui as reações de uma mensagem (resposta otimista do próprio toggle). */
  setMessageReactions(channelId: string, messageId: string, reactions: MessageDTO['reactions']): void {
    this.set((state) => {
      const channel = state.messages[channelId];
      if (!channel) return state;

      return {
        ...state,
        messages: {
          ...state.messages,
          [channelId]: {
            ...channel,
            messages: channel.messages.map((message) =>
              message.id === messageId ? { ...message, reactions } : message,
            ),
          },
        },
      };
    });
  }

  private upsertChannel(channel: ChannelDTO): void {
    this.set((state) => ({
      ...state,
      servers: state.servers.map((server) => {
        if (server.id !== channel.serverId) return server;

        const exists = server.channels.some((item) => item.id === channel.id);
        const channels = exists
          ? server.channels.map((item) => (item.id === channel.id ? channel : item))
          : [...server.channels, channel];

        return {
          ...server,
          channels: channels.sort(
            (a, b) => a.type.localeCompare(b.type) || a.position - b.position,
          ),
        };
      }),
    }));
  }

  private removeChannel(serverId: string, channelId: string): void {
    this.set((state) => {
      const messages = { ...state.messages };
      delete messages[channelId];

      return {
        ...state,
        messages,
        servers: state.servers.map((server) =>
          server.id === serverId
            ? { ...server, channels: server.channels.filter((channel) => channel.id !== channelId) }
            : server,
        ),
      };
    });
  }

  private upsertMember(serverId: string, member: MemberDTO): void {
    this.set((state) => {
      const current = state.members[serverId];
      if (!current) return state;

      const exists = current.some((item) => item.id === member.id);
      const members = exists
        ? current.map((item) => (item.id === member.id ? member : item))
        : [...current, member];

      return { ...state, members: { ...state.members, [serverId]: members } };
    });
  }

  /**
   * Troca a foto de uma pessoa em tudo que já está em cache.
   *
   * O avatar aparece em mensagens antigas, na lista de membros e na sala de
   * voz. Sem varrer os três, quem trocou a foto continuaria com a antiga nas
   * mensagens que já estavam na tela até alguém recarregar a página.
   */
  private applyAvatarChange(userId: string, avatarUrl: string | null): void {
    this.set((state) => {
      const trocar = <T extends { id: string; avatarUrl: string | null }>(usuario: T): T =>
        usuario.id === userId ? { ...usuario, avatarUrl } : usuario;

      const messages: AppState['messages'] = {};
      for (const [channelId, canal] of Object.entries(state.messages)) {
        messages[channelId] = {
          ...canal,
          messages: canal.messages.map((mensagem) =>
            mensagem.author.id === userId || mensagem.replyTo?.author?.id === userId
              ? {
                  ...mensagem,
                  author: trocar(mensagem.author),
                  replyTo: mensagem.replyTo
                    ? {
                        ...mensagem.replyTo,
                        author: mensagem.replyTo.author ? trocar(mensagem.replyTo.author) : null,
                      }
                    : null,
                }
              : mensagem,
          ),
        };
      }

      const members: AppState['members'] = {};
      for (const [serverId, lista] of Object.entries(state.members)) {
        members[serverId] = lista.map((membro) =>
          membro.user.id === userId ? { ...membro, user: trocar(membro.user) } : membro,
        );
      }

      const voice: AppState['voice'] = {};
      for (const [sessionId, participante] of Object.entries(state.voice)) {
        voice[sessionId] =
          participante.user.id === userId
            ? { ...participante, user: trocar(participante.user) }
            : participante;
      }

      return { ...state, messages, members, voice };
    });
  }

  private removeMember(serverId: string, userId: string): void {
    this.set((state) => {
      const current = state.members[serverId];

      // O próprio usuário saiu (ou foi removido): o servidor some da lista dele.
      if (userId === this.viewerId) {
        return {
          ...state,
          servers: state.servers.filter((server) => server.id !== serverId),
          members: Object.fromEntries(
            Object.entries(state.members).filter(([key]) => key !== serverId),
          ),
        };
      }

      if (!current) return state;

      return {
        ...state,
        members: {
          ...state.members,
          [serverId]: current.filter((member) => member.user.id !== userId),
        },
      };
    });
  }

  private registerTyping(channelId: string, userId: string): void {
    if (userId === this.viewerId) return;

    this.set((state) => {
      const now = Date.now();
      const current = (state.typing[channelId] ?? []).filter(
        (entry) => entry.expiresAt > now && entry.userId !== userId,
      );

      return {
        ...state,
        typing: {
          ...state.typing,
          [channelId]: [...current, { userId, expiresAt: now + TYPING_TIMEOUT_MS }],
        },
      };
    });
  }

  /** Descarta indicadores de digitação vencidos (chamado por um timer da UI). */
  pruneTyping(): void {
    const now = Date.now();
    this.set((state) => {
      let changed = false;
      const typing: Record<string, TypingEntry[]> = {};

      for (const [channelId, entries] of Object.entries(state.typing)) {
        const alive = entries.filter((entry) => entry.expiresAt > now);
        if (alive.length !== entries.length) changed = true;
        if (alive.length > 0) typing[channelId] = alive;
      }

      return changed ? { ...state, typing } : state;
    });
  }

  /**
   * Ao reconectar, o estado efêmero precisa ser reconstruído do zero: presenças e
   * participantes de voz podem ter mudado enquanto o socket estava caído, e
   * manter o que estava na tela mostraria fantasmas.
   */
  resetEphemeralState(): void {
    this.set((state) => ({ ...state, presences: {}, voice: {}, typing: {} }));
  }

  /** Marca todo mundo como offline quando a conexão cai de vez. */
  markEveryoneOffline(): void {
    this.set((state) => ({
      ...state,
      voice: {},
      typing: {},
      presences: Object.fromEntries(
        Object.entries(state.presences).map(([userId, presence]) => [
          userId,
          { ...presence, status: 'OFFLINE' as PresenceStatus },
        ]),
      ),
    }));
  }
}
