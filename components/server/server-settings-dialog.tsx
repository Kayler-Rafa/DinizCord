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
import type { ServerDTO } from '@/lib/types';

const EMOJI_CHOICES = ['🏠', '🎮', '🎧', '🚀', '🍕', '🐉', '⚡', '🌙', '🏎️', '🎲'];

export function ServerSettingsDialog({
  server,
  open,
  onOpenChange,
}: {
  server: ServerDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { refreshServers } = useApp();
  const { toast } = useToast();

  const [name, setName] = React.useState(server.name);
  const [emoji, setEmoji] = React.useState(server.iconEmoji);
  const [error, setError] = React.useState<string | undefined>();
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(undefined);

    try {
      await api.servers.update(server.id, { name, iconEmoji: emoji });
      await refreshServers();
      onOpenChange(false);
      toast({ title: 'Servidor atualizado', variant: 'success' });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Tente novamente.');
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurações do servidor</DialogTitle>
          <DialogDescription>Ajuste como o servidor aparece para todo mundo.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Nome do servidor" htmlFor="server-name" error={error} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={48}
              autoFocus
              required
            />
          </Field>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Ícone
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setEmoji(choice)}
                  aria-pressed={choice === emoji}
                  aria-label={`Usar ${choice} como ícone`}
                  className={
                    choice === emoji
                      ? 'flex size-10 items-center justify-center rounded-lg bg-accent-soft text-xl ring-2 ring-accent'
                      : 'flex size-10 items-center justify-center rounded-lg bg-elevated text-xl transition-colors hover:bg-overlay'
                  }
                >
                  {choice}
                </button>
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
