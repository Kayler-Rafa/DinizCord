'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ScrollText, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError } from './form-error';
import { api, ApiClientError } from '@/lib/client/api';
import { RESUMO_DOS_TERMOS, TERMS_VERSION } from '@/lib/terms';

/**
 * Tela de aceite dos termos.
 *
 * Só há dois caminhos daqui: aceitar e entrar, ou recusar e sair. Não existe
 * botão de fechar, não existe Esc e não existe nada renderizado por trás —
 * pular a tela pelo navegador não adianta, porque a API recusa qualquer
 * requisição de quem não aceitou.
 *
 * O botão de aceitar só habilita depois que o texto foi rolado até o fim: é
 * frágil como prova de leitura, mas remove o "aceitei sem ver que havia algo
 * escrito", e o custo para quem realmente quer entrar é um gesto.
 */
export function TermsGate({ nomeExibicao }: { nomeExibicao: string }) {
  const router = useRouter();

  const [enviando, setEnviando] = React.useState(false);
  const [recusou, setRecusou] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [leuAteOFim, setLeuAteOFim] = React.useState(false);

  const areaRef = React.useRef<HTMLDivElement>(null);

  /** Marca como lido quando o fim do texto entra em vista. */
  function aoRolar(evento: React.UIEvent<HTMLDivElement>) {
    const elemento = evento.currentTarget;
    const faltando = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight;
    if (faltando < 24) setLeuAteOFim(true);
  }

  // Texto curto o bastante para não ter rolagem: nada a exigir.
  React.useEffect(() => {
    const elemento = areaRef.current;
    if (elemento && elemento.scrollHeight <= elemento.clientHeight) setLeuAteOFim(true);
  }, []);

  async function aceitar() {
    setEnviando(true);
    setErro(null);

    try {
      await api.terms.accept();
      router.replace('/app');
      // Necessário para o layout do servidor reler a sessão já com o aceite.
      router.refresh();
    } catch (caught) {
      setErro(
        caught instanceof ApiClientError
          ? caught.message
          : 'Não foi possível registrar o aceite. Tente novamente.',
      );
      setEnviando(false);
    }
  }

  async function recusar() {
    // Encerra a sessão: recusar não pode deixar a pessoa autenticada.
    await api.auth.logout().catch(() => undefined);

    setRecusou(true);

    // `window.close()` só funciona em aba aberta por script — o navegador
    // bloqueia o fechamento de uma aba que a pessoa abriu. Por isso a tela de
    // recusa abaixo existe: ela é o que ela realmente vai ver na maioria dos
    // casos.
    window.close();
  }

  if (recusou) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-base px-4 text-center">
        <ShieldAlert className="mb-4 size-10 text-muted" aria-hidden />
        <h1 className="text-lg font-semibold text-content">Termos recusados</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">
          Você saiu da conta e não pode usar o DinizCord sem aceitar os termos. Pode fechar esta
          aba.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-6"
          onClick={() => router.replace('/entrar')}
        >
          Mudei de ideia
        </Button>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-base px-4 py-8">
      <div className="w-full max-w-xl rounded-xl border border-line bg-surface shadow-2xl">
        <header className="border-b border-line p-6">
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-accent text-on-accent">
            <ScrollText className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-content">
            Antes de começar, {nomeExibicao}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Para usar o DinizCord é preciso aceitar os termos de uso. Leia com atenção — o texto é
            curto.
          </p>
        </header>

        <div
          ref={areaRef}
          onScroll={aoRolar}
          className="dc-scroll max-h-[45vh] space-y-4 overflow-y-auto p-6"
          tabIndex={0}
          role="region"
          aria-label="Termos de uso"
        >
          {RESUMO_DOS_TERMOS.map((item) => (
            <section key={item.titulo}>
              <h2 className="text-sm font-semibold text-content">{item.titulo}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{item.texto}</p>
            </section>
          ))}

          <p className="border-t border-line pt-4 text-xs text-subtle">
            Este é um resumo dos pontos principais. O documento completo, com todas as cláusulas,
            está em{' '}
            <a
              href="https://github.com/Kayler-Rafa/DinizCord/blob/main/TERMS.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
            >
              <FileText className="size-3" aria-hidden />
              TERMS.md
            </a>
            , e a licença do código em{' '}
            <a
              href="https://github.com/Kayler-Rafa/DinizCord/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              LICENSE
            </a>
            . Versão vigente: {TERMS_VERSION}.
          </p>
        </div>

        <footer className="space-y-3 border-t border-line p-6">
          <FormError message={erro} />

          {!leuAteOFim ? (
            <p className="text-xs text-subtle" role="status">
              Role o texto até o fim para habilitar o aceite.
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => void recusar()}>
              Não aceito
            </Button>
            <Button
              type="button"
              loading={enviando}
              disabled={!leuAteOFim}
              onClick={() => void aceitar()}
            >
              Li e aceito os termos
            </Button>
          </div>
        </footer>
      </div>
    </main>
  );
}
