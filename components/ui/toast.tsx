'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Avisos temporários.
 *
 * Usados para o que acontece fora do fluxo direto do usuário (falha ao enviar,
 * permissão negada pelo navegador, reconexão). Erros de formulário NÃO vêm para
 * cá: eles pertencem ao campo que os causou.
 */

export type ToastVariant = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  title: string;
  description?: string | undefined;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6_000;

const ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

const STYLES: Record<ToastVariant, string> = {
  info: 'border-line',
  success: 'border-success/40',
  error: 'border-danger/40',
};

const ICON_STYLES: Record<ToastVariant, string> = {
  info: 'text-muted',
  success: 'text-success',
  error: 'text-danger',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    ({ title, description, variant = 'info' }) => {
      const id = nextId.current++;
      // Teto de 4 avisos: uma falha de rede em cadeia não deve cobrir a tela.
      setToasts((current) => [...current.slice(-3), { id, title, description, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        // `polite` para não interromper o que o leitor de tela está falando.
        role="status"
        aria-live="polite"
      >
        {toasts.map((item) => {
          const Icon = ICONS[item.variant];
          return (
            <div
              key={item.id}
              className={cn(
                'dc-animate-in pointer-events-auto flex items-start gap-3 rounded-lg border bg-overlay p-3 shadow-xl',
                STYLES[item.variant],
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_STYLES[item.variant])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs text-muted">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded p-0.5 text-subtle transition-colors hover:text-content"
                aria-label="Dispensar aviso"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  }
  return context;
}
