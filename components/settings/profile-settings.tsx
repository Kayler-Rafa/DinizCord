'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import { usePresence } from '@/hooks/usePresence';

export function ProfileSettings({ onDone }: { onDone: () => void }) {
  const { user } = useApp();
  const { activity, setActivity } = usePresence();
  const { toast } = useToast();
  const router = useRouter();

  const [displayName, setDisplayName] = React.useState(user.displayName);
  const [activityText, setActivityText] = React.useState(activity ?? '');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setErrors({});

    try {
      const normalizedActivity = activityText.trim() || null;

      await api.me.update({ displayName, activity: normalizedActivity });

      // Espelha a atividade nas conexões abertas para que os outros vejam na hora.
      setActivity(normalizedActivity);

      toast({ title: 'Perfil atualizado', variant: 'success' });
      onDone();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        if (Object.keys(error.fields).length === 0) {
          toast({ title: 'Não foi possível salvar', description: error.message, variant: 'error' });
        }
      }
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="flex items-center gap-3 rounded-[var(--radius-app)] bg-elevated p-3">
        <Avatar name={displayName || user.displayName} color={user.avatarColor} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-content">
            {displayName || user.displayName}
          </p>
          <p className="truncate text-sm text-muted">@{user.username}</p>
          <p className="mt-1 truncate text-xs text-subtle">{user.email}</p>
        </div>
      </div>

      <Field label="Nome de exibição" htmlFor="display-name" error={errors.displayName} required>
        <Input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={32}
          required
        />
      </Field>

      <Field
        label="Atividade"
        htmlFor="activity"
        error={errors.activity}
        hint="Aparece abaixo do seu nome. Ex.: “Jogando Assetto Corsa EVO”."
      >
        <Input
          value={activityText}
          onChange={(event) => setActivityText(event.target.value)}
          maxLength={80}
          placeholder="O que você está fazendo?"
        />
      </Field>

      <p className="text-xs text-subtle">
        O nome de usuário e o e-mail não podem ser alterados por aqui.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={saving} disabled={!displayName.trim()}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}
