import { apiHandler, json } from '@/lib/api/handler';
import { getSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

/**
 * Estado da sessão atual. Usado pelo cliente para revalidar depois de voltar de
 * uma aba em segundo plano ou de uma reconexão.
 */
export async function GET() {
  return apiHandler('auth.me', async () => {
    const session = await getSession();
    return json({ user: session?.user ?? null });
  });
}
