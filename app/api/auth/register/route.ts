import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin, clientIpOf, rateLimitIdentity } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { registerSchema } from '@/lib/validation/schemas';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { consumeInvite, findUsableInvite } from '@/lib/servers/invites';
import { serverEnv } from '@/lib/env.server';
import { avatarColorFor } from '@/lib/utils';
import { scopedLogger } from '@/lib/logger';
import type { SessionUser } from '@/lib/types';

const log = scopedLogger('auth');

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return apiHandler('auth.register', async () => {
    assertSameOrigin(request);
    enforceRateLimit(RATE_LIMITS.register, rateLimitIdentity(request));

    const body = await parseJsonBody(request, registerSchema);
    const env = serverEnv();

    // Quando o cadastro é fechado, o convite é a única porta de entrada — e ele
    // precisa ser validado ANTES de criar qualquer registro.
    let invite: Awaited<ReturnType<typeof findUsableInvite>> = null;
    if (env.REGISTRATION_INVITE_ONLY) {
      if (!body.inviteCode) {
        throw ApiError.forbidden(
          'O cadastro está restrito a convites. Peça um link de convite a alguém do servidor.',
        );
      }
      invite = await findUsableInvite(body.inviteCode);
      if (!invite) {
        throw ApiError.validation({ inviteCode: 'Convite inválido, expirado ou já esgotado.' });
      }
    } else if (body.inviteCode) {
      invite = await findUsableInvite(body.inviteCode);
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { username: body.username }] },
      select: { email: true, username: true },
    });

    if (existing) {
      throw ApiError.validation(
        existing.email === body.email
          ? { email: 'Este e-mail já está cadastrado.' }
          : { username: 'Este nome de usuário já está em uso.' },
      );
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        username: body.username,
        displayName: body.displayName,
        passwordHash,
        avatarColor: avatarColorFor(body.username),
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarColor: true,
        activity: true,
      },
    });

    if (invite) {
      await consumeInvite(invite, user.id);
    }

    await createSession(user.id, {
      userAgent: request.headers.get('user-agent'),
      ip: clientIpOf(request),
    });

    log.info({ userId: user.id, event: 'auth.registered' }, 'Novo usuário cadastrado');

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      preferredStatus: 'ONLINE',
      activity: user.activity,
    };

    return json({ user: sessionUser, joinedServerId: invite?.serverId ?? null }, 201);
  });
}
