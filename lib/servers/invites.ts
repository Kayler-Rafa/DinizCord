import 'server-only';

import { prisma } from '@/lib/db/client';
import { generateInviteCode } from '@/lib/auth/crypto';
import { ApiError } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { Topic } from '@/lib/realtime/topics';
import { toMemberDTO, toPublicUser, PUBLIC_USER_SELECT } from '@/lib/db/mappers';
import { scopedLogger } from '@/lib/logger';
import type { InviteDTO, InvitePreviewDTO } from '@/lib/types';

const log = scopedLogger('invites');

export interface UsableInvite {
  id: string;
  code: string;
  serverId: string;
}

/** Estado do convite ignorando se dá ou não para usar. */
export interface InviteRecord {
  id: string;
  code: string;
  serverId: string;
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  revokedAt: Date | null;
}

export function inviteInvalidReason(
  invite: InviteRecord,
  now = new Date(),
): 'EXPIRED' | 'REVOKED' | 'MAX_USES' | null {
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return 'MAX_USES';
  return null;
}

/** Busca o convite e devolve `null` se ele não estiver utilizável. */
export async function findUsableInvite(code: string): Promise<UsableInvite | null> {
  const invite = await prisma.invite.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      serverId: true,
      expiresAt: true,
      maxUses: true,
      uses: true,
      revokedAt: true,
    },
  });

  if (!invite || inviteInvalidReason(invite) !== null) return null;
  return { id: invite.id, code: invite.code, serverId: invite.serverId };
}

/**
 * Usa o convite e cria a associação.
 *
 * O incremento de `uses` é feito em SQL com as condições no próprio UPDATE, o
 * que torna a operação atômica: dois cliques simultâneos no último uso de um
 * convite não conseguem passar os dois — o segundo UPDATE não casa com o WHERE.
 */
export async function consumeInvite(
  invite: UsableInvite,
  userId: string,
): Promise<{ serverId: string; joined: boolean }> {
  const alreadyMember = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { id: true },
  });

  if (alreadyMember) {
    return { serverId: invite.serverId, joined: false };
  }

  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Invite"
    SET uses = uses + 1
    WHERE id = ${invite.id}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
      AND ("maxUses" IS NULL OR uses < "maxUses")
    RETURNING id
  `;

  if (claimed.length === 0) {
    throw new ApiError('CONFLICT', 'Este convite acabou de expirar ou esgotou os usos.');
  }

  const member = await prisma.serverMember.create({
    data: { serverId: invite.serverId, userId, role: 'MEMBER' },
    select: {
      id: true,
      role: true,
      nickname: true,
      joinedAt: true,
      user: { select: PUBLIC_USER_SELECT },
    },
  });

  await publishEvent(Topic.server(invite.serverId), {
    t: 'member:join',
    serverId: invite.serverId,
    member: toMemberDTO(member),
  });

  log.info(
    { userId, serverId: invite.serverId, inviteId: invite.id, event: 'invite.consumed' },
    'Convite utilizado',
  );

  return { serverId: invite.serverId, joined: true };
}

function inviteUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/invite/${code}`;
}

export function toInviteDTO(invite: {
  id: string;
  code: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  revokedAt: Date | null;
  creator: {
    id: string;
    username: string;
    displayName: string;
    avatarColor: string;
    avatarUpdatedAt: Date | null;
  };
}): InviteDTO {
  return {
    id: invite.id,
    code: invite.code,
    url: inviteUrl(invite.code),
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    maxUses: invite.maxUses,
    uses: invite.uses,
    revoked: invite.revokedAt !== null,
    active:
      inviteInvalidReason({
        id: invite.id,
        code: invite.code,
        serverId: '',
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        uses: invite.uses,
        revokedAt: invite.revokedAt,
      }) === null,
    creator: toPublicUser(invite.creator),
  };
}

export async function createInvite(params: {
  serverId: string;
  creatorId: string;
  expiresInSeconds: number | null;
  maxUses: number | null;
}): Promise<InviteDTO> {
  // Colisão de código é improvável (32^8 ≈ 1e12), mas o retry mantém a
  // operação determinística em vez de estourar um erro de constraint.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    const existing = await prisma.invite.findUnique({ where: { code }, select: { id: true } });
    if (existing) continue;

    const invite = await prisma.invite.create({
      data: {
        code,
        serverId: params.serverId,
        creatorId: params.creatorId,
        expiresAt: params.expiresInSeconds
          ? new Date(Date.now() + params.expiresInSeconds * 1000)
          : null,
        maxUses: params.maxUses,
      },
      select: {
        id: true,
        code: true,
        createdAt: true,
        expiresAt: true,
        maxUses: true,
        uses: true,
        revokedAt: true,
        creator: { select: PUBLIC_USER_SELECT },
      },
    });

    log.info(
      { serverId: params.serverId, creatorId: params.creatorId, event: 'invite.created' },
      'Convite criado',
    );

    return toInviteDTO(invite);
  }

  throw new ApiError('INTERNAL_ERROR', 'Não foi possível gerar um código de convite. Tente de novo.');
}

export async function previewInvite(
  code: string,
  viewerId: string | null,
): Promise<InvitePreviewDTO> {
  const invite = await prisma.invite.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      serverId: true,
      expiresAt: true,
      maxUses: true,
      uses: true,
      revokedAt: true,
      creator: { select: PUBLIC_USER_SELECT },
      server: {
        select: {
          id: true,
          name: true,
          iconEmoji: true,
          _count: { select: { members: true } },
        },
      },
    },
  });

  if (!invite) {
    throw ApiError.notFound('Este convite não existe.');
  }

  const alreadyMember = viewerId
    ? (await prisma.serverMember.findUnique({
        where: { serverId_userId: { serverId: invite.serverId, userId: viewerId } },
        select: { id: true },
      })) !== null
    : false;

  return {
    code: invite.code,
    server: {
      id: invite.server.id,
      name: invite.server.name,
      iconEmoji: invite.server.iconEmoji,
      memberCount: invite.server._count.members,
    },
    inviter: toPublicUser(invite.creator),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    invalidReason: inviteInvalidReason(invite),
    alreadyMember,
  };
}
