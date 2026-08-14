import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { cookieJar, jsonRequest, getRequest, readJson } from './helpers/next';
import { disconnectTestPrisma, resetDatabase, testPrisma } from './helpers/db';
import { addMember, createServerWithChannels, createSessionFor, createTicketFor, createUser } from './helpers/fixtures';
import { startTestGateway, TestClient, type TestGateway } from './helpers/gateway';
import { CLOSE_CODES } from '@/lib/websocket/protocol';
import { TERMS_VERSION } from '@/lib/terms';

vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());

const { POST: aceitarTermos } = await import('@/app/api/terms/accept/route');
const { GET: listarServidores } = await import('@/app/api/servers/route');
const { POST: enviarMensagem } = await import('@/app/api/channels/[channelId]/messages/route');
const { POST: logout } = await import('@/app/api/auth/logout/route');
const { GET: me } = await import('@/app/api/auth/me/route');
const { SESSION_COOKIE, getSession } = await import('@/lib/auth/session');
const { resetRateLimits } = await import('@/lib/api/rate-limit');

let usuario: Awaited<ReturnType<typeof createUser>>;
let server: Awaited<ReturnType<typeof createServerWithChannels>>;

async function loginAs(userId: string) {
  const { token } = await createSessionFor(userId);
  cookieJar.set(SESSION_COOKIE, token);
}

beforeEach(async () => {
  await resetDatabase();
  cookieJar.clear();
  resetRateLimits();

  usuario = await createUser({ semAceitarTermos: true });
  server = await createServerWithChannels(usuario.id);
  await loginAs(usuario.id);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('bloqueio antes do aceite', () => {
  it('a sessão nasce sem aceite', async () => {
    const sessao = await getSession();
    expect(sessao?.user.termsAccepted).toBe(false);
  });

  it('recusa listar servidores', async () => {
    const resposta = await listarServidores();
    expect(resposta.status).toBe(403);

    const corpo = await readJson<{ error: { message: string } }>(resposta);
    expect(corpo.error.message).toContain('termos de uso');
  });

  it('recusa enviar mensagem — chamar a API direto não contorna a tela', async () => {
    const resposta = await enviarMensagem(
      jsonRequest('http://localhost:3000/api/messages', { content: 'pulei a tela' }),
      { params: Promise.resolve({ channelId: server.textChannelId }) },
    );

    expect(resposta.status).toBe(403);
    expect(await testPrisma().message.count()).toBe(0);
  });

  it('permite consultar a própria sessão', async () => {
    // Sem isto o cliente não teria como saber que falta aceitar.
    const corpo = await readJson<{ user: { termsAccepted: boolean } | null }>(await me());
    expect(corpo.user?.termsAccepted).toBe(false);
  });

  it('permite sair da conta', async () => {
    // Recusar os termos precisa funcionar; senão a pessoa fica presa.
    const resposta = await logout(
      jsonRequest('http://localhost:3000/api/auth/logout', undefined),
    );
    expect(resposta.status).toBe(200);
  });
});

describe('aceite', () => {
  it('registra data e versão e libera o acesso', async () => {
    const resposta = await aceitarTermos(
      jsonRequest('http://localhost:3000/api/terms/accept', undefined),
    );

    expect(resposta.status).toBe(200);
    const corpo = await readJson<{ version: string }>(resposta);
    expect(corpo.version).toBe(TERMS_VERSION);

    const gravado = await testPrisma().user.findUnique({ where: { id: usuario.id } });
    expect(gravado?.termsAcceptedVersion).toBe(TERMS_VERSION);
    expect(gravado?.termsAcceptedAt).not.toBeNull();

    // Agora as rotas normais respondem.
    expect((await listarServidores()).status).toBe(200);
  });

  it('exige aceite de novo quando a versão dos termos muda', async () => {
    await aceitarTermos(jsonRequest('http://localhost:3000/api/terms/accept', undefined));
    expect((await listarServidores()).status).toBe(200);

    // Simula uma revisão dos termos publicada depois do aceite.
    await testPrisma().user.update({
      where: { id: usuario.id },
      data: { termsAcceptedVersion: 'versao-antiga' },
    });

    expect((await listarServidores()).status).toBe(403);
  });

  it('exige sessão para aceitar', async () => {
    cookieJar.clear();
    const resposta = await aceitarTermos(
      jsonRequest('http://localhost:3000/api/terms/accept', undefined),
    );
    expect(resposta.status).toBe(401);
  });

  it('recusa aceite vindo de outra origem', async () => {
    const resposta = await aceitarTermos(
      jsonRequest('http://localhost:3000/api/terms/accept', undefined, {
        origin: 'https://site-malicioso.example',
      }),
    );
    expect(resposta.status).toBe(403);
  });
});

describe('bloqueio no WebSocket', () => {
  let harness: TestGateway;
  const abertos: TestClient[] = [];

  beforeEach(async () => {
    harness = await startTestGateway();
  });

  afterEach(async () => {
    await Promise.all(abertos.splice(0).map((cliente) => cliente.close()));
    await harness.stop();
  });

  it('recusa a conexão de quem não aceitou', async () => {
    // O caminho mais óbvio para contornar a tela seria abrir o socket direto.
    const { ticket } = await createTicketFor(usuario.id);
    const cliente = await TestClient.connect(harness.url, ticket);
    abertos.push(cliente);

    expect(await cliente.waitForClose()).toBe(CLOSE_CODES.TERMS_PENDING);
    expect(cliente.received).toHaveLength(0);
  });

  it('aceita a conexão depois do aceite', async () => {
    await aceitarTermos(jsonRequest('http://localhost:3000/api/terms/accept', undefined));

    const { ticket } = await createTicketFor(usuario.id);
    const cliente = await TestClient.connect(harness.url, ticket);
    abertos.push(cliente);

    const pronto = await cliente.waitFor('ready');
    expect(pronto.userId).toBe(usuario.id);
  });

  it('não vaza mensagens para quem não aceitou', async () => {
    const outro = await createUser();
    await addMember(server.id, outro.id);

    const { ticket } = await createTicketFor(usuario.id);
    const semAceite = await TestClient.connect(harness.url, ticket);
    abertos.push(semAceite);
    await semAceite.waitForClose();

    // Alguém que aceitou envia uma mensagem.
    await loginAs(outro.id);
    await enviarMensagem(
      jsonRequest('http://localhost:3000/api/messages', { content: 'conversa privada' }),
      { params: Promise.resolve({ channelId: server.textChannelId }) },
    );

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(semAceite.received.some((evento) => evento.t === 'message:create')).toBe(false);
  });
});

describe('página de termos', () => {
  it('libera o histórico só depois do aceite', async () => {
    const antes = await listarServidores();
    expect(antes.status).toBe(403);

    await aceitarTermos(jsonRequest('http://localhost:3000/api/terms/accept', undefined));

    const depois = await listarServidores();
    expect(depois.status).toBe(200);
    expect(getRequest).toBeDefined();
  });
});
