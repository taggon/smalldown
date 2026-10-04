import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createEditor } from '../../src/createEditor';
import { createParser } from '../../src/createParser';
import type { Editor } from '../../src/createEditor';

/**
 * Shadow DOM embedding — document.getSelection() retargets anchors inside
 * a shadow tree to the host, so every caret read/write used to fail and
 * the caret jumped to the editor start after a re-render. These cases pin
 * the shadow-aware selection path on a real engine.
 */

function mountShadow(value = ''): {
  wrap: HTMLElement;
  shadow: ShadowRoot;
  host: HTMLElement;
  editor: Editor;
} {
  document.body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.id = 'shadow-wrap';
  document.body.appendChild(wrap);
  const shadow = wrap.attachShadow({ mode: 'open' });
  const host = document.createElement('div');
  shadow.appendChild(host);
  const editor = createEditor(host, {
    parser: createParser({ codeBlock: true, strikethrough: true }),
    value,
  });
  return { wrap, shadow, host, editor };
}

/** Selection of the tree the editor lives in. */
function selOf(host: HTMLElement): Selection {
  const root = host.getRootNode();
  const sel =
    root instanceof ShadowRoot
      ? (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
      : null;
  return sel ?? document.getSelection()!;
}

/** Caret offset in whole-editor text totals ('OUTSIDE' when not inside). */
function caretTotal(host: HTMLElement): number | string {
  const s = selOf(host);
  if (!s?.anchorNode || !host.contains(s.anchorNode)) return 'OUTSIDE';
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === s.anchorNode) return acc + s.anchorOffset;
    acc += n.textContent!.length;
  }
  return `ELEM(${s.anchorNode.nodeName}#${s.anchorOffset})`;
}

/** Sum of all text under host — the caret-at-end expectation (DOM text
 *  space has no line separators between blocks). */
function domTextTotal(host: HTMLElement): number {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let acc = 0;
  while (walker.nextNode()) acc += walker.currentNode.textContent!.length;
  return acc;
}

describe('browser: shadow DOM embedding', () => {
  it('caret tracks typing after an inline-format re-render', async () => {
    const { host, editor } = mountShadow();
    host.focus();
    await userEvent.type(host, 'hello **bold** world');
    expect(editor.getValue()).toBe('hello **bold** world');
    // Caret at the very end of the text, inside the shadow tree.
    expect(caretTotal(host)).toBe(domTextTotal(host));
  });

  it('Enter list inheritance works inside a shadow root', async () => {
    const { host, editor } = mountShadow();
    host.focus();
    await userEvent.type(host, '- a');
    await userEvent.keyboard('[Enter]');
    await userEvent.type(host, 'b');
    expect(editor.getValue()).toBe('- a\n- b');
    expect(caretTotal(host)).toBe(domTextTotal(host));
  });

  it('typing continues at the caret after a block switch', async () => {
    const { host, editor } = mountShadow();
    host.focus();
    await userEvent.type(host, 'plain');
    await userEvent.keyboard('[Enter]');
    await userEvent.type(host, '> quote');
    expect(editor.getValue()).toBe('plain\n> quote');
    expect(caretTotal(host)).toBe(domTextTotal(host));
  });
});
