'use client';

import { Loader2, WifiOff } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';

/**
 * Faixa de estado da conexão.
 *
 * Aparece somente quando há algo errado. O objetivo é que o usuário nunca se
 * pergunte "o chat travou ou ninguém está falando?" — a resposta fica no topo
 * da tela.
 */
export function ConnectionBanner() {
  const { state, banner, reconnect } = useWebSocket();

  if (!banner) return null;

  const offline = state === 'offline';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'dc-fade-in flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium',
        offline ? 'bg-danger text-white' : 'bg-warning/15 text-warning',
      )}
    >
      {offline ? (
        <WifiOff className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      )}

      <span>{banner.label}</span>

      {offline ? (
        <button
          type="button"
          onClick={reconnect}
          className="ml-1 underline underline-offset-2 hover:opacity-80"
        >
          Tentar agora
        </button>
      ) : null}
    </div>
  );
}
