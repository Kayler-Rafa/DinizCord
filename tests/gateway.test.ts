import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { startTestGateway, TestClient, type TestGateway } from './helpers/gateway';
import { addMember, createServerWithChannels, createTicketFor, createUser } from './helpers/fixtures';
import { disconnectTestPrisma, resetDatabase, testPrisma } from './helpers/db';
import { CLOSE_CODES } from '@/lib/websocket/protocol';
import { issueGatewayTicket } from '@/lib/auth/ticket';

let harness: TestGateway;
const openClients: TestClient[] = [];

async function connect(userId: string): Promise<TestClient> {
  const { ticket } = await createTicketFor(userId);
  const client = await TestClient.connect(harness.url, ticket);
  openClients.push(client);
  return client;
}

beforeEach(async () => {
  await resetDatabase();
  harness = await startTestGateway();
});

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await harness.stop();
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('handshake', () => {
  it('recusa conexão sem ticket', async () => {
    const client = await TestClient.connect(harness.url, '');
    expect(await client.waitForClose()).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('recusa ticket com assinatura inválida', async () => {
    const client = await TestClient.connect(harness.url, 'eyJhbGciOiJIUzI1NiJ9.invalido.assinatura');
    expect(await client.waitForClose()).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('recusa ticket cuja sessão não existe mais', async () => {
    const user = await createUser();
    const ticket = await issueGatewayTicket({ userId: user.id, sessionId: 'sessao-inexistente' });

    const client = await TestClient.connect(harness.url, ticket);
    expect(await client.waitForClose()).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('recusa ticket de sessão revogada', async () => {
    const user = await createUser();
    const { ticket } = await createTicketFor(user.id);
    await testPrisma().userSession.updateMany({ data: { revokedAt: new Date() } });

    const client = await TestClient.connect(harness.url, ticket);
    expect(await client.waitForClose()).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('recusa origem não autorizada antes do handshake', async () => {
    const user = await createUser();
    const { ticket } = await createTicketFor(user.id);

    const client = await TestClient.connect(harness.url, ticket, {
      origin: 'https://site-malicioso.example',
    });

    expect(client.received).toHaveLength(0);
  });

  it('entrega o estado inicial em "ready"', async () => {
    const user = await createUser();
    const server = await createServerWithChannels(user.id);

    const client = await connect(user.id);
    const ready = await client.waitFor('ready');

    expect(ready.userId).toBe(user.id);
    expect(ready.serverIds).toContain(server.id);
    expect(ready.presences.some((presence) => presence.userId === user.id)).toBe(true);
    expect(ready.voice).toEqual([]);
  });

  it('registra a sessão de presença no banco', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    const ready = await client.waitFor('ready');

    const presence = await testPrisma().presenceSession.findUnique({ where: { id: ready.sessionId } });
    expect(presence?.userId).toBe(user.id);
    expect(presence?.status).toBe('ONLINE');
  });
});

describe('heartbeat', () => {
  it('responde ao heartbeat com o horário do servidor', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'heartbeat' });
    const ack = await client.waitFor('heartbeat:ack');

    expect(ack.serverTime).toBeGreaterThan(0);
  });

  it('recusa payload inválido sem derrubar a conexão', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'presence:set', status: 'INVENTADO' } as never);
    const error = await client.waitFor('error');

    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(client.closeCode).toBeNull();
  });
});

describe('presença', () => {
  it('propaga mudança de status para os outros membros do servidor', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    await friendClient.waitFor('ready');

    friendClient.send({ t: 'presence:set', status: 'DO_NOT_DISTURB', activity: 'Jogando Forza' });

    const update = await ownerClient.waitFor(
      'presence:update',
      (event) => event.presence.userId === friend.id && event.presence.status === 'DO_NOT_DISTURB',
    );

    expect(update.presence.activity).toBe('Jogando Forza');
  });

  it('persiste o status escolhido no perfil', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'presence:set', status: 'IDLE', activity: null });
    await client.waitFor('presence:update', (event) => event.presence.status === 'IDLE');

    const stored = await testPrisma().user.findUnique({ where: { id: user.id } });
    expect(stored?.preferredStatus).toBe('IDLE');
  });

  it('ausência automática não sobrescreve o status escolhido', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'presence:set', status: 'DO_NOT_DISTURB' });
    await client.waitFor('presence:update', (event) => event.presence.status === 'DO_NOT_DISTURB');

    // O cliente fica inativo e o navegador reporta ausência automática.
    client.send({ t: 'presence:set', status: 'IDLE', auto: true });
    await client.waitFor('presence:update', (event) => event.presence.status === 'IDLE');

    // Os outros veem "ausente" agora...
    const session = await testPrisma().presenceSession.findFirst({ where: { userId: user.id } });
    expect(session?.status).toBe('IDLE');

    // ...mas a preferência gravada continua sendo a escolha explícita, para que
    // o próximo login não devolva a pessoa como ausente.
    const stored = await testPrisma().user.findUnique({ where: { id: user.id } });
    expect(stored?.preferredStatus).toBe('DO_NOT_DISTURB');
  });

  it('uma aba em segundo plano não deixa a pessoa ausente para os outros', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const observer = await connect(owner.id);
    await observer.waitFor('ready');

    // Duas abas do mesmo amigo.
    const activeTab = await connect(friend.id);
    await activeTab.waitFor('ready');
    const backgroundTab = await connect(friend.id);
    await backgroundTab.waitFor('ready');

    // A segunda aba fica parada e entra em ausência automática.
    backgroundTab.send({ t: 'presence:set', status: 'IDLE', auto: true });
    await observer.waitFor('presence:update', (event) => event.presence.userId === friend.id);

    await new Promise((resolve) => setTimeout(resolve, 300));

    // A pessoa continua disponível: a aba ativa é que manda.
    const updates = observer.received.filter(
      (event) => event.t === 'presence:update' && event.presence.userId === friend.id,
    );
    const last = updates[updates.length - 1];
    expect(last?.t === 'presence:update' && last.presence.status).toBe('ONLINE');
  });

  it('escolha explícita de status vale para todas as abas da pessoa', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const observer = await connect(owner.id);
    await observer.waitFor('ready');

    const firstTab = await connect(friend.id);
    await firstTab.waitFor('ready');
    const secondTab = await connect(friend.id);
    await secondTab.waitFor('ready');

    // "Não perturbe" escolhido em uma aba não pode ser anulado pela outra, que
    // continua reportando ONLINE.
    secondTab.send({ t: 'presence:set', status: 'DO_NOT_DISTURB' });

    await observer.waitFor(
      'presence:update',
      (event) => event.presence.userId === friend.id && event.presence.status === 'DO_NOT_DISTURB',
    );

    const sessions = await testPrisma().presenceSession.findMany({ where: { userId: friend.id } });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.status === 'DO_NOT_DISTURB')).toBe(true);
  });

  it('atividade continua sendo salva mesmo num evento automático', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'presence:set', status: 'IDLE', activity: 'Jogando Forza', auto: true });
    await client.waitFor('presence:update', (event) => event.presence.activity === 'Jogando Forza');

    const stored = await testPrisma().user.findUnique({ where: { id: user.id } });
    expect(stored?.activity).toBe('Jogando Forza');
    expect(stored?.preferredStatus).toBe('ONLINE');
  });

  it('marca o usuário como OFFLINE quando a última conexão cai', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    await friendClient.waitFor('ready');
    await ownerClient.waitFor('presence:update', (event) => event.presence.userId === friend.id);

    await friendClient.close();

    const offline = await ownerClient.waitFor(
      'presence:update',
      (event) => event.presence.userId === friend.id && event.presence.status === 'OFFLINE',
    );

    expect(offline.presence.status).toBe('OFFLINE');
  });

  it('não vaza presença para quem não é membro do servidor', async () => {
    const owner = await createUser();
    const estranho = await createUser();
    await createServerWithChannels(owner.id);
    await createServerWithChannels(estranho.id, 'Outro');

    const estranhoClient = await connect(estranho.id);
    await estranhoClient.waitFor('ready');

    const ownerClient = await connect(owner.id);
    await ownerClient.waitFor('ready');
    ownerClient.send({ t: 'presence:set', status: 'DO_NOT_DISTURB' });
    await ownerClient.waitFor('presence:update', (event) => event.presence.userId === owner.id);

    // Dá tempo para um eventual vazamento chegar antes de afirmar a ausência.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(
      estranhoClient.received.some(
        (event) => event.t === 'presence:update' && event.presence.userId === owner.id,
      ),
    ).toBe(false);
  });
});

describe('canais de voz', () => {
  it('anuncia a entrada e grava a sessão de voz', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    const friendReady = await friendClient.waitFor('ready');

    friendClient.send({ t: 'voice:join', channelId: server.voiceChannelId });

    const joined = await ownerClient.waitFor(
      'voice:join',
      (event) => event.participant.user.id === friend.id,
    );

    expect(joined.participant.channelId).toBe(server.voiceChannelId);
    expect(joined.participant.sessionId).toBe(friendReady.sessionId);

    const stored = await testPrisma().voiceSession.findUnique({ where: { userId: friend.id } });
    expect(stored?.channelId).toBe(server.voiceChannelId);
  });

  it('recusa entrada em canal de outro servidor', async () => {
    const owner = await createUser();
    const estranho = await createUser();
    const server = await createServerWithChannels(owner.id);
    await createServerWithChannels(estranho.id, 'Outro');

    const client = await connect(estranho.id);
    await client.waitFor('ready');

    client.send({ t: 'voice:join', channelId: server.voiceChannelId });
    const error = await client.waitFor('error');

    expect(error.code).toBe('NOT_FOUND');
    expect(await testPrisma().voiceSession.count()).toBe(0);
  });

  it('recusa entrar em canal de texto', async () => {
    const user = await createUser();
    const server = await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'voice:join', channelId: server.textChannelId });
    expect((await client.waitFor('error')).code).toBe('NOT_FOUND');
  });

  it('move o usuário ao entrar em outro canal de voz', async () => {
    const user = await createUser();
    const server = await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    client.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await client.waitFor('voice:join');

    client.send({ t: 'voice:join', channelId: server.secondVoiceChannelId });
    await client.waitFor('voice:join', (event) => event.participant.channelId === server.secondVoiceChannelId);

    const sessions = await testPrisma().voiceSession.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.channelId).toBe(server.secondVoiceChannelId);
  });

  it('propaga mute, deafen e screen share', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    await friendClient.waitFor('ready');

    friendClient.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await ownerClient.waitFor('voice:join', (event) => event.participant.user.id === friend.id);

    friendClient.send({ t: 'voice:state', selfMute: true, screenSharing: true });

    const update = await ownerClient.waitFor(
      'voice:update',
      (event) => event.participant.user.id === friend.id && event.participant.selfMute,
    );

    expect(update.participant.screenSharing).toBe(true);
  });

  it('remove da sala quando a conexão cai', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    await friendClient.waitFor('ready');

    friendClient.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await ownerClient.waitFor('voice:join', (event) => event.participant.user.id === friend.id);

    await friendClient.close();

    await ownerClient.waitFor('voice:leave', (event) => event.userId === friend.id);
    expect(await testPrisma().voiceSession.count()).toBe(0);
  });
});

describe('signaling WebRTC', () => {
  it('encaminha SDP e ICE entre participantes do mesmo canal', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    const ownerReady = await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    const friendReady = await friendClient.waitFor('ready');

    ownerClient.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await ownerClient.waitFor('voice:join');

    friendClient.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await friendClient.waitFor('voice:join', (event) => event.participant.user.id === friend.id);

    friendClient.send({
      t: 'webrtc:signal',
      to: ownerReady.sessionId,
      signal: { kind: 'description', description: { type: 'offer', sdp: 'v=0\r\nsdp-de-teste' } },
    });

    const signal = await ownerClient.waitFor('webrtc:signal');
    expect(signal.from).toBe(friendReady.sessionId);
    expect(signal.fromUserId).toBe(friend.id);
    expect(signal.signal.kind).toBe('description');

    ownerClient.send({
      t: 'webrtc:signal',
      to: friendReady.sessionId,
      signal: {
        kind: 'candidate',
        candidate: { candidate: 'candidate:1 1 udp 100 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      },
    });

    const candidate = await friendClient.waitFor('webrtc:signal');
    expect(candidate.signal.kind).toBe('candidate');
  });

  it('recusa signaling para quem está em outro canal de voz', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    const ownerReady = await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    await friendClient.waitFor('ready');

    ownerClient.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await ownerClient.waitFor('voice:join');

    friendClient.send({ t: 'voice:join', channelId: server.secondVoiceChannelId });
    await friendClient.waitFor('voice:join', (event) => event.participant.user.id === friend.id);

    friendClient.send({
      t: 'webrtc:signal',
      to: ownerReady.sessionId,
      signal: { kind: 'description', description: { type: 'offer', sdp: 'v=0' } },
    });

    expect((await friendClient.waitFor('error')).code).toBe('NOT_FOUND');
  });

  it('recusa signaling de quem não entrou em nenhum canal de voz', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const server = await createServerWithChannels(owner.id);
    await addMember(server.id, friend.id);

    const ownerClient = await connect(owner.id);
    const ownerReady = await ownerClient.waitFor('ready');

    const friendClient = await connect(friend.id);
    await friendClient.waitFor('ready');

    friendClient.send({
      t: 'webrtc:signal',
      to: ownerReady.sessionId,
      signal: { kind: 'description', description: { type: 'offer', sdp: 'v=0' } },
    });

    expect((await friendClient.waitFor('error')).code).toBe('FORBIDDEN');
  });

  it('rejeita SDP acima do tamanho máximo', async () => {
    const user = await createUser();
    const server = await createServerWithChannels(user.id);

    const client = await connect(user.id);
    const ready = await client.waitFor('ready');

    client.send({ t: 'voice:join', channelId: server.voiceChannelId });
    await client.waitFor('voice:join');

    client.send({
      t: 'webrtc:signal',
      to: ready.sessionId,
      signal: { kind: 'description', description: { type: 'offer', sdp: 'x'.repeat(40_000) } },
    });

    expect((await client.waitFor('error')).code).toBe('INVALID_PAYLOAD');
  });
});

describe('revogação de sessão', () => {
  it('derruba a conexão quando a sessão é revogada', async () => {
    const user = await createUser();
    await createServerWithChannels(user.id);

    const client = await connect(user.id);
    await client.waitFor('ready');

    const { publishEvent } = await import('@/lib/realtime/publish');
    const { Topic } = await import('@/lib/realtime/topics');

    await publishEvent(Topic.user(user.id), { t: 'session:revoked', reason: 'Sessão encerrada.' });

    expect(await client.waitForClose()).toBe(CLOSE_CODES.SESSION_REVOKED);
  });
});
