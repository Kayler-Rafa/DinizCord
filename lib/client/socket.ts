import { clientEnv } from '@/lib/env.client';
import { api } from './api';
import {
  HEARTBEAT_INTERVAL_MS,
  NON_RETRYABLE_CLOSE_CODES,
  type ClientEvent,
  type ServerEvent,
} from '@/lib/websocket/protocol';

/**
 * Conexão WebSocket do navegador.
 *
 * Premissa central do projeto: **a conexão vai cair**. Wi-Fi oscila, o notebook
 * suspende, a Vercel faz deploy, o gateway reinicia. Então:
 *
 *  - reconexão automática com backoff exponencial e jitter;
 *  - ticket novo a cada tentativa (eles duram 60s);
 *  - nada é enfileirado enquanto está fora do ar — ao reconectar, o estado é
 *    ressincronizado do servidor, o que é mais confiável do que reproduzir
 *    intenções antigas;
 *  - reconexão imediata quando o navegador volta a ficar online ou a aba volta
 *    ao primeiro plano, em vez de esperar o próximo passo do backoff.
 */

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface SocketHandlers {
  onEvent: (event: ServerEvent) => void;
  onStatusChange: (status: SocketStatus) => void;
  /** Chamado quando reconectar deixou de fazer sentido (sessão revogada). */
  onFatal: (reason: string) => void;
}

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class GatewaySocket {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private disposed = false;
  private connecting = false;

  constructor(private readonly handlers: SocketHandlers) {}

  async start(): Promise<void> {
    this.disposed = false;
    this.bindBrowserEvents();
    await this.open();
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Envia um evento. Retorna false se o socket não estava aberto — quem chamou
   * decide se isso importa (para signaling importa, para "digitando" não).
   */
  send(event: ClientEvent): boolean {
    if (!this.isOpen) return false;
    this.socket!.send(JSON.stringify(event));
    return true;
  }

  private async open(): Promise<void> {
    if (this.disposed || this.connecting) return;
    this.connecting = true;

    this.handlers.onStatusChange(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let ticket: string;
    try {
      ticket = (await api.gateway.ticket()).ticket;
    } catch (error) {
      this.connecting = false;

      // 401 significa que a sessão morreu: insistir não resolve, é preciso login.
      if (error instanceof Error && 'isUnauthorized' in error && error.isUnauthorized) {
        this.handlers.onFatal('Sua sessão expirou. Entre novamente.');
        return;
      }

      this.scheduleReconnect();
      return;
    }

    if (this.disposed) {
      this.connecting = false;
      return;
    }

    const url = `${clientEnv.wsUrl.replace(/\/$/, '')}/?ticket=${encodeURIComponent(ticket)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.connecting = false;
      this.attempt = 0;
      this.startHeartbeat();
    };

    socket.onmessage = (message) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(message.data)) as ServerEvent;
      } catch {
        return;
      }
      this.handlers.onEvent(event);
    };

    socket.onclose = (closeEvent) => {
      this.connecting = false;
      this.stopHeartbeat();
      this.socket = null;

      if (this.disposed) return;

      if (NON_RETRYABLE_CLOSE_CODES.includes(closeEvent.code)) {
        this.handlers.onFatal(closeEvent.reason || 'A conexão foi encerrada pelo servidor.');
        return;
      }

      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // O erro sempre vem seguido de `close`; o tratamento fica lá para não
      // agendar duas reconexões.
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    this.attempt += 1;
    this.handlers.onStatusChange(this.attempt > 3 ? 'offline' : 'reconnecting');

    // Backoff exponencial com teto e jitter. O jitter evita que todos os
    // clientes voltem no mesmo instante depois de uma queda do gateway.
    const base = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * 2 ** (this.attempt - 1));
    const delay = base * (0.7 + Math.random() * 0.6);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  /** Força uma tentativa imediata, zerando o backoff. */
  reconnectNow(): void {
    if (this.disposed || this.isOpen || this.connecting) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.attempt = 0;
    void this.open();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.send({ t: 'heartbeat' })) this.stopHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private onOnline = () => this.reconnectNow();
  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible') this.reconnectNow();
  };

  private bindBrowserEvents(): void {
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private unbindBrowserEvents(): void {
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  dispose(): void {
    this.disposed = true;
    this.unbindBrowserEvents();
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }
}
