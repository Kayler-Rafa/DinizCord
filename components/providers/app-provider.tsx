'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AppStore } from '@/lib/client/store';
import { GatewaySocket, type SocketStatus } from '@/lib/client/socket';
import { api } from '@/lib/client/api';
import { useToast } from '@/components/ui/toast';
import { useLatestRef } from '@/hooks/useLatestRef';
import type { ClientEvent, ServerEvent, WebRtcSignal } from '@/lib/websocket/protocol';
import type { ServerDTO, SessionUser } from '@/lib/types';

/**
 * Raiz do estado do aplicativo autenticado.
 *
 * Junta três coisas que precisam viver enquanto o usuário estiver logado:
 * o store, a conexão WebSocket e o roteamento de sinais WebRTC. Fica em um
 * provider só porque todos os três têm exatamente o mesmo ciclo de vida.
 */

type SignalListener = (message: { from: string; fromUserId: string; signal: WebRtcSignal }) => void;

interface AppContextValue {
  store: AppStore;
  user: SessionUser;
  send: (event: ClientEvent) => boolean;
  reconnect: () => void;
  /** Assina sinais WebRTC; devolve a função de cancelamento. */
  onSignal: (listener: SignalListener) => () => void;
  refreshServers: () => Promise<void>;
}

const AppContext = React.createContext<AppContextValue | null>(null);

export function AppProvider({
  user,
  initialServers,
  children,
}: {
  user: SessionUser;
  initialServers: ServerDTO[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [store] = React.useState(() => {
    const instance = new AppStore(user.id);
    instance.setServers(initialServers);
    return instance;
  });

  const socketRef = React.useRef<GatewaySocket | null>(null);
  const signalListeners = React.useRef(new Set<SignalListener>());
  const wasConnected = React.useRef(false);

  const refreshServers = React.useCallback(async () => {
    try {
      const { servers } = await api.servers.list();
      store.setServers(servers);
    } catch {
      // Silencioso: a lista atual continua válida e o próximo evento corrige.
    }
  }, [store]);

  const handleEvent = React.useCallback((event: ServerEvent) => {
    if (event.t === 'webrtc:signal') {
      for (const listener of signalListeners.current) {
        listener({ from: event.from, fromUserId: event.fromUserId, signal: event.signal });
      }
      return;
    }

    if (event.t === 'error') {
      // Só reporta o que o usuário pode entender; ruído de protocolo fica no console.
      if (event.code === 'RATE_LIMITED' || event.code === 'FORBIDDEN') {
        toast({ title: 'Ação recusada', description: event.message, variant: 'error' });
      }
      return;
    }

    if (event.t === 'ready') {
      // Reconexão: o servidor mandou o estado atual, e a lista de servidores
      // pode ter mudado (canal criado, alguém entrou) enquanto estávamos fora.
      if (wasConnected.current) {
        void refreshServers();
      }
      wasConnected.current = true;
    }

    store.applyEvent(event);
  }, [store, toast, refreshServers]);

  const handleStatus = React.useCallback(
    (status: SocketStatus) => {
      store.setConnection(status);

      if (status === 'reconnecting' || status === 'offline') {
        // O estado efêmero de antes da queda não vale mais.
        store.markEveryoneOffline();
      }
    },
    [store],
  );

  const handleFatal = React.useCallback(
    (reason: string) => {
      toast({ title: 'Sessão encerrada', description: reason, variant: 'error' });
      router.replace('/entrar');
    },
    [toast, router],
  );

  /**
   * Os handlers vão para refs para que o efeito de conexão não dependa deles.
   *
   * Eles já são estáveis, mas depender das identidades faria uma mudança
   * acidental derrubar e reabrir o WebSocket — e o custo disso é o usuário
   * saindo e voltando na lista de presença dos amigos.
   */
  const eventRef = useLatestRef(handleEvent);
  const statusRef = useLatestRef(handleStatus);
  const fatalRef = useLatestRef(handleFatal);

  React.useEffect(() => {
    const socket = new GatewaySocket({
      onEvent: (event) => eventRef.current(event),
      onStatusChange: (status) => statusRef.current(status),
      onFatal: (reason) => fatalRef.current(reason),
    });

    socketRef.current = socket;
    void socket.start();

    return () => {
      socket.dispose();
      socketRef.current = null;
    };
  }, [eventRef, statusRef, fatalRef]);

  // Limpa indicadores de "digitando" vencidos. Um intervalo só para todos os
  // canais, em vez de um timer por indicador.
  React.useEffect(() => {
    const timer = setInterval(() => store.pruneTyping(), 2_000);
    return () => clearInterval(timer);
  }, [store]);

  const send = React.useCallback((event: ClientEvent) => {
    return socketRef.current?.send(event) ?? false;
  }, []);

  const reconnect = React.useCallback(() => {
    socketRef.current?.reconnectNow();
  }, []);

  const onSignal = React.useCallback((listener: SignalListener) => {
    signalListeners.current.add(listener);
    return () => {
      signalListeners.current.delete(listener);
    };
  }, []);

  const value = React.useMemo<AppContextValue>(
    () => ({ store, user, send, reconnect, onSignal, refreshServers }),
    [store, user, send, reconnect, onSignal, refreshServers],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error('useApp precisa estar dentro de <AppProvider>.');
  }
  return context;
}
