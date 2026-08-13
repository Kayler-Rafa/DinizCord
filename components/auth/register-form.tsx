'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { FormError } from './form-error';
import { registerSchema, fieldErrorsOf } from '@/lib/validation/schemas';
import { slugifyChannelName } from '@/lib/utils';

export function RegisterForm({ inviteCode }: { inviteCode?: string }) {
  const router = useRouter();

  const [values, setValues] = React.useState({
    displayName: '',
    username: '',
    email: '',
    password: '',
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // O usuário só recebe o nome sugerido enquanto não digitar o dele.
  const [usernameTouched, setUsernameTouched] = React.useState(false);

  function update(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function handleDisplayNameChange(value: string) {
    update('displayName', value);
    if (!usernameTouched) {
      setValues((current) => ({ ...current, username: slugifyChannelName(value) }));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Valida no cliente com o MESMO schema do servidor: o feedback é imediato e
    // as mensagens são idênticas às que voltariam da API.
    const parsed = registerSchema.safeParse({ ...values, inviteCode });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsOf(parsed.error));
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const result = await api.auth.register(parsed.data);
      router.replace(result.joinedServerId ? '/app' : '/app');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.fields);
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

      <Field label="Nome de exibição" htmlFor="displayName" error={fieldErrors.displayName} required>
        <Input
          value={values.displayName}
          onChange={(event) => handleDisplayNameChange(event.target.value)}
          autoComplete="name"
          autoFocus
          required
          placeholder="Rafael"
        />
      </Field>

      <Field
        label="Nome de usuário"
        htmlFor="username"
        error={fieldErrors.username}
        hint="Letras minúsculas, números, ponto, hífen ou sublinhado."
        required
      >
        <Input
          value={values.username}
          onChange={(event) => {
            setUsernameTouched(true);
            update('username', event.target.value.toLowerCase());
          }}
          autoComplete="username"
          required
          placeholder="rafael"
        />
      </Field>

      <Field label="E-mail" htmlFor="email" error={fieldErrors.email} required>
        <Input
          type="email"
          value={values.email}
          onChange={(event) => update('email', event.target.value)}
          autoComplete="email"
          required
          placeholder="rafael@exemplo.com"
        />
      </Field>

      <Field
        label="Senha"
        htmlFor="password"
        error={fieldErrors.password}
        hint="No mínimo 10 caracteres, com pelo menos uma letra e um número."
        required
      >
        <Input
          type="password"
          value={values.password}
          onChange={(event) => update('password', event.target.value)}
          autoComplete="new-password"
          required
          placeholder="••••••••••"
        />
      </Field>

      {fieldErrors.inviteCode ? <FormError message={fieldErrors.inviteCode} /> : null}

      <Button type="submit" className="w-full" loading={submitting} size="lg">
        Criar conta
      </Button>
    </form>
  );
}
