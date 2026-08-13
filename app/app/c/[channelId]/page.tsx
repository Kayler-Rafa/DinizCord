import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { requireChannelAccess } from '@/lib/api/guards';
import { ApiError } from '@/lib/api/errors';
import { ChannelView } from '@/components/chat/channel-view';

type Params = { params: Promise<{ channelId: string }> };

/**
 * Resolve o canal validando o acesso no servidor.
 *
 * A checagem acontece aqui, e não só na API: sem isso, quem colasse o id de um
 * canal alheio veria a moldura da página antes de o cliente descobrir que não
 * tem permissão.
 */
async function loadChannel(channelId: string) {
  const session = await getSession();
  if (!session) redirect('/entrar');

  try {
    const context = await requireChannelAccess(session.user.id, channelId, 'TEXT');
    return context.channel;
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) {
      notFound();
    }
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { channelId } = await params;
  const channel = await loadChannel(channelId);
  return { title: `#${channel.name}` };
}

export default async function ChannelPage({ params }: Params) {
  const { channelId } = await params;
  await loadChannel(channelId);

  return <ChannelView channelId={channelId} />;
}
