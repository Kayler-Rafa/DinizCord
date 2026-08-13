import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Renderização do texto da mensagem.
 *
 * SEGURANÇA: nada aqui usa `dangerouslySetInnerHTML`. O conteúdo é dividido em
 * pedaços e cada um vira um nó de texto do React, que escapa tudo. Um usuário
 * escrevendo `<img onerror=...>` vê exatamente esses caracteres na tela — não há
 * caminho pelo qual a string vire HTML.
 *
 * A formatação suportada é mínima de propósito: bloco de código, código inline,
 * negrito, itálico e links. Markdown completo traria uma superfície de ataque e
 * uma dependência que este projeto não precisa.
 */

interface Segment {
  type: 'text' | 'code' | 'codeblock' | 'bold' | 'italic' | 'link';
  value: string;
  language?: string;
}

/** Só http/https viram link — `javascript:` jamais. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  // Ordem importa: `**` antes de `*` para o negrito não ser lido como itálico.
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushText(segments, text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      segments.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('**')) {
      segments.push({ type: 'bold', value: token.slice(2, -2) });
    } else {
      segments.push({ type: 'italic', value: token.slice(1, -1) });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    pushText(segments, text.slice(lastIndex));
  }

  return segments;
}

/** Separa URLs do texto comum para transformá-las em links. */
function pushText(segments: Segment[], text: string): void {
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'link', value: match[0] });
    lastIndex = URL_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
}

/** Extrai blocos ```…``` antes de qualquer outra formatação. */
function parseContent(content: string): Segment[][] {
  const blocks: Segment[][] = [];
  const codeBlockPattern = /```(\w+)?\n?([\s\S]*?)```/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push(parseInline(content.slice(lastIndex, match.index)));
    }
    blocks.push([{ type: 'codeblock', value: match[2] ?? '', language: match[1] }]);
    lastIndex = codeBlockPattern.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push(parseInline(content.slice(lastIndex)));
  }

  return blocks;
}

export function MessageContent({ content, edited }: { content: string; edited: boolean }) {
  const blocks = React.useMemo(() => parseContent(content), [content]);

  return (
    <div className="text-sm leading-relaxed text-content">
      {blocks.map((segments, blockIndex) => {
        const first = segments[0];

        if (first?.type === 'codeblock') {
          return (
            <pre
              key={blockIndex}
              className="dc-scroll my-1 overflow-x-auto rounded-md border border-line bg-base p-3 text-xs"
            >
              <code className="font-mono text-muted">{first.value.replace(/\n$/, '')}</code>
            </pre>
          );
        }

        return (
          <p key={blockIndex} className="whitespace-pre-wrap break-words">
            {segments.map((segment, index) => (
              <Segment key={index} segment={segment} />
            ))}

            {/* O marcador de edição acompanha o último bloco. */}
            {edited && blockIndex === blocks.length - 1 ? (
              <span className="ml-1 align-baseline text-[10px] text-subtle" title="Mensagem editada">
                (editada)
              </span>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}

function Segment({ segment }: { segment: Segment }) {
  switch (segment.type) {
    case 'code':
      return (
        <code className="rounded bg-base px-1 py-0.5 font-mono text-[0.85em] text-muted">
          {segment.value}
        </code>
      );

    case 'bold':
      return <strong className="font-semibold">{segment.value}</strong>;

    case 'italic':
      return <em className="italic">{segment.value}</em>;

    case 'link':
      return (
        <a
          href={segment.value}
          target="_blank"
          // `noopener noreferrer` impede que a página aberta manipule esta aba.
          rel="noopener noreferrer nofollow"
          className={cn('text-accent underline-offset-2 hover:underline')}
        >
          {segment.value}
        </a>
      );

    default:
      return <>{segment.value}</>;
  }
}
