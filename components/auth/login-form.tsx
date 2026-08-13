'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { FormError } from './form-error';

export function LoginForm({ redirectTo = '/app' }: { redirectTo?: string }) {
  const router = useRouter();

  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await api.auth.login({ identifier, password });
      router.replace(redirectTo);
      // `refresh` para que o layout do servidor releia a sessão recém-criada.
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.fields);
        // Credencial inválida não pertence a um campo específico — apontar para
        // "senha" já entregaria que o e-mail existe.
        if (Object.keys(error.fields).length === 0) setFormError(error.message);
      } else {
        setFormError('Algo deu errado. Tente novamente.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      <Field label="E-mail ou usuário" htmlFor="identifier" error={fieldErrors.identifier} required>
        <Input
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          autoComplete="username"
          autoFocus
          required
          placeholder="rafael@exemplo.com"
        />
      </Field>

      <Field label="Senha" htmlFor="password" error={fieldErrors.password} required>
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          placeholder="••••••••••"
        />
      </Field>

      <Button type="submit" className="w-full" loading={submitting} size="lg">
        Entrar
      </Button>
    </form>
  );
}
