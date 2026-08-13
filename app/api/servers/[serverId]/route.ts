import { apiHandler, json } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireMembership, requireRole, requireSession } from '@/lib/api/guards';
import { updateServerSchema } from '@/lib/validation/schemas';
import { updateServer } from '@/lib/servers/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ serverId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return apiHandler('servers.update', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { serverId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const membership = await requireMembership(session.user.id, serverId);
    requireRole(membership.role, 'ADMIN', 'alterar o servidor');

    const body = await parseJsonBody(request, updateServerSchema);
    const server = await updateServer(serverId, body);

    return json({ server });
  });
}
