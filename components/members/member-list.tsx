'use client';

import * as React from 'react';
import { Crown, Shield } from 'lucide-react';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import { useMembers, useStoreSelector } from '@/hooks/useStore';
import { MemberListSkeleton } from '@/components/ui/skeleton';
import { MemberRow } from './member-row';
import type { MemberDTO, PresenceStatus } from '@/lib/types';

/**
 * Lista de membros com presença ao vivo.
 *
 * Separa quem está disponível de quem está offline, como todo app de chat: a
 * pergunta que a lista responde é "com quem dá para falar agora?".
 */
export function MemberList({ serverId }: { serverId: string | null }) {
  const { store } = useApp();
  const members = useMembers(serverId);
  const presences = useStoreSelector((state) => state.presences);

  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!serverId) return;

    let cancelled = false;

    // O erro é limpo dentro do `then`, e não antes da chamada: um `setError`
    // síncrono no corpo do efeito provocaria um render a mais toda vez que o
    // servidor muda, sem nada de novo para mostrar.
    api.servers
      .members(serverId)
      .then((result) => {
        if (cancelled) return;
        store.setMembers(serverId, result.members);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(
          caught instanceof ApiClientError
            ? caught.message
            : 'Não foi possível carregar os membros.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [serverId, store]);

  const { online, offline } = React.useMemo(() => {
    const onlineMembers: MemberDTO[] = [];
    const offlineMembers: MemberDTO[] = [];

    for (const member of members ?? []) {
      const status: PresenceStatus = presences[member.user.id]?.status ?? 'OFFLINE';
      if (status === 'OFFLINE') offlineMembers.push(member);
      else onlineMembers.push(member);
    }

    const byName = (a: MemberDTO, b: MemberDTO) =>
      a.user.displayName.localeCompare(b.user.displayName, 'pt-BR');

    return { online: onlineMembers.sort(byName), offline: offlineMembers.sort(byName) };
  }, [members, presences]);

  if (!serverId) return null;

  if (error) {
    return <p className="p-4 text-sm text-muted">{error}</p>;
  }

  if (!members) {
    return <MemberListSkeleton />;
  }

  return (
    <div className="dc-scroll h-full overflow-y-auto px-2 py-3">
      <MemberGroup title={`Online — ${online.length}`} members={online} serverId={serverId} />
      {offline.length > 0 ? (
        <MemberGroup
          title={`Offline — ${offline.length}`}
          members={offline}
          serverId={serverId}
          dimmed
        />
      ) : null}

      {members.length === 0 ? (
        <p className="px-2 py-4 text-sm text-subtle">Ninguém por aqui ainda.</p>
      ) : null}
    </div>
  );
}

function MemberGroup({
  title,
  members,
  serverId,
  dimmed,
}: {
  title: string;
  members: MemberDTO[];
  serverId: string;
  dimmed?: boolean;
}) {
  if (members.length === 0) return null;

  return (
    <section className="mb-4">
      <h2 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-subtle">
        {title}
      </h2>
      <ul className="space-y-0.5">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} serverId={serverId} dimmed={dimmed} />
        ))}
      </ul>
    </section>
  );
}

/** Ícone do papel — só aparece para quem tem papel acima de membro. */
export function RoleBadge({ role }: { role: MemberDTO['role'] }) {
  if (role === 'OWNER') {
    return (
      <span title="Dono do servidor">
        <Crown className="size-3 shrink-0 text-warning" aria-label="Dono do servidor" />
      </span>
    );
  }

  if (role === 'ADMIN') {
    return (
      <span title="Administrador">
        <Shield className="size-3 shrink-0 text-accent" aria-label="Administrador" />
      </span>
    );
  }

  return null;
}
