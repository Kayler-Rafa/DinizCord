import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { cookieJar, jsonRequest, readJson } from './helpers/next';
import { disconnectTestPrisma, resetDatabase } from './helpers/db';
import { addMember, createServerWithChannels, createSessionFor, createUser } from './helpers/fixtures';
import { extrairMencoes, dividirPorMencoes } from '@/lib/mentions';
import type { MessageDTO } from '@/lib/types';

vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());

const { POST: sendMessage } = await import('@/app/api/channels/[channelId]/messages/route');
const { SESSION_COOKIE } = await import('@/lib/auth/session');
const { resetRateLimits } = await import('@/lib/api/rate-limit');

describe('extração de menções', () => {
  it('encontra nomes precedidos de espaço ou início de linha', () => {
    expect(extrairMencoes('@rafael olha isso')).toEqual(['rafael']);
    expect(extrairMencoes('oi @joao e @maria')).toEqual(['joao', 'maria']);
  });

  it('ignora e-mails e arrobas no meio de palavras', () => {
    expect(extrairMencoes('manda para rafael@exemplo.com')).toEqual([]);
    expect(extrairMencoes('algo@outro')).toEqual([]);
  });

  it('não repete o mesmo nome', () => {
    expect(extrairMencoes('@rafa @rafa @rafa')).toEqual(['rafa']);
  });

  it('normaliza para minúsculas', () => {
    expect(extrairMencoes('@Rafael')).toEqual(['rafael']);
  });

  it('deixa como texto o que não corresponde a um membro', () => {
    const membros = new Map([['rafael', 'id-rafael']]);
    const trechos = dividirPorMencoes('oi @rafael e @fantasma', membros);

    expect(trechos.filter((t) => t.tipo === 'mencao')).toHaveLength(1);
    expect(trechos.map((t) => t.valor).join('')).toBe('oi @rafael e @fantasma');
  });
});

describe('menções na API', () => {
  let autor: Awaited<ReturnType<typeof createUser>>;
  let citado: Awaited<ReturnType<typeof createUser>>;
  let estranho: Awaited<ReturnType<typeof createUser>>;
  let server: Awaited<ReturnType<typeof createServerWithChannels>>;

  async function loginAs(userId: string) {
    const { token } = await createSessionFor(userId);
    cookieJar.set(SESSION_COOKIE, token);
  }

  async function enviar(conteudo: string) {
    const resposta = await sendMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: conteudo }),
      { params: Promise.resolve({ channelId: server.textChannelId }) },
    );
    return readJson<{ message: MessageDTO }>(resposta);
  }

  beforeEach(async () => {
    await resetDatabase();
    cookieJar.clear();
    resetRateLimits();

    autor = await createUser({ username: 'autor' });
    citado = await createUser({ username: 'citado' });
    estranho = await createUser({ username: 'estranho' });

    server = await createServerWithChannels(autor.id);
    await addMember(server.id, citado.id);

    await loginAs(autor.id);
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('resolve o nome citado para o id do membro', async () => {
    const { message } = await enviar('bora jogar @citado');
    expect(message.mentions).toEqual([citado.id]);
  });

  it('ignora quem não é membro do servidor', async () => {
    // Citar alguém de fora não pode notificar nem revelar que a conta existe.
    const { message } = await enviar('oi @estranho');
    expect(message.mentions).toEqual([]);
    expect(estranho.id).toBeDefined();
  });

  it('não menciona o próprio autor', async () => {
    const { message } = await enviar('falando sozinho @autor');
    expect(message.mentions).toEqual([]);
  });

  it('recalcula as menções ao editar', async () => {
    const { message } = await enviar('mensagem sem citação');
    expect(message.mentions).toEqual([]);

    const { PATCH: editMessage } = await import('@/app/api/messages/[messageId]/route');
    const editada = await readJson<{ message: MessageDTO }>(
      await editMessage(
        jsonRequest('http://localhost:3000/api/messages', { content: 'agora com @citado' }, { method: 'PATCH' }),
        { params: Promise.resolve({ messageId: message.id }) },
      ),
    );

    expect(editada.message.mentions).toEqual([citado.id]);
  });

  it('mensagem apagada não expõe menções', async () => {
    const { message } = await enviar('@citado vem cá');

    const { DELETE: deleteMessage } = await import('@/app/api/messages/[messageId]/route');
    await deleteMessage(
      jsonRequest('http://localhost:3000/api/messages', undefined, { method: 'DELETE' }),
      { params: Promise.resolve({ messageId: message.id }) },
    );

    const { GET: listMessages } = await import('@/app/api/channels/[channelId]/messages/route');
    const { getRequest } = await import('./helpers/next');
    const pagina = await readJson<{ messages: MessageDTO[] }>(
      await listMessages(getRequest('http://localhost:3000/api/messages'), {
        params: Promise.resolve({ channelId: server.textChannelId }),
      }),
    );

    expect(pagina.messages.find((m) => m.id === message.id)).toBeUndefined();
  });
});
