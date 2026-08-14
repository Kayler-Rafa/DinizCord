import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DinizCord',
    template: '%s · DinizCord',
  },
  description: 'Chat, voz e compartilhamento de tela para o grupo de amigos.',
  applicationName: 'DinizCord',
  // App privado: nada aqui deve ser indexado.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#08080a',
  width: 'device-width',
  initialScale: 1,
  // O app é uma UI de altura fixa; permitir zoom evita prender quem precisa dele.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
