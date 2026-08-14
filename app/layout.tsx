import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DEFAULT_THEME, THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';

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
    <html lang="pt-BR" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        {/* Corrige o `data-theme` para quem escolheu o tema claro, antes de pintar. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
