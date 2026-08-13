import { apiHandler, json } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireMembership, requireRole, requireSession } from '@/lib/api/guards';
import { createChannelSchema } from '@/lib/validation/schemas';
import { createChannel } from '@/lib/servers/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ serverId: string }> };

export async function POST(request: Request, { params }: Params) {
  return apiHandler('channels.create', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { serverId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const membership = await requireMembership(session.user.id, serverId);
    requireRole(membership.role, 'ADMIN', 'criar canais');

    const body = await parseJsonBody(request, createChannelSchema);

    const channel = await createChannel({
      serverId,
      name: body.name,
      type: body.type,
      topic: body.topic ?? null,
    });

    return json({ channel }, 201);
  });
}
