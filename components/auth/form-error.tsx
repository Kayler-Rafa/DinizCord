import { AlertCircle } from 'lucide-react';

/** Erro que vale para o formulário inteiro, não para um campo específico. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="dc-animate-in flex items-start gap-2 rounded-[var(--radius-app)] border border-danger/40 bg-danger-soft p-3 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
