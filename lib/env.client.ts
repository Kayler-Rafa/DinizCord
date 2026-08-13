/**
 * Variáveis públicas (embutidas no bundle pelo Next em build time).
 *
 * O Next só substitui `process.env.NEXT_PUBLIC_X` quando a expressão aparece
 * literalmente no código — por isso os acessos abaixo não podem ser dinâmicos.
 *
 * Nada aqui é secreto: tudo é visível no navegador. Credenciais de TURN, por
 * exemplo, ficam no servidor e são entregues sob demanda por `/api/webrtc/ice`.
 */
export const clientEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001',
  stunServer: process.env.NEXT_PUBLIC_STUN_SERVER ?? 'stun:stun.l.google.com:19302',
} as const;
