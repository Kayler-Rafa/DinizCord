import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import {
  canDeleteMessage,
  canEditMessage,
  requireChannelAccess,
  requireSession,
} from '@/lib/api/guards';
import { updateMessageSchema } from '@/lib/validation/schemas';
import { deleteMessage, editMessage } from '@/lib/messages/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ messageId: string }> };

/**
 * Carrega a mensagem e valida o acesso ao canal dela.
 *
 * O canal vem do próprio registro — o cliente informa apenas o id da mensagem,
 * então não há como apontar para um canal ao qual ele não tem acesso.
 */
async function loadMessageForActor(messageId: string, viewerId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, authorId: true, deletedAt: true },
  });

  if (!message || message.deletedAt) {
    throw ApiError.notFound('Esta mensagem não existe mais.');
  }

  const context = await requireChannelAccess(viewerId, message.channelId, 'TEXT');
  return { message, context };
}

export async function PATCH(request: Request, { params }: Params) {
  return apiHandler('messages.update', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { messageId } = await params;

    enforceRateLimit(RATE_LIMITS.message, `user:${session.user.id}`);

    const { message, context } = await loadMessageForActor(messageId, session.user.id);

    if (!canEditMessage({ viewerId: session.user.id, authorId: message.authorId })) {
      throw ApiError.forbidden('Você só pode editar as suas próprias mensagens.');
    }

    const body = await parseJsonBody(request, updateMessageSchema);

    const updated = await editMessage({
      messageId,
      serverId: context.serverId,
      viewerId: session.user.id,
      content: body.content,
    });

    return json({ message: updated });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return apiHandler('messages.delete', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { messageId } = await params;

    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const { message, context } = await loadMessageForActor(messageId, session.user.id);

    if (
      !canDeleteMessage({
        viewerId: session.user.id,
        authorId: message.authorId,
        role: context.role,
      })
    ) {
      throw ApiError.forbidden('Você não tem permissão para excluir esta mensagem.');
    }

    await deleteMessage({
      messageId,
      channelId: message.channelId,
      serverId: context.serverId,
      actorId: session.user.id,
    });

    return json({ ok: true });
  });
}
