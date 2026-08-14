import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { assertSameOrigin, clientIpOf } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireSession } from '@/lib/api/guards';
import { hashIp } from '@/lib/auth/crypto';
import { TERMS_VERSION } from '@/lib/terms';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('terms');

export const runtime = 'nodejs';

/**
 * Registra o aceite dos termos.
 *
 * `permitirTermosPendentes` é obrigatório aqui: esta é justamente a rota que a
 * pessoa precisa conseguir chamar ANTES de ter aceitado. Sem a exceção, o
 * guard bloquearia o próprio ato de aceitar.
 *
 * A versão aceita é gravada junto com a data. Guardar só um booleano
 * impossibilitaria saber, no futuro, a que texto a pessoa concordou.
 */
export async function POST(request: Request) {
  return apiHandler('terms.accept', async () => {
    assertSameOrigin(request);

    const session = await requireSession({ permitirTermosPendentes: true });
    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const aceitoEm = new Date();

    await prisma.user.update({
      where: { id: session.user.id },
      data: { termsAcceptedAt: aceitoEm, termsAcceptedVersion: TERMS_VERSION },
    });

    // Registro de auditoria: se algum dia for preciso demonstrar que houve
    // aceite, o log guarda quando e de qual versão. O IP vai como HMAC, nunca
    // em claro.
    log.info(
      {
        userId: session.user.id,
        versao: TERMS_VERSION,
        ipHash: hashIp(clientIpOf(request)),
        event: 'terms.accepted',
      },
      'Termos aceitos',
    );

    return json({ acceptedAt: aceitoEm.toISOString(), version: TERMS_VERSION });
  });
}
