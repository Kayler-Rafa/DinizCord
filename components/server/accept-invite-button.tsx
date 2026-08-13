'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/auth/form-error';
import { api, ApiClientError } from '@/lib/client/api';

export function AcceptInviteButton({ code }: { code: string }) {
  const router = useRouter();
  const [joining, setJoining] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleAccept() {
    setJoining(true);
    setError(null);

    try {
      await api.invites.accept(code);
      router.replace('/app');
      // Necessário para que o layout do servidor recarregue a lista com o
      // servidor recém-adicionado.
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Não foi possível aceitar o convite. Tente novamente.',
      );
      setJoining(false);
    }
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <Button className="w-full" size="lg" loading={joining} onClick={() => void handleAccept()}>
        Entrar no servidor
      </Button>
    </div>
  );
}
