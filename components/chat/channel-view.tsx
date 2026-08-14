'use client';

import * as React from 'react';
import { Hash, Users } from 'lucide-react';
import { MessageList } from './message-list';
import { MessageComposer } from './message-composer';
import { TypingIndicator } from './typing-indicator';
import { Tooltip } from '@/components/ui/tooltip';
import { useMessages } from '@/hooks/useMessages';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useApp } from '@/components/providers/app-provider';
import { useChannel, useMembers, useServer } from '@/hooks/useStore';
import { useLayout } from '@/components/layout/app-shell';
import type { MessageDTO } from '@/lib/types';

/** Canal de texto: cabeçalho, histórico e caixa de escrita. */
export function ChannelView({ channelId }: { channelId: string }) {
  const { user } = useApp();
  const channel = useChannel(channelId);
  const server = useServer(channel?.serverId ?? null);
  const { isConnected } = useWebSocket();
  const { toggleMembers, membersVisible } = useLayout();

  // A resposta em andamento é guardada junto com o canal a que pertence, e não
  // limpa por efeito ao trocar de canal: assim `replyingTo` é derivado do render
  // atual e nunca existe um quadro em que a resposta do canal anterior aparece
  // sobre o canal novo.
  const [replyState, setReplyState] = React.useState<{
    channelId: string;
    message: MessageDTO | null;
  }>({ channelId, message: null });

  const replyingTo = replyState.channelId === channelId ? replyState.message : null;

  const setReplyingTo = React.useCallback(
    (message: MessageDTO | null) => setReplyState({ channelId, message }),
    [channelId],
  );

  const {
    messages,
    loading,
    loaded,
    hasMore,
    error,
    loadMore,
    reload,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    notifyTyping,
    markRead,
  } = useMessages(channelId);

  // Entrar no canal já marca como lido. Ficar olhando as mensagens antigas não
  // deveria manter o contador aceso.
  React.useEffect(() => {
    if (loaded) markRead();
  }, [loaded, markRead]);

  const membros = useMembers(channel?.serverId ?? null);

  /**
   * Nome de usuário em minúsculas → id.
   *
   * Serve tanto para destacar as menções no histórico quanto para alimentar o
   * autocomplete do compositor, então é montado uma vez só aqui.
   */
  const membrosPorNome = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const membro of membros ?? []) {
      mapa.set(membro.user.username.toLowerCase(), membro.user.id);
    }
    return mapa;
  }, [membros]);

  const canModerate = server?.viewerRole === 'OWNER' || server?.viewerRole === 'ADMIN';

  if (!channel) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
        Este canal não existe mais ou você perdeu o acesso a ele.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <Hash className="size-5 shrink-0 text-subtle" aria-hidden />
        <h1 className="shrink-0 text-sm font-semibold text-content">{channel.name}</h1>

        {channel.topic ? (
          <>
            <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
            <p className="min-w-0 truncate text-xs text-muted">{channel.topic}</p>
          </>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center">
          <Tooltip content={membersVisible ? 'Ocultar membros' : 'Mostrar membros'}>
            <button
              type="button"
              onClick={toggleMembers}
              className="hidden rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-content md:block"
              aria-label={membersVisible ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
              aria-pressed={membersVisible}
            >
              <Users className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </header>

      <MessageList
        messages={messages}
        loading={loading}
        loaded={loaded}
        hasMore={hasMore}
        error={error}
        viewerId={user.id}
        canModerate={Boolean(canModerate)}
        channelName={channel.name}
        onLoadMore={loadMore}
        onReload={() => void reload()}
        onReply={setReplyingTo}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onToggleReaction={(messageId, emoji) => void toggleReaction(messageId, emoji)}
        onReachBottom={markRead}
        membrosPorNome={membrosPorNome}
      />

      <TypingIndicator channelId={channelId} serverId={channel.serverId} />

      <MessageComposer
        channelName={channel.name}
        disabled={!isConnected && !loaded}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSend={sendMessage}
        onTyping={notifyTyping}
        membros={membros ?? []}
      />
    </div>
  );
}
