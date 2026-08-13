import { z } from 'zod';
import { CHANNEL_TYPES, SELECTABLE_STATUSES } from '@/lib/types';

/**
 * Schemas de entrada da API.
 *
 * Ficam em um módulo isolado (sem `server-only`) porque os formulários do
 * cliente reusam os mesmos schemas para validar antes de enviar — mensagens de
 * erro idênticas nos dois lados, sem duplicação de regra.
 */

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'O nome de usuário precisa de pelo menos 3 caracteres.')
  .max(24, 'O nome de usuário pode ter no máximo 24 caracteres.')
  .regex(
    /^[a-z0-9._-]+$/,
    'Use apenas letras minúsculas, números, ponto, hífen ou sublinhado.',
  );

export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa de pelo menos 10 caracteres.')
  .max(200, 'A senha pode ter no máximo 200 caracteres.')
  .refine((value) => /[a-zA-Z]/.test(value), 'A senha precisa conter ao menos uma letra.')
  .refine((value) => /[0-9]/.test(value), 'A senha precisa conter ao menos um número.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Informe o e-mail.')
  .max(254, 'E-mail longo demais.')
  .pipe(z.email('Informe um e-mail válido.'));

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'O nome de exibição precisa de pelo menos 2 caracteres.')
  .max(32, 'O nome de exibição pode ter no máximo 32 caracteres.');

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  /** Código de convite — obrigatório quando REGISTRATION_INVITE_ONLY=true. */
  inviteCode: z.string().trim().max(32).optional(),
});

export const loginSchema = z.object({
  // No login não aplicamos as regras de formato: quem tem senha antiga precisa
  // conseguir entrar. A validação forte vale só no cadastro/troca.
  identifier: z.string().trim().min(1, 'Informe o e-mail ou nome de usuário.').max(254),
  password: z.string().min(1, 'Informe a senha.').max(200),
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    activity: z.string().trim().max(80, 'A atividade pode ter no máximo 80 caracteres.').nullable().optional(),
    preferredStatus: z.enum(SELECTABLE_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nada para atualizar.');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.').max(200),
  newPassword: passwordSchema,
});

// ---------------------------------------------------------------------------
// Servidor e canais
// ---------------------------------------------------------------------------

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do canal.')
  .max(32, 'O nome do canal pode ter no máximo 32 caracteres.');

export const createChannelSchema = z.object({
  name: channelNameSchema,
  type: z.enum(CHANNEL_TYPES),
  topic: z.string().trim().max(200).nullable().optional(),
});

export const updateChannelSchema = z
  .object({
    name: channelNameSchema.optional(),
    topic: z.string().trim().max(200).nullable().optional(),
    position: z.number().int().min(0).max(999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nada para atualizar.');

export const updateServerSchema = z
  .object({
    name: z.string().trim().min(2).max(48).optional(),
    iconEmoji: z.string().trim().min(1).max(8).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nada para atualizar.');

export const updateMemberSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
  nickname: z.string().trim().min(1).max(32).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export const messageContentSchema = z
  .string()
  .min(1, 'A mensagem não pode ficar vazia.')
  .max(4000, 'A mensagem pode ter no máximo 4000 caracteres.')
  // Só corta espaços nas pontas: quebras de linha internas são significativas.
  .transform((value) => value.replace(/^\s+|\s+$/g, ''))
  .refine((value) => value.length > 0, 'A mensagem não pode ficar vazia.');

export const createMessageSchema = z.object({
  content: messageContentSchema,
  replyToId: z.string().min(1).max(64).nullable().optional(),
});

export const updateMessageSchema = z.object({
  content: messageContentSchema,
});

export const listMessagesSchema = z.object({
  /** Id da mensagem mais antiga já carregada — busca as anteriores a ela. */
  cursor: z.string().min(1).max(64).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Emoji de reação.
 *
 * Aceita apenas caracteres da classe Emoji do Unicode (com modificadores e ZWJ),
 * o que impede usar o campo como texto livre — nada de "reação" com 32 letras.
 */
export const reactionEmojiSchema = z
  .string()
  .trim()
  .min(1, 'Informe o emoji.')
  .max(32, 'Emoji inválido.')
  .refine(
    (value) => /^(\p{Extended_Pictographic}|\p{Emoji_Component})+$/u.test(value),
    'Apenas emojis são aceitos como reação.',
  );

export const toggleReactionSchema = z.object({
  emoji: reactionEmojiSchema,
});

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

export const createInviteSchema = z.object({
  /** Duração em segundos; null = nunca expira. */
  expiresInSeconds: z
    .number()
    .int()
    .min(60, 'A validade mínima é de 1 minuto.')
    .max(60 * 60 * 24 * 30, 'A validade máxima é de 30 dias.')
    .nullable()
    .default(60 * 60 * 24 * 7),
  maxUses: z
    .number()
    .int()
    .min(1, 'O mínimo é 1 uso.')
    .max(1000, 'O máximo é 1000 usos.')
    .nullable()
    .default(null),
});

export const inviteCodeSchema = z
  .string()
  .trim()
  .min(4, 'Código de convite inválido.')
  .max(32, 'Código de convite inválido.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Código de convite inválido.');

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/**
 * Extrai a primeira mensagem de erro por campo, no formato que os formulários
 * consomem: `{ email: 'Informe um e-mail válido.' }`.
 */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    result[key] ??= issue.message;
  }
  return result;
}
