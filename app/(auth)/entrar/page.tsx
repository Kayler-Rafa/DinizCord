import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  // Quem já está autenticado não tem o que fazer aqui.
  if (await getSession()) {
    redirect('/app');
  }

  const { proximo } = await searchParams;

  // Só aceita caminho interno: um "próximo" absoluto viraria redirecionamento
  // aberto, útil para phishing.
  const redirectTo = proximo?.startsWith('/') && !proximo.startsWith('//') ? proximo : '/app';

  return (
    <AuthShell
      title="Entrar no DinizCord"
      subtitle="Use suas credenciais para continuar."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link href="/cadastrar" className="font-medium text-accent hover:underline">
            Criar uma agora
          </Link>
        </>
      }
    >
      <LoginForm redirectTo={redirectTo} />
    </AuthShell>
  );
}
