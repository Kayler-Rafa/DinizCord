import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env.server';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Criar conta' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  if (await getSession()) {
    redirect('/app');
  }

  const { convite } = await searchParams;
  const inviteOnly = serverEnv().REGISTRATION_INVITE_ONLY;

  // Com cadastro fechado e sem convite, mostrar o formulário só levaria a um
  // erro depois de preencher tudo.
  if (inviteOnly && !convite) {
    return (
      <AuthShell
        title="Cadastro por convite"
        subtitle="Este DinizCord é privado."
        footer={
          <Link href="/entrar" className="font-medium text-accent hover:underline">
            Já tenho conta
          </Link>
        }
      >
        <div className="space-y-4 text-sm text-muted">
          <p>
            Novas contas só podem ser criadas através de um link de convite. Peça um a alguém que já
            faça parte do servidor.
          </p>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/entrar">Voltar para o login</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle={convite ? 'Você foi convidado para um servidor.' : 'Leva menos de um minuto.'}
      footer={
        <>
          Já tem conta?{' '}
          <Link href="/entrar" className="font-medium text-accent hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <RegisterForm inviteCode={convite} />
    </AuthShell>
  );
}
