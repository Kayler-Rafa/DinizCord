'use client';

import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { FormError } from '@/components/auth/form-error';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { changePasswordSchema, fieldErrorsOf } from '@/lib/validation/schemas';

export function PasswordSettings() {
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (newPassword !== confirmation) {
      setErrors({ confirmation: 'As senhas não coincidem.' });
      return;
    }

    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error));
      return;
    }

    setSaving(true);
    setErrors({});
    setFormError(null);

    try {
      await api.me.changePassword(parsed.data);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');

      toast({
        title: 'Senha alterada',
        description: 'As sessões nos outros dispositivos foram encerradas.',
        variant: 'success',
      });
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        if (Object.keys(error.fields).length === 0) setFormError(error.message);
      } else {
        setFormError('Não foi possível alterar a senha.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="flex items-start gap-2 rounded-[var(--radius-app)] bg-elevated p-3 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <p>
          Ao trocar a senha, todas as sessões ativas são encerradas — inclusive as de outros
          dispositivos. Esta aba continua conectada.
        </p>
      </div>

      <FormError message={formError} />

      <Field label="Senha atual" htmlFor="current-password" error={errors.currentPassword} required>
        <Input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        label="Nova senha"
        htmlFor="new-password"
        error={errors.newPassword}
        hint="No mínimo 10 caracteres, com pelo menos uma letra e um número."
        required
      >
        <Input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <Field label="Confirmar nova senha" htmlFor="confirm-password" error={errors.confirmation} required>
        <Input
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={!currentPassword || !newPassword}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}
