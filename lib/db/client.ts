import 'server-only';

import { createPrismaClient, type PrismaClient } from './factory';
import { serverEnv } from '@/lib/env.server';

/**
 * Instância única do PrismaClient usada pela aplicação Next.
 *
 * Em desenvolvimento o Next recarrega os módulos a cada alteração; sem o cache
 * no `globalThis` cada reload abriria um novo pool e esgotaria as conexões do
 * PostgreSQL.
 */
const globalForPrisma = globalThis as unknown as {
  dinizcordPrisma?: PrismaClient;
};

function build(): PrismaClient {
  const env = serverEnv();
  return createPrismaClient({
    connectionString: env.DATABASE_URL,
    // Pool enxuto: ambientes serverless multiplicam instâncias, então segurar
    // muitas conexões por processo é contraproducente.
    maxConnections: env.NODE_ENV === 'production' ? 10 : 5,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.dinizcordPrisma ?? build();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.dinizcordPrisma = prisma;
}
