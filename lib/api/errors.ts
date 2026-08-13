import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scopedLogger } from '@/lib/logger';
import { fieldErrorsOf } from '@/lib/validation/schemas';

const log = scopedLogger('api');

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Erro de API com mensagem já pronta para o usuário final.
 *
 * As mensagens são escritas em português e sem jargão porque vão direto para a
 * tela — nada de "Error: ECONNREFUSED".
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { fields?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  static badRequest(message: string) {
    return new ApiError('BAD_REQUEST', message);
  }
  static unauthorized(message = 'Você precisa entrar para continuar.') {
    return new ApiError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'Você não tem permissão para fazer isso.') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Não encontramos o que você procurava.') {
    return new ApiError('NOT_FOUND', message);
  }
  static conflict(message: string) {
    return new ApiError('CONFLICT', message);
  }
  static rateLimited(retryAfterSeconds: number) {
    return new ApiError(
      'RATE_LIMITED',
      `Muitas tentativas. Tente novamente em ${retryAfterSeconds} segundo${retryAfterSeconds === 1 ? '' : 's'}.`,
      { retryAfterSeconds },
    );
  }
  static validation(fields: Record<string, string>, message = 'Confira os campos destacados.') {
    return new ApiError('VALIDATION_ERROR', message, { fields });
  }
}

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
}

export function errorResponse(error: ApiError): NextResponse<ApiErrorBody> {
  const headers = new Headers();
  if (error.retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(error.retryAfterSeconds));
  }

  return NextResponse.json<ApiErrorBody>(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    },
    { status: STATUS_BY_CODE[error.code], headers },
  );
}

/**
 * Converte qualquer exceção em resposta HTTP.
 *
 * Erros inesperados são logados com stack completo, mas o cliente recebe uma
 * mensagem genérica — detalhes internos não devem vazar para o navegador.
 */
export function handleApiError(error: unknown, context: string): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    // Erros de negócio são esperados: WARN, sem stack.
    log.warn(
      { context, code: error.code, event: 'api.error' },
      `${context}: ${error.message}`,
    );
    return errorResponse(error);
  }

  if (error instanceof z.ZodError) {
    return errorResponse(ApiError.validation(fieldErrorsOf(error)));
  }

  log.error({ context, err: error, event: 'api.unhandled' }, `Erro não tratado em ${context}`);
  return errorResponse(
    new ApiError('INTERNAL_ERROR', 'Algo deu errado do nosso lado. Tente novamente em instantes.'),
  );
}

/** Lê e valida o corpo JSON da requisição. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw ApiError.badRequest('Corpo da requisição inválido.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ApiError.validation(fieldErrorsOf(result.error));
  }
  return result.data;
}
