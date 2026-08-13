import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ChannelNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <SearchX className="size-10 text-subtle" aria-hidden />
      <h1 className="text-lg font-semibold text-content">Canal não encontrado</h1>
      <p className="max-w-sm text-sm text-muted">
        Ele pode ter sido excluído, ou você não faz parte do servidor a que ele pertence.
      </p>
      <Button asChild variant="secondary" size="sm">
        <Link href="/app">Voltar ao início</Link>
      </Button>
    </div>
  );
}
