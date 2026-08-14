import { prisma } from '@/lib/db/client';
import { apiHandler, json } from '@/lib/api/handler';
import { ApiError } from '@/lib/api/errors';
import { assertSameOrigin } from '@/lib/api/request';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { requireSession } from '@/lib/api/guards';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('avatar');

export const runtime = 'nodejs';

/** Teto do corpo aceito. O cliente já reduz para ~30 KB; isto é a rede de proteção. */
const MAX_BYTES = 200 * 1024;

/**
 * Tipos aceitos e sua assinatura binária.
 *
 * O `Content-Type` enviado pelo cliente não é confiável — quem quiser subir um
 * HTML com script pode declará-lo como `image/webp`. Conferir os primeiros
 * bytes garante que o que está guardado é realmente uma imagem.
 */
const ASSINATURAS: Array<{ mime: string; verificar: (bytes: Uint8Array) => boolean }> = [
  {
    mime: 'image/webp',
    // "RIFF" .... "WEBP"
    verificar: (b) =>
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mime: 'image/png',
    verificar: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    verificar: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
];

export async function POST(request: Request) {
  return apiHandler('me.avatar.upload', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    const buffer = await request.arrayBuffer();

    if (buffer.byteLength === 0) {
      throw ApiError.badRequest('Nenhuma imagem foi enviada.');
    }

    if (buffer.byteLength > MAX_BYTES) {
      throw ApiError.badRequest('A imagem passou do limite de 200 KB.');
    }

    const bytes = new Uint8Array(buffer);
    const formato = ASSINATURAS.find((assinatura) => assinatura.verificar(bytes));

    if (!formato) {
      throw ApiError.badRequest('O arquivo enviado não é uma imagem JPG, PNG ou WebP.');
    }

    const atualizadoEm = new Date();
    const avatarUrl = `/api/users/${session.user.id}/avatar?v=${atualizadoEm.getTime()}`;

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        avatarData: Buffer.from(bytes),
        avatarMimeType: formato.mime,
        avatarUpdatedAt: atualizadoEm,
      },
    });

    await anunciarTroca(session.user.id, avatarUrl);

    log.info(
      { userId: session.user.id, bytes: bytes.length, event: 'avatar.updated' },
      'Foto de perfil atualizada',
    );

    return json({ avatarUrl });
  });
}

export async function DELETE(request: Request) {
  return apiHandler('me.avatar.remove', async () => {
    assertSameOrigin(request);

    const session = await requireSession();
    enforceRateLimit(RATE_LIMITS.mutation, `user:${session.user.id}`);

    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarData: null, avatarMimeType: null, avatarUpdatedAt: null },
    });

    await anunciarTroca(session.user.id, null);

    return json({ avatarUrl: null });
  });
}

/**
 * Avisa os servidores em que a pessoa está.
 *
 * Sem isso, os outros continuariam vendo a foto antiga (ou as iniciais) até
 * recarregarem a página.
 */
async function anunciarTroca(userId: string, avatarUrl: string | null): Promise<void> {
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });

  await Promise.all(
    memberships.map((membership) =>
      publishEvent(Topic.server(membership.serverId), { t: 'user:avatar', userId, avatarUrl }),
    ),
  );
}
