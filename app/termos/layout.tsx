import { ToastProvider } from '@/components/ui/toast';

export default function TermosLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
