'use client';

import * as React from 'react';
import Link from 'next/link';
import { Hash, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUnreadCount } from '@/hooks/useStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RenameChannelDialog } from './rename-channel-dialog';
import { DeleteChannelDialog } from './delete-channel-dialog';
import type { ChannelDTO } from '@/lib/types';

export function TextChannelItem({
  channel,
  active,
  canManage,
}: {
  channel: ChannelDTO;
  active: boolean;
  canManage: boolean;
}) {
  const unread = useUnreadCount(channel.id);
  const [renaming, setRenaming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <>
      <div className="group relative flex items-center">
        {/* Barra à esquerda: sinaliza não lidas sem depender do contador. */}
        {unread > 0 && !active ? (
          <span
            className="absolute -left-1 h-2 w-1 rounded-r-full bg-content"
            aria-hidden
          />
        ) : null}

        <Link
          href={`/app/c/${channel.id}`}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
            active
              ? 'bg-elevated text-content'
              : unread > 0
                ? 'font-medium text-content hover:bg-elevated'
                : 'text-muted hover:bg-elevated hover:text-content',
          )}
        >
          <Hash className="size-4 shrink-0 text-subtle" aria-hidden />
          <span className="truncate">{channel.name}</span>

          {unread > 0 ? (
            <span
              className="ml-auto shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
              aria-label={`${unread} ${unread === 1 ? 'mensagem não lida' : 'mensagens não lidas'}`}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Link>

        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                // Some no desktop até o hover, mas continua alcançável por teclado.
                className="ml-0.5 rounded p-1 text-subtle opacity-0 transition-opacity hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Opções do canal ${channel.name}`}
              >
                <MoreVertical className="size-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil aria-hidden />
                Renomear canal
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                <Trash2 aria-hidden />
                Excluir canal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {renaming ? (
        <RenameChannelDialog channel={channel} open onOpenChange={(open) => !open && setRenaming(false)} />
      ) : null}

      {deleting ? (
        <DeleteChannelDialog channel={channel} open onOpenChange={(open) => !open && setDeleting(false)} />
      ) : null}
    </>
  );
}
