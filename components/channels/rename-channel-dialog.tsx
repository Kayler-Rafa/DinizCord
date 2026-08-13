'use client';

import * as React from 'react';
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
import type { ChannelDTO } from '@/lib/types';

export function RenameChannelDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: ChannelDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { refreshServers } = useApp();
  const { toast } = useToast();

  const [name, setName] = React.useState(channel.name);
  const [topic, setTopic] = React.useState(channel.topic ?? '');
  const [error, setError] = React.useState<string | undefined>();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(undefined);

    try {
      await api.channels.update(channel.id, { name, topic: topic.trim() || null });
      await refreshServers();
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setError(caught.fields.name ?? caught.message);
      } else {
        toast({ title: 'Não foi possível salvar o canal', variant: 'error' });
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar canal</DialogTitle>
          <DialogDescription>Altere o nome e o assunto do canal.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Nome" htmlFor="rename-channel" error={error} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              autoFocus
              required
            />
          </Field>

          {channel.type === 'TEXT' ? (
            <Field
              label="Assunto"
              htmlFor="channel-topic"
              hint="Aparece no topo do canal. Opcional."
            >
              <Input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                maxLength={200}
                placeholder="Sobre o que é este canal?"
              />
            </Field>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
