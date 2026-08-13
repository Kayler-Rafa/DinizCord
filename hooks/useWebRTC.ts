'use client';

import * as React from 'react';
import { useVoice } from '@/components/providers/voice-provider';
import type { RemotePeerMedia } from '@/lib/webrtc/voice-engine';

/**
 * Acesso às conexões P2P da chamada em andamento.
 *
 * Exposto separadamente de `useVoiceChannel` para os componentes que precisam
 * das MediaStreams em si (o visualizador de tela) ou do diagnóstico da conexão,
 * sem carregar o resto do estado da sala.
 */
export function useWebRTC() {
  const { remotePeers, localScreenStream, turnMissing, channelId } = useVoice();

  const streamOf = React.useCallback(
    (peerId: string): RemotePeerMedia | null =>
      remotePeers.find((peer) => peer.peerId === peerId) ?? null,
    [remotePeers],
  );

  /** Transmissões de tela disponíveis para assistir, incluindo a própria. */
  const screenStreams = React.useMemo(() => {
    const streams = remotePeers
      .filter((peer) => peer.screen !== null)
      .map((peer) => ({ peerId: peer.peerId, stream: peer.screen!, local: false }));

    if (localScreenStream) {
      streams.unshift({ peerId: 'local', stream: localScreenStream, local: true });
    }

    return streams;
  }, [remotePeers, localScreenStream]);

  /** true quando algum par está com problema de conectividade. */
  const hasFailedPeer = remotePeers.some(
    (peer) => peer.connectionState === 'failed' || peer.connectionState === 'disconnected',
  );

  return {
    inCall: channelId !== null,
    peers: remotePeers,
    streamOf,
    screenStreams,
    hasFailedPeer,
    turnMissing,
  };
}
