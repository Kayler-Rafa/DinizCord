/**
 * PostgreSQL embutido para desenvolvimento/testes em máquinas sem Docker.
 *
 * O caminho recomendado continua sendo `docker compose up -d` (ver README).
 * Este script existe apenas como alternativa: ele baixa e roda um binário real
 * do PostgreSQL em `.pgdata/`, portanto o comportamento é idêntico ao de
 * produção (nada de SQLite).
 *
 * Uso:
 *   npm run db:embedded          # inicia e mantém rodando (Ctrl+C encerra)
 *   npm run db:embedded -- stop  # encerra uma instância deixada para trás
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATA_DIR = path.resolve(process.cwd(), '.pgdata');
const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const USER = 'dinizcord';
const PASSWORD = 'dinizcord';
const DATABASE = 'dinizcord';

export function embeddedConnectionString(database = DATABASE): string {
  return `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${database}?schema=public`;
}

export function createEmbeddedPostgres(): EmbeddedPostgres {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // UTF8 é obrigatório: reações e nomes de canais guardam emojis, que não
    // cabem no encoding padrão herdado do locale do Windows (WIN1252).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (message) => process.stderr.write(String(message)),
  });
}

/** Inicia o servidor, criando o cluster e o banco na primeira execução. */
export async function startEmbeddedPostgres(): Promise<EmbeddedPostgres> {
  const pg = createEmbeddedPostgres();
  const alreadyInitialised = existsSync(path.join(DATA_DIR, 'PG_VERSION'));

  if (!alreadyInitialised) {
    console.log('Inicializando cluster PostgreSQL em .pgdata (só na primeira vez)...');
    await pg.initialise();
  }

  await pg.start();

  if (!alreadyInitialised) {
    await pg.createDatabase(DATABASE);
  }

  return pg;
}

async function main() {
  if (process.argv.includes('stop')) {
    const pg = createEmbeddedPostgres();
    await pg.stop();
    console.log('PostgreSQL embutido encerrado.');
    return;
  }

  const pg = await startEmbeddedPostgres();
  console.log(`PostgreSQL embutido rodando em localhost:${PORT}`);
  console.log(`DATABASE_URL="${embeddedConnectionString()}"`);
  console.log('Ctrl+C para encerrar.');

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await pg.stop().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Mantém o processo vivo enquanto o servidor estiver de pé.
  await new Promise(() => {});
}

// Só roda o CLI quando o arquivo é o entrypoint (os testes importam as funções).
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).endsWith(path.join('scripts', 'embedded-postgres.ts'));

if (invokedDirectly) {
  main().catch((error) => {
    console.error('Falha ao iniciar o PostgreSQL embutido:', error);
    process.exit(1);
  });
}
