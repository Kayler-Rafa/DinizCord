import { NextResponse } from 'next/server';
import { handleApiError, type ApiErrorBody } from './errors';

/**
 * Envolve o corpo de um route handler com o tratamento padrão de erros.
 *
 * Cada rota vira `return apiHandler('nome.da.rota', async () => { ... })`, e
 * qualquer `ApiError` lançado lá dentro (inclusive pelos guards) sai como a
 * resposta HTTP correta — sem try/catch repetido em quinze arquivos.
 */
export async function apiHandler<T>(
  name: string,
  fn: () => Promise<NextResponse<T>>,
): Promise<NextResponse<T | ApiErrorBody>> {
  try {
    return await fn();
  } catch (error) {
    return handleApiError(error, name);
  }
}

/** Resposta JSON de sucesso com cache desabilitado (dados sempre por usuário). */
export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
