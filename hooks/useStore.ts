'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useApp } from '@/components/providers/app-provider';
import type { AppState } from '@/lib/client/store';

/**
 * Assina uma fatia do store.
 *
 * `useSyncExternalStore` compara o valor retornado por identidade, então o
 * seletor precisa devolver algo estável — uma referência do estado, um
 * primitivo, ou um valor memorizado. Um seletor que monta objeto/array novo a
 * cada chamada causa re-render infinito; por isso existem os helpers
 * `useStoreEquality` e os seletores prontos abaixo.
 */
export function useStoreSelector<T>(selector: (state: AppState) => T): T {
  const { store } = useApp();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );
}

/**
 * Variante com comparador próprio, para seletores que derivam listas novas.
 *
 * O cache vive em um ref (e não numa variável local) porque
 * `useSyncExternalStore` exige que `getSnapshot` devolva a MESMA referência
 * enquanto o estado não mudar — um array novo a cada chamada faz o React
 * acusar loop infinito.
 */
export function useStoreEquality<T>(
  selector: (state: AppState) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const { store } = useApp();
  const cache = useRef<{ value: T } | null>(null);

  const read = useCallback(() => {
    const next = selector(store.getSnapshot());
    if (cache.current && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { value: next };
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, read, read);
}

export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

// ---------------------------------------------------------------------------
// Seletores prontos
// ---------------------------------------------------------------------------

export function useConnectionState() {
  return useStoreSelector((state) => state.connection);
}

export function useSessionId() {
  return useStoreSelector((state) => state.sessionId);
}

export function useServers() {
  return useStoreSelector((state) => state.servers);
}

export function useServer(serverId: string | null) {
  return useStoreSelector((state) =>
    serverId ? (state.servers.find((server) => server.id === serverId) ?? null) : null,
  );
}

export function useChannel(channelId: string | null) {
  return useStoreSelector((state) => {
    if (!channelId) return null;
    for (const server of state.servers) {
      const channel = server.channels.find((item) => item.id === channelId);
      if (channel) return channel;
    }
    return null;
  });
}

export function useMembers(serverId: string | null) {
  return useStoreSelector((state) => (serverId ? (state.members[serverId] ?? null) : null));
}

export function usePresenceOf(userId: string) {
  return useStoreSelector((state) => state.presences[userId]?.status ?? 'OFFLINE');
}

export function useActivityOf(userId: string) {
  return useStoreSelector((state) => state.presences[userId]?.activity ?? null);
}

export function useChannelMessages(channelId: string | null) {
  return useStoreSelector((state) => (channelId ? (state.messages[channelId] ?? null) : null));
}

export function useUnreadCount(channelId: string) {
  return useStoreSelector((state) => state.unreads[channelId] ?? 0);
}

const EMPTY_IDS: string[] = [];

export function useTypingUserIds(channelId: string | null) {
  const selector = useCallback(
    (state: AppState): string[] => {
      if (!channelId) return EMPTY_IDS;
      const entries = state.typing[channelId];
      return entries ? entries.map((entry) => entry.userId) : EMPTY_IDS;
    },
    [channelId],
  );

  return useStoreEquality(selector, shallowArrayEqual);
}
