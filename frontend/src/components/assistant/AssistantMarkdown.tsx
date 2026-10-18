import type { ReactNode } from 'react';

/**
 * Renderizador Markdown seguro y ligero para el contenido del asistente.
 *
 * Decisiones de diseno:
 * - NUNCA usa `dangerouslySetInnerHTML`: todo el texto se inserta como nodos de
 *   React (texto plano) y solo se crean `<p>`, `<ul>`, `<li>` y `<strong>`.
 * - No habilita HTML arbitrario: si la respuesta trae etiquetas HTML o scripts,
 *   se muestran como texto literal y no se ejecutan (seguro contra XSS).
 * - Es ligero: no agrega dependencias. Interpreta solo lo que el asistente usa
 *   realmente: parrafos, listas con vinetas y texto en negrita.
 *
 * Ademas limpia dos artefactos frecuentes del proveedor de IA:
 * - entidades HTML escapadas (por ejemplo `&#x20;` o `&amp;`),
 * - Markdown escapado con barras invertidas (por ejemplo `\*\*texto\*\*`).
 */

/** Entidades HTML con nombre que podemas traducir sin ambiguedad. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Decodifica entidades HTML de forma segura: solo convierte referencias
 * numericas (decimales o hexadecimales) y un conjunto reducido de entidades con
 * nombre. Cualquier otra referencia se deja tal cual, sin evaluar HTML.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match: string, body: string): string => {
      if (body.startsWith('#')) {
        const isHex = body[1] === 'x' || body[1] === 'X';
        const digits = isHex ? body.slice(2) : body.slice(1);
        const code = Number.parseInt(digits, isHex ? 16 : 10);
        if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

/**
 * Quita el escape de barras invertidas tipico del Markdown generado por IA
 * (`\*\*`, `\-`, `\_`, ...) para que las negritas y las listas se interpreten.
 */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1');
}

/** Bloque de contenido reconocido por el renderizador. */
type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

/** Vinetas aceptadas al inicio de una linea de lista. */
const BULLET_ITEM = /^\s*[-*•]\s+(.+)$/;

/** Divide el texto en parrafos y listas, sin interpretar HTML. */
function parseBlocks(text: string): Block[] {
  const normalized = unescapeMarkdown(decodeHtmlEntities(text)).replace(
    /\r\n?/g,
    '\n',
  );

  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trimEnd();

    const bullet = BULLET_ITEM.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1].trim());
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

/**
 * Interpreta las negritas (`**texto**`) dentro de una linea. El resto se
 * devuelve como texto plano, de modo que React lo escape al renderizar.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /\*\*([^*]+)\*\*/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <strong key={`${keyPrefix}-b${index}`}>{match[1]}</strong>,
    );
    index += 1;
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export interface AssistantMarkdownProps {
  /** Texto plano (con Markdown ligero opcional) a presentar. */
  text: string;
  /** Clase CSS opcional para el contenedor. */
  className?: string;
}

/**
 * Presenta el contenido del asistente como parrafos, listas y negritas, sin
 * insertar HTML de la IA. El texto desconocido se muestra literal.
 */
export function AssistantMarkdown({ text, className }: AssistantMarkdownProps) {
  const blocks = parseBlocks(text);

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) =>
        block.type === 'paragraph' ? (
          <p key={`p${blockIndex}`} className="chat-text">
            {renderInline(block.text, `p${blockIndex}`)}
          </p>
        ) : (
          <ul key={`l${blockIndex}`} className="chat-text-list">
            {block.items.map((item, itemIndex) => (
              <li key={`i${itemIndex}`}>
                {renderInline(item, `l${blockIndex}i${itemIndex}`)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
