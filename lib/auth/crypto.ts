import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env.server';

/**
 * Token de sessão opaco. 32 bytes aleatórios em base64url — 256 bits de
 * entropia, o suficiente para que adivinhar seja impossível na prática.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Deriva o valor guardado no banco a partir do token do cookie.
 *
 * HMAC-SHA256 (e não bcrypt/argon2) porque o token já é aleatório e de alta
 * entropia: não há o que forçar por dicionário, e o lookup precisa ser rápido a
 * cada requisição. A chave garante que um dump da tabela não permita inverter
 * nada nem forjar registros.
 */
export function hashSessionToken(token: string): string {
  return createHmac('sha256', serverEnv().AUTH_SECRET).update(token).digest('hex');
}

/** Anonimiza o IP antes de persistir (rate limiting sem guardar dado pessoal). */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', serverEnv().AUTH_SECRET).update(`ip:${ip}`).digest('hex');
}

/** Comparação em tempo constante para valores hexadecimais de mesmo tamanho. */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Código de convite: alfabeto sem caracteres ambíguos (0/O, 1/I/l). */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length];
  }
  return code;
}
