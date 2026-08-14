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
import { AudioOutput, MAX_GAIN } from '@/lib/webrtc/audio-output';
import { destravarSons, tocarSom } from '@/lib/client/sounds';
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

  /** Volume de uma pessoa: 0 = mudo, 1 = normal, 2 = dobro. */
  getPeerVolume: (userId: string) => number;
  setPeerVolume: (userId: string, volume: number) => void;
}

const VoiceContext = React.createContext<VoiceContextValue | null>(null);

const CHAVE_VOLUMES = 'dinizcord-volumes';

function lerVolumes(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const bruto = window.localStorage.getItem(CHAVE_VOLUMES);
    if (!bruto) return {};

    const dados: unknown = JSON.parse(bruto);
    if (typeof dados !== 'object' || dados === null) return {};

    // Sanear na leitura: o localStorage é editável pelo usuário, e um valor
    // absurdo aqui viraria um estouro no ganho do WebAudio.
    const limpo: Record<string, number> = {};
    for (const [id, valor] of Object.entries(dados as Record<string, unknown>)) {
      if (typeof valor === 'number' && Number.isFinite(valor)) {
        limpo[id] = Math.min(MAX_GAIN, Math.max(0, valor));
      }
    }
    return limpo;
  } catch {
    return {};
  }
}

function gravarVolumes(volumes: Record<string, number>): void {
  try {
    window.localStorage.setItem(CHAVE_VOLUMES, JSON.stringify(volumes));
  } catch {
    // Modo privativo: vale para a sessão atual.
  }
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { send, onSignal, store, user } = useApp();
  const viewerId = user.id;
  const { toast } = useToast();

  const sessionId = useStoreSelector((state) => state.sessionId);

  const [channelId, setChannelId] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [deafened, setDeafened] = React.useState(false);
  const [sharingScreen, setSharingScreen] = React.useState(false);
  const [speaking, setSpeaking] = React.useState<ReadonlySet<string>>(new Set());
  const [remotePeers, setRemotePeers] = React.useState<RemotePeerMedia[]>([]);

  /**
   * Volume por PESSOA, não por conexão.
   *
   * A chave é o id do usuário porque o id da sessão muda a cada reconexão —
   * ajustar o volume de alguém e perdê-lo quando a pessoa cai da chamada seria
   * inútil. Fica no localStorage por ser preferência de dispositivo.
   */
  const [volumes, setVolumes] = React.useState<Record<string, number>>(() => lerVolumes());
  const audioOutputRef = React.useRef<AudioOutput | null>(null);
  const [localScreenStream, setLocalScreenStream] = React.useState<MediaStream | null>(null);
  const [turnMissing, setTurnMissing] = React.useState(false);

  const engineRef = React.useRef<VoiceEngine | null>(null);

  /**
   * Qual `sessionId` o motor em uso foi construído com.
   *
   * O id da conexão é o endereço do peer no mesh E a chave da sessão de voz no
   * servidor. Quando o WebSocket reconecta, o gateway atribui um id novo e
   * apaga a sessão antiga — quem estava na chamada sai dela do ponto de vista
   * do servidor. Guardar o id usado é o que permite detectar essa divergência.
   */
  const engineSessionIdRef = React.useRef<string | null>(null);

  // `join` e `leave` precisam do canal atual sem serem recriados a cada troca —
  // eles são passados adiante pelo contexto e uma nova identidade re-renderizaria
  // toda a árvore de voz.
  const channelIdRef = useLatestRef(channelId);
  const mutedRef = useLatestRef(muted);
  const deafenedRef = useLatestRef(deafened);
  const sharingScreenRef = useLatestRef(sharingScreen);

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
    engineSessionIdRef.current = null;

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

      // Já está nesta sala COM esta conexão: nada a fazer. A segunda condição
      // é o que permite refazer a entrada depois de uma reconexão, quando o
      // canal é o mesmo mas o id da conexão mudou.
      if (channelIdRef.current === targetChannelId && engineSessionIdRef.current === sessionId) {
        return;
      }

      // Entrar na chamada é o gesto do usuário que destrava o áudio; sem isto o
      // primeiro som seria engolido pela política de autoplay.
      destravarSons();

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
        engineSessionIdRef.current = sessionId;

        await engine.startMicrophone();

        // Numa reentrada após reconexão, o motor nasce sem saber que o usuário
        // estava mudo. Restaurar antes de anunciar a entrada evita o instante
        // em que ele volta com o microfone aberto sem ter pedido.
        if (mutedRef.current) engine.setMuted(true);
        if (deafenedRef.current) engine.setDeafened(true);

        // Só entra na sala depois que o microfone abriu: entrar e aparecer mudo
        // por falta de permissão seria confuso para quem já está lá.
        send({ t: 'voice:join', channelId: targetChannelId });
        if (mutedRef.current || deafenedRef.current) {
          send({ t: 'voice:state', selfMute: mutedRef.current, selfDeaf: deafenedRef.current });
        }
        setChannelId(targetChannelId);

        // Conecta a quem já estava na sala.
        const current = Object.values(store.getSnapshot().voice)
          .filter((participant) => participant.channelId === targetChannelId)
          .map((participant) => participant.sessionId);
        engine.setPeers(current);
      } catch (error) {
        engineRef.current?.dispose();
        engineRef.current = null;
        engineSessionIdRef.current = null;

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
    [sessionId, send, store, toast, channelIdRef, mutedRef, deafenedRef],
  );

  const leave = React.useCallback(() => {
    if (!channelIdRef.current) return;
    send({ t: 'voice:leave' });
    teardown();
  }, [send, teardown, channelIdRef]);

  /**
   * Reentra na chamada depois de uma reconexão do WebSocket.
   *
   * Sem isto, a queda é SILENCIOSA: o gateway apagou a sessão de voz ligada à
   * conexão antiga, então para todo mundo a pessoa saiu da sala — mas a tela
   * dela continua mostrando "voz conectada". Ninguém ouve ninguém e nada indica
   * que há algo errado.
   *
   * O compartilhamento de tela não volta junto: `getDisplayMedia` exige um novo
   * gesto do usuário, então avisamos em vez de fingir que continua no ar.
   */
  React.useEffect(() => {
    const canalAtual = channelIdRef.current;
    const sessaoDoMotor = engineSessionIdRef.current;

    if (!canalAtual || !sessionId || !sessaoDoMotor) return;
    if (sessaoDoMotor === sessionId) return;

    const estavaTransmitindo = sharingScreenRef.current;

    void join(canalAtual).then(() => {
      if (estavaTransmitindo) {
        toast({
          title: 'Compartilhamento interrompido',
          description:
            'A conexão caiu e voltou. Sua chamada foi restabelecida, mas é preciso compartilhar a tela de novo.',
          variant: 'info',
        });
      }
    });
  }, [sessionId, join, toast, channelIdRef, sharingScreenRef]);

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

  /**
   * Sons de entrada e saída da sala.
   *
   * Só toca para MOVIMENTO DE OUTRAS PESSOAS enquanto você está na chamada — o
   * som existe para avisar "alguém chegou" sem você precisar olhar. Tocar na
   * própria entrada seria redundante (você acabou de clicar), e tocar quando
   * você nem está na sala seria barulho puro.
   *
   * A primeira execução guarda a lista sem tocar nada: senão, entrar numa sala
   * com quatro pessoas dispararia quatro sons de uma vez.
   */
  const participantesConhecidosRef = React.useRef<Set<string> | null>(null);

  React.useEffect(() => {
    if (!channelId) {
      participantesConhecidosRef.current = null;
      return;
    }

    const atuais = new Set(
      Object.values(participants)
        .filter((participante) => participante.channelId === channelId)
        .map((participante) => participante.user.id),
    );

    const anteriores = participantesConhecidosRef.current;
    participantesConhecidosRef.current = atuais;

    if (!anteriores) return;

    for (const id of atuais) {
      if (!anteriores.has(id) && id !== viewerId) tocarSom('entrar');
    }
    for (const id of anteriores) {
      if (!atuais.has(id) && id !== viewerId) tocarSom('sair');
    }
  }, [participants, channelId, viewerId]);

  /**
   * Mantém a saída de áudio em sincronia com os participantes.
   *
   * O ganho passa por um GainNode do WebAudio porque `HTMLAudioElement.volume`
   * só vai até 1 — não daria para amplificar alguém que fala baixo.
   */
  React.useEffect(() => {
    const saida = (audioOutputRef.current ??= new AudioOutput());
    const vivos = new Set<string>();

    for (const peer of remotePeers) {
      if (!peer.audio) continue;
      vivos.add(peer.peerId);

      const userId = participants[peer.peerId]?.user.id;
      const escolhido = userId ? (volumes[userId] ?? 1) : 1;
      saida.attach(peer.peerId, peer.audio, deafened ? 0 : escolhido);
    }

    // Desliga quem saiu da chamada.
    for (const id of saida.attachedIds()) {
      if (!vivos.has(id)) saida.detach(id);
    }
  }, [remotePeers, volumes, deafened, participants]);

  const setPeerVolume = React.useCallback((userId: string, valor: number) => {
    const limitado = Math.min(MAX_GAIN, Math.max(0, valor));
    setVolumes((atual) => {
      const proximo = { ...atual, [userId]: limitado };
      gravarVolumes(proximo);
      return proximo;
    });
  }, []);

  const getPeerVolume = React.useCallback(
    (userId: string) => volumes[userId] ?? 1,
    [volumes],
  );

  React.useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      audioOutputRef.current?.dispose();
      audioOutputRef.current = null;
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
      getPeerVolume,
      setPeerVolume,
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
      getPeerVolume,
      setPeerVolume,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const context = React.useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice precisa estar dentro de <VoiceProvider>.');
  }
  return context;
}

export { LOCAL_SPEAKER_ID };
