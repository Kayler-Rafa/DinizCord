import Link from 'next/link';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { previewInvite } from '@/lib/servers/invites';
import { inviteCodeSchema } from '@/lib/validation/schemas';
import { ApiError } from '@/lib/api/errors';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { AcceptInviteButton } from '@/components/server/accept-invite-button';
import type { InvitePreviewDTO } from '@/lib/types';

export const metadata: Metadata = { title: 'Convite' };

type Params = { params: Promise<{ code: string }> };

const INVALID_MESSAGES: Record<NonNullable<InvitePreviewDTO['invalidReason']>, string> = {
  EXPIRED: 'Este convite expirou.',
  REVOKED: 'Este convite foi revogado.',
  MAX_USES: 'Este convite atingiu o limite de usos.',
};

/**
 * Página de convite.
 *
 * Renderizada no servidor para que quem recebe o link veja de imediato para
 * onde está sendo chamado — mesmo sem conta. Só a ação de entrar exige sessão.
 */
export default async function InvitePage({ params }: Params) {
  const { code } = await params;
  const parsed = inviteCodeSchema.safeParse(code);

  if (!parsed.success) {
    return <InviteError message="Este link de convite não é válido." />;
  }

  const session = await getSession();

  let preview: InvitePreviewDTO;
  try {
    preview = await previewInvite(parsed.data, session?.user.id ?? null);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      return <InviteError message="Este convite não existe ou já foi apagado." />;
    }
    throw error;
  }

  if (preview.invalidReason) {
    return <InviteError message={INVALID_MESSAGES[preview.invalidReason]} />;
  }

  return (
    <AuthShell
      title={preview.server.name}
      subtitle={`${preview.inviter.displayName} convidou você`}
    >
      <div className="space-y-5 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-elevated text-3xl">
            {preview.server.iconEmoji}
          </span>
          <p className="text-sm text-muted">
            {preview.server.memberCount}{' '}
            {preview.server.memberCount === 1 ? 'membro' : 'membros'}
          </p>
        </div>

        {preview.alreadyMember ? (
          <>
            <p className="text-sm text-muted">Você já faz parte deste servidor.</p>
            <Button asChild className="w-full" size="lg">
              <Link href="/app">Abrir o DinizCord</Link>
            </Button>
          </>
        ) : session ? (
          <AcceptInviteButton code={preview.code} />
        ) : (
          <>
            <p className="text-sm text-muted">
              Entre na sua conta ou crie uma para aceitar o convite.
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full" size="lg">
                <Link href={`/cadastrar?convite=${preview.code}`}>Criar conta e entrar</Link>
              </Button>
              <Button asChild variant="secondary" className="w-full">
                <Link href={`/entrar?proximo=/invite/${preview.code}`}>Já tenho conta</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}

function InviteError({ message }: { message: string }) {
  return (
    <AuthShell title="Convite indisponível" subtitle={message}>
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">
          Peça um link novo a alguém que já faça parte do servidor.
        </p>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/entrar">Ir para o login</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
