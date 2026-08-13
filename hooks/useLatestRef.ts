'use client';

import * as React from 'react';

/**
 * Mantém uma ref com o valor mais recente de algo.
 *
 * Serve para o caso em que um callback de longa duração (um listener de socket,
 * um timer, um handler nativo) precisa ler o valor atual sem que a assinatura
 * seja refeita a cada mudança.
 *
 * A escrita acontece em um efeito, e não durante o render: escrever numa ref no
 * corpo do componente quebra o modelo concorrente do React, porque um render
 * descartado deixaria a ref alterada.
 *
 * Consequência: dentro do próprio render a ref ainda tem o valor anterior. Isso
 * não é problema para o uso pretendido — callbacks assíncronos só rodam depois
 * do commit, quando o efeito já atualizou o valor.
 */
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);

  React.useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}
