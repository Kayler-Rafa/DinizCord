'use client';

import * as React from 'react';
import { api, ApiClientError } from '@/lib/client/api';
import { useApp } from '@/components/providers/app-provider';
import { useChannelMessages } from './useStore';
import { useToast } from '@/components/ui/toast';

const PAGE_SIZE = 50;
/** Intervalo mínimo entre dois avisos de "digitando" enviados ao servidor. */
const TYPING_THROTTLE_MS = 3_000;

/**
 * Mensagens de um canal de texto.
 *
 * Carrega a primeira página ao entrar no canal e mantém o resto do histórico sob
 * demanda. As mensagens novas chegam pelo WebSocket direto no store — este hook
 * não faz polling.
 */
export function useMessages(channelId: string | null) {
  const { store, send } = useApp();
  const { toast } = useToast();
  const state = useChannelMessages(channelId);

  const lastTypingSentAt = React.useRef(0);
  const loadingMore = React.useRef(false);

  /**
   * Primeira página do canal.
   *
   * O resultado é escrito no store SEM guarda de cancelamento, de propósito. O
   * store é externo ao React e funciona como cache do canal: descartar uma
   * resposta que já chegou porque o efeito foi refeito (StrictMode em
   * desenvolvimento, Fast Refresh, uma ida e volta rápida entre canais) deixaria
   * `loading` preso em `true` para sempre — o canal ficaria no esqueleto com a
   * resposta correta já na mão.
   *
   * A deduplicação fica por conta do próprio estado `loading`, que só é ligado
   * aqui e desligado ao concluir ou falhar.
   */
  React.useEffect(() => {
    if (!channelId) return;

    const current = store.getSnapshot().messages[channelId];
    if (current?.loaded || current?.loading) return;

    store.setChannelLoading(channelId, true);

    api.channels
      .messages(channelId, { limit: PAGE_SIZE })
      .then((page) => store.setChannelMessages(channelId, page))
      .catch((error: unknown) => {
        store.setChannelError(
          channelId,
          error instanceof ApiClientError
            ? error.message
            : 'Não foi possível carregar as mensagens deste canal.',
        );
      });
  }, [channelId, store]);

  const loadMore = React.useCallback(async () => {
    if (!channelId || loadingMore.current) return;

    const current = store.getSnapshot().messages[channelId];
    if (!current?.hasMore || !current.nextCursor) return;

    loadingMore.current = true;
    try {
      const page = await api.channels.messages(channelId, {
        cursor: current.nextCursor,
        limit: PAGE_SIZE,
      });
      store.prependChannelMessages(channelId, page);
    } catch (error) {
      toast({
        title: 'Não foi possível carregar mais mensagens',
        description: error instanceof ApiClientError ? error.message : 'Tente rolar novamente.',
        variant: 'error',
      });
    } finally {
      loadingMore.current = false;
    }
  }, [channelId, store, toast]);

  /** Recarrega do zero — usado pelo botão de "tentar de novo". */
  const reload = React.useCallback(async () => {
    if (!channelId) return;

    store.setChannelLoading(channelId, true);
    try {
      const page = await api.channels.messages(channelId, { limit: PAGE_SIZE });
      store.setChannelMessages(channelId, page);
    } catch (error) {
      store.setChannelError(
        channelId,
        error instanceof ApiClientError ? error.message : 'Não foi possível carregar as mensagens.',
      );
    }
  }, [channelId, store]);

  /**
   * Envia a mensagem.
   *
   * A mensagem entra na lista pela resposta da API (e não por atualização
   * otimista): assim o id, o horário e as reações vêm do servidor, e não existe
   * a janela em que uma mensagem aparece na tela e depois some porque o envio
   * falhou. O envio é rápido o bastante para que a diferença não incomode.
   */
  const sendMessage = React.useCallback(
    async (content: string, replyToId?: string | null): Promise<boolean> => {
      if (!channelId) return false;

      try {
        const { message } = await api.channels.send(channelId, { content, replyToId });
        store.applyEvent({ t: 'message:create', message });
        store.clearUnread(channelId);
        return true;
      } catch (error) {
        toast({
          title: 'Mensagem não enviada',
          description:
            error instanceof ApiClientError ? error.message : 'Verifique sua conexão e tente de novo.',
          variant: 'error',
        });
        return false;
      }
    },
    [channelId, store, toast],
  );

  const editMessage = React.useCallback(
    async (messageId: string, content: string): Promise<boolean> => {
      try {
        const { message } = await api.messages.edit(messageId, content);
        store.applyEvent({ t: 'message:update', message });
        return true;
      } catch (error) {
        toast({
          title: 'Não foi possível editar',
          description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
          variant: 'error',
        });
        return false;
      }
    },
    [store, toast],
  );

  const deleteMessage = React.useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!channelId) return false;

      try {
        await api.messages.remove(messageId);
        store.applyEvent({ t: 'message:delete', channelId, messageId });
        return true;
      } catch (error) {
        toast({
          title: 'Não foi possível excluir',
          description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
          variant: 'error',
        });
        return false;
      }
    },
    [channelId, store, toast],
  );

  const toggleReaction = React.useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;

      try {
        const { reactions } = await api.messages.toggleReaction(messageId, emoji);
        store.setMessageReactions(channelId, messageId, reactions);
      } catch (error) {
        toast({
          title: 'Não foi possível reagir',
          description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
          variant: 'error',
        });
      }
    },
    [channelId, store, toast],
  );

  /** Avisa que está digitando, no máximo uma vez a cada 3 segundos. */
  const notifyTyping = React.useCallback(() => {
    if (!channelId) return;

    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;

    lastTypingSentAt.current = now;
    send({ t: 'typing', channelId });
  }, [channelId, send]);

  const markRead = React.useCallback(() => {
    if (!channelId) return;

    store.clearUnread(channelId);
    // Falha aqui só significa que o marcador ficou para trás; nada quebra.
    void api.channels.markRead(channelId).catch(() => undefined);
  }, [channelId, store]);

  return {
    messages: state?.messages ?? [],
    loading: state?.loading ?? !state?.loaded,
    loaded: state?.loaded ?? false,
    hasMore: state?.hasMore ?? false,
    error: state?.error ?? null,
    loadMore,
    reload,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    notifyTyping,
    markRead,
  };
}
