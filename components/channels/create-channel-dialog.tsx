'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Hash, Volume2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import { slugifyChannelName } from '@/lib/utils';
import type { ChannelType } from '@/lib/types';

export function CreateChannelDialog({
  serverId,
  type,
  open,
  onOpenChange,
}: {
  serverId: string;
  type: ChannelType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { refreshServers } = useApp();
  const { toast } = useToast();

  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [submitting, setSubmitting] = React.useState(false);

  const isText = type === 'TEXT';
  // Mostra desde já como o nome vai ficar depois da normalização.
  const preview = isText ? slugifyChannelName(name) : name.trim();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(undefined);

    try {
      const { channel } = await api.servers.createChannel(serverId, { name, type });
      await refreshServers();
      onOpenChange(false);

      // Entrar direto no canal recém-criado é o que quem cria quer fazer.
      if (isText) router.push(`/app/c/${channel.id}`);
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setError(caught.fields.name ?? caught.message);
      } else {
        toast({ title: 'Não foi possível criar o canal', variant: 'error' });
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isText ? 'Criar canal de texto' : 'Criar canal de voz'}</DialogTitle>
          <DialogDescription>
            {isText
              ? 'Canais de texto guardam o histórico das conversas.'
              : 'Canais de voz são salas abertas: entre e saia quando quiser.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field
            label="Nome do canal"
            htmlFor="channel-name"
            error={error}
            hint={
              isText && preview && preview !== name
                ? `Ficará como #${preview}`
                : undefined
            }
            required
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={isText ? 'novo-canal' : 'Sala nova'}
              maxLength={32}
              autoFocus
              required
            />
          </Field>

          <div className="flex items-center gap-2 rounded-[var(--radius-app)] bg-elevated px-3 py-2 text-sm text-muted">
            {isText ? <Hash className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
            <span className="truncate">{preview || (isText ? 'novo-canal' : 'Sala nova')}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting} disabled={!preview}>
              Criar canal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
