import { createPrismaClient, type PrismaClient } from '@/lib/db/factory';

/**
 * Banco de testes.
 *
 * Os testes rodam contra um PostgreSQL de verdade (mesmo servidor do
 * desenvolvimento, banco separado). Nada de mock de banco: metade dos bugs que
 * importam aqui — constraints, transações, ordenação, cascade — só aparecem no
 * motor real.
 */
const TEST_DATABASE_NAME = 'dinizcord_test';

/** Deriva a URL do banco de testes a partir do DATABASE_URL de desenvolvimento. */
export function testDatabaseUrl(base = process.env.DATABASE_URL): string {
  if (!base) {
    throw new Error(
      'DATABASE_URL não definida. Suba o PostgreSQL (docker compose up -d ou npm run db:embedded) e configure o .env antes de rodar os testes.',
    );
  }

  const url = new URL(base);
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

/** URL do banco administrativo, usada para criar/derrubar o banco de testes. */
export function adminDatabaseUrl(base = process.env.DATABASE_URL): string {
  const url = new URL(base ?? testDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

export { TEST_DATABASE_NAME };

let client: PrismaClient | null = null;

/** Cliente Prisma compartilhado pelos testes, apontando para o banco de testes. */
export function testPrisma(): PrismaClient {
  client ??= createPrismaClient({ connectionString: testDatabaseUrl(), maxConnections: 5 });
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/**
 * Tabelas na ordem em que podem ser esvaziadas.
 *
 * `TRUNCATE ... CASCADE` em uma chamada só é mais rápido e dispensa se
 * preocupar com a ordem das foreign keys.
 */
const TABLES = [
  'RealtimeEvent',
  'VoiceSession',
  'PresenceSession',
  'ChannelReadState',
  'MessageReaction',
  'Message',
  'Channel',
  'Invite',
  'ServerMember',
  'Server',
  'LoginAttempt',
  'UserSession',
  'User',
];

/** Zera o banco entre testes, preservando o schema e as sequences reiniciadas. */
export async function resetDatabase(): Promise<void> {
  const prisma = testPrisma();
  const list = TABLES.map((table) => `"public"."${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
