'use client';

import * as React from 'react';
import { useVoice } from '@/components/providers/voice-provider';
import { useBrowserCapability } from './useBrowserCapability';

/**
 * Compartilhamento de tela do usuário atual.
 *
 * O seletor de tela/janela/aba é do próprio navegador — `getDisplayMedia` abre o
 * diálogo nativo, que é o único lugar onde essa escolha pode acontecer. A
 * aplicação só decide quando pedir e o que fazer com o resultado.
 */
export function useScreenShare() {
  const { sharingScreen, localScreenStream, startScreenShare, stopScreenShare, channelId } = useVoice();

  const supported = useBrowserCapability(
    () =>
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    // No servidor assumimos suportado: o botão nasce habilitado e só desabilita
    // se a hidratação revelar um navegador sem a API — evita piscar o contrário.
    true,
  );

  const toggle = React.useCallback(async () => {
    if (sharingScreen) stopScreenShare();
    else await startScreenShare();
  }, [sharingScreen, startScreenShare, stopScreenShare]);

  return {
    /** Compartilhar exige estar em uma chamada: as tracks vão pelas conexões dela. */
    available: supported && channelId !== null,
    supported,
    sharing: sharingScreen,
    stream: localScreenStream,
    start: startScreenShare,
    stop: stopScreenShare,
    toggle,
  };
}
