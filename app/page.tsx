import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

/**
 * Porta de entrada: quem já tem sessão vai direto para o app, o resto vai para o
 * login. Não existe página pública de marketing — o projeto é privado.
 */
export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect('/entrar');
  redirect(session.user.termsAccepted ? '/app' : '/termos');
}
