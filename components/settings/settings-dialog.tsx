'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProfileSettings } from './profile-settings';
import { PasswordSettings } from './password-settings';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useTheme } from '@/hooks/useTheme';
import { useVoice } from '@/components/providers/voice-provider';
import { useStoreSelector } from '@/hooks/useStore';

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Perfil, aparência e segurança da conta.</DialogDescription>
        </DialogHeader>

        <Tabs.Root defaultValue="perfil">
          <Tabs.List className="mb-4 flex gap-1 border-b border-line" aria-label="Seções">
            <TabTrigger value="perfil">Perfil</TabTrigger>
            <TabTrigger value="aparencia">Aparência</TabTrigger>
            <TabTrigger value="voz">Voz</TabTrigger>
            <TabTrigger value="seguranca">Segurança</TabTrigger>
          </Tabs.List>

          <Tabs.Content value="perfil" className="focus-visible:outline-none">
            <ProfileSettings onDone={() => onOpenChange(false)} />
          </Tabs.Content>

          <Tabs.Content value="aparencia" className="focus-visible:outline-none">
            <AppearanceSettings />
          </Tabs.Content>

          <Tabs.Content value="voz" className="focus-visible:outline-none">
            <VoiceSettings />
          </Tabs.Content>

          <Tabs.Content value="seguranca" className="focus-visible:outline-none">
            <PasswordSettings />
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}

function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        'relative px-3 py-2 text-sm text-muted transition-colors',
        'hover:text-content data-[state=active]:text-content',
        'data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px',
        'data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent',
      )}
    >
      {children}
    </Tabs.Trigger>
  );
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        O tema escuro é o padrão. O claro fica disponível para quem preferir.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { value: 'dark' as const, label: 'Escuro', Icon: Moon },
            { value: 'light' as const, label: 'Claro', Icon: Sun },
          ]
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-pressed={theme === option.value}
            className={cn(
              'flex items-center gap-2 rounded-[var(--radius-app)] border px-4 py-3 text-sm transition-colors',
              theme === option.value
                ? 'border-accent bg-accent-soft text-content'
                : 'border-line bg-elevated text-muted hover:text-content',
            )}
          >
            <option.Icon className="size-4" aria-hidden />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Diagnóstico da conexão de voz.
 *
 * Sem TURN, quem estiver atrás de NAT simétrico (comum em redes móveis e
 * corporativas) simplesmente não consegue estabelecer P2P. Avisar aqui evita
 * o suporte "o áudio não funciona e não sei por quê".
 */
function VoiceSettings() {
  const { turnMissing, inCall, peers } = useWebRTC();
  const { channelId, sharingScreen } = useVoice();

  // Quem o SERVIDOR diz que está transmitindo, que é independente da mídia ter
  // chegado ou não. Comparar as duas coisas é o que separa os diagnósticos:
  // sinalizado mas sem faixa de vídeo = problema de mídia/renegociação;
  // nem sinalizado = a captura de tela do outro lado nunca começou.
  const transmitindoSegundoServidor = useStoreSelector((state) =>
    Object.values(state.voice).filter(
      (participante) => participante.channelId === channelId && participante.screenSharing,
    ).length,
  );

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="mb-1 font-medium text-content">Como o áudio trafega</h3>
        <p className="text-muted">
          As chamadas são ponto a ponto (WebRTC): o áudio e a tela vão direto de um participante ao
          outro, sem passar pelo servidor. O servidor só intermedia a negociação inicial.
        </p>
      </div>

      <div>
        <h3 className="mb-1 font-medium text-content">Servidor TURN</h3>
        {turnMissing ? (
          <p className="rounded-[var(--radius-app)] border border-warning/40 bg-warning/10 p-3 text-warning">
            Nenhum servidor TURN configurado. Em algumas redes (4G, Wi-Fi corporativo) a conexão
            direta não é possível e a chamada pode não completar. Configure <code>TURN_SERVER_URL</code>{' '}
            no servidor para cobrir esses casos.
          </p>
        ) : (
          <p className="text-muted">Configurado. Redes restritivas usam o TURN como alternativa.</p>
        )}
      </div>

      {inCall ? (
        <div>
          <h3 className="mb-1 font-medium text-content">Compartilhamento de tela</h3>
          <ul className="mb-4 space-y-0.5 text-muted">
            <li>Você está transmitindo: {sharingScreen ? 'sim' : 'não'}</li>
            <li>Transmitindo nesta sala (segundo o servidor): {transmitindoSegundoServidor}</li>
            <li>
              Transmissões recebidas de fato: {peers.filter((peer) => peer.screen).length}
            </li>
          </ul>

          <h3 className="mb-1 font-medium text-content">Conexões ativas</h3>
          <p className="mb-2 text-xs text-subtle">
            O estado muda sozinho ao longo da chamada. &ldquo;Iniciando&rdquo; logo depois de
            entrar é normal; o que importa é o valor depois de alguns segundos.
          </p>
          {peers.length === 0 ? (
            <p className="text-muted">Você é a única pessoa na sala.</p>
          ) : (
            /*
             * Diagnóstico por participante.
             *
             * Numa chamada P2P, "não estou ouvindo/vendo" pode ser cinco coisas
             * diferentes. Mostrar se a conexão fechou e quais mídias chegaram
             * separa o problema em um olhar: sem conexão é rede (provável falta
             * de TURN); conectado e sem tela é signaling.
             */
            <ul className="space-y-2">
              {peers.map((peer) => (
                <li
                  key={peer.peerId}
                  className="rounded-[var(--radius-app)] border border-line bg-elevated px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-muted">
                      {peer.peerId.slice(0, 8)}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        peer.connectionState === 'connected' ? 'text-success' : 'text-warning',
                      )}
                    >
                      {translateConnectionState(peer.connectionState)}
                    </span>
                  </div>

                  <div className="mt-1.5 flex gap-3 text-[11px]">
                    <span className={peer.audio ? 'text-success' : 'text-subtle'}>
                      {peer.audio ? '✓' : '—'} áudio
                    </span>
                    <span className={peer.screen ? 'text-success' : 'text-subtle'}>
                      {peer.screen ? '✓' : '—'} tela
                      {peer.screen
                        ? ` (${peer.screen.getVideoTracks().length} faixa${peer.screen.getVideoTracks().length === 1 ? '' : 's'})`
                        : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function translateConnectionState(state: RTCPeerConnectionState): string {
  switch (state) {
    case 'connected':
      return 'conectado';
    case 'connecting':
      return 'conectando';
    case 'disconnected':
      return 'instável';
    case 'failed':
      return 'falhou';
    case 'closed':
      return 'encerrado';
    default:
      return 'iniciando';
  }
}
