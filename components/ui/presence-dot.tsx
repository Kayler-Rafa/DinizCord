import { cn } from '@/lib/utils';
import { PRESENCE_LABELS, type PresenceStatus } from '@/lib/types';

const STYLES: Record<PresenceStatus, string> = {
  ONLINE: 'bg-success',
  IDLE: 'bg-warning',
  DO_NOT_DISTURB: 'bg-danger',
  OFFLINE: 'bg-[var(--dc-text-subtle)]',
};

/**
 * Indicador de presença. A forma muda junto com a cor (anel vazado no OFFLINE,
 * barra no DND) para não depender só de cor — daltônicos precisam distinguir.
 */
export function PresenceDot({
  status,
  className,
  labelled = false,
}: {
  status: PresenceStatus;
  className?: string;
  /** Quando true, expõe o estado a leitores de tela em vez de esconder. */
  labelled?: boolean;
}) {
  return (
    <span
      className={cn(
        'relative flex size-3 items-center justify-center rounded-full',
        STYLES[status],
        status === 'OFFLINE' && 'border-2 border-[var(--dc-text-subtle)] bg-transparent',
        className,
      )}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? PRESENCE_LABELS[status] : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {status === 'DO_NOT_DISTURB' ? (
        <span className="h-[2px] w-1/2 rounded-full bg-[var(--dc-base)]" />
      ) : null}
    </span>
  );
}
