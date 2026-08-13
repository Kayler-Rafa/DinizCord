import type { WebRtcSignal } from '@/lib/websocket/protocol';

/**
 * Uma conexão P2P com um participante do canal de voz.
 *
 * Usa o padrão "perfect negotiation" do W3C: os dois lados podem iniciar uma
 * renegociação a qualquer momento (é o que acontece quando alguém começa a
 * compartilhar a tela), e a colisão de ofertas é resolvida por um papel fixo —
 * um dos lados é "polido" e cede, o outro ignora a oferta concorrente.
 *
 * O papel é decidido comparando os ids de sessão, que são iguais nos dois lados.
 * Sem essa regra, uma renegociação simultânea travaria a conexão em
 * `have-local-offer`.
 */
export interface PeerCallbacks {
  onSignal: (signal: WebRtcSignal) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onStreamRemoved: (streamId: string) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

export class PeerConnection {
  readonly pc: RTCPeerConnection;
  readonly polite: boolean;

  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswerPending = false;
  private closed = false;

  /** Id da MediaStream que o outro lado marcou como compartilhamento de tela. */
  remoteScreenStreamId: string | null = null;

  private readonly senders = new Map<string, RTCRtpSender>();

  constructor(
    readonly peerId: string,
    localId: string,
    iceServers: RTCIceServer[],
    private readonly callbacks: PeerCallbacks,
  ) {
    // Quem tem o id menor é o polido. Determinístico e igual dos dois lados.
    this.polite = localId < peerId;

    this.pc = new RTCPeerConnection({
      iceServers,
      // "all" permite relay via TURN quando o P2P direto não fecha.
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
    });

    this.pc.onnegotiationneeded = async () => {
      if (this.closed) return;
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.callbacks.onSignal({
            kind: 'description',
            description: {
              type: this.pc.localDescription.type,
              sdp: this.pc.localDescription.sdp,
            },
          });
        }
      } catch {
        // Uma negociação perdida não é fatal: `negotiationneeded` dispara de novo.
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (this.closed) return;
      this.callbacks.onSignal({
        kind: 'candidate',
        candidate: candidate
          ? {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid,
              sdpMLineIndex: candidate.sdpMLineIndex,
              usernameFragment: candidate.usernameFragment,
            }
          : null,
      });
    };

    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;

      this.callbacks.onRemoteStream(stream);

      // `removetrack` é o aviso de que o outro lado parou de compartilhar.
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) {
          this.callbacks.onStreamRemoved(stream.id);
        }
      };
    };

    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      this.callbacks.onConnectionStateChange(this.pc.connectionState);

      // `failed` costuma ser recuperável com um ICE restart (troca de rede,
      // saída do Wi-Fi para o 4G).
      if (this.pc.connectionState === 'failed') {
        this.restartIce();
      }
    };
  }

  /** Adiciona (ou substitui) uma track local identificada por uma chave estável. */
  setTrack(key: string, track: MediaStreamTrack | null, stream: MediaStream | null): void {
    if (this.closed) return;

    const existing = this.senders.get(key);

    if (!track) {
      if (existing) {
        this.pc.removeTrack(existing);
        this.senders.delete(key);
      }
      return;
    }

    if (existing) {
      void existing.replaceTrack(track).catch(() => undefined);
      return;
    }

    const sender = stream ? this.pc.addTrack(track, stream) : this.pc.addTrack(track);
    this.senders.set(key, sender);
  }

  async handleSignal(signal: WebRtcSignal): Promise<void> {
    if (this.closed) return;

    if (signal.kind === 'meta') {
      this.remoteScreenStreamId = signal.screenStreamId;
      return;
    }

    if (signal.kind === 'candidate') {
      if (!signal.candidate) return;
      try {
        await this.pc.addIceCandidate(signal.candidate);
      } catch {
        // Candidato descartado por conta de uma oferta ignorada: previsto pelo
        // padrão de perfect negotiation.
        if (!this.ignoreOffer) {
          // Candidato realmente inválido — não há o que fazer além de seguir.
        }
      }
      return;
    }

    const description = signal.description;

    const readyForOffer =
      !this.makingOffer && (this.pc.signalingState === 'stable' || this.settingRemoteAnswerPending);
    const offerCollision = description.type === 'offer' && !readyForOffer;

    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    try {
      this.settingRemoteAnswerPending = description.type === 'answer';
      await this.pc.setRemoteDescription(description as RTCSessionDescriptionInit);
      this.settingRemoteAnswerPending = false;

      if (description.type === 'offer') {
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.callbacks.onSignal({
            kind: 'description',
            description: {
              type: this.pc.localDescription.type,
              sdp: this.pc.localDescription.sdp,
            },
          });
        }
      }
    } catch {
      this.settingRemoteAnswerPending = false;
    }
  }

  private restartIce(): void {
    try {
      this.pc.restartIce();
    } catch {
      // Navegador sem suporte: a reconexão de nível superior cuida do caso.
    }
  }

  close(): void {
    this.closed = true;
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.senders.clear();

    try {
      this.pc.close();
    } catch {
      // Já fechada.
    }
  }
}
