import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { cookieJar, jsonRequest, getRequest, readJson } from './helpers/next';
import { disconnectTestPrisma, resetDatabase, testPrisma } from './helpers/db';
import { addMember, createServerWithChannels, createSessionFor, createUser } from './helpers/fixtures';
import type { InviteDTO, InvitePreviewDTO } from '@/lib/types';

vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());

const { GET: listInvites, POST: createInviteRoute } = await import(
  '@/app/api/servers/[serverId]/invites/route'
);
const { DELETE: revokeInvite } = await import('@/app/api/invites/[inviteId]/route');
const { GET: previewRoute, POST: acceptRoute } = await import('@/app/api/invites/code/[code]/route');
const { SESSION_COOKIE } = await import('@/lib/auth/session');
const { resetRateLimits } = await import('@/lib/api/rate-limit');

let owner: Awaited<ReturnType<typeof createUser>>;
let member: Awaited<ReturnType<typeof createUser>>;
let outsider: Awaited<ReturnType<typeof createUser>>;
let server: Awaited<ReturnType<typeof createServerWithChannels>>;

async function loginAs(userId: string) {
  const { token } = await createSessionFor(userId);
  cookieJar.set(SESSION_COOKIE, token);
}

const serverParams = (serverId: string) => ({ params: Promise.resolve({ serverId }) });
const codeParams = (code: string) => ({ params: Promise.resolve({ code }) });

async function makeInvite(options: { expiresInSeconds?: number | null; maxUses?: number | null } = {}) {
  const response = await createInviteRoute(
    jsonRequest('http://localhost:3000/api/invites', {
      expiresInSeconds: options.expiresInSeconds ?? null,
      maxUses: options.maxUses ?? null,
    }),
    serverParams(server.id),
  );

  const body = await readJson<{ invite: InviteDTO }>(response);
  return body.invite;
}

beforeEach(async () => {
  await resetDatabase();
  cookieJar.clear();
  resetRateLimits();

  owner = await createUser({ username: 'dono' });
  member = await createUser({ username: 'membro' });
  outsider = await createUser({ username: 'convidado' });

  server = await createServerWithChannels(owner.id);
  await addMember(server.id, member.id);

  await loginAs(owner.id);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('criação de convite', () => {
  it('gera código único e URL completa', async () => {
    const invite = await makeInvite();

    expect(invite.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(invite.url).toBe(`http://localhost:3000/invite/${invite.code}`);
    expect(invite.uses).toBe(0);
    expect(invite.active).toBe(true);
  });

  it('gera códigos diferentes a cada chamada', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      codes.add((await makeInvite()).code);
    }
    expect(codes.size).toBe(5);
  });

  it('membro comum não cria convites', async () => {
    await loginAs(member.id);

    const response = await createInviteRoute(
      jsonRequest('http://localhost:3000/api/invites', { expiresInSeconds: null, maxUses: null }),
      serverParams(server.id),
    );

    expect(response.status).toBe(403);
  });

  it('recusa validade fora dos limites', async () => {
    const response = await createInviteRoute(
      jsonRequest('http://localhost:3000/api/invites', { expiresInSeconds: 5, maxUses: null }),
      serverParams(server.id),
    );

    expect(response.status).toBe(422);
  });

  it('lista os convites do servidor para administradores', async () => {
    await makeInvite();
    await makeInvite();

    const body = await readJson<{ invites: InviteDTO[] }>(
      await listInvites(getRequest('http://localhost:3000/api/invites'), serverParams(server.id)),
    );

    expect(body.invites).toHaveLength(2);
  });
});

describe('prévia do convite', () => {
  it('mostra servidor e quem convidou mesmo sem sessão', async () => {
    const invite = await makeInvite();
    cookieJar.clear();

    const body = await readJson<{ invite: InvitePreviewDTO; authenticated: boolean }>(
      await previewRoute(getRequest('http://localhost:3000/api/invites'), codeParams(invite.code)),
    );

    expect(body.authenticated).toBe(false);
    expect(body.invite.server.name).toBe('Amigos');
    expect(body.invite.inviter.username).toBe('dono');
    expect(body.invite.invalidReason).toBeNull();
  });

  it('avisa quando o visitante já é membro', async () => {
    const invite = await makeInvite();
    await loginAs(member.id);

    const body = await readJson<{ invite: InvitePreviewDTO }>(
      await previewRoute(getRequest('http://localhost:3000/api/invites'), codeParams(invite.code)),
    );

    expect(body.invite.alreadyMember).toBe(true);
  });

  it('devolve 404 para código inexistente', async () => {
    const response = await previewRoute(
      getRequest('http://localhost:3000/api/invites'),
      codeParams('NAOEXISTE'),
    );

    expect(response.status).toBe(404);
  });

  it('sinaliza convite expirado sem deixar entrar', async () => {
    const invite = await makeInvite();
    await testPrisma().invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const body = await readJson<{ invite: InvitePreviewDTO }>(
      await previewRoute(getRequest('http://localhost:3000/api/invites'), codeParams(invite.code)),
    );

    expect(body.invite.invalidReason).toBe('EXPIRED');
  });
});

describe('aceitação de convite', () => {
  it('adiciona o usuário ao servidor e incrementa o contador', async () => {
    const invite = await makeInvite();
    await loginAs(outsider.id);

    const response = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );

    const body = await readJson<{ serverId: string; joined: boolean }>(response);

    expect(response.status).toBe(200);
    expect(body.joined).toBe(true);
    expect(body.serverId).toBe(server.id);

    const membership = await testPrisma().serverMember.findUnique({
      where: { serverId_userId: { serverId: server.id, userId: outsider.id } },
    });
    expect(membership?.role).toBe('MEMBER');

    const stored = await testPrisma().invite.findUnique({ where: { id: invite.id } });
    expect(stored?.uses).toBe(1);
  });

  it('aceitar duas vezes não duplica a associação nem os usos', async () => {
    const invite = await makeInvite();
    await loginAs(outsider.id);

    await acceptRoute(jsonRequest('http://localhost:3000/api/invites', undefined), codeParams(invite.code));
    const second = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );

    const body = await readJson<{ joined: boolean }>(second);
    expect(body.joined).toBe(false);

    const stored = await testPrisma().invite.findUnique({ where: { id: invite.id } });
    expect(stored?.uses).toBe(1);
  });

  it('recusa convite expirado', async () => {
    const invite = await makeInvite();
    await testPrisma().invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await loginAs(outsider.id);
    const response = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );

    expect(response.status).toBe(404);
    expect(await testPrisma().serverMember.count({ where: { userId: outsider.id } })).toBe(0);
  });

  it('recusa convite revogado', async () => {
    const invite = await makeInvite();

    await revokeInvite(jsonRequest('http://localhost:3000/api/invites', undefined, { method: 'DELETE' }), {
      params: Promise.resolve({ inviteId: invite.id }),
    });

    await loginAs(outsider.id);
    const response = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );

    expect(response.status).toBe(404);
  });

  it('respeita o limite de usos', async () => {
    const invite = await makeInvite({ maxUses: 1 });

    await loginAs(outsider.id);
    const first = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );
    expect(first.status).toBe(200);

    const segundo = await createUser({ username: 'segundo' });
    await loginAs(segundo.id);
    const second = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );

    expect(second.status).toBe(404);
    expect(await testPrisma().serverMember.count({ where: { userId: segundo.id } })).toBe(0);
  });

  it('exige sessão para aceitar', async () => {
    const invite = await makeInvite();
    cookieJar.clear();

    const response = await acceptRoute(
      jsonRequest('http://localhost:3000/api/invites', undefined),
      codeParams(invite.code),
    );

    expect(response.status).toBe(401);
  });

  it('membro comum não revoga convites', async () => {
    const invite = await makeInvite();
    await loginAs(member.id);

    const response = await revokeInvite(
      jsonRequest('http://localhost:3000/api/invites', undefined, { method: 'DELETE' }),
      { params: Promise.resolve({ inviteId: invite.id }) },
    );

    expect(response.status).toBe(403);
  });
});
