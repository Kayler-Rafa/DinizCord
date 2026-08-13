'use client';

import * as React from 'react';
import { Check, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { formatRelativeTime } from '@/lib/utils';
import type { InviteDTO } from '@/lib/types';

const EXPIRY_OPTIONS = [
  { label: '30 minutos', value: 30 * 60 },
  { label: '1 dia', value: 24 * 60 * 60 },
  { label: '7 dias', value: 7 * 24 * 60 * 60 },
  { label: 'Nunca', value: null },
] as const;

const USES_OPTIONS = [
  { label: '1 uso', value: 1 },
  { label: '5 usos', value: 5 },
  { label: '25 usos', value: 25 },
  { label: 'Ilimitado', value: null },
] as const;

/** Criação e gerenciamento de convites. */
export function InviteDialog({
  serverId,
  open,
  onOpenChange,
}: {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();

  const [invites, setInvites] = React.useState<InviteDTO[] | null>(null);
  const [expiresInSeconds, setExpiresIn] = React.useState<number | null>(7 * 24 * 60 * 60);
  const [maxUses, setMaxUses] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;
    api.invites
      .list(serverId)
      .then((result) => {
        if (!cancelled) setInvites(result.invites);
      })
      .catch(() => {
        if (!cancelled) setInvites([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, serverId]);

  async function handleCreate() {
    setCreating(true);
    try {
      const { invite } = await api.invites.create(serverId, { expiresInSeconds, maxUses });
      setInvites((current) => [invite, ...(current ?? [])]);
      await copyToClipboard(invite.url, toast);
    } catch (error) {
      toast({
        title: 'Não foi possível criar o convite',
        description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    try {
      await api.invites.revoke(inviteId);
      setInvites(
        (current) =>
          current?.map((invite) =>
            invite.id === inviteId ? { ...invite, revoked: true, active: false } : invite,
          ) ?? null,
      );
    } catch (error) {
      toast({
        title: 'Não foi possível revogar o convite',
        description: error instanceof ApiClientError ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Convidar pessoas</DialogTitle>
          <DialogDescription>
            Qualquer pessoa com o link pode entrar no servidor enquanto o convite estiver válido.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <OptionGroup
              label="Expira em"
              options={EXPIRY_OPTIONS}
              value={expiresInSeconds}
              onChange={setExpiresIn}
            />
            <OptionGroup
              label="Número de usos"
              options={USES_OPTIONS}
              value={maxUses}
              onChange={setMaxUses}
            />
          </div>

          <Button className="w-full" loading={creating} onClick={() => void handleCreate()}>
            <Link2 aria-hidden />
            Gerar link e copiar
          </Button>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
              Convites ativos
            </h3>

            {invites === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-4 animate-spin text-subtle" aria-label="Carregando" />
              </div>
            ) : invites.length === 0 ? (
              <p className="py-4 text-sm text-subtle">Nenhum convite criado ainda.</p>
            ) : (
              <ul className="dc-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
                {invites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    onRevoke={() => void handleRevoke(invite.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptionGroup<T extends number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            className={
              option.value === value
                ? 'rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-on-accent'
                : 'rounded-md bg-elevated px-2.5 py-1 text-xs text-muted transition-colors hover:text-content'
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function InviteRow({ invite, onRevoke }: { invite: InviteDTO; onRevoke: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm text-content">{invite.code}</p>
        <p className="truncate text-[11px] text-subtle">
          {invite.revoked
            ? 'Revogado'
            : !invite.active
              ? 'Expirado ou esgotado'
              : [
                  invite.expiresAt
                    ? `expira ${formatRelativeTime(invite.expiresAt)}`
                    : 'sem expiração',
                  invite.maxUses ? `${invite.uses}/${invite.maxUses} usos` : `${invite.uses} usos`,
                ].join(' · ')}
        </p>
      </div>

      <button
        type="button"
        disabled={!invite.active}
        onClick={async () => {
          const ok = await copyToClipboard(invite.url, toast);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
        className="shrink-0 rounded p-1.5 text-subtle transition-colors hover:text-content disabled:opacity-40"
        aria-label="Copiar link do convite"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>

      <button
        type="button"
        disabled={invite.revoked}
        onClick={onRevoke}
        className="shrink-0 rounded p-1.5 text-subtle transition-colors hover:text-danger disabled:opacity-40"
        aria-label="Revogar convite"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

/**
 * Copia para a área de transferência.
 *
 * A Clipboard API exige contexto seguro (https ou localhost) e pode ser negada;
 * quando isso acontece, o link é mostrado para cópia manual em vez de falhar em
 * silêncio.
 */
async function copyToClipboard(
  text: string,
  toast: (input: { title: string; description?: string; variant?: 'info' | 'success' | 'error' }) => void,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Link copiado', description: text, variant: 'success' });
    return true;
  } catch {
    toast({
      title: 'Copie o link manualmente',
      description: text,
      variant: 'info',
    });
    return false;
  }
}
