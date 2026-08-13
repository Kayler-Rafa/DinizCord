import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin, clientIpOf, rateLimitIdentity } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { loginSchema } from '@/lib/validation/schemas';
import { equalizeLoginTiming, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import {
  assertLoginAllowed,
  clearFailedAttempts,
  recordLoginAttempt,
} from '@/lib/auth/login-attempts';
import { scopedLogger } from '@/lib/logger';
import type { SelectableStatus, SessionUser } from '@/lib/types';

const log = scopedLogger('auth');

export const runtime = 'nodejs';

/** Mensagem única para credencial errada — não revela se a conta existe. */
const INVALID_CREDENTIALS = 'E-mail/usuário ou senha incorretos.';

export async function POST(request: Request) {
  return apiHandler('auth.login', async () => {
    assertSameOrigin(request);
    enforceRateLimit(RATE_LIMITS.login, rateLimitIdentity(request));

    const body = await parseJsonBody(request, loginSchema);
    const ip = clientIpOf(request);
    const identifier = body.identifier.toLowerCase();

    await assertLoginAllowed(identifier, ip);

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarColor: true,
        passwordHash: true,
        preferredStatus: true,
        activity: true,
      },
    });

    if (!user) {
      // Gasta o mesmo tempo de um argon2 real para não vazar, pelo relógio,
      // quais contas existem.
      await equalizeLoginTiming(body.password);
      await recordLoginAttempt({ identifier, successful: false, ip });
      throw new ApiError('UNAUTHORIZED', INVALID_CREDENTIALS);
    }

    const passwordOk = await verifyPassword(user.passwordHash, body.password);

    if (!passwordOk) {
      await recordLoginAttempt({ identifier, successful: false, userId: user.id, ip });
      log.warn({ userId: user.id, event: 'auth.login_failed' }, 'Senha incorreta');
      throw new ApiError('UNAUTHORIZED', INVALID_CREDENTIALS);
    }

    await Promise.all([
      recordLoginAttempt({ identifier, successful: true, userId: user.id, ip }),
      clearFailedAttempts(identifier),
    ]);

    await createSession(user.id, { userAgent: request.headers.get('user-agent'), ip });

    log.info({ userId: user.id, event: 'auth.login' }, 'Login efetuado');

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      preferredStatus: (user.preferredStatus === 'OFFLINE'
        ? 'ONLINE'
        : user.preferredStatus) as SelectableStatus,
      activity: user.activity,
    };

    return json({ user: sessionUser });
  });
}
