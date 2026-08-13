'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import type { ServerDTO } from '@/lib/types';

export function LeaveServerDialog({
  server,
  open,
  onOpenChange,
}: {
  server: ServerDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { user } = useApp();
  const { toast } = useToast();
  const [leaving, setLeaving] = React.useState(false);

  async function handleLeave() {
    setLeaving(true);

    try {
      await api.servers.removeMember(server.id, user.id);
      // Recarrega pelo servidor: sem o servidor na lista, o layout precisa
      // recalcular para onde mandar o usuário.
      router.replace('/app');
      router.refresh();
    } catch (error) {
      toast({
        title: 'Não foi possível sair do servidor',
        description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
        variant: 'error',
      });
      setLeaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sair de {server.name}?</DialogTitle>
          <DialogDescription>
            Você perderá o acesso aos canais deste servidor. Para voltar, vai precisar de um novo
            convite.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" loading={leaving} onClick={() => void handleLeave()}>
            Sair do servidor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
