import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

/**
 * Fábrica do PrismaClient.
 *
 * Vive fora de `client.ts` (que é marcado com `server-only`) porque três
 * processos diferentes precisam dela: a aplicação Next, o gateway WebSocket e os
 * scripts de linha de comando (seed, manutenção). Apenas o Next quer o singleton
 * em `globalThis`; os outros criam e fecham o próprio cliente.
 */
export interface PrismaFactoryOptions {
  connectionString?: string;
  /** Tamanho máximo do pool. Poucas conexões por processo, muitos processos. */
  maxConnections?: number;
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}

export function createPrismaClient(options: PrismaFactoryOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL não está definida. Copie .env.example para .env e preencha a connection string do PostgreSQL.',
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    max: options.maxConnections ?? 5,
  });

  return new PrismaClient({
    adapter,
    log: options.log ?? ['error'],
  });
}

export type { PrismaClient };
