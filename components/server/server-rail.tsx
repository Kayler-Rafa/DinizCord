'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { useServers, useStoreSelector } from '@/hooks/useStore';

/**
 * Trilha vertical de servidores.
 *
 * O projeto começa com um servidor só, mas o modelo de dados já suporta vários —
 * a trilha existe para que adicionar o segundo não exija repensar a navegação.
 */
export function ServerRail({ activeServerId }: { activeServerId: string | null }) {
  const servers = useServers();

  return (
    <div className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-line bg-base py-3">
      {servers.map((server) => (
        <ServerIcon
          key={server.id}
          serverId={server.id}
          name={server.name}
          emoji={server.iconEmoji}
          active={server.id === activeServerId}
        />
      ))}
    </div>
  );
}

function ServerIcon({
  serverId,
  name,
  emoji,
  active,
}: {
  serverId: string;
  name: string;
  emoji: string;
  active: boolean;
}) {
  // O primeiro canal de texto é o destino natural ao trocar de servidor.
  const firstTextChannelId = useStoreSelector(
    (state) =>
      state.servers
        .find((server) => server.id === serverId)
        ?.channels.find((channel) => channel.type === 'TEXT')?.id ?? null,
  );

  const unreadTotal = useStoreSelector((state) => {
    const server = state.servers.find((item) => item.id === serverId);
    if (!server) return 0;
    return server.channels.reduce(
      (total, channel) => total + (state.unreads[channel.id] ?? 0),
      0,
    );
  });

  const content = (
    <span
      className={cn(
        'relative flex size-12 items-center justify-center text-xl transition-all duration-150',
        'rounded-[1.5rem] bg-surface hover:rounded-[1rem] hover:bg-accent-soft',
        active && 'rounded-[1rem] bg-accent-soft',
      )}
    >
      {emoji}

      {unreadTotal > 0 && !active ? (
        <span className="absolute -bottom-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-[var(--dc-base)]">
          {unreadTotal > 99 ? '99+' : unreadTotal}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="relative flex w-full items-center justify-center">
      {/* Indicador de seleção à esquerda, no lugar de mudar a cor do ícone. */}
      <span
        className={cn(
          'absolute left-0 w-1 rounded-r-full bg-content transition-all duration-150',
          active ? 'h-8' : 'h-0',
        )}
        aria-hidden
      />

      <Tooltip content={name} side="right">
        {firstTextChannelId ? (
          <Link
            href={`/app/c/${firstTextChannelId}`}
            aria-label={name}
            aria-current={active ? 'page' : undefined}
          >
            {content}
          </Link>
        ) : (
          <span aria-label={name}>{content}</span>
        )}
      </Tooltip>
    </div>
  );
}
