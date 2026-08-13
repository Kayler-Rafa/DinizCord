import { z } from 'zod';

/**
 * Validação das variáveis de ambiente do servidor.
 *
 * Falhar cedo e com mensagem clara é melhor do que descobrir em produção que
 * `AUTH_SECRET` estava vazio e todas as sessões eram forjáveis.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL é obrigatória (connection string do PostgreSQL).')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL precisa apontar para um PostgreSQL (postgresql://...).',
    ),

  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET precisa ter no mínimo 32 caracteres. Gere com: openssl rand -base64 48'),

  WS_PORT: z.coerce.number().int().positive().default(3001),

  WS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  TURN_SERVER_URL: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  TURN_PASSWORD: z.string().default(''),

  // `silent` existe para os testes: nenhum log durante a suíte.
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  REGISTRATION_INVITE_ONLY: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Lê e valida o ambiente. O resultado é memorizado — a validação roda uma vez
 * por processo.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Variáveis de ambiente inválidas:\n${details}\n\nCopie .env.example para .env e preencha os valores.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Descarta o cache — usado apenas em testes que manipulam process.env. */
export function resetServerEnvCache(): void {
  cached = null;
}
