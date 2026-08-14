import { redirect } from 'next/navigation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';
import { AppProvider } from '@/components/providers/app-provider';
import { VoiceProvider } from '@/components/providers/voice-provider';
import { AppShell } from '@/components/layout/app-shell';
import { getSession } from '@/lib/auth/session';
import { listServersForUser } from '@/lib/servers/service';

/**
 * Layout do aplicativo autenticado.
 *
 * A sessão e a lista de servidores são resolvidas no servidor, então a primeira
 * pintura já sai com a barra lateral preenchida — nada de tela vazia piscando
 * enquanto o cliente busca os dados.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect('/entrar');
  }

  // Antes de qualquer dado do servidor ser buscado: quem não aceitou os termos
  // não vê tela nenhuma do aplicativo.
  if (!session.user.termsAccepted) {
    redirect('/termos');
  }

  const servers = await listServersForUser(session.user.id);

  return (
    <ToastProvider>
      <TooltipProvider delayDuration={300} skipDelayDuration={200}>
        <AppProvider user={session.user} initialServers={servers}>
          <VoiceProvider>
            <AppShell>{children}</AppShell>
          </VoiceProvider>
        </AppProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}
