'use client';

import * as React from 'react';
import { useApp } from './app-provider';
import { api } from '@/lib/client/api';
import { useToast } from '@/components/ui/toast';
import { useStoreSelector } from '@/hooks/useStore';
import { useLatestRef } from '@/hooks/useLatestRef';
import {
  LOCAL_SPEAKER_ID,
  MediaAccessError,
  VoiceEngine,
  type RemotePeerMedia,
} from '@/lib/webrtc/voice-engine';
import { clientEnv } from '@/lib/env.client';
import type { VoiceParticipantDTO } from '@/lib/types';

/**
 * Estado da chamada de voz.
 *
 * Fica em um provider (e não em um hook por componente) porque a chamada é
 * única para toda a aplicação: o usuário continua na sala enquanto navega entre
 * canais de texto, e a barra inferior, o painel do canal e o visualizador de
 * tela precisam ver o mesmo estado.
 */

interface VoiceContextValue {
  /** Canal de voz atual, ou null quando fora da chamada. */
  channelId: string | null;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  sharingScreen: boolean;
  /** Ids de sessão de quem está falando (inclui 'local' para o próprio usuário). */
  speaking: ReadonlySet<string>;
  remotePeers: RemotePeerMedia[];
  localScreenStream: MediaStream | null;
  /** true quando não há TURN configurado — algumas redes não fecham P2P. */
  turnMissing: boolean;

  join: (channelId: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
}

const VoiceContext = React.createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { send, onSignal, store } = useApp();
  const { toast } = useToast();

  const sessionId = useStoreSelector((state) => state.sessionId);

  const [channelId, setChannelId] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [deafened, setDeafened] = React.useState(false);
  const [sharingScreen, setSharingScreen] = React.useState(false);
  const [speaking, setSpeaking] = React.useState<ReadonlySet<string>>(new Set());
  const [remotePeers, setRemotePeers] = React.useState<RemotePeerMedia[]>([]);
  const [localScreenStream, setLocalScreenStream] = React.useState<MediaStream | null>(null);
  const [turnMissing, setTurnMissing] = React.useState(false);

  const engineRef = React.useRef<VoiceEngine | null>(null);

  // `join` e `leave` precisam do canal atual sem serem recriados a cada troca —
  // eles são passados adiante pelo contexto e uma nova identidade re-renderizaria
  // toda a árvore de voz.
  const channelIdRef = useLatestRef(channelId);

  // Participantes do canal atual, direto do store — é a lista que o servidor
  // mantém, e não uma cópia local que poderia divergir.
  const participants = useStoreSelector((state) => state.voice);

  const peerIds = React.useMemo(() => {
    if (!channelId) return [] as string[];
    return Object.values(participants)
      .filter((participant: VoiceParticipantDTO) => participant.channelId === channelId)
      .map((participant) => participant.sessionId)
      .sort();
  }, [participants, channelId]);

  const peerKey = peerIds.join(',');

  /** Sincroniza o mesh sempre que a lista de participantes muda. */
  React.useEffect(() => {
    engineRef.current?.setPeers(peerIds);
    // `peerKey` é a identidade estável da lista; `peerIds` muda de referência a
    // cada render do store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerKey]);

  /** Encaminha os sinais WebRTC recebidos para o motor. */
  React.useEffect(() => {
    return onSignal(({ from, signal }) => {
      engineRef.current?.handleSignal(from, signal);
    });
  }, [onSignal]);

  const teardown = React.useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;

    setChannelId(null);
    setSharingScreen(false);
    setLocalScreenStream(null);
    setRemotePeers([]);
    setSpeaking(new Set());
    setMuted(false);
    setDeafened(false);
  }, []);

  const join = React.useCallback(
    async (targetChannelId: string) => {
      if (!sessionId) {
        toast({
          title: 'Ainda conectando',
          description: 'Aguarde a conexão com o servidor para entrar na chamada.',
          variant: 'error',
        });
        return;
      }

      if (channelIdRef.current === targetChannelId) return;

      setConnecting(true);

      // Sai da sala anterior antes de entrar na nova.
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }

      try {
        // O TURN é entregue pelo servidor a cada entrada: assim uma troca de
        // credencial vale na próxima chamada, sem rebuild do frontend.
        const iceConfig = await api.webrtc.iceConfig().catch(() => ({
          iceServers: [{ urls: clientEnv.stunServer }] as RTCIceServer[],
          hasTurn: false,
        }));

        setTurnMissing(!iceConfig.hasTurn);

        const engine = new VoiceEngine(sessionId, iceConfig.iceServers, (to, signal) => {
          send({ t: 'webrtc:signal', to, signal });
        }, {
          onMediaChange: setRemotePeers,
          onSpeakingChange: setSpeaking,
          onLocalScreenEnded: () => {
            setSharingScreen(false);
            setLocalScreenStream(null);
            send({ t: 'voice:state', screenSharing: false });
          },
          onError: (message) => toast({ title: 'Problema na chamada', description: message, variant: 'error' }),
        });

        engineRef.current = engine;

        await engine.startMicrophone();

        // Só entra na sala depois que o microfone abriu: entrar e aparecer mudo
        // por falta de permissão seria confuso para quem já está lá.
        send({ t: 'voice:join', channelId: targetChannelId });
        setChannelId(targetChannelId);

        // Conecta a quem já estava na sala.
        const current = Object.values(store.getSnapshot().voice)
          .filter((participant) => participant.channelId === targetChannelId)
          .map((participant) => participant.sessionId);
        engine.setPeers(current);
      } catch (error) {
        engineRef.current?.dispose();
        engineRef.current = null;

        toast({
          title: 'Não foi possível entrar no canal de voz',
          description:
            error instanceof MediaAccessError ? error.message : 'Verifique o microfone e tente novamente.',
          variant: 'error',
        });
      } finally {
        setConnecting(false);
      }
    },
    [sessionId, send, store, toast, channelIdRef],
  );

  const leave = React.useCallback(() => {
    if (!channelIdRef.current) return;
    send({ t: 'voice:leave' });
    teardown();
  }, [send, teardown, channelIdRef]);

  const toggleMute = React.useCallback(() => {
    setMuted((current) => {
      const next = !current;
      engineRef.current?.setMuted(next);
      send({ t: 'voice:state', selfMute: next });
      return next;
    });
  }, [send]);

  const toggleDeafen = React.useCallback(() => {
    setDeafened((current) => {
      const next = !current;
      engineRef.current?.setDeafened(next);

      // Ensurdecer implica ficar mudo — é o comportamento esperado e evita
      // falar sozinho sem ouvir a resposta.
      if (next) {
        setMuted(true);
        engineRef.current?.setMuted(true);
        send({ t: 'voice:state', selfDeaf: true, selfMute: true });
      } else {
        send({ t: 'voice:state', selfDeaf: false });
      }

      return next;
    });
  }, [send]);

  const startScreenShare = React.useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !channelIdRef.current) return;

    try {
      await engine.startScreenShare();
      setSharingScreen(true);
      setLocalScreenStream(engine.localScreenStream);
      send({ t: 'voice:state', screenSharing: true });
    } catch (error) {
      // Cancelar o seletor de tela não é um erro que mereça alarde.
      if (error instanceof MediaAccessError && error.cancelled) return;

      toast({
        title: 'Não foi possível compartilhar a tela',
        description:
          error instanceof MediaAccessError
            ? error.message
            : 'Verifique as permissões do navegador e tente novamente.',
        variant: 'error',
      });
    }
  }, [send, toast, channelIdRef]);

  const stopScreenShare = React.useCallback(() => {
    engineRef.current?.stopScreenShare();
    setSharingScreen(false);
    setLocalScreenStream(null);
    send({ t: 'voice:state', screenSharing: false });
  }, [send]);

  // Se a conexão com o gateway cair de vez, a chamada não tem como continuar:
  // sem signaling, novos participantes não conseguem entrar e o estado da sala
  // fica mentindo para o usuário.
  const connection = useStoreSelector((state) => state.connection);
  React.useEffect(() => {
    if (connection === 'offline' && channelIdRef.current) {
      teardown();
      toast({
        title: 'Chamada encerrada',
        description: 'A conexão com o servidor foi perdida. Entre novamente quando reconectar.',
        variant: 'error',
      });
    }
  }, [connection, teardown, toast, channelIdRef]);

  React.useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const value = React.useMemo<VoiceContextValue>(
    () => ({
      channelId,
      connecting,
      muted,
      deafened,
      sharingScreen,
      speaking,
      remotePeers,
      localScreenStream,
      turnMissing,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      startScreenShare,
      stopScreenShare,
    }),
    [
      channelId,
      connecting,
      muted,
      deafened,
      sharingScreen,
      speaking,
      remotePeers,
      localScreenStream,
      turnMissing,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      startScreenShare,
      stopScreenShare,
    ],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <RemoteAudio peers={remotePeers} deafened={deafened} />
    </VoiceContext.Provider>
  );
}

/**
 * Reprodução do áudio remoto.
 *
 * Um elemento `<audio>` por participante, fora da árvore visível. Precisa ser
 * um elemento de mídia real: um MediaStream só sai pelas caixas de som quando
 * está ligado a um `<audio>`/`<video>`.
 */
function RemoteAudio({ peers, deafened }: { peers: RemotePeerMedia[]; deafened: boolean }) {
  return (
    <div className="sr-only" aria-hidden>
      {peers.map((peer) =>
        peer.audio ? (
          <AudioSink key={peer.peerId} stream={peer.audio} muted={deafened} />
        ) : null,
      )}
    </div>
  );
}

function AudioSink({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = React.useRef<HTMLAudioElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (!element || element.srcObject === stream) return;

    element.srcObject = stream;
    // Autoplay pode ser bloqueado; o erro é silencioso porque entrar na chamada
    // já foi um gesto do usuário e o áudio destrava em seguida.
    void element.play().catch(() => undefined);
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline muted={muted} />;
}

export function useVoice(): VoiceContextValue {
  const context = React.useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice precisa estar dentro de <VoiceProvider>.');
  }
  return context;
}

export { LOCAL_SPEAKER_ID };
