'use client';

import * as React from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'dinizcord-theme';

/**
 * Tema da interface.
 *
 * Escuro é o padrão e já vem no HTML do servidor, então não existe o flash
 * branco típico de quem só decide o tema no cliente. A preferência fica em
 * `localStorage` porque é uma escolha de dispositivo, não de conta.
 *
 * A leitura usa `useSyncExternalStore` em vez de `useEffect` + `setState`: o
 * `localStorage` é um armazenamento externo ao React, e essa é a API feita para
 * o caso — sem render extra na montagem e sem divergência de hidratação.
 * O evento `storage` mantém abas do mesmo navegador em sincronia.
 */

/** Notifica quando outra aba altera o tema. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    // Modo privativo pode bloquear a leitura.
    return 'dark';
  }
}

export function useTheme() {
  const theme = React.useSyncExternalStore(
    subscribe,
    readStoredTheme,
    // No servidor não há storage; o padrão é o mesmo do `data-theme` do layout.
    () => 'dark' as Theme,
  );

  // Aplica o tema lido do storage ao elemento raiz. É uma escrita no DOM fora
  // da árvore do React, que é exatamente o que um efeito deve fazer.
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem storage, o tema vale só para esta sessão.
    }
    // `storage` não dispara na aba que escreveu; o evento sintético abaixo faz
    // o `useSyncExternalStore` reler nesta aba também.
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  return { theme, setTheme };
}
