import { ToastProvider } from '@/components/ui/toast';

/** As telas de autenticação só precisam de avisos temporários. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
