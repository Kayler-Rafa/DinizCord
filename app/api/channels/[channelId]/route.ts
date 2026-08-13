import { apiHandler, json } from '@/lib/api/handler';
import { parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireChannelAccess, requireRole, requireSession } from '@/lib/api/guards';
import { updateChannelSchema } from '@/lib/validation/schemas';
import { deleteChannel, updateChannel } from '@/lib/servers/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ channelId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return apiHandler('channels.update', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { channelId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const context = await requireChannelAccess(session.user.id, channelId);
    requireRole(context.role, 'ADMIN', 'alterar canais');

    const body = await parseJsonBody(request, updateChannelSchema);

    const channel = await updateChannel(channelId, context.serverId, context.channel.type, body);
    return json({ channel });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return apiHandler('channels.delete', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { channelId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const context = await requireChannelAccess(session.user.id, channelId);
    requireRole(context.role, 'ADMIN', 'excluir canais');

    await deleteChannel(channelId, context.serverId);
    return json({ ok: true });
  });
}
