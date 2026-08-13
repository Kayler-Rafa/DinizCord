import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireMembership, requireRole, requireSession } from '@/lib/api/guards';
import { updateMemberSchema } from '@/lib/validation/schemas';
import { removeMember, updateMemberRole } from '@/lib/servers/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ serverId: string; userId: string }> };

/** Alterar papel de um membro — exclusivo do dono. */
export async function PATCH(request: Request, { params }: Params) {
  return apiHandler('members.update', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { serverId, userId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const membership = await requireMembership(session.user.id, serverId);
    requireRole(membership.role, 'OWNER', 'alterar papéis');

    const body = await parseJsonBody(request, updateMemberSchema);

    if (!body.role) {
      throw ApiError.badRequest('Informe o novo papel do membro.');
    }

    const member = await updateMemberRole({ serverId, targetUserId: userId, role: body.role });
    return json({ member });
  });
}

/** Remover membro, ou sair do servidor quando o alvo é o próprio usuário. */
export async function DELETE(request: Request, { params }: Params) {
  return apiHandler('members.remove', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { serverId, userId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const membership = await requireMembership(session.user.id, serverId);

    await removeMember({
      serverId,
      targetUserId: userId,
      actorUserId: session.user.id,
      actorRole: membership.role,
    });

    return json({ ok: true });
  });
}
