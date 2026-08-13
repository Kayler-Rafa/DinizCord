import { createPrismaClient, type PrismaClient } from '../lib/db/factory';

/**
 * Cliente Prisma do gateway.
 *
 * Processo separado da aplicação Next, portanto pool próprio. O gateway faz
 * consultas curtas e frequentes (heartbeat, presença, checagem de acesso a
 * canal), então um punhado de conexões basta.
 */
let client: PrismaClient | null = null;

export function db(): PrismaClient {
  client ??= createPrismaClient({ maxConnections: 8 });
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
