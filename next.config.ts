import type { NextConfig } from 'next';

/**
 * Cabeçalhos de segurança aplicados a todas as respostas.
 *
 * A CSP precisa liberar:
 *  - `connect-src` para o gateway WebSocket (host separado da Vercel);
 *  - `media-src blob:` para as MediaStreams do WebRTC/screen share;
 *  - `'unsafe-inline'` em style-src porque o Next injeta estilos inline no SSR.
 */
function buildCsp(): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  // Em produção a CSP lista exatamente os destinos permitidos. Curingas como
  // `wss:` anulariam boa parte do valor da diretiva — passariam a autorizar
  // qualquer servidor do mundo.
  if (!isDev && !wsUrl) {
    throw new Error(
      'NEXT_PUBLIC_WS_URL precisa estar definida no build de produção: ela entra na CSP ' +
        'e, sem ela, o navegador bloquearia a conexão com o gateway WebSocket.',
    );
  }

  const connectSrc = ["'self'", wsUrl, appUrl].filter(Boolean);

  // Em desenvolvimento o Turbopack usa um websocket em porta variável para o
  // hot reload, e engessar a lista quebraria o HMR.
  if (isDev) connectSrc.push('ws:', 'wss:');

  return [
    "default-src 'self'",
    // O runtime do Next precisa de eval em desenvolvimento (React Refresh).
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // `blob:` cobre as MediaStreams do WebRTC e do compartilhamento de tela.
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Impede que um link com `target=_blank` abra algo fora da origem em iframe.
    "frame-src 'none'",
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2', 'pino'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: buildCsp() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            // microphone/display-capture precisam ficar liberados para a própria origem.
            value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
