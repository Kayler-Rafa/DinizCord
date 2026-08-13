import { apiHandler, json } from '@/lib/api/handler';
import { requireMembership, requireSession } from '@/lib/api/guards';
import { listMembers } from '@/lib/servers/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ serverId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return apiHandler('members.list', async () => {
    const session = await requireSession();
    const { serverId } = await params;

    // Só membros enxergam a lista de membros.
    await requireMembership(session.user.id, serverId);

    const members = await listMembers(serverId);
    return json({ members });
  });
}
