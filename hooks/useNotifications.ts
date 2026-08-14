'use client';

import * as React from 'react';
import { useApp } from '@/components/providers/app-provider';
import { useStoreSelector } from './useStore';
import { tocarSom } from '@/lib/client/sounds';
import type { ServerEvent } from '@/lib/websocket/protocol';

const TITULO_BASE = 'DinizCord';

/**
 * Avisos de mensagem nova.
 *
 * Três camadas, da mais discreta à mais intrusiva:
 *
 *  1. **Contador no título da aba** — sempre. É o que faz alguém com a aba
 *     aberta em segundo plano perceber que há algo novo.
 *  2. **Som** — só quando a aba não está em foco. Bipar enquanto a pessoa lê a
 *     conversa seria irritante.
 *  3. **Notificação do sistema** — só em menção direta e só com permissão
 *     concedida. Notificar toda mensagem de um grupo ativo faria qualquer um
 *     desligar as notificações no primeiro dia.
 *
 * Não há service worker: os avisos só existem com a aba aberta. É uma limitação
 * consciente — push real exigiria service worker, VAPID e um servidor de push.
 */
export function useNotifications() {
  const { user, onEvent } = useApp();
  const totalNaoLidas = useStoreSelector((estado) =>
    Object.values(estado.unreads).reduce((soma, quantidade) => soma + quantidade, 0),
  );

  /**
   * A permissão vem do próprio navegador, não de estado nosso.
   *
   * `useSyncExternalStore` evita o `useEffect` + `setState` que geraria um
   * render a mais na montagem, e mantém o valor correto no SSR.
   * `versaoPermissao` força a releitura depois que o usuário responde ao
   * diálogo — o navegador não emite evento para isso.
   */
  const [versaoPermissao, setVersaoPermissao] = React.useState(0);

  const permissao = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    React.useCallback(
      () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [versaoPermissao],
    ),
    () => 'default' as NotificationPermission,
  );

  /** Contador no título — a camada que sempre funciona. */
  React.useEffect(() => {
    document.title = totalNaoLidas > 0 ? `(${totalNaoLidas}) ${TITULO_BASE}` : TITULO_BASE;

    return () => {
      document.title = TITULO_BASE;
    };
  }, [totalNaoLidas]);

  React.useEffect(() => {
    return onEvent((evento: ServerEvent) => {
      if (evento.t !== 'message:create') return;

      const mensagem = evento.message;
      if (mensagem.author.id === user.id) return;

      const emFoco = document.visibilityState === 'visible' && document.hasFocus();
      const meCitou = mensagem.mentions.includes(user.id);

      if (!emFoco) {
        tocarSom(meCitou ? 'mencao' : 'mensagem');
      }

      if (meCitou && !emFoco && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const notificacao = new Notification(`${mensagem.author.displayName} mencionou você`, {
            body: mensagem.content.slice(0, 140),
            // A tag agrupa: dez menções não viram dez notificações empilhadas.
            tag: `dinizcord-${mensagem.channelId}`,
            icon: mensagem.author.avatarUrl ?? undefined,
          });

          notificacao.onclick = () => {
            window.focus();
            notificacao.close();
          };
        } catch {
          // Alguns navegadores recusam o construtor fora de um service worker.
        }
      }
    });
  }, [onEvent, user.id]);

  const pedirPermissao = React.useCallback(async () => {
    if (typeof Notification === 'undefined') return;

    const resultado = await Notification.requestPermission();
    setVersaoPermissao((atual) => atual + 1);

    if (resultado === 'granted') {
      // Confirma que funcionou — sem isso a pessoa concede e não vê nada.
      new Notification('Notificações ativadas', {
        body: 'Você será avisado quando alguém mencionar seu nome.',
      });
    }
  }, []);

  return {
    permissao,
    pedirPermissao,
    suportado: typeof window !== 'undefined' && 'Notification' in window,
    totalNaoLidas,
  };
}
