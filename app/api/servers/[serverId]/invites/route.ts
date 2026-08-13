import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireMembership, requireRole, requireSession } from '@/lib/api/guards';
import { createInviteSchema } from '@/lib/validation/schemas';
import { createInvite, toInviteDTO } from '@/lib/servers/invites';
import { PUBLIC_USER_SELECT } from '@/lib/db/mappers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ serverId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return apiHandler('invites.list', async () => {
    const session = await requireSession();
    const { serverId } = await params;

    const membership = await requireMembership(session.user.id, serverId);
    requireRole(membership.role, 'ADMIN', 'ver os convites');

    const invites = await prisma.invite.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        code: true,
        createdAt: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
        revokedAt: true,
        creator: { select: PUBLIC_USER_SELECT },
      },
    });

    return json({ invites: invites.map(toInviteDTO) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return apiHandler('invites.create', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { serverId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const membership = await requireMembership(session.user.id, serverId);
    requireRole(membership.role, 'ADMIN', 'criar convites');

    const body = await parseJsonBody(request, createInviteSchema);

    const invite = await createInvite({
      serverId,
      creatorId: session.user.id,
      expiresInSeconds: body.expiresInSeconds,
      maxUses: body.maxUses,
    });

    return json({ invite }, 201);
  });
}
