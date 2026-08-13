import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { cookieJar, jsonRequest, getRequest, readJson } from './helpers/next';
import { disconnectTestPrisma, resetDatabase, testPrisma } from './helpers/db';
import { addMember, createServerWithChannels, createSessionFor, createUser } from './helpers/fixtures';
import type { MessageDTO, MessagePage } from '@/lib/types';

vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());

const { GET: listMessages, POST: sendMessage } = await import(
  '@/app/api/channels/[channelId]/messages/route'
);
const { PATCH: editMessage, DELETE: deleteMessage } = await import(
  '@/app/api/messages/[messageId]/route'
);
const { POST: toggleReaction } = await import('@/app/api/messages/[messageId]/reactions/route');
const { POST: markRead } = await import('@/app/api/channels/[channelId]/read/route');
const { GET: getUnreads } = await import('@/app/api/servers/[serverId]/unreads/route');
const { SESSION_COOKIE } = await import('@/lib/auth/session');
const { resetRateLimits } = await import('@/lib/api/rate-limit');

let owner: Awaited<ReturnType<typeof createUser>>;
let friend: Awaited<ReturnType<typeof createUser>>;
let stranger: Awaited<ReturnType<typeof createUser>>;
let server: Awaited<ReturnType<typeof createServerWithChannels>>;

/** Autentica as próximas chamadas como o usuário informado. */
async function loginAs(userId: string) {
  const { token } = await createSessionFor(userId);
  cookieJar.set(SESSION_COOKIE, token);
}

function channelParams(channelId: string) {
  return { params: Promise.resolve({ channelId }) };
}

function messageParams(messageId: string) {
  return { params: Promise.resolve({ messageId }) };
}

async function post(channelId: string, content: string, replyToId?: string) {
  const response = await sendMessage(
    jsonRequest('http://localhost:3000/api/messages', { content, replyToId }),
    channelParams(channelId),
  );
  return { response, body: await readJson<{ message: MessageDTO }>(response) };
}

beforeEach(async () => {
  await resetDatabase();
  cookieJar.clear();
  resetRateLimits();

  owner = await createUser({ username: 'dono' });
  friend = await createUser({ username: 'amigo' });
  stranger = await createUser({ username: 'estranho' });

  server = await createServerWithChannels(owner.id);
  await addMember(server.id, friend.id);

  await loginAs(owner.id);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('envio de mensagem', () => {
  it('cria a mensagem e devolve o DTO completo', async () => {
    const { response, body } = await post(server.textChannelId, 'primeira mensagem');

    expect(response.status).toBe(201);
    expect(body.message.content).toBe('primeira mensagem');
    expect(body.message.author.id).toBe(owner.id);
    expect(body.message.deleted).toBe(false);
    expect(body.message.editedAt).toBeNull();
  });

  it('rejeita mensagem vazia ou só com espaços', async () => {
    const vazia = await sendMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: '   \n  ' }),
      channelParams(server.textChannelId),
    );

    expect(vazia.status).toBe(422);
  });

  it('rejeita mensagem acima de 4000 caracteres', async () => {
    const { response } = await post(server.textChannelId, 'x'.repeat(4001));
    expect(response.status).toBe(422);
  });

  it('preserva quebras de linha internas', async () => {
    const { body } = await post(server.textChannelId, '  linha 1\nlinha 2  ');
    expect(body.message.content).toBe('linha 1\nlinha 2');
  });

  it('recusa envio em canal de voz', async () => {
    const response = await sendMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: 'oi' }),
      channelParams(server.voiceChannelId),
    );

    expect(response.status).toBe(400);
  });

  it('recusa quem não é membro do servidor', async () => {
    await loginAs(stranger.id);

    const response = await sendMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: 'invadindo' }),
      channelParams(server.textChannelId),
    );

    // 404 e não 403: quem não é membro não deve descobrir que o canal existe.
    expect(response.status).toBe(404);
    expect(await testPrisma().message.count()).toBe(0);
  });

  it('recusa sem sessão', async () => {
    cookieJar.clear();

    const response = await sendMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: 'anônimo' }),
      channelParams(server.textChannelId),
    );

    expect(response.status).toBe(401);
  });

  it('aplica rate limit ao flood de mensagens', async () => {
    let limited = false;

    for (let i = 0; i < 40; i += 1) {
      const { response } = await post(server.textChannelId, `spam ${i}`);
      if (response.status === 429) {
        limited = true;
        break;
      }
    }

    expect(limited).toBe(true);
  });
});

describe('respostas', () => {
  it('guarda a prévia da mensagem respondida', async () => {
    const { body: original } = await post(server.textChannelId, 'mensagem original');
    const { body: reply } = await post(server.textChannelId, 'respondendo', original.message.id);

    expect(reply.message.replyTo?.id).toBe(original.message.id);
    expect(reply.message.replyTo?.content).toBe('mensagem original');
    expect(reply.message.replyTo?.author?.id).toBe(owner.id);
  });

  it('recusa responder mensagem de outro canal', async () => {
    const outroCanal = await testPrisma().channel.findFirst({
      where: { serverId: server.id, type: 'TEXT', name: 'memes' },
    });

    const { body: original } = await post(outroCanal!.id, 'mensagem do outro canal');

    const response = await sendMessage(
      jsonRequest('http://localhost:3000/api/messages', {
        content: 'citando de fora',
        replyToId: original.message.id,
      }),
      channelParams(server.textChannelId),
    );

    expect(response.status).toBe(400);
  });
});

describe('histórico paginado', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 12; i += 1) {
      await post(server.textChannelId, `mensagem ${i}`);
    }
  });

  it('devolve a página mais recente em ordem cronológica', async () => {
    const response = await listMessages(
      getRequest('http://localhost:3000/api/messages?limit=5'),
      channelParams(server.textChannelId),
    );

    const page = await readJson<MessagePage>(response);

    expect(page.messages).toHaveLength(5);
    expect(page.messages[0]!.content).toBe('mensagem 8');
    expect(page.messages[4]!.content).toBe('mensagem 12');
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(page.messages[0]!.id);
  });

  it('percorre todo o histórico sem repetir nem pular mensagens', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let guard = 0; guard < 10; guard += 1) {
      const url = `http://localhost:3000/api/messages?limit=5${cursor ? `&cursor=${cursor}` : ''}`;
      const page: MessagePage = await readJson(
        await listMessages(getRequest(url), channelParams(server.textChannelId)),
      );

      seen.unshift(...page.messages.map((message) => message.content));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen[0]).toBe('mensagem 1');
    expect(seen[11]).toBe('mensagem 12');
  });

  it('recusa histórico para quem não é membro', async () => {
    await loginAs(stranger.id);

    const response = await listMessages(
      getRequest('http://localhost:3000/api/messages'),
      channelParams(server.textChannelId),
    );

    expect(response.status).toBe(404);
  });
});

describe('edição', () => {
  it('permite ao autor editar e marca editedAt', async () => {
    const { body } = await post(server.textChannelId, 'texto original');

    const response = await editMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: 'texto corrigido' }, { method: 'PATCH' }),
      messageParams(body.message.id),
    );

    const updated = await readJson<{ message: MessageDTO }>(response);

    expect(response.status).toBe(200);
    expect(updated.message.content).toBe('texto corrigido');
    expect(updated.message.editedAt).not.toBeNull();
  });

  it('impede que outro membro edite', async () => {
    const { body } = await post(server.textChannelId, 'minha mensagem');
    await loginAs(friend.id);

    const response = await editMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: 'reescrita' }, { method: 'PATCH' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(403);
  });

  it('impede que o dono do servidor reescreva mensagem alheia', async () => {
    await loginAs(friend.id);
    const { body } = await post(server.textChannelId, 'mensagem do amigo');

    await loginAs(owner.id);
    const response = await editMessage(
      jsonRequest('http://localhost:3000/api/messages', { content: 'censurada' }, { method: 'PATCH' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(403);
  });
});

describe('exclusão', () => {
  it('o autor apaga a própria mensagem e o conteúdo some do banco', async () => {
    const { body } = await post(server.textChannelId, 'algo constrangedor');

    const response = await deleteMessage(
      jsonRequest('http://localhost:3000/api/messages', undefined, { method: 'DELETE' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(200);

    const stored = await testPrisma().message.findUnique({ where: { id: body.message.id } });
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.content).toBe('');
  });

  it('o dono do servidor pode apagar mensagem de outro (moderação)', async () => {
    await loginAs(friend.id);
    const { body } = await post(server.textChannelId, 'mensagem do amigo');

    await loginAs(owner.id);
    const response = await deleteMessage(
      jsonRequest('http://localhost:3000/api/messages', undefined, { method: 'DELETE' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(200);
  });

  it('um membro comum não apaga mensagem alheia', async () => {
    const { body } = await post(server.textChannelId, 'mensagem do dono');
    await loginAs(friend.id);

    const response = await deleteMessage(
      jsonRequest('http://localhost:3000/api/messages', undefined, { method: 'DELETE' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(403);
  });

  it('mensagem apagada some do histórico mas a resposta a ela sobrevive', async () => {
    const { body: original } = await post(server.textChannelId, 'vou apagar isso');
    const { body: reply } = await post(server.textChannelId, 'resposta', original.message.id);

    await deleteMessage(
      jsonRequest('http://localhost:3000/api/messages', undefined, { method: 'DELETE' }),
      messageParams(original.message.id),
    );

    const page = await readJson<MessagePage>(
      await listMessages(getRequest('http://localhost:3000/api/messages'), channelParams(server.textChannelId)),
    );

    expect(page.messages.map((message) => message.id)).not.toContain(original.message.id);

    const survivor = page.messages.find((message) => message.id === reply.message.id);
    expect(survivor?.replyTo?.deleted).toBe(true);
    expect(survivor?.replyTo?.content).toBe('');
  });
});

describe('reações', () => {
  it('adiciona e remove a reação no segundo toque', async () => {
    const { body } = await post(server.textChannelId, 'reaja aqui');

    const added = await readJson<{ reactions: MessageDTO['reactions'] }>(
      await toggleReaction(
        jsonRequest('http://localhost:3000/api/reactions', { emoji: '🔥' }),
        messageParams(body.message.id),
      ),
    );

    expect(added.reactions[0]).toMatchObject({ emoji: '🔥', count: 1, reactedByMe: true });

    const removed = await readJson<{ reactions: MessageDTO['reactions'] }>(
      await toggleReaction(
        jsonRequest('http://localhost:3000/api/reactions', { emoji: '🔥' }),
        messageParams(body.message.id),
      ),
    );

    expect(removed.reactions).toHaveLength(0);
  });

  it('agrupa reações de vários usuários no mesmo emoji', async () => {
    const { body } = await post(server.textChannelId, 'reaja aqui');

    await toggleReaction(
      jsonRequest('http://localhost:3000/api/reactions', { emoji: '👍' }),
      messageParams(body.message.id),
    );

    await loginAs(friend.id);
    const result = await readJson<{ reactions: MessageDTO['reactions'] }>(
      await toggleReaction(
        jsonRequest('http://localhost:3000/api/reactions', { emoji: '👍' }),
        messageParams(body.message.id),
      ),
    );

    expect(result.reactions[0]!.count).toBe(2);
    expect(result.reactions[0]!.users).toHaveLength(2);
  });

  it('recusa texto no lugar de emoji', async () => {
    const { body } = await post(server.textChannelId, 'reaja aqui');

    const response = await toggleReaction(
      jsonRequest('http://localhost:3000/api/reactions', { emoji: 'isto é texto' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(422);
  });

  it('recusa reação de quem não é membro', async () => {
    const { body } = await post(server.textChannelId, 'reaja aqui');
    await loginAs(stranger.id);

    const response = await toggleReaction(
      jsonRequest('http://localhost:3000/api/reactions', { emoji: '🔥' }),
      messageParams(body.message.id),
    );

    expect(response.status).toBe(404);
  });
});

describe('mensagens não lidas', () => {
  it('conta só as mensagens de outras pessoas depois da última leitura', async () => {
    await loginAs(friend.id);
    await post(server.textChannelId, 'oi');
    await post(server.textChannelId, 'tudo bem?');

    await loginAs(owner.id);
    await post(server.textChannelId, 'as minhas não contam');

    const before = await readJson<{ unreads: Array<{ channelId: string; unreadCount: number }> }>(
      await getUnreads(getRequest('http://localhost:3000/api/unreads'), {
        params: Promise.resolve({ serverId: server.id }),
      }),
    );

    const channel = before.unreads.find((entry) => entry.channelId === server.textChannelId);
    expect(channel?.unreadCount).toBe(2);

    await markRead(
      jsonRequest('http://localhost:3000/api/read', undefined),
      channelParams(server.textChannelId),
    );

    const after = await readJson<{ unreads: Array<{ channelId: string; unreadCount: number }> }>(
      await getUnreads(getRequest('http://localhost:3000/api/unreads'), {
        params: Promise.resolve({ serverId: server.id }),
      }),
    );

    expect(after.unreads.find((entry) => entry.channelId === server.textChannelId)?.unreadCount).toBe(0);
  });
});
