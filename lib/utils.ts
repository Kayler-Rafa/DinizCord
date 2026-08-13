import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes condicionais resolvendo conflitos do Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Iniciais para o avatar textual (no máximo 2 caracteres). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Cor de avatar determinística a partir de uma string, para que o mesmo usuário
 * tenha sempre a mesma cor em qualquer dispositivo.
 */
const AVATAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#3b82f6',
] as const;

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
];

/** "agora há pouco", "há 5 minutos", ou a data completa quando for antigo. */
export function formatRelativeTime(date: Date | string, now: Date = new Date()): string {
  const target = typeof date === 'string' ? new Date(date) : date;
  let delta = (target.getTime() - now.getTime()) / 1000;

  if (Math.abs(delta) < 45) return 'agora há pouco';

  const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(delta) < size) {
      return formatter.format(Math.round(delta), unit);
    }
    delta /= size;
  }

  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(target);
}

/** Horário curto usado ao lado do autor da mensagem. */
export function formatMessageTime(date: Date | string): string {
  const target = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const isToday = target.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = target.toDateString() === yesterday.toDateString();

  const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(target);
  if (isToday) return `Hoje às ${time}`;
  if (isYesterday) return `Ontem às ${time}`;
  return `${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(target)} às ${time}`;
}

/** Separador de dia usado no histórico de mensagens. */
export function formatDayDivider(date: Date | string): string {
  const target = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(target);
}

export function sameDay(a: Date | string, b: Date | string): boolean {
  const first = typeof a === 'string' ? new Date(a) : a;
  const second = typeof b === 'string' ? new Date(b) : b;
  return first.toDateString() === second.toDateString();
}

/** Slug seguro para nomes de canal (`# jogos-em-geral`). */
export function slugifyChannelName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
