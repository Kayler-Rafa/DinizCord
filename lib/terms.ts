/**
 * Versão dos termos de uso em vigor.
 *
 * Mudou os termos de forma relevante? Suba a versão. Todo mundo volta a ver a
 * tela de aceite no próximo acesso, porque o aceite guardado deixa de bater com
 * a versão atual.
 *
 * O formato é a data da revisão, que torna óbvio na tabela quando cada pessoa
 * aceitou o quê.
 */
export const TERMS_VERSION = '2026-08-14';

/** true quando o aceite registrado corresponde à versão vigente. */
export function aceiteEstaEmDia(versaoAceita: string | null | undefined): boolean {
  return versaoAceita === TERMS_VERSION;
}

/**
 * Pontos apresentados na tela de aceite.
 *
 * É um resumo honesto, não um substituto: o documento completo fica a um
 * clique. Enterrar as cláusulas que realmente importam num muro de texto que
 * ninguém lê seria pior do que não ter tela nenhuma.
 */
export const RESUMO_DOS_TERMOS: Array<{ titulo: string; texto: string }> = [
  {
    titulo: 'O que este projeto é',
    texto:
      'Um software livre de comunicação em grupo, feito para ser hospedado por quem usa. Não é cópia, clone nem substituto de nenhuma plataforma comercial, e não usa código, marca ou identidade visual de terceiros.',
  },
  {
    titulo: 'Uso proibido',
    texto:
      'É vedado usar esta instância para qualquer atividade ilícita, para assediar ou ameaçar pessoas, para distribuir malware ou conteúdo criminoso, ou para violar direitos de terceiros.',
  },
  {
    titulo: 'Quem responde pelo que acontece aqui',
    texto:
      'Quem opera esta instância é o responsável por ela: pelo conteúdo, pela moderação, pela segurança e pela conformidade legal. O autor original do código não hospeda esta instância nem tem acesso aos dados dela.',
  },
  {
    titulo: 'Sem garantias',
    texto:
      'O software é fornecido no estado em que se encontra, sem garantia de disponibilidade, segurança ou ausência de defeitos. O autor não responde por danos decorrentes do uso.',
  },
  {
    titulo: 'Suas conversas não são criptografadas de ponta a ponta',
    texto:
      'Quem administra o banco de dados desta instância consegue ler o histórico de mensagens. Leve isso em conta antes de tratar assuntos sensíveis por aqui. Áudio e tela, esses sim, vão direto entre os participantes.',
  },
];
