import type { BlockNode } from '../ast';

/** Empty paragraph for when a custom parser returns no blocks. */
export const EMPTY_PARAGRAPH = (): BlockNode => ({
  type: 'paragraph',
  source: '',
  children: [],
});

/** Always parse to at least one block (empty doc = one empty paragraph). */
export function normalize(children: BlockNode[]): BlockNode[] {
  return children.length ? children : [EMPTY_PARAGRAPH()];
}

/** DOM tag a block renders to, in tagName's uppercase space so it
 *  compares directly with Element.tagName. */
export function blockTag(b: BlockNode): string {
  switch (b.type) {
    case 'heading':
      return 'H' + Math.min(6, Math.max(1, b.level));
    case 'paragraph':
      return 'P';
    case 'blockquote':
      return 'BLOCKQUOTE';
    case 'list':
      return b.ordered ? 'OL' : 'UL';
    case 'codeBlock':
      return 'PRE';
    case 'hr':
      return 'DIV';
  }
}

/** List/quote containers — their direct children are lines. */
export const isContainerTag = (tag: string): boolean =>
  tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE';

/** List containers (UL/OL). */
export const isListTag = (tag: string): boolean => tag === 'UL' || tag === 'OL';

/** Block DOM → markdown source (its textContent — symbol spans carry
 *  the syntax). */
export function readSource(el: Element): string {
  const tag = el.tagName;
  // Containers (quote/list): every child node is a line, including text
  // nodes the browser inserts directly.
  if (isContainerTag(tag))
    return Array.from(el.childNodes).map((c) => c.textContent!).join('\n');
  return el.textContent!;
}

/** Structural prefix of a line — quote ('>'·'> ') or list marker
 *  (indent included). */
export const prefixOf = (line: string): string =>
  /^> ?/.exec(line)?.[0] ?? /^ *((?:[-*]|\d+\.) )/.exec(line)?.[0] ?? '';

/** Inherited prefix for a new line — ordered markers increment. */
export const nextPrefix = (p: string): string => {
  const m = /^( *)(\d+)\. $/.exec(p);
  return m ? m[1]! + String(Number(m[2]) + 1) + '. ' : p;
};

/** (block, offset-in-block) → absolute source offset (source space). */
export function absOf(sources: string[], block: number, srcOffset: number): number {
  let abs = srcOffset;
  for (let i = 0; i < block; i++) abs += (sources[i]?.length ?? 0) + 1;
  return abs;
}

/** Absolute source offset → (block, offset-in-block). Boundaries
 *  attach to the end of the preceding block, mapping carets that sat
 *  right after a line separator. */
export function locateAbs(
  sources: string[],
  abs: number,
): { block: number; offset: number } {
  let acc = 0;
  for (let i = 0; i < sources.length; i++) {
    const len = sources[i]!.length;
    if (abs <= acc + len) return { block: i, offset: abs - acc };
    acc += len + 1;
  }
  const last = sources.length - 1;
  return { block: Math.max(0, last), offset: last >= 0 ? sources[last]!.length : 0 };
}

/** DOM text space → source space. PRE newlines are real DOM text
 *  (identity); containers have no newline text, so skip forward one
 *  character per separator. */
export function srcOffOf(source: string, domOff: number, isPre: boolean): number {
  if (isPre) return domOff;
  let seen = 0;
  let i = 0;
  while (i < source.length && seen < domOff) {
    if (source[i] !== '\n') seen++;
    i++;
  }
  return i;
}

/** Source space → DOM text space (inverse — containers drop one
 *  character per newline). */
export function domOffOf(source: string, srcOff: number, isPre: boolean): number {
  if (isPre) return srcOff;
  let n = 0;
  for (let k = 0; k < srcOff; k++) if (source[k] === '\n') n++;
  return srcOff - n;
}
