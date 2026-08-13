import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireChannelAccess, requireSession } from '@/lib/api/guards';
import { toggleReactionSchema } from '@/lib/validation/schemas';
import { toggleReaction } from '@/lib/messages/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ messageId: string }> };

/** Alterna a reação do usuário: envia de novo o mesmo emoji para remover. */
export async function POST(request: Request, { params }: Params) {
  return apiHandler('reactions.toggle', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { messageId } = await params;

    enforceRateLimit(RATE_LIMITS.reaction, `user:${session.user.id}`);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true },
    });

    if (!message) {
      throw ApiError.notFound('Esta mensagem não existe mais.');
    }

    const context = await requireChannelAccess(session.user.id, message.channelId, 'TEXT');
    const body = await parseJsonBody(request, toggleReactionSchema);

    const reactions = await toggleReaction({
      messageId,
      channelId: message.channelId,
      serverId: context.serverId,
      userId: session.user.id,
      emoji: body.emoji,
    });

    return json({ reactions });
  });
}
