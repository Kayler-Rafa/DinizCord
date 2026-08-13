import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from 'pg';
import { adminDatabaseUrl, testDatabaseUrl, TEST_DATABASE_NAME } from './helpers/db';

/**
 * Prepara o banco de testes uma única vez por execução:
 *  1. cria `dinizcord_test` se não existir;
 *  2. aplica as migrations versionadas (as mesmas de produção).
 *
 * Usar `migrate deploy` — e não `db push` — garante que os testes exercitam
 * exatamente o schema que vai para produção, incluindo o trigger de NOTIFY.
 */
export async function setup() {
  const admin = new Client({ connectionString: adminDatabaseUrl() });

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      'Não foi possível conectar ao PostgreSQL para preparar o banco de testes.\n' +
        'Suba o banco com "docker compose up -d" ou "npm run db:embedded" e tente de novo.\n' +
        `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE_NAME,
    ]);

    if (existing.rowCount === 0) {
      // O nome é uma constante do próprio código, não entrada de usuário.
      await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.end();
  }

  // Chama o CLI do Prisma pelo próprio executável do Node, em vez de `npx`.
  // No Windows, `npx` é um .cmd e só roda através de um shell — e usar shell
  // traria de volta a concatenação insegura de argumentos (DEP0190).
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
