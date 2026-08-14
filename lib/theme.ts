/**
 * Tema da interface — o que o servidor e o cliente precisam concordar.
 *
 * A chave vive aqui, e não no `useTheme`, porque o `layout.tsx` (componente de
 * servidor) também precisa dela: o tema salvo é aplicado por um script síncrono
 * antes da primeira pintura. Duas cópias da string acabariam divergindo.
 */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'dinizcord-theme';

/** Tema do HTML servido. Escuro é o padrão do projeto. */
export const DEFAULT_THEME: Theme = 'dark';

/**
 * Script que aplica o tema salvo antes de a página pintar.
 *
 * Sem ele, quem escolheu o claro voltava ao escuro a cada carregamento: o
 * `data-theme` do servidor é sempre o padrão e só o `useTheme` corrigia o
 * atributo — e ele só é montado dentro do diálogo de configurações.
 *
 * Precisa ser síncrono e no `<head>`: corrigir depois da hidratação faria a tela
 * escura aparecer antes da troca.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==='light'){document.documentElement.dataset.theme='light'}}catch(e){}`;
