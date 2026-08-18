import { describe, it, expect } from 'vitest';
import {
  CHAVE_VOLUME_TELA,
  CHAVE_VOLUME_VOZ,
  MAX_GAIN,
  VOLUME_PADRAO,
  limitarVolume,
  sanearVolumes,
} from '@/lib/client/volumes';

/**
 * O que está sob teste é o saneamento, não o armazenamento.
 *
 * Estes valores vêm do `localStorage`, que é editável por quem usa o navegador.
 * Um número inválido daqui vira o ganho de um `GainNode`, e o WebAudio lança ao
 * receber `NaN` — derrubando o áudio da chamada inteira, não só o da fonte
 * ajustada.
 */

describe('limitarVolume', () => {
  it('mantém valores dentro do intervalo', () => {
    expect(limitarVolume(0)).toBe(0);
    expect(limitarVolume(1)).toBe(VOLUME_PADRAO);
    expect(limitarVolume(1.6)).toBe(1.6);
    expect(limitarVolume(2)).toBe(MAX_GAIN);
  });

  it('prende o que passa dos extremos', () => {
    expect(limitarVolume(-5)).toBe(0);
    expect(limitarVolume(99)).toBe(MAX_GAIN);
  });

  it('recusa o que não é número utilizável', () => {
    // NaN e Infinity fazem o GainNode lançar; precisam morrer aqui.
    expect(limitarVolume(Number.NaN)).toBeNull();
    expect(limitarVolume(Number.POSITIVE_INFINITY)).toBeNull();
    expect(limitarVolume('1.5')).toBeNull();
    expect(limitarVolume(null)).toBeNull();
    expect(limitarVolume(undefined)).toBeNull();
    expect(limitarVolume({})).toBeNull();
  });
});

describe('sanearVolumes', () => {
  it('preserva as entradas válidas e limita as demais', () => {
    expect(sanearVolumes({ ana: 0.5, bruno: 7, carla: -1 })).toEqual({
      ana: 0.5,
      bruno: MAX_GAIN,
      carla: 0,
    });
  });

  it('descarta entradas inválidas sem perder as boas', () => {
    expect(sanearVolumes({ ana: 1.2, bruno: 'alto', carla: Number.NaN })).toEqual({ ana: 1.2 });
  });

  it('devolve vazio para qualquer coisa que não seja objeto', () => {
    expect(sanearVolumes(null)).toEqual({});
    expect(sanearVolumes('{}')).toEqual({});
    expect(sanearVolumes(42)).toEqual({});
    // Array passaria pelo typeof 'object' e viraria um mapa de índices.
    expect(sanearVolumes([1, 2])).toEqual({});
  });
});

describe('chaves de armazenamento', () => {
  it('voz e tela são coleções distintas', () => {
    // Se colidissem, ajustar o jogo mexeria na voz da mesma pessoa.
    expect(CHAVE_VOLUME_VOZ).not.toBe(CHAVE_VOLUME_TELA);
  });
});
