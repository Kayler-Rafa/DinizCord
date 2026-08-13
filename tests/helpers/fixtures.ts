import { hash } from '@node-rs/argon2';
import { testPrisma } from './db';
import { generateSessionToken, hashSessionToken } from '@/lib/auth/crypto';
import { issueGatewayTicket } from '@/lib/auth/ticket';
import { avatarColorFor } from '@/lib/utils';

/**
 * Fixtures de domínio.
 *
 * Criadas direto pelo Prisma (e não pelas rotas HTTP) porque o objetivo é
 * montar o cenário rápido; o que está sob teste é o comportamento depois do
 * cenário pronto.
 */

let counter = 0;

/** Hash barato: os testes criam dezenas de usuários e não exercitam o Argon2 real aqui. */
const FAST_ARGON2 = { memoryCost: 1 << 12, timeCost: 1, parallelism: 1 } as const;

export interface TestUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  password: string;
}

export async function createUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
  counter += 1;
  const username = overrides.username ?? `usuario${counter}`;
  const password = overrides.password ?? 'senhaforte123';

  const user = await testPrisma().user.create({
    data: {
      email: overrides.email ?? `${username}@example.com`,
      username,
      displayName: overrides.displayName ?? `Usuário ${counter}`,
      passwordHash: await hash(password, FAST_ARGON2),
      avatarColor: avatarColorFor(username),
    },
    select: { id: true, username: true, email: true, displayName: true },
  });

  return { ...user, password };
}

export async function createSessionFor(userId: string): Promise<{ sessionId: string; token: string }> {
  const token = generateSessionToken();

  const session = await testPrisma().userSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });

  return { sessionId: session.id, token };
}

/** Sessão + ticket prontos para abrir um WebSocket. */
export async function createTicketFor(userId: string): Promise<{ ticket: string; sessionId: string }> {
  const { sessionId } = await createSessionFor(userId);
  const ticket = await issueGatewayTicket({ userId, sessionId });
  return { ticket, sessionId };
}

export interface TestServerFixture {
  id: string;
  textChannelId: string;
  voiceChannelId: string;
  secondVoiceChannelId: string;
}

export async function createServerWithChannels(
  ownerId: string,
  name = 'Amigos',
): Promise<TestServerFixture> {
  counter += 1;

  const server = await testPrisma().server.create({
    data: {
      name,
      slug: `${name.toLowerCase()}-${counter}`,
      ownerId,
      members: { create: { userId: ownerId, role: 'OWNER' } },
      channels: {
        create: [
          { name: 'geral', type: 'TEXT', position: 0 },
          { name: 'memes', type: 'TEXT', position: 1 },
          { name: 'Geral', type: 'VOICE', position: 0 },
          { name: 'Jogos', type: 'VOICE', position: 1 },
        ],
      },
    },
    select: { id: true, channels: { select: { id: true, name: true, type: true } } },
  });

  const text = server.channels.find((channel) => channel.type === 'TEXT' && channel.name === 'geral')!;
  const voice = server.channels.filter((channel) => channel.type === 'VOICE');

  return {
    id: server.id,
    textChannelId: text.id,
    voiceChannelId: voice[0]!.id,
    secondVoiceChannelId: voice[1]!.id,
  };
}

export async function addMember(
  serverId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER' = 'MEMBER',
): Promise<void> {
  await testPrisma().serverMember.create({ data: { serverId, userId, role } });
}
