import 'server-only';

import { prisma } from '@/lib/db/client';
import { hashIp } from './crypto';
import { ApiError } from '@/lib/api/errors';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('auth');

/**
 * Proteção contra força bruta, persistida no PostgreSQL.
 *
 * Por que no banco e não em memória: um contador em RAM zera a cada deploy e não
 * enxerga as outras instâncias — exatamente as duas condições em que um ataque
 * de força bruta passaria batido. O volume de escrita é irrelevante (uma linha
 * por tentativa de login) e a limpeza é feita por `pruneLoginAttempts`.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Falhas por identificador (e-mail/usuário) antes do bloqueio temporário. */
const MAX_FAILURES_PER_IDENTIFIER = 8;
/** Falhas por IP — pega quem varre várias contas a partir do mesmo lugar. */
const MAX_FAILURES_PER_IP = 25;

export async function assertLoginAllowed(identifier: string, ip: string | null): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS);
  const normalized = identifier.toLowerCase();
  const ipDigest = hashIp(ip);

  const [byIdentifier, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { identifier: normalized, successful: false, createdAt: { gte: since } },
    }),
    ipDigest
      ? prisma.loginAttempt.count({
          where: { ipHash: ipDigest, successful: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  if (byIdentifier >= MAX_FAILURES_PER_IDENTIFIER || byIp >= MAX_FAILURES_PER_IP) {
    log.warn(
      { event: 'auth.login_blocked', byIdentifier, byIp },
      'Login bloqueado temporariamente por excesso de falhas',
    );
    throw new ApiError(
      'RATE_LIMITED',
      'Muitas tentativas de login. Aguarde alguns minutos antes de tentar de novo.',
      { retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) },
    );
  }
}

export async function recordLoginAttempt(params: {
  identifier: string;
  successful: boolean;
  userId?: string | null;
  ip: string | null;
}): Promise<void> {
  await prisma.loginAttempt
    .create({
      data: {
        identifier: params.identifier.toLowerCase().slice(0, 254),
        successful: params.successful,
        userId: params.userId ?? null,
        ipHash: hashIp(params.ip),
      },
    })
    .catch((error: unknown) => {
      // Não impedir o login por falha de auditoria, mas registrar o problema.
      log.error({ err: error, event: 'auth.attempt_log_failed' }, 'Falha ao registrar tentativa de login');
    });
}

/** Após um login bem-sucedido, zera o contador daquele identificador. */
export async function clearFailedAttempts(identifier: string): Promise<void> {
  await prisma.loginAttempt
    .deleteMany({ where: { identifier: identifier.toLowerCase(), successful: false } })
    .catch(() => undefined);
}

/** Descarta registros antigos — chamado pela rotina de manutenção. */
export async function pruneLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
