/**
 * Cookie jar em memória que substitui `next/headers` nos testes.
 *
 * Isso permite chamar os route handlers de verdade — com validação Zod, guards,
 * Prisma e tudo mais — em vez de testar só as funções internas. O que passa por
 * aqui é o mesmo caminho que o navegador percorre.
 */
export interface CookieJar {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: unknown): void;
  delete(name: string): void;
  clear(): void;
  raw(): Map<string, string>;
}

export function createCookieJar(): CookieJar {
  const store = new Map<string, string>();

  return {
    get(name) {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value) {
      store.set(name, value);
    },
    delete(name) {
      store.delete(name);
    },
    clear() {
      store.clear();
    },
    raw() {
      return store;
    },
  };
}

/** Jar compartilhado — os testes importam este para inspecionar/limpar cookies. */
export const cookieJar = createCookieJar();

/**
 * Implementação que substitui `next/headers`.
 *
 * Cada arquivo de teste registra o mock no topo do módulo (exigência do Vitest,
 * que iça as chamadas de `vi.mock`):
 *
 *   vi.mock('next/headers', async () => (await import('./helpers/next')).nextHeadersMock());
 */
export function nextHeadersMock() {
  return {
    cookies: async () => cookieJar,
    headers: async () => new Headers(),
  };
}

/**
 * Monta uma Request com os cabeçalhos que os guards esperam (Origin válido para
 * passar na checagem de CSRF).
 */
export function jsonRequest(
  url: string,
  body: unknown,
  init: { method?: string; origin?: string | null; headers?: Record<string, string> } = {},
): Request {
  const origin = init.origin === undefined ? 'http://localhost:3000' : init.origin;
  const headers = new Headers({
    'content-type': 'application/json',
    host: 'localhost:3000',
    ...init.headers,
  });

  if (origin) headers.set('origin', origin);

  return new Request(url, {
    method: init.method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getRequest(url: string, init: { headers?: Record<string, string> } = {}): Request {
  return new Request(url, {
    method: 'GET',
    headers: new Headers({ host: 'localhost:3000', ...init.headers }),
  });
}

/** Lê o corpo JSON de uma resposta com tipo. */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
