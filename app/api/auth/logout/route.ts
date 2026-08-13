import { apiHandler, json } from '@/lib/api/handler';
import { assertSameOrigin } from '@/lib/api/request';
import { destroyCurrentSession, getSession } from '@/lib/auth/session';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('auth');

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return apiHandler('auth.logout', async () => {
    assertSameOrigin(request);

    const session = await getSession();
    await destroyCurrentSession();

    if (session) {
      // Derruba os WebSockets abertos com esta sessão: sem isso, a aba antiga
      // continuaria recebendo eventos depois do logout.
      await publishEvent(Topic.user(session.user.id), {
        t: 'session:revoked',
        reason: 'Sessão encerrada.',
      });
      log.info({ userId: session.user.id, event: 'auth.logout' }, 'Logout efetuado');
    }

    return json({ ok: true });
  });
}
