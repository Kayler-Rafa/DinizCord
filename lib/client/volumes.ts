/**
 * Preferências de volume, guardadas por dispositivo.
 *
 * São duas coleções independentes: o microfone de alguém e o áudio da tela que
 * essa mesma pessoa transmite são fontes diferentes, e quase sempre com níveis
 * diferentes — o jogo costuma chegar bem mais alto que a voz de quem joga.
 *
 * A chave é sempre o id do USUÁRIO, nunca o da sessão: o id de sessão muda a
 * cada reconexão, e perder o ajuste porque a pessoa caiu da chamada seria
 * inútil.
 *
 * O módulo é separado do provider para ser testável sem React nem navegador:
 * a parte que sane os dados é pura, e só as duas funções do fim tocam o
 * `localStorage`.
 */
import { MAX_GAIN } from '@/lib/webrtc/audio-output';

export { MAX_GAIN };

/** Volume neutro: reproduz a fonte como ela chegou. */
export const VOLUME_PADRAO = 1;

export const CHAVE_VOLUME_VOZ = 'dinizcord-volumes';
export const CHAVE_VOLUME_TELA = 'dinizcord-volumes-tela';

/**
 * Prende um valor no intervalo aceito, ou devolve `null` se não for um número
 * utilizável.
 *
 * `NaN` e `Infinity` precisam morrer aqui: repassados ao `GainNode` eles fazem
 * o WebAudio lançar e derrubam o áudio da chamada inteira, não só o da fonte
 * ajustada.
 */
export function limitarVolume(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  return Math.min(MAX_GAIN, Math.max(0, valor));
}

/**
 * Filtra o que veio do armazenamento.
 *
 * O `localStorage` é editável por quem usa o navegador, então nada aqui pode
 * confiar no formato: entra `unknown`, sai um mapa de números no intervalo.
 */
export function sanearVolumes(dados: unknown): Record<string, number> {
  if (typeof dados !== 'object' || dados === null || Array.isArray(dados)) return {};

  const limpo: Record<string, number> = {};
  for (const [id, valor] of Object.entries(dados as Record<string, unknown>)) {
    const limitado = limitarVolume(valor);
    if (limitado !== null) limpo[id] = limitado;
  }
  return limpo;
}

export function lerVolumes(chave: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return {};
    return sanearVolumes(JSON.parse(bruto));
  } catch {
    // JSON corrompido ou storage bloqueado: começa do padrão.
    return {};
  }
}

export function gravarVolumes(chave: string, volumes: Record<string, number>): void {
  try {
    window.localStorage.setItem(chave, JSON.stringify(volumes));
  } catch {
    // Modo privativo: vale para a sessão atual.
  }
}
