import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('dc-skeleton rounded-md', className)} aria-hidden />;
}

/** Placeholder do histórico de mensagens enquanto a primeira página carrega. */
export function MessageListSkeleton() {
  return (
    <div className="space-y-6 p-4" aria-busy role="status" aria-label="Carregando mensagens">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full max-w-md" />
            {index % 2 === 0 ? <Skeleton className="h-3 w-2/3 max-w-sm" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MemberListSkeleton() {
  return (
    <div className="space-y-3 p-3" aria-busy role="status" aria-label="Carregando membros">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
