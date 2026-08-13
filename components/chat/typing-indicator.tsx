'use client';

import { useMembers, useTypingUserIds } from '@/hooks/useStore';

/**
 * "Fulano está digitando…".
 *
 * Ocupa altura fixa mesmo vazio: se o elemento aparecesse e sumisse, a caixa de
 * escrita pularia alguns pixels a cada tecla dos outros.
 */
export function TypingIndicator({
  channelId,
  serverId,
}: {
  channelId: string;
  serverId: string | null;
}) {
  const userIds = useTypingUserIds(channelId);
  const members = useMembers(serverId);

  const names = userIds
    .map((userId) => members?.find((member) => member.user.id === userId)?.user.displayName)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="h-5 px-6 text-[11px] text-muted" aria-live="polite" aria-atomic>
      {names.length > 0 ? (
        <span className="dc-fade-in flex items-center gap-1.5">
          <span className="flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-1 animate-bounce rounded-full bg-muted"
                style={{ animationDelay: `${dot * 120}ms` }}
              />
            ))}
          </span>
          {describeTyping(names)}
        </span>
      ) : null}
    </div>
  );
}

function describeTyping(names: string[]): string {
  if (names.length === 1) return `${names[0]} está digitando…`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`;
  if (names.length === 3) return `${names[0]}, ${names[1]} e ${names[2]} estão digitando…`;
  return 'Várias pessoas estão digitando…';
}
