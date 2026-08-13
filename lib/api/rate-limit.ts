import { ApiError } from './errors';

/**
 * Rate limiting em duas camadas:
 *
 *  1. Este módulo — janela deslizante em memória, por instância. Cobre abuso
 *     genérico (flood de mensagens, spam de criação de canal) com custo zero.
 *  2. `lib/auth/login-attempts.ts` — contadores no PostgreSQL, usados no login.
 *     Sobrevivem a restart e funcionam com várias instâncias, que é exatamente
 *     o que importa contra força bruta de senha.
 *
 * LIMITAÇÃO CONHECIDA: com N instâncias, o limite efetivo desta camada vira
 * N × limite. Aceitável para um app privado; se um dia virar problema, a troca é
 * substituir o Map por uma tabela ou um contador externo, sem mudar a interface.
 */

interface Bucket {
  /** Timestamps das requisições dentro da janela. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/** Remoção preguiçosa: sem timer de fundo, o GC acontece durante o uso. */
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1]! > windowMs * 2) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitRule {
  /** Nome do limite — entra na chave, então limites diferentes não se misturam. */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(rule: RateLimitRule, identity: string): RateLimitResult {
  const now = Date.now();
  sweep(now, rule.windowMs);

  const key = `${rule.name}:${identity}`;
  const bucket = buckets.get(key) ?? { hits: [] };
  const cutoff = now - rule.windowMs;

  bucket.hits = bucket.hits.filter((timestamp) => timestamp > cutoff);

  if (bucket.hits.length >= rule.limit) {
    const oldest = bucket.hits[0]!;
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  return { allowed: true, remaining: rule.limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Igual a `checkRateLimit`, mas lança o erro de API já formatado. */
export function enforceRateLimit(rule: RateLimitRule, identity: string): void {
  const result = checkRateLimit(rule, identity);
  if (!result.allowed) {
    throw ApiError.rateLimited(result.retryAfterSeconds);
  }
}

/** Limpa o estado — usado entre testes. */
export function resetRateLimits(): void {
  buckets.clear();
}

export const RATE_LIMITS = {
  /** Cadastro: caro e raro. */
  register: { name: 'register', limit: 5, windowMs: 60 * 60 * 1000 },
  /** Login por IP — o limite por conta fica no contador do banco. */
  login: { name: 'login', limit: 20, windowMs: 15 * 60 * 1000 },
  /** Envio de mensagens: rápido o bastante para conversa, lento para flood. */
  message: { name: 'message', limit: 30, windowMs: 20 * 1000 },
  /** Reações são baratas, mas o toggle pode ser abusado. */
  reaction: { name: 'reaction', limit: 60, windowMs: 30 * 1000 },
  /** Operações administrativas. */
  mutation: { name: 'mutation', limit: 40, windowMs: 60 * 1000 },
  /** Emissão de ticket do gateway (uma por reconexão). */
  ticket: { name: 'ticket', limit: 60, windowMs: 60 * 1000 },
  /** Aceitar convite — limita varredura de códigos. */
  invite: { name: 'invite', limit: 15, windowMs: 10 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;
