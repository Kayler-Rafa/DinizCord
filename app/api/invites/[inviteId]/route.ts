import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { requireMembership, requireRole, requireSession } from '@/lib/api/guards';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('invites');

export const runtime = 'nodejs';

type Params = { params: Promise<{ inviteId: string }> };

/** Revoga um convite. O registro fica no banco para efeito de auditoria. */
export async function DELETE(request: Request, { params }: Params) {
  return apiHandler('invites.revoke', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { inviteId } = await params;

    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
      select: { id: true, serverId: true, revokedAt: true },
    });

    if (!invite) {
      throw ApiError.notFound('Este convite não existe.');
    }

    const membership = await requireMembership(session.user.id, invite.serverId);
    requireRole(membership.role, 'ADMIN', 'revogar convites');

    if (!invite.revokedAt) {
      await prisma.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
      log.info(
        { inviteId, serverId: invite.serverId, actorId: session.user.id, event: 'invite.revoked' },
        'Convite revogado',
      );
    }

    return json({ ok: true });
  });
}
