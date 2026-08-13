import { apiHandler, json } from '@/lib/api/handler';
import { ApiError, parseJsonBody } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireChannelAccess, requireSession } from '@/lib/api/guards';
import { createMessageSchema, listMessagesSchema } from '@/lib/validation/schemas';
import { createMessage, listMessages } from '@/lib/messages/service';
import { fieldErrorsOf } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

type Params = { params: Promise<{ channelId: string }> };

/** Histórico do canal, paginado por cursor (mais recentes primeiro). */
export async function GET(request: Request, { params }: Params) {
  return apiHandler('messages.list', async () => {
    const session = await requireSession();
    const { channelId } = await params;

    await requireChannelAccess(session.user.id, channelId, 'TEXT');

    const url = new URL(request.url);
    const parsed = listMessagesSchema.safeParse({
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      throw ApiError.validation(fieldErrorsOf(parsed.error));
    }

    const page = await listMessages({
      channelId,
      viewerId: session.user.id,
      cursor: parsed.data.cursor ?? null,
      limit: parsed.data.limit,
    });

    return json(page);
  });
}

export async function POST(request: Request, { params }: Params) {
  return apiHandler('messages.create', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    const { channelId } = await params;

    enforceRateLimit(RATE_LIMITS.message, `user:${session.user.id}`);

    const context = await requireChannelAccess(session.user.id, channelId, 'TEXT');
    const body = await parseJsonBody(request, createMessageSchema);

    const message = await createMessage({
      channelId,
      serverId: context.serverId,
      authorId: session.user.id,
      content: body.content,
      replyToId: body.replyToId ?? null,
    });

    return json({ message }, 201);
  });
}
