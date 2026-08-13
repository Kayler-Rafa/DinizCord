import { apiHandler, json } from '@/lib/api/handler';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireSession } from '@/lib/api/guards';
import { issueGatewayTicket, TICKET_TTL_MS } from '@/lib/auth/ticket';

export const runtime = 'nodejs';

/**
 * Emite o ticket de handshake do WebSocket.
 *
 * O gateway roda em outro processo/domínio e não recebe o cookie de sessão; este
 * endpoint troca a sessão por um JWT de 60 segundos que o gateway sabe validar.
 * O cliente pede um ticket novo a cada (re)conexão.
 */
export async function POST(request: Request) {
  return apiHandler('gateway.ticket', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    enforceRateLimit(RATE_LIMITS.ticket, `user:${session.user.id}`);

    const ticket = await issueGatewayTicket({
      userId: session.user.id,
      sessionId: session.sessionId,
    });

    return json({ ticket, expiresIn: TICKET_TTL_MS });
  });
}
