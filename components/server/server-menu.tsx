'use client';

import * as React from 'react';
import { ChevronDown, LogOut, Settings2, UserPlus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InviteDialog } from './invite-dialog';
import { ServerSettingsDialog } from './server-settings-dialog';
import { LeaveServerDialog } from './leave-server-dialog';
import type { ServerDTO } from '@/lib/types';

/** Cabeçalho do servidor, com as ações administrativas. */
export function ServerMenu({ server }: { server: ServerDTO }) {
  const [dialog, setDialog] = React.useState<'invite' | 'settings' | 'leave' | null>(null);

  const canManage = server.viewerRole === 'OWNER' || server.viewerRole === 'ADMIN';
  const isOwner = server.viewerRole === 'OWNER';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full shrink-0 items-center gap-2 border-b border-line px-4 py-3 text-left transition-colors hover:bg-elevated"
            aria-label={`Menu do servidor ${server.name}`}
          >
            <span className="text-base" aria-hidden>
              {server.iconEmoji}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-content">
              {server.name}
            </span>
            <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {canManage ? (
            <DropdownMenuItem onSelect={() => setDialog('invite')}>
              <UserPlus aria-hidden />
              Convidar pessoas
            </DropdownMenuItem>
          ) : null}

          {canManage ? (
            <DropdownMenuItem onSelect={() => setDialog('settings')}>
              <Settings2 aria-hidden />
              Configurações do servidor
            </DropdownMenuItem>
          ) : null}

          {/* O dono não pode sair: o servidor ficaria sem responsável. */}
          {!isOwner ? (
            <>
              {canManage ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem destructive onSelect={() => setDialog('leave')}>
                <LogOut aria-hidden />
                Sair do servidor
              </DropdownMenuItem>
            </>
          ) : null}

          {!canManage && isOwner ? null : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'invite' ? (
        <InviteDialog serverId={server.id} open onOpenChange={() => setDialog(null)} />
      ) : null}

      {dialog === 'settings' ? (
        <ServerSettingsDialog server={server} open onOpenChange={() => setDialog(null)} />
      ) : null}

      {dialog === 'leave' ? (
        <LeaveServerDialog server={server} open onOpenChange={() => setDialog(null)} />
      ) : null}
    </>
  );
}
