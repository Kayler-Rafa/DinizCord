import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { cookieJar, jsonRequest, readJson } from './helpers/next';
import { disconnectTestPrisma, resetDatabase, testPrisma } from './helpers/db';

vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: logout } = await import('@/app/api/auth/logout/route');
const { GET: me } = await import('@/app/api/auth/me/route');
const { SESSION_COOKIE, getSession } = await import('@/lib/auth/session');
const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
const { resetRateLimits } = await import('@/lib/api/rate-limit');

const VALID_USER = {
  email: 'rafael@example.com',
  username: 'rafael',
  displayName: 'Rafael',
  password: 'senhaforte123',
};

beforeEach(async () => {
  await resetDatabase();
  cookieJar.clear();
  resetRateLimits();
});

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('hash de senha', () => {
  it('gera hashes diferentes para a mesma senha e valida ambos', async () => {
    const first = await hashPassword('senhaforte123');
    const second = await hashPassword('senhaforte123');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(first, 'senhaforte123')).toBe(true);
    expect(await verifyPassword(second, 'senhaforte123')).toBe(true);
  });

  it('recusa a senha errada', async () => {
    const digest = await hashPassword('senhaforte123');
    expect(await verifyPassword(digest, 'senhaforte124')).toBe(false);
  });

  it('devolve false para hash corrompido em vez de lançar', async () => {
    expect(await verifyPassword('não-é-um-hash', 'qualquer')).toBe(false);
  });
});

describe('cadastro', () => {
  it('cria o usuário, grava a sessão e nunca devolve o hash da senha', async () => {
    const response = await register(jsonRequest('http://localhost:3000/api/auth/register', VALID_USER));
    expect(response.status).toBe(201);

    const body = await readJson<{ user: { id: string; email: string } }>(response);
    expect(body.user.email).toBe(VALID_USER.email);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain(VALID_USER.password);

    expect(cookieJar.get(SESSION_COOKIE)).toBeDefined();

    const stored = await testPrisma().user.findUnique({ where: { email: VALID_USER.email } });
    expect(stored?.passwordHash).not.toBe(VALID_USER.password);
  });

  it('rejeita senha fraca com erro por campo', async () => {
    const response = await register(
      jsonRequest('http://localhost:3000/api/auth/register', { ...VALID_USER, password: 'curta1' }),
    );

    expect(response.status).toBe(422);
    const body = await readJson<{ error: { fields: Record<string, string> } }>(response);
    expect(body.error.fields.password).toBeDefined();
  });

  it('rejeita nome de usuário com caracteres inválidos', async () => {
    const response = await register(
      jsonRequest('http://localhost:3000/api/auth/register', { ...VALID_USER, username: 'Rafael Diniz' }),
    );

    expect(response.status).toBe(422);
  });

  it('rejeita e-mail duplicado', async () => {
    await register(jsonRequest('http://localhost:3000/api/auth/register', VALID_USER));
    cookieJar.clear();

    const response = await register(
      jsonRequest('http://localhost:3000/api/auth/register', { ...VALID_USER, username: 'outro' }),
    );

    expect(response.status).toBe(422);
    const body = await readJson<{ error: { fields: Record<string, string> } }>(response);
    expect(body.error.fields.email).toContain('já está cadastrado');
  });

  it('rejeita nome de usuário duplicado', async () => {
    await register(jsonRequest('http://localhost:3000/api/auth/register', VALID_USER));
    cookieJar.clear();

    const response = await register(
      jsonRequest('http://localhost:3000/api/auth/register', {
        ...VALID_USER,
        email: 'outro@example.com',
      }),
    );

    expect(response.status).toBe(422);
    const body = await readJson<{ error: { fields: Record<string, string> } }>(response);
    expect(body.error.fields.username).toBeDefined();
  });

  it('recusa requisição de outra origem (CSRF)', async () => {
    const response = await register(
      jsonRequest('http://localhost:3000/api/auth/register', VALID_USER, {
        origin: 'https://site-malicioso.example',
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await register(jsonRequest('http://localhost:3000/api/auth/register', VALID_USER));
    cookieJar.clear();
  });

  it('aceita e-mail e senha corretos', async () => {
    const response = await login(
      jsonRequest('http://localhost:3000/api/auth/login', {
        identifier: VALID_USER.email,
        password: VALID_USER.password,
      }),
    );

    expect(response.status).toBe(200);
    expect(cookieJar.get(SESSION_COOKIE)).toBeDefined();
  });

  it('aceita nome de usuário no lugar do e-mail', async () => {
    const response = await login(
      jsonRequest('http://localhost:3000/api/auth/login', {
        identifier: VALID_USER.username,
        password: VALID_USER.password,
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejeita senha incorreta sem revelar se a conta existe', async () => {
    const wrongPassword = await login(
      jsonRequest('http://localhost:3000/api/auth/login', {
        identifier: VALID_USER.email,
        password: 'senhaerrada123',
      }),
    );
    const unknownAccount = await login(
      jsonRequest('http://localhost:3000/api/auth/login', {
        identifier: 'ninguem@example.com',
        password: 'senhaerrada123',
      }),
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);

    const a = await readJson<{ error: { message: string } }>(wrongPassword);
    const b = await readJson<{ error: { message: string } }>(unknownAccount);
    expect(a.error.message).toBe(b.error.message);

    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('bloqueia após falhas repetidas no mesmo identificador', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await login(
        jsonRequest('http://localhost:3000/api/auth/login', {
          identifier: VALID_USER.email,
          password: 'senhaerrada123',
        }),
      );
    }

    const blocked = await login(
      jsonRequest('http://localhost:3000/api/auth/login', {
        identifier: VALID_USER.email,
        password: VALID_USER.password,
      }),
    );

    expect(blocked.status).toBe(429);
    // Mesmo com a senha certa, o bloqueio vale: é isso que impede força bruta.
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe('sessão', () => {
  beforeEach(async () => {
    await register(jsonRequest('http://localhost:3000/api/auth/register', VALID_USER));
  });

  it('resolve o usuário a partir do cookie', async () => {
    const session = await getSession();
    expect(session?.user.username).toBe(VALID_USER.username);
  });

  it('guarda no banco apenas o hash do token, nunca o token', async () => {
    const token = cookieJar.get(SESSION_COOKIE)!.value;
    const sessions = await testPrisma().userSession.findMany();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
    expect(sessions[0]!.tokenHash).toHaveLength(64);
  });

  it('invalida a sessão no logout', async () => {
    await logout(jsonRequest('http://localhost:3000/api/auth/logout', undefined));

    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();

    const stored = await testPrisma().userSession.findFirst();
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('recusa um token de sessão revogado mesmo que o cookie volte', async () => {
    const token = cookieJar.get(SESSION_COOKIE)!.value;
    await logout(jsonRequest('http://localhost:3000/api/auth/logout', undefined));

    cookieJar.set(SESSION_COOKIE, token);
    expect(await getSession()).toBeNull();
  });

  it('recusa sessão expirada', async () => {
    await testPrisma().userSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await getSession()).toBeNull();
  });

  it('/api/auth/me devolve null sem cookie', async () => {
    cookieJar.clear();
    const body = await readJson<{ user: unknown }>(await me());
    expect(body.user).toBeNull();
  });
});
