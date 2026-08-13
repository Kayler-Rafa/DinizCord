import { apiHandler, json } from '@/lib/api/handler';
import { ApiError } from '@/lib/api/errors';
import { assertSameOrigin, rateLimitIdentity } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getSession } from '@/lib/auth/session';
import { requireSession } from '@/lib/api/guards';
import { inviteCodeSchema } from '@/lib/validation/schemas';
import { consumeInvite, findUsableInvite, previewInvite } from '@/lib/servers/invites';

export const runtime = 'nodejs';

type Params = { params: Promise<{ code: string }> };

async function parseCode(params: Params['params']): Promise<string> {
  const { code } = await params;
  const parsed = inviteCodeSchema.safeParse(code);
  if (!parsed.success) {
    throw ApiError.notFound('Este convite não existe.');
  }
  return parsed.data;
}

/**
 * Prévia pública do convite (nome do servidor, quem convidou, validade).
 *
 * Funciona sem sessão: quem recebe o link precisa ver para onde está indo antes
 * de decidir criar uma conta.
 */
export async function GET(request: Request, { params }: Params) {
  return apiHandler('invites.preview', async () => {
    enforceRateLimit(RATE_LIMITS.invite, rateLimitIdentity(request));

    const code = await parseCode(params);
    const session = await getSession();

    const preview = await previewInvite(code, session?.user.id ?? null);
    return json({ invite: preview, authenticated: session !== null });
  });
}

/** Aceita o convite e entra no servidor. */
export async function POST(request: Request, { params }: Params) {
  return apiHandler('invites.accept', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    enforceRateLimit(RATE_LIMITS.invite, `user:${session.user.id}`);

    const code = await parseCode(params);
    const invite = await findUsableInvite(code);

    if (!invite) {
      throw ApiError.notFound('Convite inválido, expirado ou já esgotado.');
    }

    const result = await consumeInvite(invite, session.user.id);
    return json({ serverId: result.serverId, joined: result.joined });
  });
}
