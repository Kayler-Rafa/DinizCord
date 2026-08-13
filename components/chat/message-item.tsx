'use client';

import * as React from 'react';
import { CornerUpLeft, MoreVertical, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { cn, formatMessageTime } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmojiPicker, QUICK_REACTIONS } from './emoji-picker';
import { MessageContent } from './message-content';
import type { MessageDTO } from '@/lib/types';

interface MessageItemProps {
  message: MessageDTO;
  grouped: boolean;
  viewerId: string;
  canModerate: boolean;
  onReply: (message: MessageDTO) => void;
  onEdit: (messageId: string, content: string) => Promise<boolean>;
  onDelete: (messageId: string) => Promise<boolean>;
  onToggleReaction: (messageId: string, emoji: string) => void;
}

export const MessageItem = React.memo(function MessageItem({
  message,
  grouped,
  viewerId,
  canModerate,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
}: MessageItemProps) {
  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const isAuthor = message.author.id === viewerId;
  const canEdit = isAuthor;
  const canDelete = isAuthor || canModerate;

  return (
    <li
      className={cn(
        'group relative px-4 transition-colors hover:bg-elevated/40',
        grouped ? 'py-0.5' : 'mt-3 py-0.5',
      )}
    >
      {message.replyTo ? <ReplyPreview reply={message.replyTo} /> : null}

      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {grouped ? (
            // No modo agrupado, o horário ocupa o lugar do avatar no hover.
            <span className="hidden pt-1 text-right text-[10px] leading-5 text-subtle group-hover:block">
              {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(
                new Date(message.createdAt),
              )}
            </span>
          ) : (
            <Avatar name={message.author.displayName} color={message.author.avatarColor} size="lg" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!grouped ? (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-content">
                {message.author.displayName}
              </span>
              <time
                dateTime={message.createdAt}
                className="text-[11px] text-subtle"
                title={new Date(message.createdAt).toLocaleString('pt-BR')}
              >
                {formatMessageTime(message.createdAt)}
              </time>
            </div>
          ) : null}

          {editing ? (
            <EditBox
              initialContent={message.content}
              onCancel={() => setEditing(false)}
              onSave={async (content) => {
                const ok = await onEdit(message.id, content);
                if (ok) setEditing(false);
                return ok;
              }}
            />
          ) : (
            <MessageContent content={message.content} edited={message.editedAt !== null} />
          )}

          {message.reactions.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-1">
              {message.reactions.map((reaction) => (
                <li key={reaction.emoji}>
                  <Tooltip content={reaction.users.join(', ')}>
                    <button
                      type="button"
                      onClick={() => onToggleReaction(message.id, reaction.emoji)}
                      aria-pressed={reaction.reactedByMe}
                      aria-label={`${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? 'reação' : 'reações'}`}
                      className={cn(
                        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                        reaction.reactedByMe
                          ? 'border-accent bg-accent-soft text-content'
                          : 'border-line bg-elevated text-muted hover:border-line-strong',
                      )}
                    >
                      <span aria-hidden>{reaction.emoji}</span>
                      <span className="tabular-nums">{reaction.count}</span>
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {!editing ? (
        <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded-lg border border-line bg-overlay p-0.5 shadow-md group-focus-within:flex group-hover:flex">
          {QUICK_REACTIONS.map((emoji) => (
            <Tooltip key={emoji} content={`Reagir com ${emoji}`}>
              <button
                type="button"
                onClick={() => onToggleReaction(message.id, emoji)}
                className="rounded px-1.5 py-1 text-sm transition-colors hover:bg-elevated"
                aria-label={`Reagir com ${emoji}`}
              >
                {emoji}
              </button>
            </Tooltip>
          ))}

          <EmojiPicker onSelect={(emoji) => onToggleReaction(message.id, emoji)}>
            <button
              type="button"
              className="rounded p-1.5 text-subtle transition-colors hover:bg-elevated hover:text-content"
              aria-label="Escolher outro emoji"
            >
              <SmilePlus className="size-4" aria-hidden />
            </button>
          </EmojiPicker>

          <Tooltip content="Responder">
            <button
              type="button"
              onClick={() => onReply(message)}
              className="rounded p-1.5 text-subtle transition-colors hover:bg-elevated hover:text-content"
              aria-label="Responder mensagem"
            >
              <Reply className="size-4" aria-hidden />
            </button>
          </Tooltip>

          {canEdit || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded p-1.5 text-subtle transition-colors hover:bg-elevated hover:text-content"
                  aria-label="Mais ações"
                >
                  <MoreVertical className="size-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                {canEdit ? (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil aria-hidden />
                    Editar mensagem
                  </DropdownMenuItem>
                ) : null}

                {canDelete ? (
                  <DropdownMenuItem
                    destructive
                    onSelect={() => {
                      // Duplo passo em vez de diálogo: exclusão é frequente e o
                      // diálogo modal atrapalharia o ritmo da conversa.
                      if (confirmingDelete) {
                        void onDelete(message.id);
                      } else {
                        setConfirmingDelete(true);
                        setTimeout(() => setConfirmingDelete(false), 4_000);
                      }
                    }}
                  >
                    <Trash2 aria-hidden />
                    {confirmingDelete ? 'Confirmar exclusão' : 'Excluir mensagem'}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </li>
  );
});

function ReplyPreview({ reply }: { reply: NonNullable<MessageDTO['replyTo']> }) {
  return (
    <div className="mb-0.5 flex items-center gap-1.5 pl-[3.25rem] text-xs text-subtle">
      <CornerUpLeft className="size-3 shrink-0" aria-hidden />
      {reply.author ? (
        <span className="shrink-0 font-medium text-muted">{reply.author.displayName}</span>
      ) : null}
      <span className="truncate italic">
        {reply.deleted ? 'mensagem apagada' : reply.content}
      </span>
    </div>
  );
}

function EditBox({
  initialContent,
  onSave,
  onCancel,
}: {
  initialContent: string;
  onSave: (content: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initialContent);
  const [saving, setSaving] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    // Cursor no fim: quem edita quase sempre quer completar, não reescrever.
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  async function save() {
    if (saving || !value.trim() || value === initialContent) {
      onCancel();
      return;
    }
    setSaving(true);
    const ok = await onSave(value);
    if (!ok) setSaving(false);
  }

  return (
    <div className="mt-1">
      <Textarea
        ref={ref}
        value={value}
        rows={Math.min(8, value.split('\n').length || 1)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
        disabled={saving}
        aria-label="Editar mensagem"
        className="bg-elevated"
      />
      <p className="mt-1 text-[11px] text-subtle">
        <kbd className="font-sans">Esc</kbd> cancela · <kbd className="font-sans">Enter</kbd> salva
      </p>
    </div>
  );
}
