'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

/** Emojis oferecidos direto na barra de ações, sem abrir o seletor. */
export const QUICK_REACTIONS = ['👍', '😂', '🔥', '❤️'] as const;

/**
 * Seletor de emojis enxuto.
 *
 * Uma lista curada em vez do conjunto Unicode inteiro: um grupo de amigos usa
 * duas dúzias de emojis, e uma biblioteca de picker completo custaria centenas
 * de kilobytes para resolver um problema que não existe aqui.
 */
const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: 'Reações',
    emojis: ['👍', '👎', '❤️', '🔥', '🎉', '👏', '🙌', '💯'],
  },
  {
    label: 'Rostos',
    emojis: ['😂', '🤣', '😅', '😊', '😍', '🤔', '😐', '😴', '😭', '😱', '🤯', '🥲'],
  },
  {
    label: 'Jogos e coisas',
    emojis: ['🎮', '🏎️', '⚽', '🍕', '☕', '💻', '🚀', '🐛', '✅', '❌', '👀', '🫡'],
  },
];

export function EmojiPicker({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: (emoji: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-lg border border-line bg-overlay p-2 shadow-xl data-[state=open]:animate-[dc-slide-up_120ms_ease-out]"
        >
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-subtle">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onSelect(emoji);
                      setOpen(false);
                    }}
                    className="rounded p-1 text-lg transition-colors hover:bg-elevated"
                    aria-label={`Reagir com ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
