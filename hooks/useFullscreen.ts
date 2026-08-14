'use client';

import * as React from 'react';
import { useBrowserCapability } from './useBrowserCapability';

/**
 * Tela cheia de verdade, via Fullscreen API do navegador.
 *
 * Diferente de só esticar o elemento com CSS: o navegador esconde as próprias
 * barras, o vídeo ganha a tela inteira e o Esc funciona como o usuário espera.
 *
 * O estado é lido do `document` através de `useSyncExternalStore`, e não
 * guardado por conta própria, porque a saída pode acontecer sem passar por
 * aqui — Esc, F11, ou o botão que o próprio navegador desenha.
 */
export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [recusado, setRecusado] = React.useState(false);

  const assinar = React.useCallback((aoMudar: () => void) => {
    document.addEventListener('fullscreenchange', aoMudar);
    return () => document.removeEventListener('fullscreenchange', aoMudar);
  }, []);

  const ativo = React.useSyncExternalStore(
    assinar,
    () => document.fullscreenElement !== null && document.fullscreenElement === ref.current,
    () => false,
  );

  const disponivel = useBrowserCapability(
    () => typeof document !== 'undefined' && document.fullscreenEnabled,
    // No servidor assumimos disponível: o botão nasce visível e some na
    // hidratação se o navegador não suportar, em vez de aparecer piscando.
    true,
  );

  const alternar = React.useCallback(async () => {
    const elemento = ref.current;
    if (!elemento) return;

    try {
      if (document.fullscreenElement === elemento) {
        await document.exitFullscreen();
      } else {
        // `navigationUI: 'hide'` pede ao navegador para não deixar barras por
        // cima do vídeo; quem não suporta simplesmente ignora.
        await elemento.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      // Alguns navegadores recusam sem gesto do usuário, ou dentro de iframe
      // sem `allowfullscreen`. Esconder o botão evita oferecer o que não
      // funciona.
      setRecusado(true);
    }
  }, [ref]);

  return { ativo, suportado: disponivel && !recusado, alternar };
}
