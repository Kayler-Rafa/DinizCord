import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { cookieJar, jsonRequest, getRequest, readJson } from './helpers/next';
import { disconnectTestPrisma, resetDatabase, testPrisma } from './helpers/db';
import { addMember, createServerWithChannels, createSessionFor, createUser } from './helpers/fixtures';
import type { ChannelDTO, MemberDTO, ServerDTO } from '@/lib/types';

vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());

const { GET: listServers } = await import('@/app/api/servers/route');
const { PATCH: patchServer } = await import('@/app/api/servers/[serverId]/route');
const { POST: createChannelRoute } = await import('@/app/api/servers/[serverId]/channels/route');
const { PATCH: patchChannel, DELETE: deleteChannelRoute } = await import(
  '@/app/api/channels/[channelId]/route'
);
const { GET: listMembersRoute } = await import('@/app/api/servers/[serverId]/members/route');
const { PATCH: patchMember, DELETE: deleteMember } = await import(
  '@/app/api/servers/[serverId]/members/[userId]/route'
);
const { SESSION_COOKIE } = await import('@/lib/auth/session');
const { resetRateLimits } = await import('@/lib/api/rate-limit');

let owner: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;
let member: Awaited<ReturnType<typeof createUser>>;
let stranger: Awaited<ReturnType<typeof createUser>>;
let server: Awaited<ReturnType<typeof createServerWithChannels>>;

async function loginAs(userId: string) {
  const { token } = await createSessionFor(userId);
  cookieJar.set(SESSION_COOKIE, token);
}

const serverParams = (serverId: string) => ({ params: Promise.resolve({ serverId }) });
const channelParams = (channelId: string) => ({ params: Promise.resolve({ channelId }) });
const memberParams = (serverId: string, userId: string) => ({
  params: Promise.resolve({ serverId, userId }),
});

beforeEach(async () => {
  await resetDatabase();
  cookieJar.clear();
  resetRateLimits();

  owner = await createUser({ username: 'dono' });
  admin = await createUser({ username: 'admin' });
  member = await createUser({ username: 'membro' });
  stranger = await createUser({ username: 'estranho' });

  server = await createServerWithChannels(owner.id);
  await addMember(server.id, admin.id, 'ADMIN');
  await addMember(server.id, member.id, 'MEMBER');

  await loginAs(owner.id);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('listagem de servidores', () => {
  it('devolve os servidores do usuário com canais e papel', async () => {
    const body = await readJson<{ servers: ServerDTO[] }>(await listServers());

    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]!.viewerRole).toBe('OWNER');
    expect(body.servers[0]!.channels).toHaveLength(4);
  });

  it('não devolve servidores de que o usuário não participa', async () => {
    await loginAs(stranger.id);
    const body = await readJson<{ servers: ServerDTO[] }>(await listServers());
    expect(body.servers).toHaveLength(0);
  });

  it('exige sessão', async () => {
    cookieJar.clear();
    expect((await listServers()).status).toBe(401);
  });
});

describe('criação de canal', () => {
  it('o dono cria canal de texto com nome normalizado', async () => {
    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: 'Jogos de Corrida', type: 'TEXT' }),
      serverParams(server.id),
    );

    const body = await readJson<{ channel: ChannelDTO }>(response);

    expect(response.status).toBe(201);
    expect(body.channel.name).toBe('jogos-de-corrida');
    expect(body.channel.type).toBe('TEXT');
  });

  it('canal de voz preserva maiúsculas e espaços', async () => {
    const body = await readJson<{ channel: ChannelDTO }>(
      await createChannelRoute(
        jsonRequest('http://localhost:3000/api/channels', { name: 'Sala do Forza', type: 'VOICE' }),
        serverParams(server.id),
      ),
    );

    expect(body.channel.name).toBe('Sala do Forza');
  });

  it('administrador também cria canais', async () => {
    await loginAs(admin.id);

    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: 'novidades', type: 'TEXT' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(201);
  });

  it('membro comum não cria canais', async () => {
    await loginAs(member.id);

    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: 'proibido', type: 'TEXT' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(403);
  });

  it('quem não é membro recebe 404, não 403', async () => {
    await loginAs(stranger.id);

    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: 'invasao', type: 'TEXT' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(404);
  });

  it('recusa nome duplicado no mesmo tipo', async () => {
    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: 'geral', type: 'TEXT' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(422);
  });

  it('permite o mesmo nome em tipos diferentes', async () => {
    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: 'geral', type: 'VOICE' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(201);
  });

  it('recusa nome que vira vazio depois da normalização', async () => {
    const response = await createChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', { name: '!!!', type: 'TEXT' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(422);
  });
});

describe('edição e exclusão de canal', () => {
  it('renomeia o canal', async () => {
    const body = await readJson<{ channel: ChannelDTO }>(
      await patchChannel(
        jsonRequest('http://localhost:3000/api/channels', { name: 'papo-geral' }, { method: 'PATCH' }),
        channelParams(server.textChannelId),
      ),
    );

    expect(body.channel.name).toBe('papo-geral');
  });

  it('exclui um canal de texto quando ainda sobra outro', async () => {
    const response = await deleteChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', undefined, { method: 'DELETE' }),
      channelParams(server.textChannelId),
    );

    expect(response.status).toBe(200);
    expect(await testPrisma().channel.count({ where: { serverId: server.id, type: 'TEXT' } })).toBe(1);
  });

  it('impede excluir o último canal de texto', async () => {
    const outro = await testPrisma().channel.findFirst({
      where: { serverId: server.id, type: 'TEXT', name: 'memes' },
    });

    await deleteChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', undefined, { method: 'DELETE' }),
      channelParams(outro!.id),
    );

    const response = await deleteChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', undefined, { method: 'DELETE' }),
      channelParams(server.textChannelId),
    );

    expect(response.status).toBe(409);
  });

  it('apagar canal apaga as mensagens dele em cascata', async () => {
    await testPrisma().message.create({
      data: { channelId: server.textChannelId, authorId: owner.id, content: 'tchau' },
    });

    await deleteChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', undefined, { method: 'DELETE' }),
      channelParams(server.textChannelId),
    );

    expect(await testPrisma().message.count()).toBe(0);
  });

  it('membro comum não exclui canal', async () => {
    await loginAs(member.id);

    const response = await deleteChannelRoute(
      jsonRequest('http://localhost:3000/api/channels', undefined, { method: 'DELETE' }),
      channelParams(server.textChannelId),
    );

    expect(response.status).toBe(403);
  });
});

describe('configuração do servidor', () => {
  it('o dono renomeia o servidor', async () => {
    const response = await patchServer(
      jsonRequest('http://localhost:3000/api/servers', { name: 'Turma do Rafa' }, { method: 'PATCH' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(200);
    const stored = await testPrisma().server.findUnique({ where: { id: server.id } });
    expect(stored?.name).toBe('Turma do Rafa');
  });

  it('membro comum não renomeia', async () => {
    await loginAs(member.id);

    const response = await patchServer(
      jsonRequest('http://localhost:3000/api/servers', { name: 'Meu agora' }, { method: 'PATCH' }),
      serverParams(server.id),
    );

    expect(response.status).toBe(403);
  });
});

describe('membros', () => {
  it('lista os membros para quem participa', async () => {
    await loginAs(member.id);

    const body = await readJson<{ members: MemberDTO[] }>(
      await listMembersRoute(getRequest('http://localhost:3000/api/members'), serverParams(server.id)),
    );

    expect(body.members).toHaveLength(3);
    expect(body.members[0]!.role).toBe('OWNER');
  });

  it('não lista membros para quem está de fora', async () => {
    await loginAs(stranger.id);

    const response = await listMembersRoute(
      getRequest('http://localhost:3000/api/members'),
      serverParams(server.id),
    );

    expect(response.status).toBe(404);
  });

  it('o dono promove um membro a administrador', async () => {
    const body = await readJson<{ member: MemberDTO }>(
      await patchMember(
        jsonRequest('http://localhost:3000/api/members', { role: 'ADMIN' }, { method: 'PATCH' }),
        memberParams(server.id, member.id),
      ),
    );

    expect(body.member.role).toBe('ADMIN');
  });

  it('administrador não promove ninguém', async () => {
    await loginAs(admin.id);

    const response = await patchMember(
      jsonRequest('http://localhost:3000/api/members', { role: 'ADMIN' }, { method: 'PATCH' }),
      memberParams(server.id, member.id),
    );

    expect(response.status).toBe(403);
  });

  it('o dono remove um membro', async () => {
    const response = await deleteMember(
      jsonRequest('http://localhost:3000/api/members', undefined, { method: 'DELETE' }),
      memberParams(server.id, member.id),
    );

    expect(response.status).toBe(200);
    expect(await testPrisma().serverMember.count({ where: { serverId: server.id } })).toBe(2);
  });

  it('administrador não remove outro administrador', async () => {
    const outroAdmin = await createUser({ username: 'admin2' });
    await addMember(server.id, outroAdmin.id, 'ADMIN');
    await loginAs(admin.id);

    const response = await deleteMember(
      jsonRequest('http://localhost:3000/api/members', undefined, { method: 'DELETE' }),
      memberParams(server.id, outroAdmin.id),
    );

    expect(response.status).toBe(403);
  });

  it('o dono não pode ser removido', async () => {
    const response = await deleteMember(
      jsonRequest('http://localhost:3000/api/members', undefined, { method: 'DELETE' }),
      memberParams(server.id, owner.id),
    );

    expect(response.status).toBe(403);
  });

  it('um membro pode sair do servidor sozinho', async () => {
    await loginAs(member.id);

    const response = await deleteMember(
      jsonRequest('http://localhost:3000/api/members', undefined, { method: 'DELETE' }),
      memberParams(server.id, member.id),
    );

    expect(response.status).toBe(200);
  });

  it('membro comum não remove outro membro', async () => {
    const outro = await createUser({ username: 'outro' });
    await addMember(server.id, outro.id);
    await loginAs(member.id);

    const response = await deleteMember(
      jsonRequest('http://localhost:3000/api/members', undefined, { method: 'DELETE' }),
      memberParams(server.id, outro.id),
    );

    expect(response.status).toBe(403);
  });

  it('sair do servidor encerra a sessão de voz do usuário', async () => {
    const channel = await testPrisma().channel.findFirst({
      where: { serverId: server.id, type: 'VOICE' },
    });

    await testPrisma().voiceSession.create({
      data: {
        id: 'sessao-de-voz-de-teste',
        userId: member.id,
        channelId: channel!.id,
        instanceId: 'teste',
      },
    });

    await deleteMember(
      jsonRequest('http://localhost:3000/api/members', undefined, { method: 'DELETE' }),
      memberParams(server.id, member.id),
    );

    expect(await testPrisma().voiceSession.count()).toBe(0);
  });
});
