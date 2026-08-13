import { PeerConnection } from './peer-connection';
import { SpeakingDetector } from './speaking-detector';
import type { WebRtcSignal } from '@/lib/websocket/protocol';

/**
 * Motor da chamada de voz.
 *
 * Topologia: **mesh** — cada participante abre uma conexão direta com cada
 * outro. O servidor só transporta signaling; áudio e vídeo nunca passam por ele.
 * Para o tamanho deste projeto (um punhado de amigos) o mesh é a escolha certa:
 * latência mínima, custo de servidor zero e nenhuma infraestrutura de SFU. Em
 * compensação o custo de upload cresce linearmente com o número de pares — o
 * limite prático fica em torno de 6 a 8 pessoas com vídeo.
 *
 * Esta classe é deliberadamente independente do React: ela emite mudanças por
 * callback, e o hook `useVoiceChannel` só espelha isso em estado.
 */

export interface RemotePeerMedia {
  peerId: string;
  /** Stream de microfone (somente áudio). */
  audio: MediaStream | null;
  /** Stream de compartilhamento de tela (vídeo, com ou sem áudio). */
  screen: MediaStream | null;
  connectionState: RTCPeerConnectionState;
}

export interface VoiceEngineCallbacks {
  onMediaChange: (peers: RemotePeerMedia[]) => void;
  onSpeakingChange: (speakingIds: ReadonlySet<string>) => void;
  onLocalScreenEnded: () => void;
  onError: (message: string) => void;
}

/** Chaves estáveis das tracks locais em cada conexão. */
const TRACK_MIC = 'mic';
const TRACK_SCREEN_VIDEO = 'screen-video';
const TRACK_SCREEN_AUDIO = 'screen-audio';

/** Id usado pelo detector de fala para o próprio usuário. */
export const LOCAL_SPEAKER_ID = 'local';

interface PeerEntry {
  connection: PeerConnection;
  streams: Map<string, MediaStream>;
  connectionState: RTCPeerConnectionState;
}

export class VoiceEngine {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly speaking = new Set<string>();
  private readonly detector: SpeakingDetector;

  private micStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private muted = false;
  private deafened = false;
  private disposed = false;

  constructor(
    private readonly localSessionId: string,
    private iceServers: RTCIceServer[],
    private readonly sendSignal: (to: string, signal: WebRtcSignal) => void,
    private readonly callbacks: VoiceEngineCallbacks,
  ) {
    this.detector = new SpeakingDetector((id, isSpeaking) => {
      if (isSpeaking) this.speaking.add(id);
      else this.speaking.delete(id);
      this.callbacks.onSpeakingChange(new Set(this.speaking));
    });
  }

  // -------------------------------------------------------------------------
  // Microfone
  // -------------------------------------------------------------------------

  /**
   * Abre o microfone.
   *
   * O processamento (cancelamento de eco, supressão de ruído, ganho automático)
   * fica a cargo do navegador: a implementação nativa é muito melhor do que
   * qualquer coisa que daria para fazer aqui, e é o que evita microfonia quando
   * alguém usa caixas de som.
   */
  async startMicrophone(): Promise<void> {
    if (this.micStream) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Seu navegador não permite acesso ao microfone. Use um navegador atualizado em uma conexão segura (https).',
      );
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (error) {
      throw describeMediaError(error, 'microfone');
    }

    this.applyMuteToTracks();
    this.detector.track(LOCAL_SPEAKER_ID, this.micStream);

    for (const entry of this.peers.values()) {
      this.attachMic(entry.connection);
    }
  }

  private attachMic(connection: PeerConnection): void {
    const track = this.micStream?.getAudioTracks()[0] ?? null;
    connection.setTrack(TRACK_MIC, track, this.micStream);
  }

  private applyMuteToTracks(): void {
    // `enabled = false` mantém a conexão viva enviando silêncio, o que é bem
    // mais rápido do que remover e readicionar a track (que forçaria uma
    // renegociação a cada clique no botão de mudo).
    for (const track of this.micStream?.getAudioTracks() ?? []) {
      track.enabled = !this.muted && !this.deafened;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMuteToTracks();

    if (muted && this.speaking.delete(LOCAL_SPEAKER_ID)) {
      this.callbacks.onSpeakingChange(new Set(this.speaking));
    }
  }

  /** Ensurdecer também silencia o próprio microfone, como é praxe. */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.applyMuteToTracks();
  }

  get isDeafened(): boolean {
    return this.deafened;
  }

  // -------------------------------------------------------------------------
  // Compartilhamento de tela
  // -------------------------------------------------------------------------

  async startScreenShare(): Promise<void> {
    if (this.screenStream) return;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        'Este navegador não suporta compartilhamento de tela. Tente pelo Chrome, Edge ou Firefox no computador.',
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        // O áudio da tela é opcional: nem todo navegador/origem oferece, e a
        // captura precisa continuar funcionando quando não houver.
        audio: true,
      });
    } catch (error) {
      throw describeMediaError(error, 'tela');
    }

    this.screenStream = stream;

    // O navegador oferece o próprio botão "parar compartilhamento"; quando o
    // usuário o usa, a track termina e precisamos refletir isso na interface.
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        this.stopScreenShare();
        this.callbacks.onLocalScreenEnded();
      };
    }

    for (const entry of this.peers.values()) {
      this.attachScreen(entry.connection);
    }

    this.broadcastScreenMeta();
  }

  private attachScreen(connection: PeerConnection): void {
    connection.setTrack(
      TRACK_SCREEN_VIDEO,
      this.screenStream?.getVideoTracks()[0] ?? null,
      this.screenStream,
    );
    connection.setTrack(
      TRACK_SCREEN_AUDIO,
      this.screenStream?.getAudioTracks()[0] ?? null,
      this.screenStream,
    );
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;

    for (const track of this.screenStream.getTracks()) {
      track.onended = null;
      track.stop();
    }
    this.screenStream = null;

    for (const entry of this.peers.values()) {
      this.attachScreen(entry.connection);
    }

    this.broadcastScreenMeta();
  }

  get localScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  get localMicStream(): MediaStream | null {
    return this.micStream;
  }

  private broadcastScreenMeta(): void {
    const screenStreamId = this.screenStream?.id ?? null;
    for (const peerId of this.peers.keys()) {
      this.sendSignal(peerId, { kind: 'meta', screenStreamId });
    }
  }

  // -------------------------------------------------------------------------
  // Pares
  // -------------------------------------------------------------------------

  setIceServers(iceServers: RTCIceServer[]): void {
    this.iceServers = iceServers;
  }

  /**
   * Sincroniza o mesh com a lista atual de participantes.
   *
   * Chamado sempre que alguém entra ou sai do canal. Conexões que sobraram são
   * fechadas e as novas são criadas — o resto permanece intocado, para que a
   * entrada de um terceiro não interrompa a conversa em andamento.
   */
  setPeers(peerIds: string[]): void {
    if (this.disposed) return;

    const wanted = new Set(peerIds.filter((id) => id !== this.localSessionId));

    for (const [peerId, entry] of this.peers) {
      if (!wanted.has(peerId)) {
        entry.connection.close();
        this.peers.delete(peerId);
        this.detector.untrack(peerId);
        this.speaking.delete(peerId);
      }
    }

    for (const peerId of wanted) {
      if (!this.peers.has(peerId)) this.createPeer(peerId);
    }

    this.emitMedia();
    this.callbacks.onSpeakingChange(new Set(this.speaking));
  }

  private createPeer(peerId: string): void {
    const connection = new PeerConnection(peerId, this.localSessionId, this.iceServers, {
      onSignal: (signal) => this.sendSignal(peerId, signal),
      onRemoteStream: (stream) => this.onRemoteStream(peerId, stream),
      onStreamRemoved: (streamId) => this.onRemoteStreamRemoved(peerId, streamId),
      onConnectionStateChange: (state) => {
        const entry = this.peers.get(peerId);
        if (!entry) return;
        entry.connectionState = state;
        this.emitMedia();
      },
    });

    const entry: PeerEntry = { connection, streams: new Map(), connectionState: 'new' };
    this.peers.set(peerId, entry);

    // As tracks entram já na criação; é isso que dispara `negotiationneeded` e
    // inicia a troca de SDP.
    this.attachMic(connection);
    this.attachScreen(connection);

    if (this.screenStream) {
      this.sendSignal(peerId, { kind: 'meta', screenStreamId: this.screenStream.id });
    }
  }

  private onRemoteStream(peerId: string, stream: MediaStream): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;

    entry.streams.set(stream.id, stream);

    // Só o stream de microfone alimenta o detector de fala; áudio de tela
    // compartilhada não deve acender o indicador de "falando".
    if (stream.getVideoTracks().length === 0) {
      this.detector.track(peerId, stream);
    }

    this.emitMedia();
  }

  private onRemoteStreamRemoved(peerId: string, streamId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;

    entry.streams.delete(streamId);
    this.emitMedia();
  }

  handleSignal(from: string, signal: WebRtcSignal): void {
    const entry = this.peers.get(from);

    if (!entry) {
      // O sinal chegou antes de sabermos que a pessoa entrou (o evento do
      // WebSocket ainda não foi processado). Criar a conexão agora evita perder
      // a oferta e ficar com áudio de mão única.
      this.createPeer(from);
      this.peers.get(from)?.connection.handleSignal(signal);
      this.emitMedia();
      return;
    }

    void entry.connection.handleSignal(signal);
  }

  private emitMedia(): void {
    const peers: RemotePeerMedia[] = [];

    for (const [peerId, entry] of this.peers) {
      let audio: MediaStream | null = null;
      let screen: MediaStream | null = null;

      for (const stream of entry.streams.values()) {
        // A distinção é pela presença de vídeo: o app nunca envia câmera, então
        // todo stream com vídeo é compartilhamento de tela.
        if (stream.getVideoTracks().length > 0) screen = stream;
        else audio = stream;
      }

      peers.push({ peerId, audio, screen, connectionState: entry.connectionState });
    }

    this.callbacks.onMediaChange(peers);
  }

  dispose(): void {
    this.disposed = true;

    for (const entry of this.peers.values()) entry.connection.close();
    this.peers.clear();

    this.stopScreenShare();

    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    this.micStream = null;

    this.detector.dispose();
    this.speaking.clear();

    this.callbacks.onMediaChange([]);
    this.callbacks.onSpeakingChange(new Set());
  }
}

/**
 * Erro de acesso a mídia com mensagem já pronta para a tela.
 *
 * O sinalizador `cancelled` existe porque cancelar o seletor de tela dispara o
 * mesmo `NotAllowedError` de uma permissão negada — e desistir de compartilhar
 * não é um erro que mereça um alerta vermelho.
 */
export class MediaAccessError extends Error {
  constructor(
    message: string,
    readonly cancelled: boolean,
  ) {
    super(message);
    this.name = 'MediaAccessError';
  }
}

/**
 * Traduz os erros de `getUserMedia`/`getDisplayMedia` para instruções úteis.
 *
 * "NotAllowedError" não diz nada a quem só quer conversar; "Você bloqueou o
 * acesso ao microfone" diz o que fazer.
 */
export function describeMediaError(error: unknown, device: 'microfone' | 'tela'): MediaAccessError {
  const name = error instanceof Error ? error.name : '';
  const isScreen = device === 'tela';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return isScreen
        ? new MediaAccessError('Compartilhamento de tela cancelado.', true)
        : new MediaAccessError(
            'O acesso ao microfone foi bloqueado. Libere a permissão no cadeado da barra de endereços e tente de novo.',
            false,
          );

    case 'NotFoundError':
    case 'OverconstrainedError':
      return new MediaAccessError(
        isScreen
          ? 'Nenhuma tela disponível para compartilhar.'
          : 'Nenhum microfone foi encontrado. Conecte um e tente novamente.',
        false,
      );

    case 'NotReadableError':
      return new MediaAccessError(
        isScreen
          ? 'Não foi possível capturar a tela. Feche outros programas que possam estar usando a captura.'
          : 'Seu microfone está em uso por outro programa. Feche-o e tente novamente.',
        false,
      );

    case 'AbortError':
      return isScreen
        ? new MediaAccessError('Compartilhamento de tela cancelado.', true)
        : new MediaAccessError('A captura do microfone foi interrompida.', false);

    default:
      return new MediaAccessError(
        isScreen
          ? 'Não foi possível iniciar o compartilhamento de tela. Verifique as permissões do navegador.'
          : 'Não foi possível acessar o microfone. Verifique as permissões do navegador.',
        false,
      );
  }
}
