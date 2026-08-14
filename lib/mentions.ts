/**
 * Menções no texto das mensagens.
 *
 * Módulo puro e compartilhado: o servidor usa para resolver `@nome` em ids de
 * usuário na hora de gravar a mensagem, e o cliente usa para destacar o mesmo
 * trecho na tela. Uma regra só, nos dois lados — se divergissem, o destaque
 * marcaria uma coisa e a notificação outra.
 */

/**
 * O padrão aceita exatamente os caracteres válidos em nome de usuário (ver
 * `usernameSchema`). Precedido por início de linha ou espaço, para que um
 * e-mail no meio do texto não vire menção.
 */
const MENCAO = /(^|\s)@([a-z0-9._-]{3,24})/gi;

/** Nomes de usuário citados no texto, sem repetição e em minúsculas. */
export function extrairMencoes(conteudo: string): string[] {
  const encontrados = new Set<string>();

  for (const match of conteudo.matchAll(MENCAO)) {
    const nome = match[2];
    if (nome) encontrados.add(nome.toLowerCase());
  }

  return [...encontrados];
}

export interface TrechoMencao {
  tipo: 'texto' | 'mencao';
  valor: string;
  /** Preenchido só quando o nome corresponde a um membro conhecido. */
  userId?: string;
}

/**
 * Quebra o texto em trechos para renderização.
 *
 * Um `@nome` que não corresponde a nenhum membro fica como texto comum: marcar
 * visualmente uma menção que não notifica ninguém enganaria quem escreveu.
 */
export function dividirPorMencoes(
  conteudo: string,
  membrosPorNome: Map<string, string>,
): TrechoMencao[] {
  const trechos: TrechoMencao[] = [];
  let ultimo = 0;

  for (const match of conteudo.matchAll(MENCAO)) {
    const inteiro = match[0];
    const prefixo = match[1] ?? '';
    const nome = (match[2] ?? '').toLowerCase();
    const userId = membrosPorNome.get(nome);

    if (!userId) continue;

    const inicio = (match.index ?? 0) + prefixo.length;

    if (inicio > ultimo) {
      trechos.push({ tipo: 'texto', valor: conteudo.slice(ultimo, inicio) });
    }

    trechos.push({ tipo: 'mencao', valor: `@${match[2]}`, userId });
    ultimo = (match.index ?? 0) + inteiro.length;
  }

  if (ultimo < conteudo.length) {
    trechos.push({ tipo: 'texto', valor: conteudo.slice(ultimo) });
  }

  return trechos;
}
