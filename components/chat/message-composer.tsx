'use client';

import * as React from 'react';
import { CornerUpLeft, SendHorizontal, SmilePlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmojiPicker } from './emoji-picker';
import { Tooltip } from '@/components/ui/tooltip';
import type { MessageDTO } from '@/lib/types';

const MAX_LENGTH = 4000;
/** A partir daqui o contador aparece. */
const COUNTER_THRESHOLD = 3600;

/**
 * Caixa de escrita.
 *
 * Enter envia, Shift+Enter quebra linha — a convenção de todo chat. A altura
 * acompanha o conteúdo até um limite, para que uma mensagem longa não engula a
 * conversa.
 */
export function MessageComposer({
  channelName,
  disabled,
  replyingTo,
  onCancelReply,
  onSend,
  onTyping,
}: {
  channelName: string;
  disabled: boolean;
  replyingTo: MessageDTO | null;
  onCancelReply: () => void;
  onSend: (content: string, replyToId: string | null) => Promise<boolean>;
  onTyping: () => void;
}) {
  const [value, setValue] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const resize = React.useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, []);

  React.useEffect(resize, [value, resize]);

  // Ao começar a responder, o foco vai para a caixa: o usuário já está no fluxo.
  React.useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  async function submit() {
    const content = value.trim();
    if (!content || sending || disabled) return;

    setSending(true);
    const ok = await onSend(content, replyingTo?.id ?? null);
    setSending(false);

    if (ok) {
      // Só limpa em caso de sucesso: perder o texto digitado por causa de uma
      // falha de rede seria o pior desfecho possível.
      setValue('');
      onCancelReply();
    }

    textareaRef.current?.focus();
  }

  function insertEmoji(emoji: string) {
    const element = textareaRef.current;
    if (!element) {
      setValue((current) => current + emoji);
      return;
    }

    const start = element.selectionStart;
    const end = element.selectionEnd;
    setValue((current) => current.slice(0, start) + emoji + current.slice(end));

    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  const remaining = MAX_LENGTH - value.length;

  return (
    <div className="shrink-0 px-4 pb-4 pt-1">
      {replyingTo ? (
        <div className="dc-animate-in flex items-center gap-2 rounded-t-lg border border-b-0 border-line bg-elevated px-3 py-1.5 text-xs">
          <CornerUpLeft className="size-3 shrink-0 text-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-muted">
            Respondendo a{' '}
            <span className="font-medium text-content">{replyingTo.author.displayName}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded p-0.5 text-subtle transition-colors hover:text-content"
            aria-label="Cancelar resposta"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-end gap-1 border border-line bg-surface px-2 py-1.5 transition-colors',
          'focus-within:border-line-strong',
          replyingTo ? 'rounded-b-lg' : 'rounded-lg',
          disabled && 'opacity-60',
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          maxLength={MAX_LENGTH}
          disabled={disabled || sending}
          placeholder={disabled ? 'Reconectando…' : `Conversar em #${channelName}`}
          aria-label={`Escrever mensagem em ${channelName}`}
          onChange={(event) => {
            setValue(event.target.value);
            if (event.target.value.trim()) onTyping();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
            if (event.key === 'Escape' && replyingTo) {
              event.preventDefault();
              onCancelReply();
            }
          }}
          className="dc-scroll max-h-60 min-h-[1.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-content outline-none placeholder:text-subtle disabled:cursor-not-allowed"
        />

        {remaining <= MAX_LENGTH - COUNTER_THRESHOLD ? (
          <span
            className={cn(
              'shrink-0 pb-2 text-[11px] tabular-nums',
              remaining < 100 ? 'text-danger' : 'text-subtle',
            )}
            aria-live="polite"
          >
            {remaining}
          </span>
        ) : null}

        <EmojiPicker onSelect={insertEmoji}>
          <button
            type="button"
            disabled={disabled}
            className="shrink-0 rounded-md p-2 text-subtle transition-colors hover:bg-elevated hover:text-content disabled:cursor-not-allowed"
            aria-label="Inserir emoji"
          >
            <SmilePlus className="size-4" aria-hidden />
          </button>
        </EmojiPicker>

        <Tooltip content="Enviar (Enter)">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!value.trim() || sending || disabled}
            className={cn(
              'shrink-0 rounded-md p-2 transition-colors',
              value.trim() && !disabled
                ? 'bg-accent text-on-accent hover:bg-accent-hover'
                : 'text-subtle',
              'disabled:cursor-not-allowed',
            )}
            aria-label="Enviar mensagem"
          >
            <SendHorizontal className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
