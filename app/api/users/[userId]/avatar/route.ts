import { prisma } from '@/lib/db/client';
import { getSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

type Params = { params: Promise<{ userId: string }> };

/**
 * Entrega a foto de perfil.
 *
 * Exige sessão: num app privado, as fotos das pessoas não devem ficar
 * acessíveis a quem tiver o link. O custo é não poder usar CDN pública, o que
 * é irrelevante para o tamanho deste projeto.
 *
 * O cache é agressivo de propósito — a URL carrega `?v=<timestamp>` do último
 * upload, então uma foto nova gera uma URL nova. O navegador pode guardar a
 * antiga para sempre sem risco de mostrar imagem desatualizada.
 */
export async function GET(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarData: true, avatarMimeType: true, avatarUpdatedAt: true },
  });

  if (!user?.avatarData || !user.avatarMimeType) {
    return new Response(null, { status: 404 });
  }

  const etag = `"${userId}-${user.avatarUpdatedAt?.getTime() ?? 0}"`;

  // Responde 304 quando o navegador já tem a versão atual.
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(new Uint8Array(user.avatarData), {
    status: 200,
    headers: {
      'content-type': user.avatarMimeType,
      'content-length': String(user.avatarData.length),
      etag,
      // `private` porque a resposta depende da sessão: proxies compartilhados
      // não podem guardá-la e servir para outra pessoa.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
}
