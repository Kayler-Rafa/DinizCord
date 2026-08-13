/**
 * Detecção de "quem está falando".
 *
 * Mede o volume RMS de cada stream com um AnalyserNode. Não é reconhecimento de
 * voz: é o mesmo indicador de nível que qualquer mesa de som mostra, e é o
 * suficiente para acender o anel ao redor do avatar.
 *
 * Detalhes que evitam um indicador piscando sem parar:
 *  - histerese (limiar de entrada maior que o de saída);
 *  - tempo mínimo de permanência antes de apagar;
 *  - análise a ~20 Hz, não a cada frame.
 */

/** Acima disto, considera-se que começou a falar. */
const SPEAKING_THRESHOLD = 0.045;
/** Abaixo disto, considera-se que parou. */
const SILENCE_THRESHOLD = 0.02;
/** Tempo que o indicador permanece aceso depois do silêncio. */
const RELEASE_MS = 350;
const SAMPLE_INTERVAL_MS = 50;

interface Tracked {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  // Tipado com ArrayBuffer explícito: `getFloatTimeDomainData` não aceita um
  // buffer que possa ser SharedArrayBuffer.
  buffer: Float32Array<ArrayBuffer>;
  speaking: boolean;
  lastLoudAt: number;
}

export type SpeakingListener = (id: string, speaking: boolean) => void;

export class SpeakingDetector {
  private context: AudioContext | null = null;
  private readonly tracked = new Map<string, Tracked>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onChange: SpeakingListener) {}

  /**
   * O AudioContext só é criado sob demanda porque os navegadores o iniciam
   * suspenso até haver um gesto do usuário — e entrar em um canal de voz é
   * justamente esse gesto.
   */
  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === 'undefined') return null;

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) return null;

    this.context = new AudioContextCtor();
    return this.context;
  }

  track(id: string, stream: MediaStream): void {
    if (this.tracked.has(id)) this.untrack(id);
    if (stream.getAudioTracks().length === 0) return;

    const context = this.ensureContext();
    if (!context) return;

    void context.resume().catch(() => undefined);

    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(stream);
    } catch {
      // Stream sem áudio utilizável (ex.: tela compartilhada sem som).
      return;
    }

    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // Suaviza o sinal para o indicador não tremer com estalos curtos.
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    this.tracked.set(id, {
      source,
      analyser,
      buffer: new Float32Array(analyser.fftSize),
      speaking: false,
      lastLoudAt: 0,
    });

    this.ensureTimer();
  }

  untrack(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;

    entry.source.disconnect();
    entry.analyser.disconnect();
    this.tracked.delete(id);

    if (entry.speaking) this.onChange(id, false);
    if (this.tracked.size === 0) this.stopTimer();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private sample(): void {
    const now = Date.now();

    for (const [id, entry] of this.tracked) {
      entry.analyser.getFloatTimeDomainData(entry.buffer);

      let sum = 0;
      for (let i = 0; i < entry.buffer.length; i += 1) {
        const value = entry.buffer[i]!;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / entry.buffer.length);

      if (rms > SPEAKING_THRESHOLD) {
        entry.lastLoudAt = now;
        if (!entry.speaking) {
          entry.speaking = true;
          this.onChange(id, true);
        }
      } else if (entry.speaking && rms < SILENCE_THRESHOLD && now - entry.lastLoudAt > RELEASE_MS) {
        entry.speaking = false;
        this.onChange(id, false);
      }
    }
  }

  dispose(): void {
    this.stopTimer();

    for (const id of [...this.tracked.keys()]) this.untrack(id);

    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
