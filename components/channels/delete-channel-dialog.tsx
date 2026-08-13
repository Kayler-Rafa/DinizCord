'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import { useStoreSelector } from '@/hooks/useStore';
import type { ChannelDTO } from '@/lib/types';

export function DeleteChannelDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: ChannelDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const params = useParams<{ channelId?: string }>();
  const { refreshServers } = useApp();
  const { toast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);

  // Se o canal aberto for o excluído, é preciso ter para onde ir depois.
  const fallbackChannelId = useStoreSelector(
    (state) =>
      state.servers
        .find((server) => server.id === channel.serverId)
        ?.channels.find((item) => item.type === 'TEXT' && item.id !== channel.id)?.id ?? null,
  );

  async function handleDelete() {
    setSubmitting(true);

    try {
      await api.channels.remove(channel.id);
      await refreshServers();
      onOpenChange(false);

      if (params?.channelId === channel.id && fallbackChannelId) {
        router.replace(`/app/c/${fallbackChannelId}`);
      }
    } catch (error) {
      toast({
        title: 'Não foi possível excluir o canal',
        description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
        variant: 'error',
      });
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir #{channel.name}?</DialogTitle>
          <DialogDescription>
            {channel.type === 'TEXT'
              ? 'Todas as mensagens deste canal serão apagadas permanentemente. Não há como desfazer.'
              : 'Quem estiver na sala será desconectado. Não há como desfazer.'}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" loading={submitting} onClick={handleDelete}>
            Excluir canal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
