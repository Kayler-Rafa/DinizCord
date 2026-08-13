'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Exibe uma MediaStream de vídeo.
 *
 * `srcObject` é atribuído por efeito porque não existe como passá-lo por atributo
 * JSX — o React só escreve atributos de string, e a stream é um objeto vivo.
 */
export function VideoSurface({
  stream,
  muted,
  label,
}: {
  stream: MediaStream;
  muted: boolean;
  label: string;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setReady(false);
    element.srcObject = stream;

    // Autoplay com som pode ser barrado; o vídeo em si toca por ser `muted`
    // ou por ter havido gesto do usuário ao entrar na chamada.
    void element.play().catch(() => undefined);

    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      {!ready ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-subtle">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <span className="text-xs">Recebendo transmissão…</span>
        </div>
      ) : null}

      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        onLoadedMetadata={() => setReady(true)}
        aria-label={label}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
