'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Menu, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ServerRail } from '@/components/server/server-rail';
import { ChannelSidebar } from '@/components/channels/channel-sidebar';
import { MemberList } from '@/components/members/member-list';
import { UserPanel } from './user-panel';
import { ConnectionBanner } from './connection-banner';
import { ScreenShareStage } from '@/components/screen-share/screen-share-stage';
import { useChannel, useServers } from '@/hooks/useStore';

/**
 * Layout de três colunas.
 *
 * Desktop: trilha de servidores + canais | conteúdo | membros.
 * Mobile: as colunas laterais viram gavetas sobrepostas, e o conteúdo ocupa a
 * tela inteira — a conversa é o que importa na tela pequena.
 *
 * A altura usa `dvh` (e não `vh`) porque a barra de endereços do navegador
 * móvel muda de tamanho ao rolar; com `vh` o rodapé ficaria escondido.
 */

interface LayoutContextValue {
  openNavigation: () => void;
  openMembers: () => void;
  membersVisible: boolean;
  toggleMembers: () => void;
}

const LayoutContext = React.createContext<LayoutContextValue | null>(null);

export function useLayout(): LayoutContextValue {
  const context = React.useContext(LayoutContext);
  if (!context) throw new Error('useLayout precisa estar dentro de <AppShell>.');
  return context;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ channelId?: string }>();
  const channelId = params?.channelId ?? null;

  const servers = useServers();
  const channel = useChannel(channelId);
  const serverId = channel?.serverId ?? servers[0]?.id ?? null;

  /**
   * Gaveta aberta no mobile, amarrada ao canal em que foi aberta.
   *
   * Guardar o `channelId` junto faz o fechamento ao navegar ser uma derivação do
   * render, e não um efeito: tocar num canal já pinta a conversa com a gaveta
   * fechada, sem o quadro intermediário em que ela ainda aparece por cima.
   *
   * Uma gaveta por vez, também: elas ocupam lados opostos e abrir as duas
   * escureceria a tela inteira sem mostrar nada de útil.
   */
  const [drawer, setDrawer] = React.useState<{
    channelId: string | null;
    open: 'navigation' | 'members' | null;
  }>({ channelId, open: null });

  const openDrawer = drawer.channelId === channelId ? drawer.open : null;
  const navigationOpen = openDrawer === 'navigation';
  const membersDrawerOpen = openDrawer === 'members';

  const [membersVisible, setMembersVisible] = React.useState(true);

  const closeDrawers = React.useCallback(
    () => setDrawer({ channelId, open: null }),
    [channelId],
  );

  // Esc fecha o que estiver aberto.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer((current) => ({ ...current, open: null }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = React.useMemo<LayoutContextValue>(
    () => ({
      openNavigation: () => setDrawer({ channelId, open: 'navigation' }),
      openMembers: () => {
        setDrawer({ channelId, open: 'members' });
        setMembersVisible(true);
      },
      membersVisible,
      toggleMembers: () => setMembersVisible((current) => !current),
    }),
    [channelId, membersVisible],
  );

  const drawerOpen = navigationOpen || membersDrawerOpen;

  return (
    <LayoutContext.Provider value={value}>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-base">
        <ConnectionBanner />

        <div className="relative flex min-h-0 flex-1">
          {/* Fundo escurecido das gavetas (só no mobile). */}
          {drawerOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={closeDrawers}
              aria-label="Fechar menu"
            />
          ) : null}

          <nav
            className={cn(
              'z-40 flex h-full shrink-0 md:relative md:translate-x-0',
              'fixed inset-y-0 left-0 transition-transform duration-200 ease-out',
              navigationOpen ? 'translate-x-0' : '-translate-x-full',
            )}
            aria-label="Servidores e canais"
          >
            <ServerRail activeServerId={serverId} />
            <div className="flex w-60 flex-col border-r border-line bg-surface">
              <ChannelSidebar serverId={serverId} activeChannelId={channelId} />
              <UserPanel />
            </div>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <MobileBar onOpenNavigation={value.openNavigation} onOpenMembers={value.openMembers} />
            <ScreenShareStage />
            <div className="min-h-0 flex-1">{children}</div>
          </div>

          <aside
            className={cn(
              'z-40 w-60 shrink-0 border-l border-line bg-surface',
              'fixed inset-y-0 right-0 transition-transform duration-200 ease-out md:relative md:translate-x-0',
              membersDrawerOpen ? 'translate-x-0' : 'translate-x-full',
              membersVisible ? 'md:block' : 'md:hidden',
            )}
            aria-label="Membros do servidor"
          >
            <MemberList serverId={serverId} />
          </aside>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

/** Barra que só existe no mobile, para abrir as gavetas. */
function MobileBar({
  onOpenNavigation,
  onOpenMembers,
}: {
  onOpenNavigation: () => void;
  onOpenMembers: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line bg-surface px-2 py-1.5 md:hidden">
      <Button variant="ghost" size="icon-sm" onClick={onOpenNavigation} aria-label="Abrir canais">
        <Menu />
      </Button>
      <span className="text-sm font-semibold text-content">DinizCord</span>
      <Button variant="ghost" size="icon-sm" onClick={onOpenMembers} aria-label="Ver membros">
        <Users />
      </Button>
    </div>
  );
}
