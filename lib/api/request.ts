import { ApiError } from './errors';

/**
 * Extrai o IP do cliente considerando os proxies da Vercel.
 *
 * `x-forwarded-for` pode ser forjado por quem fala direto com a aplicação, então
 * este valor serve apenas para rate limiting (best effort) — nunca para
 * autorização.
 */
export function clientIpOf(request: Request): string | null {
  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? null;
}

/** Identidade usada nos limites: o IP quando existe, senão um balde global. */
export function rateLimitIdentity(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  return `ip:${clientIpOf(request) ?? 'desconhecido'}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defesa contra CSRF.
 *
 * O cookie de sessão já é `SameSite=Lax`, o que impede que um POST disparado por
 * outro site o carregue. Esta checagem é a segunda camada: em toda requisição
 * que altera estado, o `Origin` precisa bater com o host da aplicação.
 *
 * Requisições sem `Origin` nem `Referer` são recusadas — todo navegador atual
 * envia `Origin` em POST/PUT/PATCH/DELETE.
 */
export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!host) {
    throw ApiError.forbidden('Requisição sem host identificável foi recusada.');
  }

  const allowedHosts = new Set([host]);
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      allowedHosts.add(new URL(configured).host);
    } catch {
      // URL malformada na configuração: ignoramos e ficamos só com o host real.
    }
  }

  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw ApiError.forbidden('Origem da requisição inválida.');
    }

    if (!allowedHosts.has(originHost)) {
      throw ApiError.forbidden('Origem da requisição não autorizada.');
    }
    return;
  }

  // Sem Origin, aceitamos um Referer do mesmo host (clientes antigos).
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      if (allowedHosts.has(new URL(referer).host)) return;
    } catch {
      // cai no throw abaixo
    }
  }

  throw ApiError.forbidden('Origem da requisição não pôde ser verificada.');
}
