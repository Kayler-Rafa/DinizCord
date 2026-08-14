import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { db } from './db';
import { publish, publishMany, RealtimeBus, type BusMessage } from './bus';
import { Connection, ConnectionRegistry } from './connection';
import {
  computePresence,
  presencesForServers,
  registerPresence,
  removePresence,
  serverIdsForUser,
  setPresenceStatus,
  touchPresence,
  voiceParticipantsForServers,
} from './presence';
import { verifyGatewayTicket } from '../lib/auth/ticket';
import { aceiteEstaEmDia } from '../lib/terms';
import { scopedLogger } from '../lib/logger';
import { Topic, parseTopic } from '../lib/realtime/topics';
import { PUBLIC_USER_SELECT, toVoiceParticipantDTO } from '../lib/db/mappers';
import {
  CLOSE_CODES,
  HEARTBEAT_TIMEOUT_MS,
  MAX_INBOUND_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseClientEvent,
  type ClientEvent,
  type ServerEvent,
} from '../lib/websocket/protocol';
import type { PresenceStatus } from '../lib/types';

const log = scopedLogger('gateway');

/** Só grava o heartbeat no banco a cada 15s, mesmo recebendo mais. */
const HEARTBEAT_PERSIST_INTERVAL_MS = 15_000;

export interface GatewayOptions {
  wss: WebSocketServer;
  bus: RealtimeBus;
  allowedOrigins: string[];
  instanceId?: string;
}

export class Gateway {
  readonly instanceId: string;
  private readonly registry = new ConnectionRegistry();
  private readonly wss: WebSocketServer;
  private readonly bus: RealtimeBus;
  private readonly allowedOrigins: string[];
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: GatewayOptions) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.wss = options.wss;
    this.bus = options.bus;
    this.allowedOrigins = options.allowedOrigins;
  }

  get connectionCount(): number {
    return this.registry.size;
  }

  start(): void {
    this.bus.onEvent((message) => this.deliver(message));
    this.wss.on('connection', (socket, request) => {
      void this.onConnection(socket, request);
    });

    // Corta conexões que pararam de dar sinal de vida. Sem isso, um cliente que
    // sumiu (aba fechada em modo avião, cabo arrancado) ficaria "online" até o
    // TCP desistir sozinho, o que pode levar minutos.
    this.heartbeatTimer = setInterval(() => this.dropStaleConnections(), 15_000);
  }

  // -------------------------------------------------------------------------
  // Handshake
  // -------------------------------------------------------------------------

  /**
   * Valida a origem do upgrade.
   *
   * O navegador manda `Origin` em toda conexão WebSocket, e ele não é forjável
   * por JavaScript de outra página — é essa checagem que impede um site
   * qualquer de abrir um socket usando a sessão da vítima.
   */
  isOriginAllowed(origin: string | undefined): boolean {
    // Clientes não-navegador (testes, ferramentas) não enviam Origin.
    if (!origin) return true;
    return this.allowedOrigins.includes(origin);
  }

  private async onConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const ticket = url.searchParams.get('ticket');

    if (!ticket) {
      socket.close(CLOSE_CODES.UNAUTHORIZED, 'Ticket ausente');
      return;
    }

    const verification = await verifyGatewayTicket(ticket);
    if (!verification.ok) {
      log.warn({ reason: verification.reason, event: 'gateway.ticket_rejected' }, 'Ticket recusado');
      socket.close(CLOSE_CODES.UNAUTHORIZED, 'Ticket inválido ou expirado');
      return;
    }

    const { userId, sessionId } = verification.claims;

    // Assinatura válida não basta: a sessão pode ter sido revogada (logout,
    // troca de senha) depois que o ticket foi emitido.
    const session = await db().userSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });

    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      socket.close(CLOSE_CODES.UNAUTHORIZED, 'Sessão encerrada');
      return;
    }

    const user = await db().user.findUnique({
      where: { id: userId },
      select: { preferredStatus: true, activity: true, termsAcceptedVersion: true },
    });

    if (!user) {
      socket.close(CLOSE_CODES.UNAUTHORIZED, 'Usuário não encontrado');
      return;
    }

    // O aceite dos termos também vale aqui. Sem esta checagem, alguém poderia
    // pular a tela e abrir o WebSocket direto — passando a receber mensagens,
    // presença e voz sem nunca ter aceitado nada.
    if (!aceiteEstaEmDia(user.termsAcceptedVersion)) {
      log.warn({ userId, event: 'gateway.terms_pending' }, 'Conexão recusada: termos não aceitos');
      socket.close(CLOSE_CODES.TERMS_PENDING, 'É preciso aceitar os termos de uso');
      return;
    }

    const connection = new Connection(randomUUID(), userId, sessionId, socket);
    const status: PresenceStatus = user.preferredStatus === 'OFFLINE' ? 'ONLINE' : user.preferredStatus;

    try {
      await registerPresence({
        connectionId: connection.id,
        userId,
        instanceId: this.instanceId,
        status,
        activity: user.activity,
      });
    } catch (error) {
      log.error({ err: error, userId, event: 'gateway.presence_failed' }, 'Falha ao registrar presença');
      socket.close(CLOSE_CODES.GOING_AWAY, 'Falha ao registrar a conexão');
      return;
    }

    const serverIds = await serverIdsForUser(userId);
    for (const serverId of serverIds) connection.serverIds.add(serverId);

    this.registry.add(connection);

    socket.on('message', (raw, isBinary) => {
      // Serializado: mensagens da mesma conexão dependem da ordem em que foram
      // enviadas (ver `Connection.enqueue`).
      connection.enqueue(() => this.onMessage(connection, raw, isBinary));
    });
    socket.on('close', () => void this.onClose(connection));
    socket.on('error', (error) => {
      log.warn({ err: error, connectionId: connection.id, event: 'gateway.socket_error' }, 'Erro no socket');
    });
    socket.on('pong', () => {
      connection.lastHeartbeatAt = Date.now();
    });

    const [presences, voice] = await Promise.all([
      presencesForServers(serverIds),
      voiceParticipantsForServers(serverIds),
    ]);

    connection.send({
      t: 'ready',
      protocol: PROTOCOL_VERSION,
      sessionId: connection.id,
      userId,
      serverIds,
      presences,
      voice,
    });

    // Avisa os servidores só quando esta é a primeira conexão do usuário —
    // abrir uma segunda aba não é um evento de presença.
    if (this.registry.forUser(userId).length === 1) {
      await this.broadcastPresence(userId, serverIds);
    }

    log.info(
      { userId, connectionId: connection.id, connections: this.registry.size, event: 'gateway.connected' },
      'Cliente conectado',
    );
  }

  // -------------------------------------------------------------------------
  // Mensagens do cliente
  // -------------------------------------------------------------------------

  private async onMessage(
    connection: Connection,
    raw: unknown,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      connection.send({ t: 'error', code: 'INVALID_PAYLOAD', message: 'Somente mensagens de texto são aceitas.' });
      return;
    }

    const text = String(raw);

    if (text.length > MAX_INBOUND_MESSAGE_BYTES) {
      connection.close(CLOSE_CODES.RATE_LIMITED, 'Mensagem grande demais');
      return;
    }

    if (!connection.allowEvent()) {
      log.warn(
        { userId: connection.userId, connectionId: connection.id, event: 'gateway.rate_limited' },
        'Conexão excedeu o limite de eventos',
      );
      connection.close(CLOSE_CODES.RATE_LIMITED, 'Excesso de mensagens');
      return;
    }

    const event = parseClientEvent(text);

    if (!event) {
      connection.send({
        t: 'error',
        code: 'INVALID_PAYLOAD',
        message: 'Não entendemos essa mensagem.',
      });
      return;
    }

    connection.lastHeartbeatAt = Date.now();

    try {
      await this.handleClientEvent(connection, event);
    } catch (error) {
      log.error(
        { err: error, type: event.t, userId: connection.userId, event: 'gateway.handler_failed' },
        'Falha ao processar evento do cliente',
      );
      connection.send({
        t: 'error',
        code: 'INTERNAL',
        message: 'Não foi possível concluir a ação. Tente novamente.',
      });
    }
  }

  private async handleClientEvent(connection: Connection, event: ClientEvent): Promise<void> {
    switch (event.t) {
      case 'heartbeat':
        await this.onHeartbeat(connection);
        return;

      case 'presence:set':
        await this.onPresenceSet(connection, event.status, event.activity, event.auto ?? false);
        return;

      case 'typing':
        await this.onTyping(connection, event.channelId);
        return;

      case 'voice:join':
        await this.onVoiceJoin(connection, event.channelId);
        return;

      case 'voice:leave':
        await this.onVoiceLeave(connection);
        return;

      case 'voice:state':
        await this.onVoiceState(connection, event);
        return;

      case 'webrtc:signal':
        await this.onWebRtcSignal(connection, event.to, event.signal);
        return;
    }
  }

  private async onHeartbeat(connection: Connection): Promise<void> {
    connection.send({ t: 'heartbeat:ack', serverTime: Date.now() });

    // O heartbeat chega a cada 20s por conexão; gravar todos seria escrita
    // constante à toa. O TTL do sweeper (90s) tolera de sobra este intervalo.
    const now = Date.now();
    if (now - connection.lastPersistedHeartbeatAt < HEARTBEAT_PERSIST_INTERVAL_MS) return;

    connection.lastPersistedHeartbeatAt = now;
    await touchPresence([connection.id]);
  }

  private async onPresenceSet(
    connection: Connection,
    status: PresenceStatus,
    activity: string | null | undefined,
    auto: boolean,
  ): Promise<void> {
    await setPresenceStatus({
      connectionId: connection.id,
      userId: connection.userId,
      status,
      activity,
      // A escolha explícita vale para a pessoa toda; a ausência automática vale
      // só para a aba que ficou parada.
      scope: auto ? 'connection' : 'user',
    });

    // Só uma escolha explícita vira preferência persistente. A ausência
    // automática por inatividade é estado da conexão e morre com ela — gravá-la
    // faria o usuário voltar "ausente" no login seguinte sem ter pedido.
    if (!auto) {
      await db().user.update({
        where: { id: connection.userId },
        data: {
          preferredStatus: status,
          ...(activity !== undefined ? { activity: activity || null } : {}),
        },
      });
    } else if (activity !== undefined) {
      // A atividade continua sendo escolha do usuário mesmo num evento automático.
      await db().user.update({
        where: { id: connection.userId },
        data: { activity: activity || null },
      });
    }

    await this.broadcastPresence(connection.userId, [...connection.serverIds]);
  }

  private async onTyping(connection: Connection, channelId: string): Promise<void> {
    const channel = await this.resolveChannel(connection, channelId, 'TEXT');
    if (!channel) return;

    // "Digitando" é efêmero por natureza: vai direto ao barramento, sem tocar em
    // nenhuma tabela de estado.
    await publish(Topic.server(channel.serverId), {
      t: 'typing',
      channelId,
      userId: connection.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Voz
  // -------------------------------------------------------------------------

  /** Confere que o canal existe, é do tipo certo e que o usuário é membro. */
  private async resolveChannel(
    connection: Connection,
    channelId: string,
    type: 'TEXT' | 'VOICE',
  ): Promise<{ serverId: string } | null> {
    const channel = await db().channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, type: true },
    });

    if (!channel || channel.type !== type || !connection.serverIds.has(channel.serverId)) {
      connection.send({
        t: 'error',
        code: 'NOT_FOUND',
        message: 'Este canal não existe ou você não tem acesso a ele.',
      });
      return null;
    }

    return { serverId: channel.serverId };
  }

  private async onVoiceJoin(connection: Connection, channelId: string): Promise<void> {
    const channel = await this.resolveChannel(connection, channelId, 'VOICE');
    if (!channel) return;

    // Um usuário ocupa um canal de voz por vez: entrar por outra aba move a
    // sessão em vez de duplicar a pessoa na sala.
    const previous = await db().voiceSession.findUnique({
      where: { userId: connection.userId },
      select: { id: true, channelId: true, channel: { select: { serverId: true } } },
    });

    if (previous) {
      await db().voiceSession.delete({ where: { id: previous.id } }).catch(() => undefined);
      await publish(Topic.server(previous.channel.serverId), {
        t: 'voice:leave',
        sessionId: previous.id,
        channelId: previous.channelId,
        userId: connection.userId,
      });

      const previousConnection = this.registry.get(previous.id);
      if (previousConnection) previousConnection.voiceChannelId = null;
    }

    const session = await db().voiceSession.create({
      data: {
        id: connection.id,
        userId: connection.userId,
        channelId,
        instanceId: this.instanceId,
      },
      select: {
        id: true,
        channelId: true,
        selfMute: true,
        selfDeaf: true,
        screenSharing: true,
        joinedAt: true,
        user: { select: PUBLIC_USER_SELECT },
      },
    });

    connection.voiceChannelId = channelId;

    await publish(Topic.server(channel.serverId), {
      t: 'voice:join',
      participant: toVoiceParticipantDTO(session),
    });

    log.info(
      { userId: connection.userId, channelId, event: 'voice.joined' },
      'Usuário entrou no canal de voz',
    );
  }

  private async onVoiceLeave(connection: Connection): Promise<void> {
    if (!connection.voiceChannelId) return;

    const channelId = connection.voiceChannelId;
    connection.voiceChannelId = null;

    const channel = await db().channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });

    await db().voiceSession.delete({ where: { id: connection.id } }).catch(() => undefined);

    if (channel) {
      await publish(Topic.server(channel.serverId), {
        t: 'voice:leave',
        sessionId: connection.id,
        channelId,
        userId: connection.userId,
      });
    }

    log.info(
      { userId: connection.userId, channelId, event: 'voice.left' },
      'Usuário saiu do canal de voz',
    );
  }

  private async onVoiceState(
    connection: Connection,
    patch: { selfMute?: boolean; selfDeaf?: boolean; screenSharing?: boolean },
  ): Promise<void> {
    if (!connection.voiceChannelId) return;

    const session = await db()
      .voiceSession.update({
        where: { id: connection.id },
        data: {
          ...(patch.selfMute !== undefined ? { selfMute: patch.selfMute } : {}),
          ...(patch.selfDeaf !== undefined ? { selfDeaf: patch.selfDeaf } : {}),
          ...(patch.screenSharing !== undefined ? { screenSharing: patch.screenSharing } : {}),
        },
        select: {
          id: true,
          channelId: true,
          selfMute: true,
          selfDeaf: true,
          screenSharing: true,
          joinedAt: true,
          user: { select: PUBLIC_USER_SELECT },
          channel: { select: { serverId: true } },
        },
      })
      .catch(() => null);

    if (!session) return;

    await publish(Topic.server(session.channel.serverId), {
      t: 'voice:update',
      participant: toVoiceParticipantDTO(session),
    });
  }

  /**
   * Roteia signaling WebRTC entre dois peers.
   *
   * A validação essencial: os dois precisam estar no MESMO canal de voz. Sem
   * isso, qualquer usuário autenticado poderia enviar SDP para qualquer outro e
   * forçar uma negociação indesejada.
   *
   * Quando o destino está nesta instância, a entrega é direta — nem toca o
   * barramento. Isso importa porque candidatos ICE chegam às dezenas por
   * chamada.
   */
  private async onWebRtcSignal(
    connection: Connection,
    targetSessionId: string,
    signal: unknown,
  ): Promise<void> {
    if (!connection.voiceChannelId) {
      connection.send({
        t: 'error',
        code: 'FORBIDDEN',
        message: 'Você precisa estar em um canal de voz para isso.',
      });
      return;
    }

    if (targetSessionId === connection.id) return;

    const target = await db().voiceSession.findUnique({
      where: { id: targetSessionId },
      select: { channelId: true },
    });

    if (!target || target.channelId !== connection.voiceChannelId) {
      connection.send({
        t: 'error',
        code: 'NOT_FOUND',
        message: 'O outro participante saiu da chamada.',
      });
      return;
    }

    const event: ServerEvent = {
      t: 'webrtc:signal',
      from: connection.id,
      fromUserId: connection.userId,
      signal: signal as ServerEvent extends { t: 'webrtc:signal'; signal: infer S } ? S : never,
    };

    const local = this.registry.get(targetSessionId);
    if (local) {
      local.send(event);
      return;
    }

    await publish(Topic.session(targetSessionId), event);
  }

  // -------------------------------------------------------------------------
  // Entrega de eventos do barramento
  // -------------------------------------------------------------------------

  private deliver(message: BusMessage): void {
    const topic = parseTopic(message.topic);
    if (!topic) return;

    switch (topic.scope) {
      case 'server': {
        for (const connection of this.registry.forServer(topic.id)) {
          this.deliverToConnection(connection, message.event);
        }
        return;
      }
      case 'user': {
        for (const connection of this.registry.forUser(topic.id)) {
          this.deliverToConnection(connection, message.event);
        }
        return;
      }
      case 'session': {
        this.registry.get(topic.id)?.send(message.event);
        return;
      }
    }
  }

  /**
   * Entrega o evento e reage aos que mudam o próprio estado da conexão.
   *
   * `member:join`/`member:leave` alteram a lista de servidores que a conexão
   * pode receber — sem tratar isso aqui, quem fosse removido continuaria vendo
   * as mensagens do servidor até recarregar a página.
   */
  private deliverToConnection(connection: Connection, event: ServerEvent): void {
    if (event.t === 'member:join' && event.member.user.id === connection.userId) {
      connection.serverIds.add(event.serverId);
    }

    if (event.t === 'member:leave' && event.userId === connection.userId) {
      connection.send(event);
      connection.serverIds.delete(event.serverId);
      return;
    }

    if (event.t === 'session:revoked') {
      connection.send(event);
      connection.close(CLOSE_CODES.SESSION_REVOKED, event.reason);
      return;
    }

    connection.send(event);
  }

  /** Entrega de um evento para o usuário mesmo sem passar pelo barramento. */
  sendToUser(userId: string, event: ServerEvent): void {
    for (const connection of this.registry.forUser(userId)) {
      connection.send(event);
    }
  }

  // -------------------------------------------------------------------------
  // Encerramento
  // -------------------------------------------------------------------------

  private async onClose(connection: Connection): Promise<void> {
    this.registry.remove(connection);

    const events: Array<{ topic: string; event: ServerEvent }> = [];

    if (connection.voiceChannelId) {
      const channel = await db().channel.findUnique({
        where: { id: connection.voiceChannelId },
        select: { serverId: true },
      });

      if (channel) {
        events.push({
          topic: Topic.server(channel.serverId),
          event: {
            t: 'voice:leave',
            sessionId: connection.id,
            channelId: connection.voiceChannelId,
            userId: connection.userId,
          },
        });
      }
    }

    await db().voiceSession.deleteMany({ where: { id: connection.id } }).catch(() => undefined);
    await removePresence(connection.id);

    // Presença só muda quando a ÚLTIMA conexão do usuário cai.
    const remaining = this.registry.forUser(connection.userId).length;
    if (remaining === 0) {
      const presence = await computePresence(connection.userId);
      for (const serverId of connection.serverIds) {
        events.push({ topic: Topic.server(serverId), event: { t: 'presence:update', presence } });
      }
    }

    await publishMany(events);

    log.info(
      {
        userId: connection.userId,
        connectionId: connection.id,
        connections: this.registry.size,
        event: 'gateway.disconnected',
      },
      'Cliente desconectado',
    );
  }

  private async broadcastPresence(userId: string, serverIds: string[]): Promise<void> {
    if (serverIds.length === 0) return;

    const presence = await computePresence(userId);
    await publishMany(
      serverIds.map((serverId) => ({
        topic: Topic.server(serverId),
        event: { t: 'presence:update' as const, presence },
      })),
    );
  }

  private dropStaleConnections(): void {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;

    for (const connection of this.registry.all()) {
      if (connection.lastHeartbeatAt < cutoff) {
        log.warn(
          { connectionId: connection.id, userId: connection.userId, event: 'gateway.heartbeat_timeout' },
          'Conexão sem heartbeat foi encerrada',
        );
        connection.terminate();
        void this.onClose(connection);
      }
    }
  }

  /** Encerra o gateway avisando os clientes para reconectarem. */
  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const connections = this.registry.all();

    for (const connection of connections) {
      connection.close(CLOSE_CODES.GOING_AWAY, 'Servidor reiniciando');
    }

    // Limpa o estado efêmero desta instância para que ninguém fique preso como
    // "online" até o sweeper agir.
    await db()
      .presenceSession.deleteMany({ where: { instanceId: this.instanceId } })
      .catch(() => undefined);
    await db()
      .voiceSession.deleteMany({ where: { instanceId: this.instanceId } })
      .catch(() => undefined);
  }
}
