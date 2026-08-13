'use client';

import * as React from 'react';
import {
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings,
  Signal,
  SignalHigh,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PresenceDot } from '@/components/ui/presence-dot';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { useAuth } from '@/hooks/useAuth';
import { usePresence } from '@/hooks/usePresence';
import { useVoice, LOCAL_SPEAKER_ID } from '@/components/providers/voice-provider';
import { useScreenShare } from '@/hooks/useScreenShare';
import { useChannel } from '@/hooks/useStore';
import { PRESENCE_LABELS, SELECTABLE_STATUSES } from '@/lib/types';

/**
 * Painel do usuário no rodapé da barra lateral.
 *
 * Concentra o que precisa estar sempre a um clique: identidade, status,
 * microfone, fones, compartilhamento de tela e configurações.
 */
export function UserPanel() {
  const { user, logout, loggingOut } = useAuth();
  const { status, setStatus, activity } = usePresence();
  const voice = useVoice();
  const screenShare = useScreenShare();
  const voiceChannel = useChannel(voice.channelId);

  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const speaking = voice.speaking.has(LOCAL_SPEAKER_ID) && !voice.muted;

  return (
    <div className="mt-auto shrink-0 border-t border-line">
      {voice.channelId ? (
        <div className="flex items-center gap-2 border-b border-line bg-elevated/60 px-2 py-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {voice.remotePeers.some((peer) => peer.connectionState === 'connected') ||
            voice.remotePeers.length === 0 ? (
              <SignalHigh className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Signal className="size-4 shrink-0 animate-pulse text-warning" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-success">Voz conectada</span>
              <span className="block truncate text-[11px] text-muted">{voiceChannel?.name}</span>
            </span>
          </span>

          <Tooltip content="Sair do canal de voz">
            <button
              type="button"
              onClick={voice.leave}
              className="rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
              aria-label="Sair do canal de voz"
            >
              <PhoneOff className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : null}

      <div className="flex items-center gap-1 px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-elevated"
              aria-label="Menu do usuário"
            >
              <Avatar
                name={user.displayName}
                color={user.avatarColor}
                size="md"
                status={status}
                speaking={speaking}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-content">
                  {user.displayName}
                </span>
                <span className="block truncate text-[11px] text-subtle">
                  {activity ?? `@${user.username}`}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {SELECTABLE_STATUSES.map((option) => (
              <DropdownMenuItem key={option} onSelect={() => setStatus(option)}>
                <PresenceDot status={option} />
                {PRESENCE_LABELS[option]}
                {status === option ? <span className="ml-auto text-xs text-subtle">atual</span> : null}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings aria-hidden />
              Configurações
            </DropdownMenuItem>

            <DropdownMenuItem destructive disabled={loggingOut} onSelect={() => void logout()}>
              <LogOut aria-hidden />
              Sair da conta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex shrink-0 items-center">
          <ControlButton
            label={voice.muted ? 'Ligar microfone' : 'Desligar microfone'}
            active={voice.muted}
            disabled={!voice.channelId}
            onClick={voice.toggleMute}
            Icon={voice.muted ? MicOff : Mic}
          />

          <ControlButton
            label={voice.deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            active={voice.deafened}
            disabled={!voice.channelId}
            onClick={voice.toggleDeafen}
            Icon={voice.deafened ? HeadphoneOff : Headphones}
          />

          <ControlButton
            label={
              !screenShare.supported
                ? 'Seu navegador não suporta compartilhamento de tela'
                : !screenShare.available
                  ? 'Entre em um canal de voz para compartilhar'
                  : screenShare.sharing
                    ? 'Parar compartilhamento'
                    : 'Compartilhar tela'
            }
            active={screenShare.sharing}
            activeTone="success"
            disabled={!screenShare.available}
            onClick={() => void screenShare.toggle()}
            Icon={MonitorUp}
          />
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function ControlButton({
  label,
  active,
  activeTone = 'danger',
  disabled,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  activeTone?: 'danger' | 'success';
  disabled?: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Tooltip content={label}>
      {/* O span envolve o botão para que o tooltip apareça mesmo desabilitado —
          é justamente quando o usuário mais precisa saber o porquê. */}
      <span className="inline-flex">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'rounded-md p-2 transition-colors',
            disabled && 'cursor-not-allowed opacity-40',
            !disabled && !active && 'text-muted hover:bg-elevated hover:text-content',
            !disabled && active && activeTone === 'danger' && 'bg-danger-soft text-danger',
            !disabled && active && activeTone === 'success' && 'bg-success/15 text-success',
          )}
        >
          <Icon className="size-4" />
        </button>
      </span>
    </Tooltip>
  );
}
