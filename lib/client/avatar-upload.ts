/**
 * Preparo da foto de perfil no navegador.
 *
 * A imagem é recortada em quadrado e reduzida a 256×256 ANTES de subir. Isso
 * resolve três coisas de uma vez: a rede não carrega um JPEG de 8 MB tirado no
 * celular, o servidor não precisa de biblioteca de processamento de imagem, e o
 * banco guarda dezenas de kilobytes em vez de megabytes.
 *
 * O servidor revalida tipo e tamanho de qualquer forma — o cliente é hostil.
 */

/** Lado do quadrado final, em pixels. */
export const AVATAR_SIZE = 256;

/** Teto do arquivo ORIGINAL aceito para leitura, antes de reduzir. */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/** Teto do resultado enviado ao servidor. */
export const MAX_UPLOAD_BYTES = 200 * 1024;

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class AvatarError extends Error {}

/**
 * Lê o arquivo, recorta no centro e devolve um WebP quadrado.
 *
 * WebP porque comprime bem melhor que JPEG nesse tamanho; navegadores sem
 * suporte caem para JPEG automaticamente (`toBlob` devolve o tipo que
 * conseguiu).
 */
export async function prepararAvatar(arquivo: File): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(arquivo.type)) {
    throw new AvatarError('Formato não suportado. Use JPG, PNG, WebP ou GIF.');
  }

  if (arquivo.size > MAX_SOURCE_BYTES) {
    throw new AvatarError('Imagem grande demais. O limite é 12 MB.');
  }

  const bitmap = await carregarBitmap(arquivo);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AvatarError('Seu navegador não conseguiu processar a imagem.');

    // Recorte central: a maior região quadrada que cabe na imagem original.
    const lado = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - lado) / 2;
    const sy = (bitmap.height - lado) / 2;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, lado, lado, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );

    if (!blob) throw new AvatarError('Não foi possível converter a imagem.');

    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new AvatarError('A imagem ficou grande demais depois de processada.');
    }

    return blob;
  } finally {
    bitmap.close();
  }
}

async function carregarBitmap(arquivo: File): Promise<ImageBitmap> {
  try {
    // `createImageBitmap` respeita a orientação EXIF; sem isso, foto de celular
    // sobe deitada.
    return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new AvatarError('Não foi possível ler esta imagem. Tente outro arquivo.');
  }
}
