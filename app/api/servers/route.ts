import { apiHandler, json } from '@/lib/api/handler';
import { requireSession } from '@/lib/api/guards';
import { listServersForUser } from '@/lib/servers/service';

export const runtime = 'nodejs';

/** Servidores do usuário autenticado, com os canais de cada um. */
export async function GET() {
  return apiHandler('servers.list', async () => {
    const session = await requireSession();
    const servers = await listServersForUser(session.user.id);
    return json({ servers });
  });
}
