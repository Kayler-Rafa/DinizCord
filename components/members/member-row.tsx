'use client';

import * as React from 'react';
import { ShieldMinus, ShieldPlus, UserMinus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import { useActivityOf, usePresenceOf, useServer } from '@/hooks/useStore';
import { RoleBadge } from './member-list';
import { PRESENCE_LABELS, ROLE_LABELS, type MemberDTO } from '@/lib/types';

export function MemberRow({
  member,
  serverId,
  dimmed,
}: {
  member: MemberDTO;
  serverId: string;
  dimmed?: boolean;
}) {
  const { user, store } = useApp();
  const { toast } = useToast();
  const server = useServer(serverId);
  const status = usePresenceOf(member.user.id);
  const activity = useActivityOf(member.user.id);

  const [working, setWorking] = React.useState(false);

  const isSelf = member.user.id === user.id;
  const viewerRole = server?.viewerRole ?? 'MEMBER';

  // Só o dono mexe em papéis; admins removem apenas membros comuns.
  const canChangeRole = viewerRole === 'OWNER' && member.role !== 'OWNER';
  const canRemove =
    !isSelf &&
    member.role !== 'OWNER' &&
    (viewerRole === 'OWNER' || (viewerRole === 'ADMIN' && member.role === 'MEMBER'));

  async function run(action: () => Promise<void>, failureTitle: string) {
    setWorking(true);
    try {
      await action();
    } catch (error) {
      toast({
        title: failureTitle,
        description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setWorking(false);
    }
  }

  const row = (
    <div
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        dimmed && 'opacity-45',
      )}
    >
      <Avatar
        name={member.user.displayName}
        color={member.user.avatarColor}
        size="md"
        status={status}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-sm font-medium text-content">
            {member.nickname ?? member.user.displayName}
          </span>
          <RoleBadge role={member.role} />
        </span>

        {/* Atividade tem prioridade sobre o status: é a informação mais rica. */}
        <span className="block truncate text-[11px] text-subtle">
          {activity ?? PRESENCE_LABELS[status]}
        </span>
      </span>
    </div>
  );

  if (!canChangeRole && !canRemove) {
    return <li className="hover:bg-elevated/60">{row}</li>;
  }

  return (
    <li>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={working}>
          <button
            type="button"
            className="w-full rounded-md hover:bg-elevated/60"
            aria-label={`Opções de ${member.user.displayName}`}
          >
            {row}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {member.user.displayName} · {ROLE_LABELS[member.role]}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {canChangeRole ? (
            <DropdownMenuItem
              onSelect={() =>
                void run(async () => {
                  const nextRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
                  const result = await api.servers.updateMember(serverId, member.user.id, {
                    role: nextRole,
                  });
                  store.applyEvent({ t: 'member:update', serverId, member: result.member });
                }, 'Não foi possível alterar o papel')
              }
            >
              {member.role === 'ADMIN' ? <ShieldMinus aria-hidden /> : <ShieldPlus aria-hidden />}
              {member.role === 'ADMIN' ? 'Rebaixar a membro' : 'Promover a administrador'}
            </DropdownMenuItem>
          ) : null}

          {canRemove ? (
            <DropdownMenuItem
              destructive
              onSelect={() =>
                void run(async () => {
                  await api.servers.removeMember(serverId, member.user.id);
                  store.applyEvent({ t: 'member:leave', serverId, userId: member.user.id });
                }, 'Não foi possível remover o membro')
              }
            >
              <UserMinus aria-hidden />
              Remover do servidor
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
