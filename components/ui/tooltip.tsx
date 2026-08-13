'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Tooltip de conveniência: recebe o gatilho como filho e o texto como prop.
 * Radix já cuida de teclado (foco) e de `aria-describedby`.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  if (!content) return <>{children}</>;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-md border border-line bg-overlay px-2.5 py-1.5 text-xs font-medium text-content shadow-lg',
            'data-[state=delayed-open]:animate-[dc-fade-in_100ms_ease-out]',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[var(--dc-overlay)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
