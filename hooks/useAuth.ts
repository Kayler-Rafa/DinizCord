'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import { useToast } from '@/components/ui/toast';

/**
 * Acesso ao usuário autenticado e às ações de conta.
 *
 * O usuário chega do servidor (via `AppProvider`), então não há estado de
 * "carregando sessão" no cliente — a página só renderiza depois que o layout
 * já validou a sessão.
 */
export function useAuth() {
  const { user } = useApp();
  const router = useRouter();
  const { toast } = useToast();
  const [loggingOut, setLoggingOut] = React.useState(false);

  const logout = React.useCallback(async () => {
    setLoggingOut(true);
    try {
      await api.auth.logout();
      // `replace` para que o botão "voltar" não retorne ao app autenticado.
      router.replace('/entrar');
      router.refresh();
    } catch (error) {
      setLoggingOut(false);
      toast({
        title: 'Não foi possível sair',
        description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    }
  }, [router, toast]);

  return { user, logout, loggingOut };
}
