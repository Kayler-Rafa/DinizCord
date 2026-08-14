'use client';

import * as React from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiClientError } from '@/lib/client/api';
import { AvatarError, ACCEPTED_TYPES, prepararAvatar } from '@/lib/client/avatar-upload';

/**
 * Escolha da foto de perfil.
 *
 * A imagem é reduzida no navegador antes de subir (ver `avatar-upload.ts`), e a
 * prévia usa a versão já processada — assim o usuário vê exatamente o recorte
 * que os outros vão ver, e não a foto original.
 */
export function AvatarPicker({
  userId,
  name,
  color,
  avatarUrl,
  onChange,
}: {
  userId: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  onChange: (avatarUrl: string | null) => void;
}) {
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [enviando, setEnviando] = React.useState(false);
  const [previa, setPrevia] = React.useState<string | null>(null);

  // Um object URL segura memória até ser revogado.
  React.useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa);
    };
  }, [previa]);

  async function aoEscolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    // Zera o input para que escolher o MESMO arquivo de novo dispare o evento.
    evento.target.value = '';
    if (!arquivo) return;

    setEnviando(true);

    try {
      const processada = await prepararAvatar(arquivo);

      const url = URL.createObjectURL(processada);
      setPrevia((anterior) => {
        if (anterior) URL.revokeObjectURL(anterior);
        return url;
      });

      const { avatarUrl: nova } = await api.me.uploadAvatar(processada);
      onChange(nova);
      toast({ title: 'Foto atualizada', variant: 'success' });
    } catch (erro) {
      toast({
        title: 'Não foi possível usar essa foto',
        description:
          erro instanceof AvatarError || erro instanceof ApiClientError
            ? erro.message
            : 'Tente outra imagem.',
        variant: 'error',
      });
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    setEnviando(true);
    try {
      await api.me.removeAvatar();
      setPrevia((anterior) => {
        if (anterior) URL.revokeObjectURL(anterior);
        return null;
      });
      onChange(null);
      toast({ title: 'Foto removida', variant: 'success' });
    } catch (erro) {
      toast({
        title: 'Não foi possível remover',
        description: erro instanceof ApiClientError ? erro.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setEnviando(false);
    }
  }

  const mostrada = previa ?? avatarUrl;

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar name={name} color={color} src={mostrada} size="xl" />

        {enviando ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
            <Loader2 className="size-5 animate-spin text-white" aria-label="Enviando" />
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          id={`avatar-${userId}`}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={(evento) => void aoEscolher(evento)}
          className="sr-only"
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={enviando}
            onClick={() => inputRef.current?.click()}
          >
            <Camera aria-hidden />
            {mostrada ? 'Trocar foto' : 'Escolher foto'}
          </Button>

          {mostrada ? (
            <Button
              type="button"
              variant="danger-ghost"
              size="sm"
              disabled={enviando}
              onClick={() => void remover()}
            >
              <Trash2 aria-hidden />
              Remover
            </Button>
          ) : null}
        </div>

        <p className="mt-2 text-xs text-subtle">
          A imagem é recortada em quadrado e reduzida para 256×256 antes de enviar.
        </p>
      </div>
    </div>
  );
}
