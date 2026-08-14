'use client';

import * as React from 'react';
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
  /** Foto de perfil; quando ausente, caem as iniciais sobre a cor. */
  src?: string | null;
  size?: keyof typeof SIZES;
  /** Quando informado, desenha o indicador de presença no canto. */
  status?: PresenceStatus | undefined;
  speaking?: boolean;
  className?: string;
}

/**
 * Avatar do usuário.
 *
 * Mostra a foto quando existe e cai para as iniciais sobre uma cor
 * determinística quando não. As iniciais também voltam se a imagem falhar ao
 * carregar — um avatar quebrado é pior que nenhum.
 */
export function Avatar({ name, color, src, size = 'md', status, speaking, className }: AvatarProps) {
  // A falha é guardada junto da URL que falhou, e não zerada por efeito ao
  // trocar de foto: assim uma URL nova já nasce "sem falha" no mesmo render,
  // sem passar por um quadro exibindo as iniciais.
  const [falha, setFalha] = React.useState<{ src: string | null; falhou: boolean }>({
    src: src ?? null,
    falhou: false,
  });

  const falhou = falha.src === (src ?? null) && falha.falhou;
  const mostrarFoto = Boolean(src) && !falhou;

  return (
    <div className={cn('relative shrink-0', className)}>
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none',
          'ring-2 transition-[box-shadow,ring-color] duration-150',
          SIZES[size],
          speaking ? 'ring-speaking' : 'ring-transparent',
        )}
        style={mostrarFoto ? undefined : { backgroundColor: color }}
        aria-hidden
      >
        {mostrarFoto ? (
          // `img` puro em vez de next/image: a rota devolve bytes do banco com
          // cache imutável, então o otimizador do Next não teria o que fazer
          // além de adicionar um salto a mais.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src ?? ''}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setFalha({ src: src ?? null, falhou: true })}
          />
        ) : (
          initialsOf(name)
        )}
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
