import { z } from 'zod';
import type {
  ChannelDTO,
  MemberDTO,
  MessageDTO,
  PresenceDTO,
  ReactionGroup,
  VoiceParticipantDTO,
} from '@/lib/types';

/**
 * Protocolo do gateway WebSocket.
 *
 * Regras:
 *  - Toda mensagem do cliente é validada com Zod ANTES de tocar o banco. O
 *    cliente é hostil por definição.
 *  - O campo discriminante é `t` (type). Mensagens desconhecidas são recusadas.
 *  - O payload do WebRTC é repassado quase opaco, mas com teto de tamanho: SDP
 *    é grande, e sem limite vira vetor de abuso de memória.
 */

export const PROTOCOL_VERSION = 1;

/** Intervalo com que o cliente envia heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/** Sem heartbeat por este tempo, o gateway derruba a conexão. */
export const HEARTBEAT_TIMEOUT_MS = 60_000;
/** Sessões efêmeras sem heartbeat mais antigas que isto são varridas. */
export const PRESENCE_STALE_MS = 90_000;
/** Frequência do sweeper que limpa sessões órfãs. */
export const SWEEP_INTERVAL_MS = 30_000;
/** Um indicador de "digitando" expira sozinho depois disto. */
export const TYPING_TIMEOUT_MS = 7_000;

export const MAX_INBOUND_MESSAGE_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Cliente → gateway
// ---------------------------------------------------------------------------

const sdpDescriptionSchema = z.object({
  kind: z.literal('description'),
  description: z.object({
    type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
    sdp: z.string().max(32_000).optional(),
  }),
});

const iceCandidateSchema = z.object({
  kind: z.literal('candidate'),
  candidate: z
    .object({
      candidate: z.string().max(2_000),
      sdpMid: z.string().max(64).nullish(),
      sdpMLineIndex: z.number().int().min(0).max(256).nullish(),
      usernameFragment: z.string().max(256).nullish(),
    })
    .nullable(),
});

/**
 * Metadado de mídia: informa aos pares qual MediaStream corresponde ao
 * compartilhamento de tela. Sem isso, o receptor não sabe distinguir a track de
 * vídeo da tela de uma eventual câmera.
 */
const streamMetaSchema = z.object({
  kind: z.literal('meta'),
  screenStreamId: z.string().max(128).nullable(),
});

export const webrtcSignalSchema = z.discriminatedUnion('kind', [
  sdpDescriptionSchema,
  iceCandidateSchema,
  streamMetaSchema,
]);

export type WebRtcSignal = z.infer<typeof webrtcSignalSchema>;

const cuidLike = z.string().min(1).max(64);

export const clientEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('heartbeat') }),

  z.object({
    t: z.literal('presence:set'),
    status: z.enum(['ONLINE', 'IDLE', 'DO_NOT_DISTURB']),
    activity: z.string().trim().max(80).nullable().optional(),
    /**
     * true quando a mudança foi automática (ausência por inatividade), e não
     * uma escolha do usuário.
     *
     * A distinção importa: o status automático vale só enquanto a conexão
     * durar. Persistir "ausente" como preferência faria a pessoa reaparecer
     * ausente no próximo login sem nunca ter pedido isso.
     */
    auto: z.boolean().optional(),
  }),

  z.object({ t: z.literal('typing'), channelId: cuidLike }),

  z.object({ t: z.literal('voice:join'), channelId: cuidLike }),
  z.object({ t: z.literal('voice:leave') }),
  z.object({
    t: z.literal('voice:state'),
    selfMute: z.boolean().optional(),
    selfDeaf: z.boolean().optional(),
    screenSharing: z.boolean().optional(),
  }),

  z.object({
    t: z.literal('webrtc:signal'),
    to: cuidLike,
    signal: webrtcSignalSchema,
  }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

// ---------------------------------------------------------------------------
// Gateway → cliente
// ---------------------------------------------------------------------------

export type ServerEvent =
  | {
      t: 'ready';
      protocol: number;
      sessionId: string;
      userId: string;
      serverIds: string[];
      presences: PresenceDTO[];
      voice: VoiceParticipantDTO[];
    }
  | { t: 'heartbeat:ack'; serverTime: number }
  | { t: 'presence:update'; presence: PresenceDTO }
  | { t: 'message:create'; message: MessageDTO }
  | { t: 'message:update'; message: MessageDTO }
  | { t: 'message:delete'; channelId: string; messageId: string }
  | {
      t: 'message:reactions';
      channelId: string;
      messageId: string;
      reactions: Array<Omit<ReactionGroup, 'reactedByMe'> & { userIds: string[] }>;
    }
  | { t: 'channel:create'; channel: ChannelDTO }
  | { t: 'channel:update'; channel: ChannelDTO }
  | { t: 'channel:delete'; serverId: string; channelId: string }
  | { t: 'server:update'; serverId: string; name: string; iconEmoji: string }
  | { t: 'member:join'; serverId: string; member: MemberDTO }
  | { t: 'member:update'; serverId: string; member: MemberDTO }
  | { t: 'member:leave'; serverId: string; userId: string }
  | { t: 'typing'; channelId: string; userId: string }
  | { t: 'voice:join'; participant: VoiceParticipantDTO }
  | { t: 'voice:update'; participant: VoiceParticipantDTO }
  | { t: 'voice:leave'; sessionId: string; channelId: string; userId: string }
  | { t: 'webrtc:signal'; from: string; fromUserId: string; signal: WebRtcSignal }
  | { t: 'session:revoked'; reason: string }
  | { t: 'error'; code: GatewayErrorCode; message: string };

export type GatewayErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Códigos de fechamento próprios (o range 4000–4999 é reservado à aplicação). */
export const CLOSE_CODES = {
  /** Ticket ausente, inválido ou expirado — o cliente deve renovar antes de tentar de novo. */
  UNAUTHORIZED: 4001,
  /** Origem não autorizada. */
  FORBIDDEN_ORIGIN: 4003,
  /** Heartbeat perdido. */
  HEARTBEAT_TIMEOUT: 4008,
  /** A sessão foi encerrada em outro lugar (logout). */
  SESSION_REVOKED: 4009,
  /** Abuso detectado. */
  RATE_LIMITED: 4029,
  /** O gateway está desligando; o cliente deve reconectar. */
  GOING_AWAY: 4100,
} as const;

/**
 * Fechamentos em que reconectar automaticamente não faz sentido — insistir só
 * gera loop. O cliente precisa de uma ação nova (novo ticket, novo login).
 */
export const NON_RETRYABLE_CLOSE_CODES: number[] = [
  CLOSE_CODES.FORBIDDEN_ORIGIN,
  CLOSE_CODES.SESSION_REVOKED,
];

export function encodeEvent(event: ServerEvent): string {
  return JSON.stringify(event);
}

/** Parse defensivo: nunca lança, devolve `null` para entrada inválida. */
export function parseClientEvent(raw: string): ClientEvent | null {
  if (raw.length > MAX_INBOUND_MESSAGE_BYTES) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = clientEventSchema.safeParse(json);
  return result.success ? result.data : null;
}
