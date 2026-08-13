'use client';

import * as React from 'react';
import { useVoice } from '@/components/providers/voice-provider';
import { useStoreSelector } from './useStore';
import type { VoiceParticipantDTO } from '@/lib/types';

/**
 * Estado de um canal de voz específico.
 *
 * Combina a lista de participantes (que vem do servidor, via store) com o
 * estado local da chamada (mudo, falando, compartilhando). Componentes de canal
 * usam este hook; a barra de controle usa `useVoice` direto.
 */
export function useVoiceChannel(channelId: string) {
  const voice = useVoice();
  const participantsById = useStoreSelector((state) => state.voice);

  const participants = React.useMemo(
    () =>
      Object.values(participantsById)
        .filter((participant: VoiceParticipantDTO) => participant.channelId === channelId)
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    [participantsById, channelId],
  );

  const isConnected = voice.channelId === channelId;

  const join = React.useCallback(() => voice.join(channelId), [voice, channelId]);

  return {
    participants,
    isConnected,
    connecting: voice.connecting && !isConnected,
    join,
    leave: voice.leave,
    /** Quem está transmitindo a tela neste canal. */
    broadcasters: participants.filter((participant) => participant.screenSharing),
  };
}
