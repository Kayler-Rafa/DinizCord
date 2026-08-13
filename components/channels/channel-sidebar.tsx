'use client';

import * as React from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useServer } from '@/hooks/useStore';
import { TextChannelItem } from './text-channel-item';
import { VoiceChannelItem } from '@/components/voice/voice-channel-item';
import { ServerMenu } from '@/components/server/server-menu';
import { CreateChannelDialog } from './create-channel-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import type { ChannelType } from '@/lib/types';

/** Lista de canais do servidor, separada por tipo. */
export function ChannelSidebar({
  serverId,
  activeChannelId,
}: {
  serverId: string | null;
  activeChannelId: string | null;
}) {
  const server = useServer(serverId);
  const [creating, setCreating] = React.useState<ChannelType | null>(null);

  if (!server) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-subtle">
        Você ainda não faz parte de nenhum servidor.
      </div>
    );
  }

  const textChannels = server.channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = server.channels.filter((channel) => channel.type === 'VOICE');
  const canManage = server.viewerRole === 'OWNER' || server.viewerRole === 'ADMIN';

  return (
    <>
      <ServerMenu server={server} />

      <div className="dc-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <ChannelSection
          title="Canais de texto"
          onCreate={canManage ? () => setCreating('TEXT') : undefined}
          createLabel="Criar canal de texto"
        >
          {textChannels.map((channel) => (
            <TextChannelItem
              key={channel.id}
              channel={channel}
              active={channel.id === activeChannelId}
              canManage={canManage}
            />
          ))}
        </ChannelSection>

        <ChannelSection
          title="Canais de voz"
          onCreate={canManage ? () => setCreating('VOICE') : undefined}
          createLabel="Criar canal de voz"
        >
          {voiceChannels.map((channel) => (
            <VoiceChannelItem key={channel.id} channel={channel} canManage={canManage} />
          ))}
        </ChannelSection>
      </div>

      {creating ? (
        <CreateChannelDialog
          serverId={server.id}
          type={creating}
          open
          onOpenChange={(open) => {
            if (!open) setCreating(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Seção recolhível.
 *
 * Recolher é lembrado apenas na sessão da aba — é uma preferência de momento
 * ("quero ver só a voz agora"), não uma configuração de conta.
 */
function ChannelSection({
  title,
  children,
  onCreate,
  createLabel,
}: {
  title: string;
  children: React.ReactNode;
  onCreate?: (() => void) | undefined;
  createLabel: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const contentId = React.useId();

  return (
    <section className="mt-4 first:mt-3">
      <div className="group flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="flex flex-1 items-center gap-0.5 py-1 text-[11px] font-bold uppercase tracking-wider text-subtle transition-colors hover:text-content"
        >
          <ChevronDown
            className={cn('size-3 transition-transform duration-150', collapsed && '-rotate-90')}
            aria-hidden
          />
          {title}
        </button>

        {onCreate ? (
          <Tooltip content={createLabel}>
            <button
              type="button"
              onClick={onCreate}
              className="rounded p-0.5 text-subtle transition-colors hover:text-content"
              aria-label={createLabel}
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div id={contentId} className={cn('mt-0.5 space-y-0.5', collapsed && 'hidden')}>
        {children}
      </div>
    </section>
  );
}
