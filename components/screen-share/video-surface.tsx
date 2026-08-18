'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Exibe uma MediaStream de vídeo.
 *
 * `srcObject` é atribuído por efeito porque não existe como passá-lo por atributo
 * JSX — o React só escreve atributos de string, e a stream é um objeto vivo.
 *
 * O elemento é SEMPRE mudo. O áudio da transmissão sai pelo `AudioOutput`, que
 * o faz atravessar um `GainNode` para permitir volume acima de 100% e para que
 * o botão de ensurdecer também o alcance. Deixar o `<video>` com som tocaria a
 * mesma fonte duas vezes.
 */
export function VideoSurface({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setReady(false);
    element.srcObject = stream;

    // Sendo mudo, o autoplay nunca esbarra na política do navegador.
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
        muted
        onLoadedMetadata={() => setReady(true)}
        aria-label={label}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
