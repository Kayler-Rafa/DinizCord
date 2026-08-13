'use client';

import * as React from 'react';
import { ArrowDown, Loader2, RefreshCw } from 'lucide-react';
import { cn, formatDayDivider, sameDay } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MessageListSkeleton } from '@/components/ui/skeleton';
import { MessageItem } from './message-item';
import type { MessageDTO } from '@/lib/types';

/**
 * Histórico do canal com rolagem inteligente.
 *
 * Três comportamentos que fazem a diferença entre um chat utilizável e um
 * irritante:
 *
 *  1. **Rolagem automática condicional** — só desce sozinho quando o usuário já
 *     está no fim. Quem está lendo mensagens antigas não é arrastado para baixo.
 *  2. **Âncora ao carregar histórico** — ao inserir mensagens no topo, a posição
 *     visual é preservada compensando a diferença de `scrollHeight`. Sem isso, o
 *     conteúdo "pularia" a cada página carregada.
 *  3. **Carregamento incremental** — busca a página anterior quando o topo se
 *     aproxima, em vez de trazer o canal inteiro.
 */

/** Distância do fim, em pixels, ainda considerada "no fim". */
const AT_BOTTOM_THRESHOLD = 120;
/** Distância do topo que dispara o carregamento da página anterior. */
const LOAD_MORE_THRESHOLD = 240;

interface MessageListProps {
  messages: MessageDTO[];
  loading: boolean;
  loaded: boolean;
  hasMore: boolean;
  error: string | null;
  viewerId: string;
  canModerate: boolean;
  channelName: string;
  onLoadMore: () => void;
  onReload: () => void;
  onReply: (message: MessageDTO) => void;
  onEdit: (messageId: string, content: string) => Promise<boolean>;
  onDelete: (messageId: string) => Promise<boolean>;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReachBottom: () => void;
}

export function MessageList({
  messages,
  loading,
  loaded,
  hasMore,
  error,
  viewerId,
  canModerate,
  channelName,
  onLoadMore,
  onReload,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
  onReachBottom,
}: MessageListProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  // A mesma informação em ref e em estado, de propósito: o estado pinta o botão
  // "ir para as mais recentes"; a ref é lida pelo efeito de layout, que roda
  // antes de qualquer efeito poder sincronizá-la. A escrita acontece no handler
  // de scroll — que é um evento, e não um render.
  const atBottomRef = React.useRef(true);

  // Guarda a altura antes da atualização para reancorar depois de prepend.
  const previousHeight = React.useRef(0);
  const previousFirstId = React.useRef<string | null>(null);
  const loadingMore = React.useRef(false);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  const handleScroll = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceFromBottom <= AT_BOTTOM_THRESHOLD;

    atBottomRef.current = isAtBottom;
    setAtBottom(isAtBottom);
    if (isAtBottom) onReachBottom();

    if (container.scrollTop <= LOAD_MORE_THRESHOLD && hasMore && !loadingMore.current) {
      loadingMore.current = true;
      previousHeight.current = container.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, onLoadMore, onReachBottom]);

  // Reposicionamento após mudanças na lista.
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    const firstId = messages[0]?.id ?? null;
    const grewAtTop = previousFirstId.current !== null && previousFirstId.current !== firstId;

    if (grewAtTop && previousHeight.current > 0) {
      // Histórico carregado: mantém o que o usuário estava lendo na mesma altura.
      container.scrollTop += container.scrollHeight - previousHeight.current;
      previousHeight.current = 0;
      loadingMore.current = false;
    } else if (atBottomRef.current) {
      scrollToBottom();
    }

    previousFirstId.current = firstId;
  }, [messages, scrollToBottom]);

  // Primeira carga: começa no fim, que é onde a conversa está.
  React.useLayoutEffect(() => {
    if (loaded && messages.length > 0 && previousFirstId.current === null) {
      scrollToBottom();
    }
  }, [loaded, messages.length, scrollToBottom]);

  if (!loaded && loading) {
    return <MessageListSkeleton />;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-sm text-sm text-muted">{error}</p>
        <Button variant="secondary" size="sm" onClick={onReload}>
          <RefreshCw aria-hidden />
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="dc-scroll h-full overflow-y-auto overscroll-contain"
        // `log` faz o leitor de tela anunciar mensagens novas sem roubar o foco.
        role="log"
        aria-live="polite"
        aria-label={`Mensagens do canal ${channelName}`}
      >
        {hasMore ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 animate-spin text-subtle" aria-label="Carregando histórico" />
          </div>
        ) : (
          <ChannelIntro channelName={channelName} />
        )}

        <ol className="pb-4">
          {messages.map((message, index) => {
            const previous = index > 0 ? messages[index - 1] : undefined;

            const showDivider = !previous || !sameDay(previous.createdAt, message.createdAt);

            // Mensagens seguidas da mesma pessoa em poucos minutos são agrupadas:
            // repetir avatar e nome a cada linha polui a leitura.
            const grouped =
              !showDivider &&
              previous?.author.id === message.author.id &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
                5 * 60 * 1000 &&
              !message.replyTo;

            return (
              <React.Fragment key={message.id}>
                {showDivider ? <DayDivider date={message.createdAt} /> : null}
                <MessageItem
                  message={message}
                  grouped={grouped}
                  viewerId={viewerId}
                  canModerate={canModerate}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleReaction={onToggleReaction}
                />
              </React.Fragment>
            );
          })}
        </ol>
      </div>

      {!atBottom ? (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="dc-animate-in absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full border border-line bg-overlay px-3 py-1.5 text-xs font-medium text-content shadow-lg transition-colors hover:bg-elevated"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Ir para as mais recentes
        </button>
      ) : null}
    </div>
  );
}

function DayDivider({ date }: { date: string }) {
  return (
    <li className="relative my-4 flex items-center gap-3 px-4" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {formatDayDivider(date)}
      </span>
      <span className="h-px flex-1 bg-line" />
    </li>
  );
}

/** Cabeçalho mostrado quando o começo do canal está visível. */
function ChannelIntro({ channelName }: { channelName: string }) {
  return (
    <div className={cn('px-4 pb-2 pt-8')}>
      <h2 className="text-2xl font-bold text-content">Bem-vindo a #{channelName}</h2>
      <p className="mt-1 text-sm text-muted">Este é o começo do canal. Mande a primeira mensagem.</p>
    </div>
  );
}
