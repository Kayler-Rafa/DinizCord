import type { WebSocket } from 'ws';
import { encodeEvent, type ServerEvent } from '../lib/websocket/protocol';

/**
 * Uma conexão WebSocket autenticada.
 *
 * O `id` é o identificador único da conexão e serve como chave em três lugares:
 * `PresenceSession.id`, `VoiceSession.id` e o endereço do peer no mesh WebRTC.
 * Manter os três iguais elimina uma camada inteira de mapeamento.
 */
export class Connection {
  /** Servidores de que o usuário participa; controla o que ele pode receber. */
  readonly serverIds = new Set<string>();

  /** Canal de voz atual, quando houver. */
  voiceChannelId: string | null = null;

  lastHeartbeatAt = Date.now();
  /** Última vez que o heartbeat foi gravado no banco (escrita é throttled). */
  lastPersistedHeartbeatAt = Date.now();

  private closed = false;
  private readonly eventTimestamps: number[] = [];

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly sessionId: string,
    private readonly socket: WebSocket,
  ) {}

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === this.socket.OPEN;
  }

  send(event: ServerEvent): void {
    if (!this.isOpen) return;
    this.socket.send(encodeEvent(event));
  }

  close(code: number, reason: string): void {
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch {
      // Socket já morto: nada a fazer.
    }
  }

  terminate(): void {
    this.closed = true;
    this.socket.terminate();
  }

  /**
   * Janela deslizante contra flood.
   *
   * O teto é generoso de propósito: o signaling WebRTC dispara dezenas de
   * candidatos ICE em poucos segundos ao entrar numa chamada, e limitar demais
   * quebraria a conexão de voz em vez de proteger o servidor.
   */
  allowEvent(limit = 120, windowMs = 10_000): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;

    while (this.eventTimestamps.length > 0 && this.eventTimestamps[0]! <= cutoff) {
      this.eventTimestamps.shift();
    }

    if (this.eventTimestamps.length >= limit) return false;

    this.eventTimestamps.push(now);
    return true;
  }
}

/**
 * Registro em memória das conexões desta instância.
 *
 * É um cache local, não fonte de verdade: o estado durável está no PostgreSQL.
 * Se o processo morrer, o sweeper limpa as sessões órfãs e os clientes
 * reconectam.
 */
export class ConnectionRegistry {
  private readonly byId = new Map<string, Connection>();
  private readonly byUser = new Map<string, Set<Connection>>();

  add(connection: Connection): void {
    this.byId.set(connection.id, connection);

    const forUser = this.byUser.get(connection.userId) ?? new Set<Connection>();
    forUser.add(connection);
    this.byUser.set(connection.userId, forUser);
  }

  remove(connection: Connection): void {
    this.byId.delete(connection.id);

    const forUser = this.byUser.get(connection.userId);
    if (forUser) {
      forUser.delete(connection);
      if (forUser.size === 0) this.byUser.delete(connection.userId);
    }
  }

  get(connectionId: string): Connection | undefined {
    return this.byId.get(connectionId);
  }

  forUser(userId: string): Connection[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  /** Conexões cujo usuário participa do servidor informado. */
  forServer(serverId: string): Connection[] {
    const result: Connection[] = [];
    for (const connection of this.byId.values()) {
      if (connection.serverIds.has(serverId)) result.push(connection);
    }
    return result;
  }

  all(): Connection[] {
    return [...this.byId.values()];
  }

  get size(): number {
    return this.byId.size;
  }
}
