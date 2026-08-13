'use client';

import * as React from 'react';
import { useApp } from '@/components/providers/app-provider';
import { useLatestRef } from './useLatestRef';
import type { SelectableStatus } from '@/lib/types';

/** Depois deste tempo sem interação, o status vira "ausente" automaticamente. */
const AUTO_IDLE_MS = 5 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Presença do usuário atual.
 *
 * Expõe a troca manual de status e implementa o "ausente" automático: sem
 * interação por 5 minutos, o status cai para IDLE; a primeira interação o
 * devolve ao que o usuário havia escolhido.
 *
 * O auto-idle nunca sobrescreve DO_NOT_DISTURB — quem pediu para não ser
 * perturbado continua assim, mesmo longe do teclado.
 */
export function usePresence() {
  const { user, send } = useApp();

  const [preferred, setPreferred] = React.useState<SelectableStatus>(user.preferredStatus);
  const [activity, setActivityState] = React.useState<string | null>(user.activity);
  const [autoIdle, setAutoIdle] = React.useState(false);

  // O timer de inatividade é montado uma vez e vive fora do ciclo de render;
  // as refs deixam os callbacks lerem o estado atual sem religar os listeners a
  // cada troca de status.
  const preferredRef = useLatestRef(preferred);
  const autoIdleRef = useLatestRef(autoIdle);

  const effective: SelectableStatus = autoIdle && preferred === 'ONLINE' ? 'IDLE' : preferred;

  /** Troca escolhida pelo usuário — cancela o auto-idle em curso. */
  const setStatus = React.useCallback(
    (status: SelectableStatus) => {
      setPreferred(status);
      setAutoIdle(false);
      send({ t: 'presence:set', status });
    },
    [send],
  );

  const setActivity = React.useCallback(
    (value: string | null) => {
      const normalized = value?.trim() ? value.trim() : null;
      setActivityState(normalized);
      send({ t: 'presence:set', status: preferredRef.current, activity: normalized });
    },
    [send, preferredRef],
  );

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    // `auto: true` marca a mudança como efêmera: ela vale enquanto a conexão
    // durar, mas não substitui o status que o usuário escolheu.
    const goIdle = () => {
      if (preferredRef.current !== 'ONLINE' || autoIdleRef.current) return;
      setAutoIdle(true);
      send({ t: 'presence:set', status: 'IDLE', auto: true });
    };

    const reset = () => {
      clearTimeout(timer);

      if (autoIdleRef.current) {
        setAutoIdle(false);
        send({ t: 'presence:set', status: preferredRef.current, auto: true });
      }

      timer = setTimeout(goIdle, AUTO_IDLE_MS);
    };

    // Sair da aba conta como ausência imediata; voltar restaura o status.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        goIdle();
      } else {
        reset();
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    timer = setTimeout(goIdle, AUTO_IDLE_MS);

    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [send, preferredRef, autoIdleRef]);

  return { status: effective, preferred, activity, setStatus, setActivity };
}
