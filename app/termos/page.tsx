import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { TermsGate } from '@/components/auth/terms-gate';

export const metadata: Metadata = { title: 'Termos de uso' };

/**
 * Aceite obrigatório dos termos.
 *
 * Fica FORA do layout do aplicativo de propósito: não existe interface por
 * trás, nada para espiar e nada para fechar. A pessoa vê os termos ou não vê
 * nada.
 *
 * A checagem que realmente vale é a do servidor — esta página redireciona quem
 * já aceitou, e o guard da API recusa quem não aceitou. Pular a tela pelo
 * navegador não leva a lugar nenhum.
 */
export default async function TermosPage() {
  const session = await getSession();

  if (!session) {
    redirect('/entrar');
  }

  if (session.user.termsAccepted) {
    redirect('/app');
  }

  return <TermsGate nomeExibicao={session.user.displayName} />;
}
