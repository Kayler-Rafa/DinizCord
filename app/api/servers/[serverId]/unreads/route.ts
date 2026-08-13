import { apiHandler, json } from '@/lib/api/handler';
import { requireMembership, requireSession } from '@/lib/api/guards';
import { unreadStates } from '@/lib/messages/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ serverId: string }> };

/** Contagem de mensagens não lidas por canal de texto. */
export async function GET(_request: Request, { params }: Params) {
  return apiHandler('servers.unreads', async () => {
    const session = await requireSession();
    const { serverId } = await params;

    await requireMembership(session.user.id, serverId);

    const unreads = await unreadStates(session.user.id, serverId);
    return json({ unreads });
  });
}
