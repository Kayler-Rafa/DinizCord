'use client';

import * as React from 'react';
import { Loader2, MicOff, MonitorUp, MoreVertical, Pencil, Trash2, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RenameChannelDialog } from '@/components/channels/rename-channel-dialog';
import { DeleteChannelDialog } from '@/components/channels/delete-channel-dialog';
import { useVoiceChannel } from '@/hooks/useVoiceChannel';
import { useVoice, LOCAL_SPEAKER_ID } from '@/components/providers/voice-provider';
import { useApp } from '@/components/providers/app-provider';
import type { ChannelDTO, VoiceParticipantDTO } from '@/lib/types';

/**
 * Canal de voz na barra lateral, com os participantes listados abaixo.
 *
 * Mostrar quem está na sala sem precisar entrar é o que faz alguém decidir
 * entrar — é a informação mais útil da lista.
 */
export function VoiceChannelItem({
  channel,
  canManage,
}: {
  channel: ChannelDTO;
  canManage: boolean;
}) {
  const { participants, isConnected, connecting, join } = useVoiceChannel(channel.id);
  const [renaming, setRenaming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <>
      <div className="group flex items-center">
        <button
          type="button"
          onClick={() => void join()}
          disabled={connecting}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
            isConnected
              ? 'bg-elevated text-content'
              : 'text-muted hover:bg-elevated hover:text-content',
            connecting && 'opacity-60',
          )}
          aria-label={`Entrar no canal de voz ${channel.name}`}
        >
          {connecting ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-subtle" aria-hidden />
          ) : (
            <Volume2 className="size-4 shrink-0 text-subtle" aria-hidden />
          )}
          <span className="truncate">{channel.name}</span>

          {participants.length > 0 ? (
            <span className="ml-auto shrink-0 text-xs text-subtle">{participants.length}</span>
          ) : null}
        </button>

        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
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

      {participants.length > 0 ? (
        <ul className="mb-1 ml-4 space-y-0.5 border-l border-line pl-2">
          {participants.map((participant) => (
            <VoiceParticipant key={participant.sessionId} participant={participant} />
          ))}
        </ul>
      ) : null}

      {renaming ? (
        <RenameChannelDialog channel={channel} open onOpenChange={(open) => !open && setRenaming(false)} />
      ) : null}
      {deleting ? (
        <DeleteChannelDialog channel={channel} open onOpenChange={(open) => !open && setDeleting(false)} />
      ) : null}
    </>
  );
}

function VoiceParticipant({ participant }: { participant: VoiceParticipantDTO }) {
  const { speaking } = useVoice();
  const { user } = useApp();

  const isSelf = participant.user.id === user.id;
  // O próprio usuário aparece no detector como 'local'; os demais pelo id da sessão.
  const isSpeaking =
    !participant.selfMute &&
    speaking.has(isSelf ? LOCAL_SPEAKER_ID : participant.sessionId);

  return (
    <li className="flex items-center gap-1.5 rounded px-1 py-1">
      <Avatar
        name={participant.user.displayName}
        color={participant.user.avatarColor}
        size="sm"
        speaking={isSpeaking}
      />

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs transition-colors',
          isSpeaking ? 'text-content' : 'text-muted',
        )}
      >
        {participant.user.displayName}
      </span>

      <span className="flex shrink-0 items-center gap-1 text-subtle">
        {participant.screenSharing ? (
          <Tooltip content="Compartilhando a tela">
            <MonitorUp className="size-3 text-success" aria-label="Compartilhando a tela" />
          </Tooltip>
        ) : null}
        {participant.selfDeaf ? (
          <Tooltip content="Ensurdecido">
            <VolumeX className="size-3 text-danger" aria-label="Ensurdecido" />
          </Tooltip>
        ) : participant.selfMute ? (
          <Tooltip content="Microfone desligado">
            <MicOff className="size-3 text-danger" aria-label="Microfone desligado" />
          </Tooltip>
        ) : null}
      </span>
    </li>
  );
}
