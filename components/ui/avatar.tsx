'use client';

import { cn, initialsOf } from '@/lib/utils';
import type { PresenceStatus } from '@/lib/types';
import { PresenceDot } from './presence-dot';

const SIZES = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-20 text-2xl',
} as const;

interface AvatarProps {
  name: string;
  color: string;
  size?: keyof typeof SIZES;
  /** Quando informado, desenha o indicador de presença no canto. */
  status?: PresenceStatus | undefined;
  speaking?: boolean;
  className?: string;
}

/**
 * Avatar textual — o projeto não hospeda upload de imagens, então a identidade
 * visual vem das iniciais sobre uma cor determinística por usuário.
 */
export function Avatar({ name, color, size = 'md', status, speaking, className }: AvatarProps) {
  return (
    <div className={cn('relative shrink-0', className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full font-semibold text-white select-none',
          'ring-2 transition-[box-shadow,ring-color] duration-150',
          SIZES[size],
          speaking ? 'ring-speaking' : 'ring-transparent',
        )}
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {initialsOf(name)}
      </div>

      {status ? (
        <PresenceDot
          status={status}
          className={cn(
            'absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--dc-surface)]',
            size === 'sm' && 'size-2.5',
            size === 'xl' && 'size-5',
          )}
        />
      ) : null}
    </div>
  );
}
