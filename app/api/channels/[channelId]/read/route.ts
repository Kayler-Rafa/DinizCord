import { apiHandler, json } from '@/lib/api/handler';
import { assertSameOrigin } from '@/lib/api/request';
import { requireChannelAccess, requireSession } from '@/lib/api/guards';
import { markChannelRead } from '@/lib/messages/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ channelId: string }> };

/** Marca o canal como lido até o instante atual. */
export async function POST(request: Request, { params }: Params) {
  return apiHandler('channels.read', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { channelId } = await params;

    await requireChannelAccess(session.user.id, channelId, 'TEXT');
    await markChannelRead(session.user.id, channelId);

    return json({ ok: true });
  });
}
