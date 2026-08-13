import 'server-only';

import { hash, verify } from '@node-rs/argon2';

/**
 * Parâmetros do Argon2id.
 *
 * Alinhados à recomendação do OWASP (19 MiB de memória, 2 iterações, 1 thread):
 * caro o bastante para tornar força bruta offline inviável, leve o bastante para
 * rodar dentro do limite de tempo de uma função serverless.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Confere a senha. Retorna `false` em vez de lançar quando o hash está corrompido
 * ou em formato desconhecido — um registro inválido no banco não deve derrubar o
 * endpoint de login.
 */
export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Hash descartável usado para igualar o custo do login quando o usuário não
 * existe. Sem isso, a diferença de tempo de resposta revelaria quais e-mails
 * estão cadastrados (user enumeration).
 */
let dummyDigestPromise: Promise<string> | null = null;

export async function equalizeLoginTiming(plain: string): Promise<void> {
  dummyDigestPromise ??= hashPassword('dinizcord-timing-equalizer');
  const digest = await dummyDigestPromise;
  await verifyPassword(digest, plain);
}
