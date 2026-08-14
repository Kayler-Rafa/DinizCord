/**
 * Saída de áudio com ganho por participante.
 *
 * A propriedade `volume` de um `<audio>` é limitada ao intervalo 0–1: não há
 * como passar de 100% por ali. Para amplificar, o stream precisa atravessar um
 * `GainNode` do WebAudio, que aceita ganho arbitrário.
 *
 * O elemento `<audio>` continua existindo, mudo, porque alguns navegadores só
 * mantêm o fluxo de um MediaStream remoto vivo enquanto ele estiver ligado a um
 * elemento de mídia — sem isso o WebAudio recebe silêncio.
 */

/** Ganho máximo oferecido na interface. */
export const MAX_GAIN = 2;

export class AudioOutput {
  private context: AudioContext | null = null;
  private readonly nodes = new Map<
    string,
    { source: MediaStreamAudioSourceNode; gain: GainNode; element: HTMLAudioElement }
  >();

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === 'undefined') return null;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    this.context = new Ctor();
    return this.context;
  }

  /** Liga (ou religa) o stream de um participante à saída. */
  attach(peerId: string, stream: MediaStream, gain: number): void {
    const atual = this.nodes.get(peerId);
    if (atual) {
      // Mesmo stream: só ajusta o ganho, sem recriar o grafo de áudio.
      if (atual.element.srcObject === stream) {
        this.setGain(peerId, gain);
        return;
      }
      this.detach(peerId);
    }

    const context = this.ensureContext();
    if (!context) return;

    void context.resume().catch(() => undefined);

    // Elemento mudo apenas para manter o stream "puxando" dados.
    const element = new Audio();
    element.srcObject = stream;
    element.muted = true;
    element.autoplay = true;
    void element.play().catch(() => undefined);

    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(stream);
    } catch {
      return;
    }

    const gainNode = context.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(context.destination);

    this.nodes.set(peerId, { source, gain: gainNode, element });
  }

  setGain(peerId: string, gain: number): void {
    const node = this.nodes.get(peerId);
    if (!node || !this.context) return;

    // Rampa curta em vez de salto: mudar o ganho de uma vez produz um estalo
    // audível no meio da fala.
    const agora = this.context.currentTime;
    node.gain.gain.cancelScheduledValues(agora);
    node.gain.gain.setValueAtTime(node.gain.gain.value, agora);
    node.gain.gain.linearRampToValueAtTime(Math.max(0, gain), agora + 0.05);
  }

  detach(peerId: string): void {
    const node = this.nodes.get(peerId);
    if (!node) return;

    node.source.disconnect();
    node.gain.disconnect();
    node.element.srcObject = null;
    this.nodes.delete(peerId);
  }

  /** Ids atualmente ligados — usado para desligar quem saiu da chamada. */
  attachedIds(): string[] {
    return [...this.nodes.keys()];
  }

  dispose(): void {
    for (const peerId of this.attachedIds()) this.detach(peerId);
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
