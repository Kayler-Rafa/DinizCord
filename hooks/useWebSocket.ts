'use client';

import { useApp } from '@/components/providers/app-provider';
import { useConnectionState } from './useStore';
import type { ConnectionState } from '@/lib/client/store';

const MESSAGES: Record<ConnectionState, { label: string; description: string } | null> = {
  connected: null,
  connecting: { label: 'Conectando…', description: 'Estabelecendo conexão com o servidor.' },
  reconnecting: {
    label: 'Sua conexão foi interrompida. Reconectando…',
    description: 'Nada foi perdido: o histórico é recarregado assim que voltarmos.',
  },
  offline: {
    label: 'Não foi possível conectar ao servidor.',
    description: 'Continuamos tentando. Verifique sua internet.',
  },
};

/**
 * Estado da conexão em tempo real, já traduzido para a interface.
 *
 * Componentes não devem inspecionar o WebSocket diretamente: o que importa para
 * a tela é se está conectado e, se não, qual mensagem mostrar.
 */
export function useWebSocket() {
  const { send, reconnect } = useApp();
  const state = useConnectionState();

  return {
    state,
    isConnected: state === 'connected',
    /** null quando está tudo certo — não há o que avisar. */
    banner: MESSAGES[state],
    send,
    reconnect,
  };
}
