/**
 * Browser test helpers — the test code runs inside a real Chromium page.
 * DOM manipulation is direct; key input goes through userEvent (trusted
 * events).
 */
import { userEvent } from 'vitest/browser';
import { createEditor } from '../../src/createEditor';
import { createParser, type Parser } from '../../src/createParser';
import type { Editor } from '../../src/createEditor';

export const full = () =>
  createParser({ heading: true, strikethrough: true, codeBlock: true, hr: true });

export function mount(opts: {
  value?: string;
  parser?: Parser;
  syntaxHighlight?: (code: string, lang: string) => string | null | Promise<string | null>;
} = {}): { host: HTMLElement; editor: Editor } {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  host.id = 'host';
  document.body.appendChild(host);
  const editor = createEditor(host, { parser: opts.parser ?? full(), ...opts });
  return { host, editor };
}

export function focusEditor(host: HTMLElement): void {
  host.focus();
}

/** Resolve (block, block-text-total offset) to a position. */
function locate(host: HTMLElement, block: number, offset: number): { node: Node; offset: number } {
  const root = host.children[block]!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  let acc = 0;
  while (n && acc + n.textContent!.length < offset) {
    acc += n.textContent!.length;
    n = walker.nextNode();
  }
  return n ? { node: n, offset: offset - acc } : { node: root, offset: root.childNodes.length };
}

/** Place a collapsed caret. */
export function caretAt(host: HTMLElement, block: number, offset: number): void {
  const p = locate(host, block, offset);
  const r = document.createRange();
  r.setStart(p.node, Math.max(0, p.offset));
  r.collapse(true);
  const s = getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

/** Caret offset in block-text totals (ELEM marker for element anchors). */
export function caretOffset(host: HTMLElement): number | string {
  const s = getSelection()!;
  if (!s.anchorNode || !host.contains(s.anchorNode)) return 'OUTSIDE';
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === s.anchorNode) return acc + s.anchorOffset;
    acc += n.textContent!.length;
  }
  return `ELEM(${s.anchorNode.nodeName}#${s.anchorOffset})`;
}

export function caretInBlock(host: HTMLElement, block: number): boolean {
  const s = getSelection()!;
  return !!s.anchorNode && !!host.children[block] && host.children[block]!.contains(s.anchorNode);
}

/** Extend the selection from the current caret to a position (anchor kept). */
export function selectTo(host: HTMLElement, block: number, offset: number): void {
  const s = getSelection()!;
  const f = locate(host, block, offset);
  s.setBaseAndExtent(
    s.anchorNode ?? f.node,
    s.anchorNode ? s.anchorOffset : f.offset,
    f.node,
    Math.max(0, f.offset),
  );
}

/** Select between two positions (anchor→focus). */
export function selectRange(
  host: HTMLElement,
  anchor: { block: number; offset: number },
  focus: { block: number; offset: number },
): void {
  const a = locate(host, anchor.block, anchor.offset);
  const f = locate(host, focus.block, focus.offset);
  const s = getSelection()!;
  s.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
}

export const keys = {
  enter: () => userEvent.keyboard('[Enter]'),
  backspace: () => userEvent.keyboard('[Backspace]'),
  selectAll: () => userEvent.keyboard('{Meta>}[KeyA]{/Meta}'),
  undo: () => userEvent.keyboard('{Meta>}[KeyZ]{/Meta}'),
  end: () => userEvent.keyboard('[End]'),
  home: () => userEvent.keyboard('[Home]'),
  shiftEnd: () => userEvent.keyboard('{Shift>}[End]{/Shift}'),
  shiftHome: () => userEvent.keyboard('{Shift>}[Home]{/Shift}'),
  cmdRight: () => userEvent.keyboard('{Meta>}[ArrowRight]{/Meta}'),
  cmdLeft: () => userEvent.keyboard('{Meta>}[ArrowLeft]{/Meta}'),
  tab: () => userEvent.keyboard('[Tab]'),
  shiftTab: () => userEvent.keyboard('{Shift>}[Tab]{/Shift}'),
  char: (c: string) => userEvent.keyboard(c),
  arrowLeft: () => userEvent.keyboard('[ArrowLeft]'),
  arrowRight: () => userEvent.keyboard('[ArrowRight]'),
  click: (el: Element) => userEvent.click(el as HTMLElement),
};

export function type(text: string): Promise<void> {
  const host = document.getElementById('host')!;
  return userEvent.type(host, text);
}
