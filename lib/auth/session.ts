import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';
import { prisma } from '@/lib/db/client';
import { generateSessionToken, hashIp, hashSessionToken } from './crypto';
import { scopedLogger } from '@/lib/logger';
import type { SelectableStatus, SessionUser } from '@/lib/types';

const log = scopedLogger('auth');

export const SESSION_COOKIE = 'dinizcord_session';

/** Duração da sessão. 30 dias equilibra conveniência e janela de exposição. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A partir daqui, o `expiresAt` é renovado no uso (sliding expiration). */
const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthenticatedSession {
  sessionId: string;
  user: SessionUser;
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    // `lax` deixa o convite por link funcionar (navegação top-level) e ainda
    // bloqueia o cookie em requisições cross-site de terceiros — a primeira
    // linha de defesa contra CSRF.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  };
}

/** Cria a sessão no banco e grava o cookie. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
      ipHash: hashIp(meta.ip),
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(expiresAt));

  log.info({ userId, event: 'session.created' }, 'Sessão criada');
  return { token, expiresAt };
}

/**
 * Lê a sessão atual a partir do cookie.
 *
 * Envolto em `cache()` do React: várias chamadas dentro do mesmo request (layout,
 * page e route handler) resultam em uma única consulta ao banco.
 */
export const getSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarColor: true,
          preferredStatus: true,
          activity: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  // Sliding expiration: só escreve quando falta pouco, para não gerar um UPDATE
  // a cada requisição.
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining < SESSION_REFRESH_THRESHOLD_MS) {
    const newExpiry = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.userSession
      .update({
        where: { id: session.id },
        data: { expiresAt: newExpiry, lastUsedAt: new Date() },
      })
      .catch((error: unknown) => {
        log.warn({ err: error, event: 'session.refresh_failed' }, 'Falha ao renovar sessão');
      });
  }

  const { user } = session;

  return {
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      // OFFLINE nunca é um status escolhido; se estiver no banco, trate como ONLINE.
      preferredStatus: (user.preferredStatus === 'OFFLINE'
        ? 'ONLINE'
        : user.preferredStatus) as SelectableStatus,
      activity: user.activity,
    },
  };
});

/** Encerra a sessão atual e apaga o cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.userSession
      .updateMany({
        where: { tokenHash: hashSessionToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch((error: unknown) => {
        log.warn({ err: error, event: 'session.revoke_failed' }, 'Falha ao revogar sessão');
      });
  }

  jar.delete(SESSION_COOKIE);
}

/** Revoga todas as sessões de um usuário (troca de senha, "sair de tudo"). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  log.info({ userId, count, event: 'session.revoked_all' }, 'Sessões revogadas');
  return count;
}

/** Remove sessões expiradas/revogadas há mais de 30 dias. */
export async function pruneExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const { count } = await prisma.userSession.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return count;
}
