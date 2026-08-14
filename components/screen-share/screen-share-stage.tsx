'use client';

import * as React from 'react';
import { Expand, Maximize2, Minimize2, MonitorUp, Shrink, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { useVoice } from '@/components/providers/voice-provider';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useStoreSelector } from '@/hooks/useStore';
import { useApp } from '@/components/providers/app-provider';
import { useFullscreen } from '@/hooks/useFullscreen';
import { VideoSurface } from './video-surface';

/**
 * Área de transmissões de tela.
 *
 * Fica acima do conteúdo do canal, e não em uma janela separada, para que dê
 * para assistir e conversar ao mesmo tempo — que é o uso real: alguém mostra o
 * jogo enquanto o resto comenta no chat.
 */
export function ScreenShareStage() {
  const { channelId, sharingScreen, stopScreenShare } = useVoice();
  const { screenStreams } = useWebRTC();
  const { user } = useApp();
  const participants = useStoreSelector((state) => state.voice);

  const [selectedPeerId, setSelectedPeerId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  const palcoRef = React.useRef<HTMLElement>(null);
  const {
    ativo: telaCheia,
    suportado: suportaTelaCheia,
    alternar: alternarTelaCheia,
  } = useFullscreen(palcoRef);

  if (!channelId || screenStreams.length === 0) return null;

  // A seleção é derivada, não sincronizada por efeito: se a transmissão
  // escolhida acabar (a pessoa parou de compartilhar ou saiu), a linha abaixo
  // já cai para a primeira disponível no mesmo render, sem passar por um quadro
  // de tela preta.
  const selected = screenStreams.find((item) => item.peerId === selectedPeerId) ?? screenStreams[0];
  if (!selected) return null;

  const nameOf = (peerId: string): string => {
    if (peerId === 'local') return `${user.displayName} (você)`;
    return participants[peerId]?.user.displayName ?? 'Participante';
  };

  return (
    <section
      ref={palcoRef}
      className={cn(
        'shrink-0 border-b border-line bg-black/40',
        // Em tela cheia o elemento ocupa a tela toda, então altura fixa daria
        // faixas pretas em cima e embaixo.
        telaCheia ? 'h-screen' : expanded ? 'h-[70vh]' : 'h-[38vh] min-h-[220px]',
      )}
      aria-label="Transmissões de tela"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line/60 bg-surface/80 px-3 py-1.5">
          <MonitorUp className="size-3.5 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-content">
            {nameOf(selected.peerId)} está transmitindo
          </span>

          {/* Seletor só aparece quando há mais de uma transmissão simultânea. */}
          {screenStreams.length > 1 ? (
            <div className="flex shrink-0 gap-1">
              {screenStreams.map((item) => (
                <button
                  key={item.peerId}
                  type="button"
                  onClick={() => setSelectedPeerId(item.peerId)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] transition-colors',
                    item.peerId === selected.peerId
                      ? 'bg-accent text-on-accent'
                      : 'bg-elevated text-muted hover:text-content',
                  )}
                >
                  {nameOf(item.peerId)}
                </button>
              ))}
            </div>
          ) : null}

          {/* Ampliar continua útil: dá mais espaço sem esconder o chat. */}
          {!telaCheia ? (
            <Tooltip content={expanded ? 'Reduzir' : 'Ampliar'}>
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="rounded p-1 text-subtle transition-colors hover:text-content"
                aria-label={expanded ? 'Reduzir transmissão' : 'Ampliar transmissão'}
              >
                {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </Tooltip>
          ) : null}

          {suportaTelaCheia ? (
            <Tooltip content={telaCheia ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}>
              <button
                type="button"
                onClick={() => void alternarTelaCheia()}
                className="rounded p-1 text-subtle transition-colors hover:text-content"
                aria-label={telaCheia ? 'Sair da tela cheia' : 'Ver em tela cheia'}
                aria-pressed={telaCheia}
              >
                {telaCheia ? (
                  <Shrink className="size-3.5" />
                ) : (
                  <Expand className="size-3.5" />
                )}
              </button>
            </Tooltip>
          ) : null}

          {sharingScreen ? (
            <Tooltip content="Parar de compartilhar">
              <button
                type="button"
                onClick={stopScreenShare}
                className="rounded p-1 text-danger transition-colors hover:bg-danger-soft"
                aria-label="Parar de compartilhar a tela"
              >
                <X className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>

        <div className="min-h-0 flex-1">
          <VideoSurface
            stream={selected.stream}
            // A própria transmissão vai muda: o som já sai pelas caixas do
            // próprio computador, e reproduzi-lo de novo causaria eco.
            muted={selected.local}
            label={`Transmissão de ${nameOf(selected.peerId)}`}
          />
        </div>
      </div>
    </section>
  );
}
