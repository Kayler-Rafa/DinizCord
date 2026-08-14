/**
 * Sons da interface, sintetizados com WebAudio.
 *
 * Sem arquivos de áudio no repositório, por três motivos: nada para baixar
 * antes do primeiro som tocar, nenhum asset binário para versionar, e nenhuma
 * dúvida de licenciamento sobre um som de terceiro num projeto que vai ser
 * aberto.
 *
 * São tons curtos com envelope suave. O ataque/decaimento importa: um
 * oscilador ligado e desligado de repente produz um "clique" audível nas bordas.
 */

export type SoundName = 'entrar' | 'sair' | 'mencao' | 'mensagem';

/** Notas de cada som, em Hz, com duração e volume relativos. */
const SOUNDS: Record<SoundName, { notas: number[]; duracao: number; volume: number }> = {
  // Subindo: alguém chegou.
  entrar: { notas: [523.25, 783.99], duracao: 0.11, volume: 0.18 },
  // Descendo: alguém saiu. Mesmas notas na ordem inversa, para o par soar
  // obviamente relacionado.
  sair: { notas: [783.99, 523.25], duracao: 0.11, volume: 0.16 },
  // Duas notas iguais e rápidas, mais agudas: chama atenção sem assustar.
  mencao: { notas: [880, 880], duracao: 0.09, volume: 0.2 },
  // Uma nota só e discreta: mensagem comum não deve competir com menção.
  mensagem: { notas: [660], duracao: 0.07, volume: 0.1 },
};

let contexto: AudioContext | null = null;

function obterContexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (contexto) return contexto;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  contexto = new Ctor();
  return contexto;
}

/**
 * Toca um som da interface.
 *
 * Nunca lança e nunca bloqueia: som é enfeite, e falhar em tocá-lo não pode
 * atrapalhar o que o usuário estava fazendo. Navegadores bloqueiam áudio antes
 * de qualquer interação — nesse caso o `resume` falha em silêncio e o próximo
 * som, já depois de um clique, funciona.
 */
export function tocarSom(nome: SoundName): void {
  const ctx = obterContexto();
  if (!ctx) return;

  void ctx.resume().catch(() => undefined);
  if (ctx.state !== 'running') return;

  const { notas, duracao, volume } = SOUNDS[nome];
  const inicio = ctx.currentTime;

  notas.forEach((frequencia, indice) => {
    const oscilador = ctx.createOscillator();
    const ganho = ctx.createGain();

    // Onda triangular: mais suave que a quadrada, menos "apitada" que a senoide
    // pura em notas curtas.
    oscilador.type = 'triangle';
    oscilador.frequency.value = frequencia;

    const t0 = inicio + indice * duracao;
    const t1 = t0 + duracao;

    // Envelope: sobe em 15 ms, decai até o silêncio. É isto que remove o clique.
    ganho.gain.setValueAtTime(0, t0);
    ganho.gain.linearRampToValueAtTime(volume, t0 + 0.015);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t1);

    oscilador.connect(ganho).connect(ctx.destination);
    oscilador.start(t0);
    oscilador.stop(t1 + 0.02);
  });
}

/**
 * Destrava o áudio.
 *
 * Deve ser chamado dentro de um gesto do usuário (entrar na chamada, por
 * exemplo). Sem isso o primeiro som é engolido pela política de autoplay.
 */
export function destravarSons(): void {
  void obterContexto()?.resume().catch(() => undefined);
}
