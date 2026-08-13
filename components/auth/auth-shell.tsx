import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';

/**
 * Moldura das telas de entrada.
 *
 * Layout centrado e estreito: as páginas de autenticação existem para uma
 * decisão só, então tudo que não é o formulário some.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-base px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/"
            className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent"
            aria-label="DinizCord"
          >
            <MessagesSquare className="size-6" aria-hidden />
          </Link>
          <h1 className="text-xl font-semibold text-content">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-lg">{children}</div>

        {footer ? <div className="mt-5 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </main>
  );
}
