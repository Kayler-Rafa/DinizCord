import { prisma } from '@/lib/db/client';
import { avatarUrlFor } from '@/lib/db/mappers';
import { apiHandler, json } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireSession } from '@/lib/api/guards';
import { updateProfileSchema } from '@/lib/validation/schemas';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import type { SelectableStatus, SessionUser } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Atualiza o perfil (nome exibido, status preferido, atividade).
 *
 * O status escolhido é persistido para que a próxima conexão já entre com ele —
 * o estado ao vivo fica em `PresenceSession`, mas a preferência é do usuário.
 */
export async function PATCH(request: Request) {
  return apiHandler('me.update', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const body = await parseJsonBody(request, updateProfileSchema);

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.activity !== undefined ? { activity: body.activity || null } : {}),
        ...(body.preferredStatus !== undefined ? { preferredStatus: body.preferredStatus } : {}),
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarColor: true,
        avatarUpdatedAt: true,
        preferredStatus: true,
        activity: true,
      },
    });

    // Reflete o novo status/atividade nas conexões abertas deste usuário.
    if (body.preferredStatus !== undefined || body.activity !== undefined) {
      await prisma.presenceSession.updateMany({
        where: { userId: user.id },
        data: {
          ...(body.preferredStatus !== undefined ? { status: body.preferredStatus } : {}),
          ...(body.activity !== undefined ? { activity: body.activity || null } : {}),
        },
      });

      const servers = await prisma.serverMember.findMany({
        where: { userId: user.id },
        select: { serverId: true },
      });

      await Promise.all(
        servers.map((membership) =>
          publishEvent(Topic.server(membership.serverId), {
            t: 'presence:update',
            presence: {
              userId: user.id,
              status: user.preferredStatus,
              activity: user.activity,
            },
          }),
        ),
      );
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      avatarUrl: avatarUrlFor(user),
      preferredStatus: (user.preferredStatus === 'OFFLINE'
        ? 'ONLINE'
        : user.preferredStatus) as SelectableStatus,
      activity: user.activity,
    };

    return json({ user: sessionUser });
  });
}
