'use client';

import { useSyncExternalStore } from 'react';

/** Capacidades do navegador não mudam durante a sessão: nada a assinar. */
const noopSubscribe = () => () => {};

/**
 * Lê uma capacidade do navegador de forma segura para SSR.
 *
 * `useSyncExternalStore` é a ferramenta certa aqui: o servidor renderiza com
 * `serverValue` e o cliente corrige na hidratação, sem `useEffect` + `setState`
 * (que causaria um render extra) e sem divergência de hidratação.
 */
export function useBrowserCapability(check: () => boolean, serverValue: boolean): boolean {
  return useSyncExternalStore(noopSubscribe, check, () => serverValue);
}
