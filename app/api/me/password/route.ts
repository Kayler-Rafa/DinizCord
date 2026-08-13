import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin, clientIpOf } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireSession } from '@/lib/api/guards';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, revokeAllSessions } from '@/lib/auth/session';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('auth');

export const runtime = 'nodejs';

/**
 * Troca de senha.
 *
 * Depois de trocar, TODAS as sessões são revogadas — inclusive as de outros
 * dispositivos — e uma nova é criada para quem fez a troca. É esse o
 * comportamento esperado de quem troca a senha justamente por suspeitar de
 * acesso indevido.
 */
export async function POST(request: Request) {
  return apiHandler('me.password', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    enforceRateLimit(RATE_LIMITS.login, `user:${session.user.id}`);

    const body = await parseJsonBody(request, changePasswordSchema);

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });

    if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw ApiError.validation({ currentPassword: 'Senha atual incorreta.' });
    }

    if (await verifyPassword(user.passwordHash, body.newPassword)) {
      throw ApiError.validation({ newPassword: 'A nova senha precisa ser diferente da atual.' });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });

    await revokeAllSessions(session.user.id);

    await publishEvent(Topic.user(session.user.id), {
      t: 'session:revoked',
      reason: 'A senha foi alterada. Entre novamente.',
    });

    await createSession(session.user.id, {
      userAgent: request.headers.get('user-agent'),
      ip: clientIpOf(request),
    });

    log.info({ userId: session.user.id, event: 'auth.password_changed' }, 'Senha alterada');

    return json({ ok: true });
  });
}
