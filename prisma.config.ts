import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Configuração da CLI do Prisma (migrate / studio / seed).
 *
 * A partir do Prisma 7 a connection string não fica mais no schema: a CLI a lê
 * daqui, e o runtime usa o driver adapter criado em `lib/db/factory.ts`.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
