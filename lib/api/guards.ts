import 'server-only';

import { prisma } from '@/lib/db/client';
import { getSession, type AuthenticatedSession } from '@/lib/auth/session';
import { ApiError } from './errors';
import type { ChannelType, MemberRole } from '@/lib/types';

/**
 * Guardas de autorização.
 *
 * Todo acesso a canal ou mensagem passa por aqui. A regra central é uma só:
 * *o servidor é derivado do recurso, nunca informado pelo cliente* — assim não
 * existe caminho em que um `serverId` forjado no corpo da requisição dê acesso
 * a um canal de outro servidor.
 */

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) {
    throw ApiError.unauthorized();
  }
  return session;
}

export interface MembershipContext {
  serverId: string;
  role: MemberRole;
  memberId: string;
}

/** Garante que o usuário é membro do servidor. */
export async function requireMembership(
  userId: string,
  serverId: string,
): Promise<MembershipContext> {
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    select: { id: true, role: true, serverId: true },
  });

  if (!member) {
    // 404 em vez de 403: quem não é membro não deve nem conseguir descobrir se
    // o servidor existe.
    throw ApiError.notFound('Servidor não encontrado.');
  }

  return { serverId: member.serverId, role: member.role, memberId: member.id };
}

export interface ChannelContext extends MembershipContext {
  channel: {
    id: string;
    name: string;
    type: ChannelType;
    topic: string | null;
    position: number;
    serverId: string;
  };
}

/**
 * Resolve o canal E confere a associação ao servidor dono dele, em uma consulta.
 */
export async function requireChannelAccess(
  userId: string,
  channelId: string,
  expectedType?: ChannelType,
): Promise<ChannelContext> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      name: true,
      type: true,
      topic: true,
      position: true,
      serverId: true,
      server: {
        select: {
          members: {
            where: { userId },
            select: { id: true, role: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!channel) {
    throw ApiError.notFound('Canal não encontrado.');
  }

  const member = channel.server.members[0];
  if (!member) {
    throw ApiError.notFound('Canal não encontrado.');
  }

  if (expectedType && channel.type !== expectedType) {
    throw ApiError.badRequest(
      expectedType === 'TEXT'
        ? 'Este canal não é um canal de texto.'
        : 'Este canal não é um canal de voz.',
    );
  }

  return {
    serverId: channel.serverId,
    role: member.role,
    memberId: member.id,
    channel: {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      topic: channel.topic,
      position: channel.position,
      serverId: channel.serverId,
    },
  };
}

const ROLE_RANK: Record<MemberRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

export function hasAtLeastRole(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function requireRole(role: MemberRole, minimum: MemberRole, action: string): void {
  if (!hasAtLeastRole(role, minimum)) {
    throw ApiError.forbidden(`Você precisa ser ${minimum === 'OWNER' ? 'o dono' : 'administrador'} do servidor para ${action}.`);
  }
}

/** Gerenciar canais e convites exige ADMIN ou OWNER. */
export function canManageServer(role: MemberRole): boolean {
  return hasAtLeastRole(role, 'ADMIN');
}

/**
 * Quem pode apagar uma mensagem: o autor sempre; admins e o dono apagam
 * qualquer uma (moderação).
 */
export function canDeleteMessage(params: {
  viewerId: string;
  authorId: string;
  role: MemberRole;
}): boolean {
  return params.viewerId === params.authorId || canManageServer(params.role);
}

/** Editar conteúdo é privativo do autor — nem o dono reescreve fala alheia. */
export function canEditMessage(params: { viewerId: string; authorId: string }): boolean {
  return params.viewerId === params.authorId;
}
