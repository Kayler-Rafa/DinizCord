import pino from 'pino';

/**
 * Logger estruturado (JSON) para o backend.
 *
 * Regras:
 *  - nunca logar senha, token, secret, cookie ou o conteúdo de mensagens;
 *  - todo log carrega um contexto nomeado (`scope`) para facilitar filtro;
 *  - em desenvolvimento a saída é formatada; em produção é JSON puro.
 */
const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

/** Campos que jamais devem aparecer nos logs, em qualquer profundidade razoável. */
const REDACT_PATHS = [
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'authorization',
  'cookie',
  'headers.cookie',
  'headers.authorization',
  '*.password',
  '*.token',
  '*.secret',
  '*.passwordHash',
  'req.headers.cookie',
  'req.headers.authorization',
];

export const logger = pino({
  level,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'dinizcord' },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    !isProduction && level !== 'silent'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        }
      : undefined,
});

/** Cria um logger filho amarrado a um subsistema (`auth`, `gateway`, `voice`...). */
export function scopedLogger(scope: string, bindings: Record<string, unknown> = {}) {
  return logger.child({ scope, ...bindings });
}

export type Logger = ReturnType<typeof scopedLogger>;
