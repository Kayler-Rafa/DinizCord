import { ToastProvider } from '@/components/ui/toast';

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
