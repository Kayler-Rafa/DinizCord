import { redirect } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { getSession } from '@/lib/auth/session';
import { listServersForUser } from '@/lib/servers/service';

/**
 * Entrada do app.
 *
 * Manda o usuário direto ao primeiro canal de texto: a tela de "escolha um
 * canal" seria um passo vazio, já que praticamente sempre existe um destino
 * óbvio.
 */
export default async function AppHomePage() {
  const session = await getSession();
  if (!session) redirect('/entrar');

  const servers = await listServersForUser(session.user.id);
  const firstChannel = servers[0]?.channels.find((channel) => channel.type === 'TEXT');

  if (firstChannel) {
    redirect(`/app/c/${firstChannel.id}`);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <MessagesSquare className="size-10 text-subtle" aria-hidden />
      <h1 className="text-lg font-semibold text-content">Nada por aqui ainda</h1>
      <p className="max-w-sm text-sm text-muted">
        {servers.length === 0
          ? 'Você ainda não faz parte de nenhum servidor. Peça um link de convite a alguém do grupo.'
          : 'Este servidor não tem canais de texto. Peça a um administrador para criar o primeiro.'}
      </p>
    </div>
  );
}
