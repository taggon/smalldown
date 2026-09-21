import { describe, expect, it } from 'vitest';
import { createParser } from '../../src/createParser';
import { styles } from '../../src/editor/styles';
import { caretAt, focusEditor, keys, mount, selectRange, type } from './helpers';

/** Paste/styles/minimal splice (keyed)/syntax highlight — the real DOM
 *  and real events layer. */
describe('browser: paste and drop', () => {
  it('multi-line paste → block split + caret at the pasted end', async () => {
    const { host, editor } = mount({ value: 'a' });
    focusEditor(host);
    caretAt(host, 0, 1);
    const dt = new DataTransfer();
    dt.setData('text/plain', 'P\n- q');
    host.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
    );
    expect(editor.getValue()).toBe('aP\n- q');
    expect(getSelection()!.anchorNode?.textContent ?? '').toContain('q');
  });

  it('drop inserts text only (rich HTML blocked)', async () => {
    const { host, editor } = mount({ value: 'x' });
    focusEditor(host);
    caretAt(host, 0, 1);
    const dt = new DataTransfer();
    dt.setData('text/plain', 'D');
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    host.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(editor.getValue()).toBe('xD');
  });
});

describe('browser: minimal updates (keyed splice)', () => {
  it('one Enter keeps existing nodes alive; only new nodes are inserted', async () => {
    const { host, editor } = mount({ value: 'a\nb\nc\nd' });
    const tag = (c: Element) => ((c as HTMLElement & { __t?: string }).__t ??= Math.random().toString(36).slice(2, 8));
    const before = Array.from(host.children).map(tag);
    focusEditor(host);
    caretAt(host, 1, 1); // end of 'b'
    await keys.enter();
    expect(editor.getValue()).toBe('a\nb\n\nc\nd');
    const after = Array.from(host.children).map(tag);
    // all 4 original nodes survive; only one new node (empty paragraph) inserted
    const survivors = after.filter((t) => before.includes(t));
    expect(survivors.length).toBe(4);
    expect(after.length).toBe(5);
  });
});

describe('browser: style injection (CSS Modules)', () => {
  it('suffixed class names, flat rules actually applied', async () => {
    const { host } = mount({ value: '> q\n**b**' });
    expect(host.className).toMatch(/sd-editor-/);
    const quote = host.querySelector(`.${styles.quote}`);
    const sym = host.querySelector(`.${styles.symbol}`);
    expect(quote ? getComputedStyle(quote).borderLeftWidth : '').toBe('3px');
    expect(sym ? getComputedStyle(sym).opacity : '').toBe('0.45');
    const injected = Array.from(document.querySelectorAll('style')).some((s) =>
      s.textContent?.includes(`.${styles.url}{word-break:break-all}`),
    );
    expect(injected).toBe(true);
  });
});

describe('browser: image widget', () => {
  it('img is an unselectable, undraggable widget — edits go through the source symbol', async () => {
    const { host } = mount({
      value: '![alt](https://example.com/i.png) tail',
      parser: createParser({ image: true }),
    });
    const img = host.querySelector('img')!;
    expect(img.getAttribute('contenteditable')).toBe('false');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(getComputedStyle(img).userSelect).toBe('none');
    // round-trip intact
    expect(host.textContent).toBe('![alt](https://example.com/i.png) tail');
  });

  it('no caret ever renders beside the image preview (block widget)', async () => {
    const { host, editor } = mount({
      value: '앞 ![alt](https://example.com/i.png) 뒤',
      parser: createParser({ image: true }),
    });
    focusEditor(host);
    const img = host.querySelector('img') as HTMLImageElement;
    expect(getComputedStyle(img).display).toBe('block'); // own line
    const alt = host.querySelector(`.${styles.imageAlt}`) as HTMLElement;
    expect(getComputedStyle(alt).display.startsWith('inline')).toBe(true);
    expect(getComputedStyle(alt).wordBreak).toBe('break-all'); // URL wraps like links

    // clicking the image lands the caret on a text seat, never beside the img
    await keys.click(img);
    let sel = getSelection()!;
    expect(sel.anchorNode?.nodeType).toBe(3);
    expect(sel.anchorNode === img || sel.anchorNode === img.parentElement).toBe(false);

    // arrows stepping over the image never anchor on it, and the
    // resolved seats are the exact text boundaries
    caretAt(host, 0, 3); // inside the source ('a' '!') — one step from its start
    await keys.arrowLeft();
    await keys.arrowLeft(); // second step crosses the image backward
    sel = getSelection()!;
    expect(sel.anchorNode === img || sel.anchorNode === img.parentElement).toBe(false);
    expect((sel.anchorNode?.textContent ?? '').endsWith('앞 ')).toBe(true);
    expect(sel.anchorOffset).toBe(2); // pinned seat — end of '앞 '

    // ArrowRight must cross the image into the raw source (no bounce)
    for (let i = 0; i < 3; i++) await keys.arrowRight();
    sel = getSelection()!;
    const a = sel.anchorNode?.textContent ?? '';
    expect(a.includes('![alt]')).toBe(true); // inside the source span
    expect(sel.anchorNode === img || sel.anchorNode === img.parentElement).toBe(false);
    expect(editor.getValue()).toBe('앞 ![alt](https://example.com/i.png) 뒤');
  });

  it('setReadonly — real typing is blocked and restored on unlock', async () => {
    const { host, editor } = mount({ value: 'lock me' });
    focusEditor(host);
    editor.setReadonly(true);
    expect(host.getAttribute('contenteditable')).toBe('false');
    caretAt(host, 0, 3);
    await keys.char('x');
    await keys.backspace();
    expect(editor.getValue()).toBe('lock me'); // nothing changed
    editor.setReadonly(false);
    caretAt(host, 0, 3);
    await keys.char('x');
    expect(editor.getValue()).toBe('locxk me');
  });

  it('a non-collapsed selection spanning the image is left alone — source still editable', async () => {
    const { host, editor } = mount({
      value: '앞 ![alt](https://example.com/i.png) 뒤',
      parser: createParser({ image: true }),
    });
    focusEditor(host);
    // select from before the image through the whole source text
    // (block offsets: 0..1 = '앞 ', 2..33 = '![alt](https://example.com/i.png)')
    selectRange(host, { block: 0, offset: 0 }, { block: 0, offset: 35 });
    const sel = getSelection()!;
    expect(sel.isCollapsed).toBe(false);
    await keys.backspace();
    expect(editor.getValue()).toBe(' 뒤'); // the whole image source deleted
    expect(host.querySelector('img')).toBe(null); // widget gone with it
  });
});

describe('browser: syntax highlighting', () => {
  it('setValue highlights immediately; typing keeps the round-trip', async () => {
    const { host, editor } = mount({
      value: '```\nlet x\n```',
      syntaxHighlight: (code) => `<i>${code}</i>`,
    });
    const body = host.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.innerHTML).toBe('<i>let x</i>\n'); // trailing newline appended
    expect(body.textContent).toBe('let x\n'); // structural newline lives in the body
    focusEditor(host);
    caretAt(host, 0, 9);
    await type('!');
    expect(editor.getValue()).toBe('```\nlet x!\n```');
  });

  it('re-highlight preserves a non-collapsed selection', async () => {
    const { host, editor } = mount({
      value: '```\nabcdef\n```',
      syntaxHighlight: (code) => `<i>${code}</i>`,
    });
    focusEditor(host);
    const body = host.querySelector(`.${styles.codeBody}`) as HTMLElement;
    const text = (body.querySelector('i') ?? body).firstChild as Text;
    text.nodeValue = 'abcxef';
    selectRange(host, { block: 0, offset: 5 }, { block: 0, offset: 8 });
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.getValue()).toBe('```\nabcxef\n```');
    await new Promise((r) => setTimeout(r, 250)); // debounce
    expect(body.innerHTML).toBe('<i>abcxef</i>\n');
    expect(getSelection()!.toString()).toBe('bcx');
  });
});
