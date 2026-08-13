import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { serverEnv } from '@/lib/env.server';

/**
 * Ticket de handshake do WebSocket.
 *
 * O gateway roda em outro processo (e, em produção, em outro domínio), então o
 * cookie de sessão não chega até ele. O fluxo é:
 *
 *   1. o navegador, já autenticado por cookie, pede um ticket em
 *      `POST /api/gateway/ticket`;
 *   2. o ticket é um JWT de vida curta assinado com AUTH_SECRET;
 *   3. o gateway valida a assinatura e ainda confere no banco se a sessão
 *      continua ativa — assinatura válida não basta se o usuário deslogou.
 *
 * A vida curta importa: o ticket vai na query string da URL do WebSocket, que
 * costuma aparecer em logs de proxy. 60 segundos limitam a janela de replay.
 */
const TICKET_TTL_SECONDS = 60;
const ISSUER = 'dinizcord';
const AUDIENCE = 'dinizcord-gateway';

export interface GatewayTicketClaims {
  userId: string;
  sessionId: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv().AUTH_SECRET);
}

export async function issueGatewayTicket(claims: GatewayTicketClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(secretKey());
}

export type TicketVerificationResult =
  | { ok: true; claims: GatewayTicketClaims }
  | { ok: false; reason: 'EXPIRED' | 'INVALID' };

export async function verifyGatewayTicket(token: string): Promise<TicketVerificationResult> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    const sessionId = payload.sid;
    if (typeof payload.sub !== 'string' || typeof sessionId !== 'string') {
      return { ok: false, reason: 'INVALID' };
    }

    return { ok: true, claims: { userId: payload.sub, sessionId } };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      return { ok: false, reason: 'EXPIRED' };
    }
    return { ok: false, reason: 'INVALID' };
  }
}

export const TICKET_TTL_MS = TICKET_TTL_SECONDS * 1000;
