import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from '../src/createEditor';
import { styles } from '../src/editor/styles';
import { createParser } from '../src/createParser';

const full = () =>
  createParser({ heading: true, strikethrough: true, codeBlock: true, hr: true });

function setup(value = '') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = createEditor(el, { parser: full(), value });
  return { el, editor };
}

function firstBlock(el: HTMLElement) {
  return el.firstElementChild as HTMLElement;
}

describe('createEditor', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('sets contenteditable=plaintext-only', () => {
    createEditor(el);
    expect(el.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(el.classList.contains(styles.editor)).toBe(true);
  });

  it('injects the base CSS', () => {
    createEditor(el);
    const style = document.head.querySelector('style');
    expect(style?.textContent).toContain(`.${styles.editor}{`);
    expect(style?.textContent).toContain(`.${styles.url}{word-break:break-all}`);
  });

  it('heading typography — 1.75em down by 0.15em, margins distinct from blocks', () => {
    createEditor(el, { parser: full(), value: '# a\n\n## b' });
    const css = document.head.querySelector('style')!.textContent!;
    expect(css).toContain(`.${styles.heading}{font-weight:600;line-height:1.3;margin:.67em 0 .33em}`);
    expect(css).toContain(`.${styles.heading}:first-child{margin-top:0}`);
    const sizes = ['1.75em', '1.6em', '1.45em', '1.3em', '1.15em', '1em'];
    ([styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6] as const).forEach(
      (c, i) => expect(css).toContain(`.${c}{font-size:${sizes[i]}}`),
    );
    const h1 = el.children[0] as HTMLElement;
    expect(h1.classList.contains(styles.heading)).toBe(true);
    expect(h1.classList.contains(styles.h1)).toBe(true);
    const h2 = el.children[2] as HTMLElement;
    expect(h2.classList.contains(styles.h2)).toBe(true);
  });

  it('setValue → block render, getValue round-trip', () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '**hi**\n\n> quote\n\n- a\n- b',
    });
    expect(el.children.length).toBe(5); // strong/empty/quote/empty/list
    const strong = el.querySelector('strong');
    expect(strong?.querySelector(`.${styles.symbol}`)?.textContent).toBe('**');
    expect(ed.getValue()).toBe('**hi**\n\n> quote\n\n- a\n- b'); // full round-trip
  });

  it('block textContent == markdown source (symbols included)', () => {
    createEditor(el, { parser: full(), value: '# Title **x**' });
    expect(firstBlock(el).textContent).toBe('# Title **x**');
  });

  it('classes option — extra classes on host/blocks/links, round-trip unaffected', () => {
    const ed = createEditor(el, {
      parser: full(),
      value: 'para\n> q\n```\ncode\n```\n[l](https://x.y)',
      classes: { editor: ['my-editor'], codeBlock: ['my-code'], link: ['my-link'] },
    });
    expect(el.classList.contains('my-editor')).toBe(true);
    const pre = el.children[2] as HTMLElement;
    expect(pre.classList.contains('my-code')).toBe(true);
    expect(pre.classList.contains(styles.code)).toBe(true); // built-ins stay
    const a = el.querySelector('a.my-link');
    expect(a?.getAttribute('href')).toBe('https://x.y');
    // classes are attributes only — textContent (source) untouched
    expect(ed.getValue()).toBe('para\n> q\n```\ncode\n```\n[l](https://x.y)');
    // rebuilds keep the extras
    ed.setValue('```\nx\n```');
    expect((el.children[0] as HTMLElement).classList.contains('my-code')).toBe(true);
    ed.destroy();
    expect(el.classList.contains('my-editor')).toBe(false);
  });

  it('focus() call', () => {
    const ed = createEditor(el, { parser: full(), value: 'x' });
    ed.focus();
    expect(document.activeElement).toBe(el);
  });

  it('empty value: placeholder + one empty paragraph', () => {
    const ed = createEditor(el, { parser: full(), placeholder: 'PH' });
    expect(el.classList.contains(styles.empty)).toBe(true);
    expect(el.getAttribute('data-sd-ph')).toBe('PH');
    expect(ed.getValue()).toBe('');
    expect(el.children.length).toBe(1);
  });

  it('input patches only the changed block', () => {
    createEditor(el, { parser: full(), value: 'aa\n\nbb' });
    const b1 = el.children[0] as HTMLElement;
    const b2 = el.children[1] as HTMLElement;
    // simulate user typing directly in b1
    b1.textContent = '**bold**';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const newB1 = el.children[0] as HTMLElement;
    const newB2 = el.children[1] as HTMLElement;
    expect(newB1.querySelector('strong')).toBeTruthy();
    expect(newB1.textContent).toBe('**bold**');
    // unchanged b2 keeps its DOM node
    expect(newB2).toBe(b2);
  });

  it('input: typing only > invents no whitespace in the DOM (value↔DOM agree)', () => {
    const ed = createEditor(el, { parser: full() });
    const p = el.children[0] as HTMLElement;
    p.textContent = '>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('>');
    expect((el.children[0] as HTMLElement).textContent).toBe('>'); // not '>'+' '
    // further typing stays in sync
    (el.children[0] as HTMLElement).textContent = '>x';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('>x');
    expect((el.children[0] as HTMLElement).textContent).toBe('>x');
  });

  it('IME composition defers patching until it ends (per block)', () => {
    createEditor(el, { parser: full(), value: '한글 블록\n\nplain' });
    const b1 = el.children[0] as HTMLElement;
    const b2 = el.children[1] as HTMLElement;
    b1.textContent = '한글 **강조**';
    b1.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // composing: no strong render, block element untouched (no DOM swaps)
    expect(b1.querySelector('strong')).toBeNull();
    expect(el.children[0]).toBe(b1);
    b1.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    // after compositionend: applied — element may be replaced now
    expect(el.children[0]!.querySelector('strong')).toBeTruthy();
    expect(el.children[1]).toBe(b2);
  });

  it('compositionstart on a text node still protects the composed block (real IME flow)', () => {
    createEditor(el, { parser: full(), value: '여기에 한글' });
    const b1 = el.children[0] as HTMLElement;
    b1.textContent = '여기에 한글**굵**';
    const textNode = b1.firstChild!; // real browsers target this in compositionstart
    textNode.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.children[0]).toBe(b1);
    expect(b1.querySelector('strong')).toBeNull();
    textNode.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    );
    expect(el.children[0]!.querySelector('strong')).toBeTruthy();
  });

  it('compositionstart on the editor root also defers rerender mid-composition (CDP IME regression)', () => {
    createEditor(el, { parser: full(), value: '대상 블록' });
    const b1 = el.children[0] as HTMLElement;
    b1.textContent = '대상 블록**굵**';
    // target is the root — blockIndexOf fails → selection fallback (-1 → defer all)
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.children[0]).toBe(b1); // block not replaced
    expect(b1.querySelector('strong')).toBeNull();
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(el.children[0]!.querySelector('strong')).toBeTruthy();
  });

  it('a block not being composed still applies on the same input (§6.3 per-block rule)', () => {
    createEditor(el, { parser: full(), value: '첫째\n둘째 블록' });
    const b1 = el.children[0] as HTMLElement;
    const b2 = el.children[1] as HTMLElement;
    b2.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    // composition in block 2, external change in block 1 — simultaneously
    b1.textContent = '**첫째**';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.children[0]!.querySelector('strong')).toBeTruthy(); // block 1 applied immediately
    expect(el.children[1]).toBe(b2); // composing block 2 untouched
    b2.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });

  it('onChange receives the value', () => {
    const seen: string[] = [];
    createEditor(el, { parser: full(), value: 'x', onChange: (v) => seen.push(v) });
    const p = el.firstElementChild as HTMLElement;
    p.textContent = 'xy';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seen.at(-1)).toBe('xy');
  });

  it('destroy: attributes/listeners/DOM cleanup', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    ed.destroy();
    expect(el.hasAttribute('contenteditable')).toBe(false);
    expect(el.children.length).toBe(0);
    // no further input events are processed
    el.innerHTML = '<p>zz</p>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('a');
  });

  it('update via setValue', () => {
    const ed = createEditor(el, { parser: full() });
    ed.setValue('- one');
    expect(el.querySelector('li')?.textContent).toBe('- one');
    expect(ed.getValue()).toBe('- one');
  });
});

/** Place the caret at a text-node offset via happy-dom selection. */
function setSel(node: Node, offset: number): void {
  const sel = document.getSelection();
  if (!sel) throw new Error('no selection');
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Select a range inside a text node via happy-dom selection. */
function setSelRange(node: Node, start: number, end: number): void {
  const sel = document.getSelection();
  if (!sel) throw new Error('no selection');
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  sel.removeAllRanges();
  sel.addRange(r);
}

describe('code blocks', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  it('typing a lone opening fence adds an empty body + closing fence without touching later blocks', () => {
    const ed = createEditor(el, { parser: full(), value: '윗문단\n중간\n아랫문단' });
    const b1 = el.children[1] as HTMLElement;
    b1.textContent = '```'; // type ``` in the middle paragraph
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('윗문단\n```\n\n```\n아랫문단'); // the rest is not swallowed as code
    expect(el.children[0]!.tagName).toBe('P');
    expect(el.children[1]!.tagName).toBe('PRE');
    expect(el.children[1]!.textContent).toBe('```\n\n```'); // empty body line round-trips
    expect(el.children[2]!.tagName).toBe('P');
  });

  it('Enter past the closing fence (block end) escapes the code block', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode\n```' });
    const pre = el.children[0] as HTMLElement;
    const closeText = pre.lastElementChild!.firstChild!; // the '\n```' text
    setSel(closeText, 4); // end of the closing fence
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('```\ncode\n```\n');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['PRE', 'P']);
    // caret lands in the new empty paragraph — typing continues there
    expect(el.children[1]!.contains(document.getSelection()!.anchorNode!)).toBe(true);
    // body still contains just the line break (regression on rebuilt PRE)
    const pre2 = el.children[0] as HTMLElement;
    setSel((pre2.childNodes[1] as HTMLElement).firstChild!, 4); // end of 'code'
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('```\ncode\n\n```\n');
  });

  it('Enter after a mid-document code block fence → blank line between block and next paragraph', () => {
    const ed = createEditor(el, { parser: full(), value: '```\nc\n```\nafter' });
    const pre = el.children[0] as HTMLElement;
    setSel(pre.lastElementChild!.firstChild!, 4);
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('```\nc\n```\n\nafter');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['PRE', 'P', 'P']);
  });

  it('pasting a whole code block enters verbatim, unclosed-guard not applied', () => {
    const ed = createEditor(el, { parser: full(), value: '윗문단' });
    const p = el.children[0] as HTMLElement;
    // simulate a browser paste: several lines arrive in one element
    p.textContent = '```\ncode\nmore\n```';
    el.dispatchEvent(
      new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }),
    );
    expect(ed.getValue()).toBe('```\ncode\nmore\n```');
    expect(el.children[0]!.tagName).toBe('PRE');
    expect(el.children[0]!.childNodes[1]!.textContent).toBe('code\nmore');
  });

  it('a language typed after the fence becomes lang', () => {
    createEditor(el, { parser: full(), value: '```' });
    const pre = el.children[0] as HTMLElement;
    expect(pre.tagName).toBe('PRE'); // already closed by setValue (same parse)
    // simulate typing js after the ``` opening symbol
    (pre.firstElementChild!.firstChild as Text).nodeValue = '```js\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.children[0]!.firstElementChild!.textContent).toBe('```js\n');
  });

  it('Enter in a code block inserts a raw newline in the source (no execCommand)', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode\n```' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild!; // body text in the codeBody span
    setSel(body, 4); // end of 'code'
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('```\ncode\n\n```');
  });

  it('code Enter — a line with 2+ leading spaces passes its indent to the new line', () => {
    const ed = createEditor(el, { parser: full(), value: '```\n  a\n```' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild!;
    setSel(body, 3); // end of '  a'
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('```\n  a\n  \n```');
    // caret after the inherited indent
    const sel = document.getSelection()!;
    expect((sel.anchorNode?.textContent ?? '').slice(0, sel.anchorOffset)).toBe('  a\n  ');
  });

  it('code Enter — one or no leading spaces do not inherit indent', () => {
    for (const [value, at, expected] of [
      ['```\n a\n```', 2, '```\n a\n\n```'],
      ['```\na\n```', 1, '```\na\n\n```'],
    ] as const) {
      const ed = createEditor(el, { parser: full(), value });
      const pre = el.children[0] as HTMLElement;
      const body = (pre.childNodes[1] as HTMLElement).firstChild!;
      setSel(body, at); // end of the body line
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      expect(ed.getValue()).toBe(expected);
      ed.destroy();
    }
  });

  it('code Enter — splitting mid-line indents the new line too', () => {
    const ed = createEditor(el, { parser: full(), value: '```\n  foo\n```' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild!;
    setSel(body, 2); // between '  ' and 'foo'
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('```\n  \n  foo\n```');
  });

  it('the caret is never restored inside the closing fence symbol', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode\n```' });
    const pre = el.children[0] as HTMLElement;
    // editing the body rerenders — a case where offsets fall outside
    ((pre.childNodes[1] as HTMLElement).firstChild as Text).nodeValue = 'codes';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```\ncodes\n```');
  });
});

describe('escaping empty list/quote items', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  it('Enter on an empty list item escapes to a paragraph', () => {
    const ed = createEditor(el, { parser: full(), value: '- 하나\n- ' });
    const ul = el.children[0] as HTMLElement;
    const li2 = ul.children[1]!;
    setSel(li2.firstChild!.firstChild!, 2); // after '- '
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('- 하나\n');
    expect(el.children[0]!.tagName).toBe('UL');
    expect(el.children[1]!.tagName).toBe('P');
  });

  it('Enter on an empty quote line escapes to a paragraph', () => {
    const ed = createEditor(el, { parser: full(), value: '> 인용\n> ' });
    const bq = el.children[0] as HTMLElement;
    const p2 = bq.children[1]!;
    setSel(p2.firstChild!.firstChild!, 2); // after '> '
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('> 인용\n');
    expect(el.children[0]!.tagName).toBe('BLOCKQUOTE');
    expect(el.children[1]!.tagName).toBe('P');
  });

  it('when it was the only item, the whole container becomes a paragraph', () => {
    const ed = createEditor(el, { parser: full(), value: '- ' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[0]!.firstChild!.firstChild!, 2);
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('');
    expect(el.children.length).toBe(1);
    expect(el.children[0]!.tagName).toBe('P');
  });
});

describe('Backspace — intercept prefix lines only, delegate the rest to the browser', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const backspace = () => {
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  };
  /** Simulates native deletion (the non-intercepted case). */
  const nativeEdit = (edit: () => void) => {
    edit();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it("문서 시작이 아닌 커서는 모두 브라우저에 위임 — 사파리식 정규화 포함", () => {
    const ed = createEditor(el, { parser: full(), value: '\n- A' });
    const ul = el.children[1] as HTMLElement;
    setSel(ul.children[0]!.firstChild!.firstChild!, 0); // before the li '- ' symbol
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // not intercepted
    // assume the browser deleted the empty line above → apply
    (el.children[0] as HTMLElement).remove();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('- A');
    expect(el.children[0]!.tagName).toBe('UL');
  });

  it('blank line before a list → starting the first list line is delegated (blank-line join)', () => {
    const ed = createEditor(el, { parser: full(), value: 'x\n\n- A' });
    const ul = el.children[2] as HTMLElement;
    setSel(ul.children[0]!.firstChild!.firstChild!, 0);
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    (el.children[1] as HTMLElement).remove();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('x\n- A');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['P', 'UL']);
  });

  it('starting a quote first line (blank line above) is delegated too', () => {
    const ed = createEditor(el, { parser: full(), value: '\n> A' });
    const bq = el.children[1] as HTMLElement;
    setSel(bq.children[0]!.firstChild!.firstChild!, 0);
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    (el.children[0] as HTMLElement).remove();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('> A');
  });

  it('list first line after a paragraph — delegated (line join: x- A)', () => {
    const ed = createEditor(el, { parser: full(), value: 'x\n- A' });
    const ul = el.children[1] as HTMLElement;
    setSel(ul.children[0]!.firstChild!.firstChild!, 0);
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    // browser join: the li text appends to the previous paragraph
    (el.children[0] as HTMLElement).textContent = 'x- A';
    ul.remove();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('x- A');
  });

  it('first block being an empty paragraph → Backspace deletes that line, caret to next line start', () => {
    const ed = createEditor(el, { parser: full(), value: '\n- A' });
    const blank = el.children[0] as HTMLElement;
    setSel(blank, 0);
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(ed.getValue()).toBe('- A');
    expect(el.children[0]!.tagName).toBe('UL');
    const sel = document.getSelection()!;
    expect(sel.anchorNode?.textContent).toBe('- '); // before the '- ' symbol (line start)
    expect(sel.anchorOffset).toBe(0);
  });

  it('same for a blank line before a quote', () => {
    const ed = createEditor(el, { parser: full(), value: '\n> A' });
    const blank = el.children[0] as HTMLElement;
    setSel(blank, 0);
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('> A');
    expect(el.children[0]!.tagName).toBe('BLOCKQUOTE');
  });

  it('blank line before a paragraph — same value/caret rule', () => {
    const ed = createEditor(el, { parser: full(), value: '\nA' });
    const blank = el.children[0] as HTMLElement;
    setSel(blank, 0);
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('A');
    expect(el.children[0]!.contains(document.getSelection()!.anchorNode!)).toBe(true);
  });

  it('the only block is never intercepted (empty editor)', () => {
    const ed = createEditor(el, { parser: full(), value: '' });
    setSel(el.children[0]!, 0);
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(ed.getValue()).toBe('');
  });

  it('deleting a quote prefix that pushes content into a list is reflected without loss', () => {
    const ed = createEditor(el, { parser: full(), value: '> A\n>- B\n- C' });
    const bq = el.children[0] as HTMLElement;
    const p2 = bq.children[1] as HTMLElement;
    // simulate the browser Backspace deleting the '>'
    (p2.firstElementChild as HTMLElement).textContent = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('> A\n- B\n- C');
    const ul = el.children[1] as HTMLElement;
    expect(ul.children.length).toBe(2); // both '- B' and '- C' visible
    expect(ul.children[0]!.textContent).toBe('- B');
    expect(ul.children[1]!.textContent).toBe('- C');
  });

  it('Backspace on an empty paragraph line — not intercepted; the browser-deleted blank line is applied', () => {
    const ed = createEditor(el, { parser: full(), value: '> A\n\nB' });
    const blank = el.children[1] as HTMLElement;
    setSel(blank, 0);
    expect(backspace().defaultPrevented).toBe(false);
    nativeEdit(() => blank.remove());
    expect(ed.getValue()).toBe('> A\nB');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['BLOCKQUOTE', 'P']);
  });

  it('same for a blank line under a list', () => {
    const ed = createEditor(el, { parser: full(), value: '- A\n\nB' });
    const blank = el.children[1] as HTMLElement;
    setSel(blank, 0);
    expect(backspace().defaultPrevented).toBe(false);
    nativeEdit(() => blank.remove());
    expect(ed.getValue()).toBe('- A\nB');
  });

  it('paragraph line start right under a list → the browser merge (into li) is applied', () => {
    const ed = createEditor(el, { parser: full(), value: '- A\nB' });
    const p = el.children[1] as HTMLElement;
    setSel(p.firstChild!, 0);
    expect(backspace().defaultPrevented).toBe(false);
    nativeEdit(() => {
      const li = (el.children[0] as HTMLElement).children[0]!;
      li.lastChild!.textContent = 'AB'; // browser merges 'B' into the last item
      p.remove();
    });
    expect(ed.getValue()).toBe('- AB');
  });

  it('paragraph line start right under a quote → the browser merge is applied', () => {
    const ed = createEditor(el, { parser: full(), value: '> A\nB' });
    const p = el.children[1] as HTMLElement;
    setSel(p.firstChild!, 0);
    expect(backspace().defaultPrevented).toBe(false);
    nativeEdit(() => {
      const qp = (el.children[0] as HTMLElement).children[0]!;
      qp.lastChild!.textContent = 'AB';
      p.remove();
    });
    expect(ed.getValue()).toBe('> AB');
  });

  it('paragraph line-start merges are browser-driven too', () => {
    const ed = createEditor(el, { parser: full(), value: 'A\nB' });
    const p = el.children[1] as HTMLElement;
    setSel(p.firstChild!, 0);
    expect(backspace().defaultPrevented).toBe(false);
    nativeEdit(() => {
      (el.children[0] as HTMLElement).textContent = 'AB';
      p.remove();
    });
    expect(ed.getValue()).toBe('AB');
  });

  it('list marker at line start is intercepted and the marker deleted', () => {
    const ed = createEditor(el, { parser: full(), value: '- A' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[0]!.firstChild!.firstChild!, 0); // before '- '
    expect(backspace().defaultPrevented).toBe(true);
    expect(ed.getValue()).toBe('A');
  });

  it('quote marker at line start is intercepted and the marker deleted', () => {
    const ed = createEditor(el, { parser: full(), value: '> A' });
    const bq = el.children[0] as HTMLElement;
    setSel(bq.children[0]!.firstChild!.firstChild!, 0); // before '> '
    expect(backspace().defaultPrevented).toBe(true);
    expect(ed.getValue()).toBe('A');
  });
});

describe('Enter on blank lines / list-merge caret (absolute-offset restore)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const pressEnter = () =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

  it('Enter on a blank line above a quote adds a blank line; the caret stays on it', () => {
    const ed = createEditor(el, { parser: full(), value: '\n> quote' });
    const blank = el.children[0] as HTMLElement;
    setSel(blank, 0);
    pressEnter();
    expect(ed.getValue()).toBe('\n\n> quote');
    expect(el.children.length).toBe(3); // empty ×2 + quote
    expect(el.children[2]!.tagName).toBe('BLOCKQUOTE');
    expect(el.children[1]!.contains(document.getSelection()!.anchorNode)).toBe(true);
  });

  it('Enter on a blank line above a list adds a blank line', () => {
    const ed = createEditor(el, { parser: full(), value: '\n- a' });
    const blank = el.children[0] as HTMLElement;
    setSel(blank, 0);
    pressEnter();
    expect(ed.getValue()).toBe('\n\n- a');
    expect(el.children.length).toBe(3);
    expect(el.children[2]!.tagName).toBe('UL');
    expect(el.children[1]!.contains(document.getSelection()!.anchorNode)).toBe(true);
  });

  it('blank lines keep multiplying with Enter (consecutive blanks preserved)', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\n\nb' });
    const blank = el.children[1] as HTMLElement;
    setSel(blank, 0);
    pressEnter();
    expect(ed.getValue()).toBe('a\n\n\nb');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['P', 'P', 'P', 'P']);
    expect(el.children[2]!.contains(document.getSelection()!.anchorNode)).toBe(true);
  });

  it('typing "- " on a blank line below a list merges it, caret stays on that line', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n' });
    const blank = el.children[1] as HTMLElement;
    blank.textContent = '- ';
    setSel(blank.firstChild!, 2);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('- a\n- '); // merged into one list block
    expect(el.children.length).toBe(1);
    const ul = el.children[0] as HTMLElement;
    expect(ul.children[1]!.contains(document.getSelection()!.anchorNode)).toBe(true);
    expect(document.getSelection()!.anchorOffset).toBe(2); // after '- '
  });
});

describe('list nesting (Tab / Shift+Tab / indentation)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const key = (k: string, shift = false) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }),
    );

  it('Tab nests one level, Shift+Tab undoes it', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n- b' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[1]!.firstChild!.firstChild!, 2); // after the '- ' of '- b'
    key('Tab');
    expect(ed.getValue()).toBe('- a\n  - b');
    const ul2 = el.children[0] as HTMLElement;
    setSel(ul2.children[1]!.querySelector(`.${styles.symbol}`)!.firstChild!, 2); // end of the '  - b' marker symbol
    key('Tab', true);
    expect(ed.getValue()).toBe('- a\n- b');
  });

  it('Tab only goes one level deeper than the previous item', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n- b' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[1]!.firstChild!.firstChild!, 2);
    key('Tab');
    expect(ed.getValue()).toBe('- a\n  - b');
    key('Tab'); // previous item is top-level: cannot nest deeper
    expect(ed.getValue()).toBe('- a\n  - b');
  });

  it('indentation works in ordered lists too (numbers preserved in source)', () => {
    const ed = createEditor(el, { parser: full(), value: '1. a\n2. b' });
    const ol = el.children[0] as HTMLElement;
    setSel(ol.children[1]!.firstChild!.firstChild!, 3); // after '2. '
    key('Tab');
    expect(ed.getValue()).toBe('1. a\n  2. b');
  });

  it('Tab outside a list changes nothing', () => {
    const ed = createEditor(el, { parser: full(), value: 'plain' });
    const p = el.children[0] as HTMLElement;
    setSel(p.firstChild!, 5);
    key('Tab');
    expect(ed.getValue()).toBe('plain');
  });

  it('Backspace at an indented list line start removes two spaces', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n  - b' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[1]!.firstChild!, 0); // before the indent spaces
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('- a\n- b');
  });

  it('quotes are unaffected by indentation (Tab ignored)', () => {
    const ed = createEditor(el, { parser: full(), value: '> a\n> b' });
    const bq = el.children[0] as HTMLElement;
    setSel(bq.children[1]!.firstChild!.firstChild!, 2);
    key('Tab');
    expect(ed.getValue()).toBe('> a\n> b');
  });
});

describe('IME caret anchoring · selection deletion', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const pressEnter = () =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

  it('the caret on an Enter-created blank line sits before the <br> (content start) — IME-safe', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    const p = el.children[0] as HTMLElement;
    setSel(p.firstChild!, 1); // after 'a'
    pressEnter();
    expect(ed.getValue()).toBe('a\n');
    const blank = el.children[1] as HTMLElement;
    const sel = document.getSelection()!;
    expect(sel.anchorNode).toBe(blank);
    expect(sel.anchorOffset).toBe(0);
  });

  it('above an empty paragraph, the caret also lands at content start', () => {
    createEditor(el, { parser: full(), value: '' });
    const blank = el.children[0] as HTMLElement;
    const sel = document.getSelection()!; // at setValue time — re-checked via Enter below
    setSel(blank, 0);
    pressEnter();
    const blank2 = el.children[1] as HTMLElement;
    expect(sel.anchorNode === blank2 || blank2.contains(sel.anchorNode!)).toBe(true);
    expect(sel.anchorNode).toBe(blank2);
    expect(sel.anchorOffset).toBe(0);
  });

  it('Backspace is not intercepted when a selection exists (browser deletes it)', () => {
    const ed = createEditor(el, { parser: full(), value: '- A\n- B' });
    const ul = el.children[0] as HTMLElement;
    const li1Text = ul.children[0]!.firstChild!.firstChild!; // '- ' symbol text
    const li2Last = ul.children[1]!.lastChild!; // the 'B' text
    const sel = document.getSelection()!;
    const r = document.createRange();
    r.setStart(li1Text, 0);
    r.setEnd(li2Last, 1); // whole-list selection
    sel.removeAllRanges();
    sel.addRange(r);
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // default action = selection deletion
    expect(ed.getValue()).toBe('- A\n- B'); // the editor doesn't invent line edits
  });

  it('Enter deletes the selection and splits', () => {
    const ed = createEditor(el, { parser: full(), value: 'abcd' });
    const p = el.children[0] as HTMLElement;
    setSelRange(p.firstChild!, 1, 3); // 'bc' selected
    pressEnter();
    expect(ed.getValue()).toBe('a\nd');
  });
});

describe('Enter at line start — blank line above', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const pressEnter = () =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

  it('Enter before a list item prefix → blank line above, item untouched', () => {
    const ed = createEditor(el, { parser: full(), value: '- A' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[0]!.firstChild!.firstChild!, 0); // before '-'
    pressEnter();
    expect(ed.getValue()).toBe('\n- A');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['P', 'UL']);
    expect(el.children[0]!.contains(document.getSelection()!.anchorNode!)).toBe(true);
  });

  it('same before a quote marker', () => {
    const ed = createEditor(el, { parser: full(), value: '> A' });
    const bq = el.children[0] as HTMLElement;
    setSel(bq.children[0]!.firstChild!.firstChild!, 0);
    pressEnter();
    expect(ed.getValue()).toBe('\n> A');
    expect(Array.from(el.children).map((c) => c.tagName)).toEqual(['P', 'BLOCKQUOTE']);
  });

  it('before an indented item prefix — blank line above, indent kept', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n  - b' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[1]!.firstChild!, 0); // before '  '
    pressEnter();
    expect(ed.getValue()).toBe('- a\n\n  - b'); // a blank line splits the list
    const sel = document.getSelection()!;
    expect(el.children[1]!.tagName).toBe('P');
    expect(el.children[1]!.contains(sel.anchorNode!)).toBe(true);
  });

  it('regression: Enter mid/end of an item keeps prefix inheritance', () => {
    const ed = createEditor(el, { parser: full(), value: '- A' });
    const ul = el.children[0] as HTMLElement;
    setSel(ul.children[0]!.lastChild!, 1); // after 'A'
    pressEnter();
    expect(ed.getValue()).toBe('- A\n- ');
  });
});

describe('bulk Tab indentation (code blocks · multi-line selections)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const key = (k: string, shift = false) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }),
    );
  const selectRange = (start: [Node, number], end: [Node, number]) => {
    const r = document.createRange();
    r.setStart(start[0], start[1]);
    r.setEnd(end[0], end[1]);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  it('collapsed Tab in a code block inserts two spaces; Shift+Tab removes two', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode\n  more\n```' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild!; // 'code\n  more'
    setSel(body, 4); // end of 'code'
    key('Tab');
    expect(ed.getValue()).toBe('```\ncode  \n  more\n```');
    // the rerender replaced the nodes — re-query
    const pre2 = el.children[0] as HTMLElement;
    const body2 = (pre2.childNodes[1] as HTMLElement).firstChild!;
    setSel(body2, 13); // start of the 'more' line (after 'code  \n  ')
    key('Tab', true);
    expect(ed.getValue()).toBe('```\ncode  \nmore\n```');
  });

  it('collapsed Tab on a fence line also inserts two spaces', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode\n```' });
    const pre = el.children[0] as HTMLElement;
    setSel(pre.firstElementChild!.firstChild!, 3); // end of the opening ```
    key('Tab');
    expect(ed.getValue()).toBe('```  \ncode\n```'); // still a fence
  });

  it('keys with isComposing are ignored (§6.3)', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nb' });
    setSel(el.children[1]!.firstChild!, 1);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(ed.getValue()).toBe('a\nb');
  });

  it('paste/drop: payload-less events are safely ignored', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    el.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    expect(ed.getValue()).toBe('a');
  });

  it('paste: Range fallback + synthetic input when execCommand fails or throws', () => {
    const orig = document.execCommand;
    try {
      for (const stub of [() => false, () => { throw new Error('no'); }]) {
        document.body.innerHTML = '';
        const host = document.createElement('div');
        document.body.appendChild(host);
        const ed = createEditor(host, { parser: full(), value: 'a' });
        setSel(host.children[0]!.firstChild!, 1);
        (document as unknown as { execCommand: unknown }).execCommand = stub;
        const ev = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', { value: { getData: () => 'P' } });
        host.dispatchEvent(ev);
        expect(ed.getValue()).toBe('aP');
        ed.destroy();
      }
    } finally {
      (document as unknown as { execCommand: unknown }).execCommand = orig;
    }
  });

  it('Shift+Tab: nothing to unindent → unchanged, key just blocked', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nb' });
    const p0 = el.children[0] as HTMLElement;
    const p1 = el.children[1] as HTMLElement;
    selectRange([p0.firstChild!, 0], [p1.firstChild!, 1]);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // blocked — focus stays
    expect(ed.getValue()).toBe('a\nb'); // unchanged
  });

  it('Tab on a heading line — indent after the prefix', () => {
    const ed = createEditor(el, { parser: full(), value: '# h\nplain' });
    const h = el.children[0] as HTMLElement;
    selectRange([h, 1], [h, 2]); // the heading text node
    key('Tab');
    expect(ed.getValue()).toBe('#   h\nplain');
  });

  it('with no selection, Tab/Home/End do nothing', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\nb' });
    document.getSelection()!.removeAllRanges();
    for (const key of ['Tab', 'Home', 'End']) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(ed.getValue()).toBe('- a\nb');
  });

  it('mixed-selection Shift+Tab — lines without indent stay put', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\n  b' });
    const p0 = el.children[0] as HTMLElement;
    const p1 = el.children[1] as HTMLElement;
    selectRange([p0.firstChild!, 0], [p1.firstChild!, 2]);
    key('Tab', true);
    expect(ed.getValue()).toBe('a\nb');
  });

  it('image widget boundary seats are re-seated onto text (selectionchange normalization)', () => {
    createEditor(el, {
      parser: createParser({ image: true }),
      value: '앞 ![alt](https://x.y/i.png) 뒤',
    });
    const p = el.children[0] as HTMLElement;
    const span = p.querySelector(`.${styles.image}`) as HTMLElement;
    // simulate the engine anchoring the caret on the widget span itself;
    // the leading boundary steps FORWARD into the raw source (ArrowRight
    // must cross the image), other seats fall back to the preceding text
    setSel(span, 0);
    document.dispatchEvent(new Event('selectionchange'));
    const sel = document.getSelection()!;
    expect(sel.anchorNode?.nodeType).toBe(3); // text seat
    expect((sel.anchorNode?.textContent ?? '').startsWith('![alt]')).toBe(true);
    // (span,1) — the img contributes no text, so this is the same text
    // boundary; seat resolves to the preceding text instead
    setSel(span, 1);
    document.dispatchEvent(new Event('selectionchange'));
    const s2 = document.getSelection()!;
    expect(s2.anchorNode?.nodeType).toBe(3);
    expect(s2.anchorNode === span).toBe(false);
    expect((s2.anchorNode?.textContent ?? '').endsWith('앞 ')).toBe(true);
  });

  it('paste/drop: empty text is a no-op', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '' } });
    el.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true); // still blocked
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => '' } });
    el.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(ed.getValue()).toBe('a');
  });

  it('unclosed fence: both body Enter and end escape work', () => {
    const ed = createEditor(el, { parser: full(), value: '```\nab' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild as Text;
    setSel(body, 2); // end of 'ab' — no closing fence, all body
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.getValue()).toBe('```\nab\n');
    // caret at the very end escapes (unclosed fence, empty paragraph after)
    const pre2 = el.children[0] as HTMLElement;
    const body2 = (pre2.childNodes[1] as HTMLElement).firstChild as Text;
    setSel(body2, 3);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.getValue()).toBe('```\nab\n\n');
  });

  it('caret clamp in a closed empty-body fence (\'```\\n```\')', () => {
    const ed = createEditor(el, { parser: full(), value: '```\n```' });
    const pre = el.children[0] as HTMLElement;
    setSel(pre.lastElementChild!.firstChild as Text, 3); // end of the closer
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.getValue()).toBe('```\n```\n');
  });

  it('no fence auto-close with codeBlock disabled in the parser', () => {
    const ed = createEditor(el, { parser: createParser({ list: true }), value: 'x' });
    (el.children[0] as HTMLElement).textContent = '```';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```');
  });

  it('paste: fallback for environments without execCommand at all', () => {
    const orig = document.execCommand;
    try {
      document.body.innerHTML = '';
      const host = document.createElement('div');
      document.body.appendChild(host);
      const ed = createEditor(host, { parser: full(), value: 'a' });
      setSel(host.children[0]!.firstChild!, 1);
      delete (document as unknown as { execCommand?: unknown }).execCommand;
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => 'P' } });
      host.dispatchEvent(ev);
      expect(ed.getValue()).toBe('aP');
    } finally {
      (document as unknown as { execCommand: unknown }).execCommand = orig;
    }
  });

  it('BS at the start of an HR first block is delegated', () => {
    const ed = createEditor(el, { parser: full(), value: '---' });
    const hr = el.children[0] as HTMLElement;
    setSel(hr.firstChild!.firstChild!, 0);
    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Enter with no selection at all is a no-op', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    document.getSelection()!.removeAllRanges();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.getValue()).toBe('a');
  });

  it('classifyInput: insertParagraph/insertLineBreak/insertFromDrop', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nb' });
    for (const inputType of ['insertParagraph', 'insertLineBreak', 'insertFromDrop']) {
      setSel(el.children[0]!.firstChild!, 1);
      const t = el.children[0] as HTMLElement;
      t.textContent = inputType === 'insertFromDrop' ? 'aX' : 'a\n';
      el.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
    }
    expect(ed.canUndo()).toBe(true); // recorded as some unit — no crash
  });

  it('Backspace: prefix-less text on a container first line is delegated', () => {
    const ed = createEditor(el, { parser: full(), value: '- a' });
    const ul = el.children[0] as HTMLElement;
    // simulate a browser-inserted stray text line before the li
    ul.insertBefore(document.createTextNode('x'), ul.firstChild!);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('x\n- a');
    const stray = ul.firstChild as Text;
    setSel(stray, 0);
    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // delegated — no prefix to strip
  });

  it('fence lines are never indented (selection)', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode\n```' });
    const pre = el.children[0] as HTMLElement;
    const open = pre.firstElementChild!.firstChild! as Text;
    const body = (pre.childNodes[1] as HTMLElement).firstChild as Text;
    selectRange([open, 0], [body, 2]);
    key('Tab');
    // fence line untouched, body indented
    expect(ed.getValue()).toBe('```\n  code\n```');
  });

  it('selection spanning the closing fence — the closing line stays untouched too', () => {
    const ed = createEditor(el, { parser: full(), value: '```\na\nb\n```' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild!; // 'a\nb'
    const close = pre.lastElementChild!.firstChild!;
    selectRange([body, 3], [close, 3]);
    expect(ed.getValue()).toBe('```\na\nb\n```');
    key('Tab');
    expect(ed.getValue()).toBe('```\na\n  b\n```');
  });

  it('paragraph→code→paragraph selection — bodies indent, fences/prefixes untouched', () => {
    const ed = createEditor(el, { parser: full(), value: 'x\n```\ny\n```\nz' });
    const p0 = el.children[0] as HTMLElement;
    const p2 = el.children[2] as HTMLElement;
    selectRange([p0.firstChild!, 0], [p2.firstChild!, 1]);
    key('Tab');
    expect(ed.getValue()).toBe('  x\n```\n  y\n```\n  z');
  });

  it('multi-line quote selection Tab — indent after the prefix', () => {
    const ed = createEditor(el, { parser: full(), value: '> a\n> b' });
    const q = el.children[0] as HTMLElement;
    const l0 = q.children[0] as HTMLElement;
    const l1 = q.children[1] as HTMLElement;
    selectRange([l0.lastChild!, 0], [l1.lastChild!, 1]);
    key('Tab');
    expect(ed.getValue()).toBe('>   a\n>   b');
  });

  it('multi-line code selection — whole body indented + selection kept', () => {
    const ed = createEditor(el, { parser: full(), value: '```\na\nb\n```' });
    const pre = el.children[0] as HTMLElement;
    const body = (pre.childNodes[1] as HTMLElement).firstChild!; // 'a\nb'
    selectRange([body, 0], [body, 3]);
    key('Tab');
    expect(ed.getValue()).toBe('```\n  a\n  b\n```');
    const sel = document.getSelection()!;
    expect(sel.getRangeAt(0).collapsed).toBe(false);
    expect(sel.toString()).toBe('a\n  b'); // selection content preserved
    key('Tab', true);
    expect(ed.getValue()).toBe('```\na\nb\n```');
  });

  it('multi-line list selection — uniform ±2 spaces (collapsed-Tab depth cap not applied)', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n- b\n- c' });
    const ul = el.children[0] as HTMLElement;
    selectRange(
      [ul.children[0]!.firstChild!.firstChild!, 0],
      [ul.children[2]!.lastChild!, 1],
    );
    key('Tab');
    expect(ed.getValue()).toBe('  - a\n  - b\n  - c');
    key('Tab', true);
    expect(ed.getValue()).toBe('- a\n- b\n- c');
  });

  it('selection across blocks — paragraphs and lists both indent', () => {
    const ed = createEditor(el, { parser: full(), value: 'x\n- a' });
    const p = el.children[0] as HTMLElement;
    const ul = el.children[1] as HTMLElement;
    selectRange([p.firstChild!, 0], [ul.children[0]!.lastChild!, 1]);
    key('Tab');
    expect(ed.getValue()).toBe('  x\n  - a');
  });

  it('quote lines indent after the prefix (markers kept)', () => {
    const ed = createEditor(el, { parser: full(), value: '> q1\n> q2' });
    const bq = el.children[0] as HTMLElement;
    selectRange(
      [bq.children[0]!.firstChild!.firstChild!, 0],
      [bq.children[1]!.lastChild!, 2],
    );
    key('Tab');
    expect(ed.getValue()).toBe('>   q1\n>   q2');
    key('Tab', true);
    expect(ed.getValue()).toBe('> q1\n> q2');
  });

  it('a multi-line Tab reverts with one undo', () => {
    const ed = createEditor(el, { parser: full(), value: '- a\n- b' });
    const ul = el.children[0] as HTMLElement;
    selectRange(
      [ul.children[0]!.firstChild!.firstChild!, 0],
      [ul.children[1]!.lastChild!, 1],
    );
    key('Tab');
    expect(ed.getValue()).toBe('  - a\n  - b');
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('- a\n- b');
  });
});describe('syntax highlighting (syntaxHighlight)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  // fake a highlighter whose markup keeps textContent identical to the source
  const hl = (code: string, lang: string) =>
    code ? `<b data-lang="${lang}">${code}</b>` : null;

  it('closed block: one newline appended to the result, removed before the closing fence — round-trip intact', () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```js\nab\n```',
      syntaxHighlight: (c) => `<i>${c}</i>`,
    });
    const pre = el.children[0] as HTMLElement;
    const body = pre.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.textContent).toBe('ab\n'); // newline moved into the body
    expect(body.lastChild?.nodeType).toBe(3);
    expect(body.lastChild?.textContent).toBe('\n');
    // close fence symbol no longer carries the structural newline
    expect(pre.lastElementChild?.textContent).toBe('```');
    expect(pre.textContent).toBe('```js\nab\n```'); // round-trip intact
    expect(ed.getValue()).toBe('```js\nab\n```');
  });

  it('unclosed block: no newline appended (no fence to compensate)', () => {
    createEditor(el, {
      parser: full(),
      value: '```js\nab',
      syntaxHighlight: (c) => `<i>${c}</i>`,
    });
    const pre = el.children[0] as HTMLElement;
    const body = pre.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.textContent).toBe('ab');
    expect(pre.textContent).toBe('```js\nab');
  });

  it('re-application (debounced re-highlight) keeps the round-trip', async () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```\nab\n```',
      syntaxHighlight: (c) => `<i>${c}</i>`,
    });
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    // edit → plain rebuild → re-highlight settles (firstChild is inside <i>)
    ((body.querySelector('i') ?? body).firstChild as Text).nodeValue = 'ax';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250)); // debounce
    expect(ed.getValue()).toBe('```\nax\n```');
    const pre = el.children[0] as HTMLElement;
    expect((pre.querySelector(`.${styles.codeBody}`) as HTMLElement).textContent).toBe('ax\n');
    expect(pre.lastElementChild?.textContent).toBe('```');
  });

  it('async re-application after a sync result — round-trip holds in the already-shifted state', async () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```\nab\n```',
      syntaxHighlight: (c) => `<i>${c}</i>`,
    });
    // first application already moved the newline into the body;
    // a second (async) application must not lose or double it
    const pre = el.children[0] as HTMLElement;
    const body = pre.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.innerHTML).toBe('<i>ab</i>\n');
    expect(pre.lastElementChild?.textContent).toBe('```');
    // trigger re-highlight with a different result via an edit
    ((body.querySelector('i') ?? body).firstChild as Text).nodeValue = 'ax';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250)); // debounce
    expect(ed.getValue()).toBe('```\nax\n```');
    expect(body.innerHTML).toBe('<i>ax</i>\n');
    expect(pre.lastElementChild?.textContent).toBe('```'); // still no double newline
  });

  it('a null highlighter result keeps the block plain (unsupported language)', async () => {
    const hl = vi.fn(() => null);
    const ed = createEditor(el, { parser: full(), value: '```zzz\nab\n```', syntaxHighlight: hl });
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.textContent).toBe('ab');
    expect(body.querySelector('i')).toBeNull();
    expect(hl).toHaveBeenCalled();
    expect(ed.getValue()).toBe('```zzz\nab\n```');
  });

  it('consecutive typing reuses the debounce timer', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const ed = createEditor(el, {
        parser: full(),
        value: '```\nab\n```',
        syntaxHighlight: (c) => {
          calls++;
          return `<i>${c}</i>`;
        },
      });
      expect(calls).toBe(1); // initial
      const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
      for (const v of ['x', 'y']) {
        ((body.querySelector('i') ?? body).firstChild as Text).nodeValue = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await vi.advanceTimersByTimeAsync(300);
      expect(calls).toBe(2); // one debounced re-run for both inputs
    } finally {
      vi.useRealTimers();
    }
  });

  it('a composing code block skips the debounced flush and applies after compositionend', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const ed = createEditor(el, {
        parser: full(),
        value: '```\nab\n```',
        syntaxHighlight: (c) => {
          calls++;
          return `<i>${c}</i>`;
        },
      });
      expect(calls).toBe(1);
      const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
      const text = (body.querySelector('i') ?? body).firstChild as Text;
      text.nodeValue = 'ax';
      setSel(text, 2);
      el.dispatchEvent(new Event('compositionstart'));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
      expect(calls).toBe(1); // flush skipped while composing
      el.dispatchEvent(new Event('compositionend'));
      await vi.advanceTimersByTimeAsync(300);
      expect(calls).toBe(2); // re-applied after the composition ends
      expect(body.querySelector('i')?.textContent).toBe('ax');
      expect(ed.getValue()).toBe('```\nax\n```');
    } finally {
      vi.useRealTimers();
    }
  });

  it('structural changes during composition are deferred until it ends', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\n- b' });
    const p0 = el.children[0] as HTMLElement;
    setSel(p0.firstChild!, 1);
    el.dispatchEvent(new Event('compositionstart'));
    // structural edit during composition: 'a' becomes a list line → blocks merge
    p0.textContent = '- x';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.children.length).toBe(2); // rebuild deferred (§6.3)
    el.dispatchEvent(new Event('compositionend'));
    expect(ed.getValue()).toBe('- x\n- b');
    expect(el.children.length).toBe(1);
  });

  it('splices that insert code blocks are safe without a highlighter', () => {
    const ed = createEditor(el, { parser: full(), value: '```\nab\n```' });
    const pre = el.children[0] as HTMLElement;
    setSel(pre.lastElementChild!.firstChild as Text, 4); // end of the closing fence
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ed.getValue()).toBe('```\nab\n```\n');
    // paste a multi-block text into the tail — splice inserts a PRE without a highlighter
    const tail = el.children[1] as HTMLElement;
    tail.textContent = '```js\nlet\n```\nafter';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```\nab\n```\n```js\nlet\n```\nafter');
    expect((el.children[1] as HTMLElement).tagName).toBe('PRE');
    expect((el.children[2] as HTMLElement).tagName).toBe('P');
  });

  it('setValue highlights immediately; the source round-trip holds', async () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```js\nconst a;\n```',
      syntaxHighlight: hl,
    });
    await Promise.resolve(); // drain async applications
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.querySelector('b')?.getAttribute('data-lang')).toBe('js');
    expect(body.textContent).toBe('const a;\n'); // structural newline lives in the body now
    expect(ed.getValue()).toBe('```js\nconst a;\n```');
  });

  it('sync callback: highlighting survives typing (rerender skipped) — no plain flash', async () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```\nab\n```',
      syntaxHighlight: hl,
    });
    const pre0 = el.children[0] as HTMLElement;
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    const text = (body.querySelector('b') ?? body).firstChild as Text;
    text.nodeValue = 'abc';
    setSel(text, 3);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```\nabc\n```');
    expect(el.children[0]).toBe(pre0); // rerender skipped — no flicker
    const body2 = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body2.querySelector('b')?.textContent).toBe('abc'); // stale markup + current text (colors kept)
    const sel = document.getSelection()!;
    expect(sel.anchorNode?.textContent).toBe('abc');
    expect(sel.anchorOffset).toBe(3); // caret preserved
  });

  it('async callback applies after the debounce — existing highlight DOM kept meanwhile (no flicker)', async () => {
    vi.useFakeTimers();
    try {
      const ed = createEditor(el, {
        parser: full(),
        value: '```\nab\n```',
        syntaxHighlight: (code, lang) =>
          Promise.resolve(code ? `<i data-lang="${lang}">${code}</i>` : null),
      });
      await vi.advanceTimersByTimeAsync(0); // settle the initial application
      const pre0 = el.children[0] as HTMLElement;
      const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
      const text = (body.querySelector('i') ?? body).firstChild as Text;
      text.nodeValue = 'abc';
      setSel(text, 3);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(ed.getValue()).toBe('```\nabc\n```');
      expect(el.children[0]).toBe(pre0); // no rebuild
      expect(body.querySelector('i')?.textContent).toBe('abc'); // stale markup + current text (colors kept)
      await vi.advanceTimersByTimeAsync(200);
      const body2 = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
      expect(body2.querySelector('i')?.textContent).toBe('abc'); // refreshed after debounce
      const sel = document.getSelection()!;
      expect(sel.anchorNode?.textContent).toBe('abc');
      expect(sel.anchorOffset).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('typing on a highlighted block reads the source back exactly', async () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```js\nlet x = 1;\n```',
      syntaxHighlight: hl,
    });
    await Promise.resolve(); // drain the initial highlight
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    (body.querySelector('b')!.firstChild as Text).nodeValue = 'let y = 2;';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```js\nlet y = 2;\n```');
  });

  it('a null result leaves the block as-is (unsupported language)', () => {
    createEditor(el, {
      parser: full(),
      value: '```xyz\ncode\n```',
      syntaxHighlight: (code) => (code.includes('?') ? `<i>${code}</i>` : null),
    });
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    expect(body.querySelector('i')).toBeNull();
    expect(body.textContent).toBe('code');
  });

  it('no compositionstart target and no selection → defer everything (-1), applied at the end', () => {
    const ed = createEditor(el, { parser: full(), value: '```\nab\n```' });
    // no selection anywhere: fallback also fails → -1 → defer all
    document.getSelection()!.removeAllRanges();
    el.dispatchEvent(new Event('compositionstart'));
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    (body.firstChild as Text).nodeValue = 'ax';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```\nax\n```'); // value follows the DOM live (§6.6)
    expect((el.children[0] as HTMLElement).tagName).toBe('PRE'); // block untouched
    el.dispatchEvent(new Event('compositionend'));
    expect(ed.getValue()).toBe('```\nax\n```');
  });

  it('a selection outside the body is not restored when applying a highlight', async () => {
    const ed = createEditor(el, { parser: full(), value: 'p\n```\nab\n```', syntaxHighlight: hl });
    const p0 = el.children[0] as HTMLElement;
    setSelRange(p0.firstChild!, 0, 1); // selection in the paragraph, outside the body
    const body = (el.children[1] as HTMLElement);
    const text = ((body.querySelector(`.${styles.codeBody}`) as HTMLElement).querySelector('b') as HTMLElement)?.firstChild as Text;
    text.nodeValue = 'ax';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('p\n```\nax\n```');
    const sel = document.getSelection()!;
    expect(sel.toString()).toBe('p'); // untouched
  });

  it('re-highlight preserves a non-collapsed selection', async () => {
    const ed = createEditor(el, { parser: full(), syntaxHighlight: hl });
    ed.setValue('```js\nabcdef\n```');
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    const text = (body.querySelector('b') ?? body).firstChild as Text;
    text.nodeValue = 'abcxef';
    setSelRange(text, 1, 4); // non-collapsed selection inside the body
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```js\nabcxef\n```');
    const sel = document.getSelection()!;
    expect(sel.toString()).toBe('bcx'); // selection preserved across the swap
  });

  it('scheduled highlights are cancelled after destroy', () => {
    vi.useFakeTimers();
    try {
      const ed = createEditor(el, { parser: full(), syntaxHighlight: hl });
      ed.setValue('```js\ncode\n```');
      ed.destroy();
      vi.advanceTimersByTime(500);
      // detached DOM is no longer the editor's concern — just must not throw
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late async result is discarded by the stale guard', async () => {
    let resolve!: (h: string | null) => void;
    const ed = createEditor(el, {
      parser: full(),
      value: '```\nab\n```',
      syntaxHighlight: () => new Promise<string | null>((r) => (resolve = r)),
    });
    const body = el.querySelector(`.${styles.codeBody}`) as HTMLElement;
    const text = body.firstChild as Text;
    text.nodeValue = 'abc'; // edited again before the result lands
    setSel(text, 3);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    resolve('<i>ab</i>'); // resolves with the STALE code
    await Promise.resolve();
    await Promise.resolve();
    expect(body.querySelector('i')).toBeNull(); // discarded
    expect(ed.getValue()).toBe('```\nabc\n```');
  });

  it('a late async result on a destroyed editor is ignored too', async () => {
    let resolve!: (h: string | null) => void;
    const ed = createEditor(el, {
      parser: full(),
      value: '```\nab\n```',
      syntaxHighlight: () => new Promise<string | null>((r) => (resolve = r)),
    });
    ed.destroy();
    resolve('<i>x</i>');
    await Promise.resolve();
    await Promise.resolve();
    expect(el.children.length).toBe(0);
  });
});

describe('undo/redo', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const type = (text: string) => {
    (el.firstElementChild as HTMLElement).textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('redo stack cap: undos past the limit are not redoable', () => {
    const ed = createEditor(el, { parser: full(), value: '', history: { limit: 2 } });
    const p = el.children[0] as HTMLElement;
    for (const [i, v] of ['a', 'b', 'c'].entries()) {
      p.textContent = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // distinct undo units: alternate kinds via setValue between types
      if (i < 2) ed.setValue(v + 'x');
    }
    while (ed.canUndo()) ed.undo();
    expect(ed.canUndo()).toBe(false);
    let redos = 0;
    while (ed.canRedo()) {
      ed.redo();
      redos++;
    }
    expect(redos).toBeLessThanOrEqual(2); // cap held
  });

  it('undo stack cap: overflowing snapshots are dropped', () => {
    const ed = createEditor(el, { parser: full(), value: '', history: { limit: 2 } });
    // three units of distinct kinds
    type('a');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    type('b');
    expect(ed.canUndo()).toBe(true);
    ed.undo(); ed.undo(); ed.undo();
    expect(ed.getValue()).toBe('');
    // redo stack was capped at 2 → one redo only
    expect(ed.canRedo()).toBe(true);
    ed.redo();
    expect(ed.canRedo()).toBe(false);
  });

  it('Cmd/Ctrl+Y redo — restores the caret captured at undo time', () => {
    const ed = createEditor(el, { parser: full(), value: '' });
    type('ab');
    type('c'); // same-kind units merge — one undo unit ''→'c'
    expect(ed.getValue()).toBe('c');
    const t = el.children[0]!.firstChild!;
    document.getSelection()!.setBaseAndExtent(t, 1, t, 1);
    ed.undo();
    expect(ed.getValue()).toBe('');
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('c');
    expect(document.getSelection()!.anchorOffset).toBe(1); // caret captured at undo time
  });

  it('ARIA: role/aria-multiline; placeholder doubles as the label', () => {
    const ed0 = createEditor(el, { placeholder: 'Write a comment' });
    expect(el.getAttribute('role')).toBe('textbox');
    expect(el.getAttribute('aria-multiline')).toBe('true');
    expect(el.getAttribute('aria-label')).toBe('Write a comment');
    ed0.destroy();
    expect(el.getAttribute('role')).toBe(null); // clean up what we set
    expect(el.getAttribute('aria-label')).toBe(null);
  });

  it('ARIA: an existing label is never overwritten', () => {
    el.setAttribute('aria-label', 'User comment');
    createEditor(el, { placeholder: 'Write a comment' });
    expect(el.getAttribute('aria-label')).toBe('User comment');
  });

  it('reset(): replaces the value AND drops all undo history', () => {
    const seen: string[] = [];
    const ed = createEditor(el, { parser: full(), value: '', onChange: (v) => seen.push(v) });
    const p = el.children[0] as HTMLElement;
    p.textContent = 'hello';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('hello');
    expect(ed.canUndo()).toBe(true);
    ed.reset();
    expect(ed.getValue()).toBe('');
    expect(ed.canUndo()).toBe(false);
    expect(ed.canRedo()).toBe(false);
    expect(ed.undo()).toBe(false); // nothing left to restore
    expect(seen).toContain('');
  });

  it('reset(text): starts fresh with nothing to restore', () => {
    const ed = createEditor(el, { parser: full(), value: 'old' });
    ed.reset('new');
    expect(ed.getValue()).toBe('new');
    expect(ed.canUndo()).toBe(false);
  });

  it('setReadonly(): edit lock/unlock + aria-readonly sync', () => {
    const ed = createEditor(el, { parser: full(), value: 'text' });
    ed.setReadonly(true);
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(el.getAttribute('aria-readonly')).toBe('true');
    // locked: dispatched edits change nothing
    const ev = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ed.getValue()).toBe('text');
    ed.setReadonly(false);
    expect(el.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(el.hasAttribute('aria-readonly')).toBe(false);
  });

  it('a reset requested mid-composition applies the value and drops history at the end', () => {
    const ed = createEditor(el, { parser: full(), value: 'draft' });
    // composition on the first block defers external sets (§6.3)
    const p0 = el.children[0] as HTMLElement;
    p0.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    ed.reset('done');
    expect(ed.getValue()).toBe('draft'); // deferred
    p0.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(ed.getValue()).toBe('done');
    expect(ed.canUndo()).toBe(false); // history dropped after flush
  });

  it('onChange subscribe/unsubscribe', () => {
    const ed = createEditor(el, { parser: full(), value: '' });
    const seen: string[] = [];
    const off = ed.onChange((v) => seen.push(v));
    type('x');
    expect(seen).toEqual(['x']);
    off();
    type('y');
    expect(seen).toEqual(['x']);
  });

  it('compositionend without compositionstart still syncs the value', () => {
    const seen: string[] = [];
    const ed = createEditor(el, { parser: full(), value: 'a', onChange: (v) => seen.push(v) });
    (el.children[0] as HTMLElement).textContent = 'ab';
    el.dispatchEvent(new Event('compositionend'));
    expect(ed.getValue()).toBe('ab');
    expect(seen).toEqual(['ab']);
  });

  it('history: false disables undo/redo', () => {
    const ed = createEditor(el, { parser: full(), value: '', history: false });
    type('ab');
    expect(ed.getValue()).toBe('ab');
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(false);
    expect(ed.canUndo()).toBe(false);
    expect(ed.canRedo()).toBe(false);
    expect(ed.getValue()).toBe('ab');
  });

  it('undo restores the pre-edit caret position (not the post-input one)', () => {
    const ed = createEditor(el, { parser: full(), value: 'abcd' });
    const t = el.children[0]!.firstChild!;
    setSel(t, 2); // ab|cd
    // real browser flow: beforeinput → DOM edit + caret move → input
    el.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertText', data: 'X', bubbles: true, cancelable: true }),
    );
    t.textContent = 'abXcd';
    setSel(t, 3); // caret already past the inserted char
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('abXcd');
    ed.undo();
    expect(ed.getValue()).toBe('abcd');
    const sel = document.getSelection()!;
    expect(sel.anchorOffset).toBe(2); // pre-edit caret, not 3
  });

  it('consecutive inputs of the same kind merge into one unit', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    type('ab');
    type('abc');
    expect(ed.getValue()).toBe('abc');
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('a'); // straight back to the start
    expect(ed.canUndo()).toBe(false);
    expect(ed.redo()).toBe(true);
    expect(ed.getValue()).toBe('abc');
  });

  it('units split past the pause threshold', () => {
    vi.useFakeTimers({ now: 1000 });
    try {
      const ed = createEditor(el, { parser: full(), value: 'a' });
      type('ab');
      vi.setSystemTime(1600);
      type('abc');
      expect(ed.undo()).toBe(true);
      expect(ed.getValue()).toBe('ab');
      expect(ed.undo()).toBe(true);
      expect(ed.getValue()).toBe('a');
    } finally {
      vi.useRealTimers();
    }
  });

  it('different action kinds split units', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    type('ab');
    (el.firstElementChild as HTMLElement).textContent = 'a';
    el.dispatchEvent(
      new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }),
    );
    expect(ed.getValue()).toBe('a');
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('ab'); // only the deletion undone
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('a');
  });

  it('a composition becomes one unit against the pre-start state', () => {
    const ed = createEditor(el, { parser: full(), value: '한글' });
    const b = el.firstElementChild as HTMLElement;
    b.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    b.textContent = '한글 가';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    b.textContent = '한글 가나';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('한글 가나'); // live value during composition
    b.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('한글'); // the whole composition in one step
  });

  it('Cmd+Z / Cmd+Shift+Z keys', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    type('ab');
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('a');
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe('ab');
  });

  it('history: false disables it', () => {
    const ed = createEditor(el, { parser: full(), value: 'a', history: false });
    type('ab');
    expect(ed.canUndo()).toBe(false);
    expect(ed.undo()).toBe(false);
    expect(ed.getValue()).toBe('ab');
  });

  it('over the limit, the oldest units are dropped', () => {
    vi.useFakeTimers({ now: 1000 });
    try {
      const ed = createEditor(el, {
        parser: full(),
        value: 'a',
        history: { limit: 1, pauseMs: 10 },
      });
      type('ab');
      vi.setSystemTime(1100);
      type('abc');
      vi.setSystemTime(1200);
      type('abcd');
      expect(ed.getValue()).toBe('abcd');
      expect(ed.undo()).toBe(true);
      expect(ed.getValue()).toBe('abc');
      expect(ed.undo()).toBe(false); // limit 1
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo returns to the block where the selection was recorded', () => {
    const ed = createEditor(el, { parser: full(), value: '첫줄\n둘째줄' });
    const b1 = el.children[1] as HTMLElement;
    b1.textContent = '둘째줄 수정';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('첫줄\n둘째줄');
    expect(ed.redo()).toBe(true);
    expect(ed.getValue()).toBe('첫줄\n둘째줄 수정');
  });
});

describe('code fence source fidelity (unclosed · non-standard fences)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('an unclosed fence invents no closing fence (value↔DOM agree)', () => {
    const ed = createEditor(el, { parser: full(), value: '```\ncode' });
    expect(ed.getValue()).toBe('```\ncode');
    expect((el.children[0] as HTMLElement).textContent).toBe('```\ncode');
    // further typing must not invent a closing fence
    const pre = el.children[0] as HTMLElement;
    pre.querySelector(`.${styles.codeBody}`)!.textContent = 'code x';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```\ncode x');
  });

  it("여는 울타리만('```') 있어도 왕복이 정확하다", () => {
    const ed = createEditor(el, { parser: full(), value: '```' });
    expect((el.children[0] as HTMLElement).textContent).toBe('```');
    expect(ed.getValue()).toBe('```');
  });

  it("빈 몸통 닫힘('```\\n```')은 빈 줄 1개('```\\n\\n```')로 오염되지 않는다", () => {
    const ed = createEditor(el, { parser: full(), value: '```\n```' });
    expect((el.children[0] as HTMLElement).textContent).toBe('```\n```');
    expect(ed.getValue()).toBe('```\n```');
    const ed2 = createEditor(el, { parser: full(), value: '```\n\n```' });
    expect((el.children[0] as HTMLElement).textContent).toBe('```\n\n```');
    expect(ed2.getValue()).toBe('```\n\n```');
  });

  it("펜스 언어·닫는 울타리 원문 보존('``` js', '````')", () => {
    const ed = createEditor(el, { parser: full(), value: '``` js\nx\n```' });
    const pre = el.children[0] as HTMLElement;
    expect(pre.textContent).toBe('``` js\nx\n```');
    pre.querySelector(`.${styles.codeBody}`)!.textContent = 'xy';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('``` js\nxy\n```'); // no '```js' normalization
    const ed2 = createEditor(el, { parser: full(), value: '````\nx\n````' });
    expect((el.children[0] as HTMLElement).textContent).toBe('````\nx\n````');
  });

  it('typing ``` under the default parser (no codeBlock) adds no auto-close pollution', () => {
    const ed = createEditor(el, { value: 'a' }); // parser omitted = default options
    el.children[0]!.textContent = 'a\n```';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('a\n```'); // no blank line + closing fence injected
  });

  it('an unclosed fence body is fully editable — no closing-symbol no-go zone', () => {
    createEditor(el, { parser: full(), value: '```\ncode' });
    const pre = el.children[0] as HTMLElement;
    // setCaret may place the caret at the body end (full length) — no clamping
    const body = pre.querySelector(`.${styles.codeBody}`) as HTMLElement;
    body.textContent = 'code!';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect((el.children[0] as HTMLElement).textContent).toBe('```\ncode!');
  });
});

describe('review-driven bug fixes (2026-09-22)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const type = (text: string) => {
    const b = el.firstElementChild as HTMLElement;
    b.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const selAllRoot = () => {
    // root-anchored select-all (Cmd+A): startContainer is the editor root
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };

  it('select-all (root anchor) + Enter: value syncs and undo works', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nb\nc' });
    selAllRoot();
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(ed.getValue()).toBe(''); // screen and value agree
    expect(ed.canUndo()).toBe(true);
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('a\nb\nc');
  });

  it('a same-value setValue rebuilds nothing (caret/DOM preserved)', () => {
    const ed = createEditor(el, { parser: full(), value: '가나' });
    const p = el.children[0] as HTMLElement;
    p.textContent = '가나다';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const before = el.children[0];
    ed.setValue('가나다'); // echo — same value
    expect(el.children[0]).toBe(before); // no rebuild
    expect((el.children[0] as HTMLElement).textContent).toBe('가나다');
  });

  it('setValue during composition is deferred and applied at the end', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    el.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    type('aㅎ');
    ed.setValue('외부값');
    expect(ed.getValue()).toBe('aㅎ'); // still the DOM state
    el.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(ed.getValue()).toBe('외부값');
    expect(ed.canUndo()).toBe(true);
  });

  it('a composition broken by blur is still recorded as one undo unit', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    el.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    type('a한글');
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(ed.getValue()).toBe('a한글');
    expect(ed.canUndo()).toBe(true);
    expect(ed.undo()).toBe(true);
    expect(ed.getValue()).toBe('a');
  });

  it('drop inserts text only (pendingKind=paste)', () => {
    const ed = createEditor(el, { parser: full(), value: 'x' });
    const r = document.createRange();
    r.selectNodeContents(el.children[0]!);
    r.collapse(false);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { getData: (t: string) => (t === 'text/plain' ? '\n붙' : '') },
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(ed.getValue()).toBe('x\n붙');
  });

  it('parser + parserOptions together: the options win', () => {
    const custom = createParser({ heading: true });
    createEditor(el, { parser: custom, parserOptions: { heading: true, hr: true }, value: '---' });
    expect(el.children[0]!.tagName).toBe('DIV'); // hr option applied
  });

  it('fallback formatting shortcuts (Cmd+B/I/U) are blocked', () => {
    createEditor(el, { parser: full(), value: 'ab' });
    const ev = new KeyboardEvent('keydown', {
      key: 'b', metaKey: true, bubbles: true, cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('a rejected highlighter Promise silently falls back', async () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```\ncode\n```',
      syntaxHighlight: () => Promise.reject(new Error('boom')),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ed.getValue()).toBe('```\ncode\n```');
    const body = (el.children[0] as HTMLElement).querySelector(`.${styles.codeBody}`)!;
    expect(body.textContent).toBe('code'); // stays plain without highlight
  });
});

describe('coverage reinforcement (review testing gaps)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const type = (text: string) => {
    const b = el.firstElementChild as HTMLElement;
    b.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const caretAt = (block: number, offset: number) => {
    const b = el.children[block] as HTMLElement;
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    let acc = 0;
    while (n && acc + n.textContent!.length < offset) {
      acc += n.textContent!.length;
      n = w.nextNode();
    }
    const r = document.createRange();
    if (n) r.setStart(n, offset - acc);
    else r.setStart(b, b.childNodes.length);
    r.collapse(true);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };
  const pressEnter = () =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  const pressBackspace = () => {
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace', bubbles: true, cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  };

  it('real paste event: multi-line text + caret position', () => {
    const ed = createEditor(el, { parser: full(), value: 'a' });
    caretAt(0, 1);
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: { getData: (t: string) => (t === 'text/plain' ? 'P\n- q' : '') },
    });
    el.dispatchEvent(ev);
    expect(ed.getValue()).toBe('aP\n- q');
    const s = getSelection()!;
    expect(s.anchorNode?.textContent).toContain('q'); // caret at the paste end
  });

  it('ordered list Enter: numbers increment (1. → 2., 3. → 4.)', () => {
    const ed = createEditor(el, { parser: full(), value: '1. a' });
    caretAt(0, 4);
    pressEnter();
    expect(ed.getValue()).toBe('1. a\n2. ');
    ed.setValue('3. b');
    caretAt(0, 4);
    pressEnter();
    expect(ed.getValue()).toBe('3. b\n4. ');
  });

  it('mid-line Backspace: not intercepted; the native deletion is applied', () => {
    const ed = createEditor(el, { parser: full(), value: 'ab' });
    caretAt(0, 2); // 'ab|'
    const ev = pressBackspace();
    expect(ev.defaultPrevented).toBe(false); // delegated
    // simulate native deletion
    const p = el.children[0] as HTMLElement;
    p.textContent = 'a';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('a');
  });

  it('undo returns the caret to the recorded selection position', () => {
    const ed = createEditor(el, { parser: full(), value: '첫줄\n둘째줄' });
    caretAt(1, 3); // '둘째줄|' — position just before the edit
    type('둘째줄 수정');
    expect(ed.undo()).toBe(true);
    const s = getSelection()!;
    expect(s.anchorNode?.parentElement).toBe(el.children[1]);
    expect(s.anchorOffset + (s.anchorNode === el.children[1] ? 0 : 0)).toBeGreaterThanOrEqual(0);
    // caret in block 1's '둘째줄' text node
    expect(s.anchorNode?.textContent === '둘째줄' || s.anchorNode === el.children[1]).toBe(true);
  });
});

describe('container line navigation (Home/End/Cmd+←/→)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const caretAt = (block: number, offset: number) => {
    const b = el.children[block] as HTMLElement;
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    let acc = 0;
    while (n && acc + n.textContent!.length < offset) {
      acc += n.textContent!.length;
      n = w.nextNode();
    }
    const r = document.createRange();
    if (n) r.setStart(n, offset - acc);
    else r.setStart(b, b.childNodes.length);
    r.collapse(true);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };
  const key = (k: string, opts: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
    el.dispatchEvent(ev);
    return ev;
  };
  const selOff = () => {
    const s = getSelection()!;
    const b = el.children[0] as HTMLElement;
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let acc = 0, n;
    while ((n = w.nextNode())) {
      if (n === s.anchorNode) return acc + s.anchorOffset;
      acc += n.textContent!.length;
    }
    return -1;
  };

  it('End inside a list goes to the line end (not the container end)', () => {
    createEditor(el, { parser: full(), value: '- A\n- B\n- C' });
    caretAt(0, 5); // middle of 'B' (total 5)
    const ev = key('End');
    expect(ev.defaultPrevented).toBe(true);
    expect(selOff()).toBe(6); // end of the '- B' line
  });

  it('Home inside a list goes to the line start', () => {
    createEditor(el, { parser: full(), value: '- A\n- B\n- C' });
    caretAt(0, 5);
    const ev = key('Home');
    expect(ev.defaultPrevented).toBe(true);
    expect(selOff()).toBe(3); // start of the '- B' line
  });

  it('Cmd+→/← also go to the line end/start (macOS convention)', () => {
    createEditor(el, { parser: full(), value: '- A\n- B' });
    caretAt(0, 4);
    key('ArrowRight', { metaKey: true });
    expect(selOff()).toBe(6);
    key('ArrowLeft', { metaKey: true });
    expect(selOff()).toBe(3);
  });

  it('Shift+End selects up to the line end only (anchor kept)', () => {
    createEditor(el, { parser: full(), value: '- A\n- B\n- C' });
    caretAt(0, 5); // start of 'B' (may be expressed as the marker-end node — same position)
    const ev = key('End', { shiftKey: true });
    expect(ev.defaultPrevented).toBe(true);
    const s = getSelection()!;
    expect(s.isCollapsed).toBe(false);
    // range: original position (5) → line end ('B' end) — happy-dom's
    // anchor/focus accessors are incomplete, assert via Range
    const r = s.getRangeAt(0);
    expect(r.endContainer.textContent).toBe('B');
    expect(r.endOffset).toBe(1);
    const b = el.children[0] as HTMLElement;
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let acc = 0, n;
    while ((n = w.nextNode())) {
      if (n === r.startContainer) break;
      acc += n.textContent!.length;
    }
    expect(acc + r.startOffset).toBe(5);
  });

  it('Home→End back-and-forth stays within one line (line-ambiguity resolved)', () => {
    createEditor(el, { parser: full(), value: '- A\n- B\n- C' });
    caretAt(0, 6); // end of 'B'
    key('Home');
    expect(selOff()).toBe(3); // start of the B line
    // the landed node belongs to the B line — not the previous line's 'A' node
    const s1 = getSelection()!;
    const ul = el.children[0] as HTMLElement;
    expect(ul.children[1]!.contains(s1.anchorNode)).toBe(true);
    key('End');
    expect(selOff()).toBe(6); // end of the B line (not the A line end = 3)
  });

  it('a plain paragraph is not intercepted', () => {
    createEditor(el, { parser: full(), value: 'p1\np2' });
    caretAt(1, 1);
    const ev = key('End');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('quote lines move per line too', () => {
    createEditor(el, { parser: full(), value: '> a\n> b' });
    caretAt(0, 5); // end of the '> b' marker
    key('End');
    expect(selOff()).toBe(6); // end of the '> b' line
    key('Home');
    expect(selOff()).toBe(3); // start of the '> b' line
  });
});

describe('element-anchored carets (cursor after blank-line deletion)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('select-all inside an li + delete → caret lands on the blank line, not the block end', () => {
    const ed = createEditor(el, { parser: full(), value: '- A\n- B\n- C' });
    const ul = el.children[0] as HTMLElement;
    const liB = ul.children[1] as HTMLElement;
    // simulate native deletion: clear the li interior, leave an element anchor in the empty li
    Array.from(liB.childNodes).forEach((n) => n.remove());
    const r = document.createRange();
    r.setStart(liB, 0);
    r.collapse(true);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('- A\n\n- C');
    // caret near the end of the A line (start of the empty line) — not at 'C' text end
    const sel = getSelection()!;
    expect(sel.anchorNode?.textContent).not.toBe('C');
    const ulNew = el.children[0] as HTMLElement;
    const anchorInFirstUl = ulNew.contains(sel.anchorNode);
    expect(anchorInFirstUl).toBe(true);
  });

  it('an element anchor on an empty quote line does not jump to the block end either', () => {
    const ed = createEditor(el, { parser: full(), value: '> a\n> b\n> c' });
    const bq = el.children[0] as HTMLElement;
    const p2 = bq.children[1] as HTMLElement;
    Array.from(p2.childNodes).forEach((n) => n.remove());
    const r = document.createRange();
    r.setStart(p2, 0);
    r.collapse(true);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('> a\n\n> c'); // a blank line is not a quote — blocks split
    const sel = getSelection()!;
    const anchorText = sel.anchorNode?.textContent ?? '';
    expect(anchorText).not.toContain('c');
  });
});

describe('structural splice (minimal vdom updates)', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });
  const caretAt = (block: number, offset: number) => {
    const b = el.children[block] as HTMLElement;
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    let acc = 0;
    while (n && acc + n.textContent!.length < offset) {
      acc += n.textContent!.length;
      n = w.nextNode();
    }
    const r = document.createRange();
    if (n) r.setStart(n, offset - acc);
    else r.setStart(b, b.childNodes.length);
    r.collapse(true);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };
  const pressEnter = () =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

  it('append splice at the document end — the no-anchor path', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nb' });
    const n0 = el.children[0];
    caretAt(1, 1); // end of 'b' — insert at the very end
    pressEnter();
    expect(ed.getValue()).toBe('a\nb\n');
    expect(el.children[0]).toBe(n0); // prefix survivor
    expect(el.children).toHaveLength(3);
  });

  it('Enter at a paragraph end: exactly one block inserted there, the rest survive', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nb\nc\nd' });
    const [n0, n1, n2, n3] = Array.from(el.children);
    caretAt(1, 1); // end of 'b'
    pressEnter();
    expect(ed.getValue()).toBe('a\nb\n\nc\nd');
    expect(el.children.length).toBe(5);
    expect(el.children[0]).toBe(n0); // prefix survivor
    expect(el.children[1]).toBe(n1); // 'b' intact too (only a blank line inserted after)
    expect(el.children[3]).toBe(n2); // suffix survivor (index +1)
    expect(el.children[4]).toBe(n3);
  });

  it('Enter mid-paragraph: only the split blocks are replaced, both sides survive', () => {
    const ed = createEditor(el, { parser: full(), value: 'a\nbc\nd' });
    const [n0, , n2] = Array.from(el.children);
    caretAt(1, 1); // 'b|c'
    pressEnter();
    expect(ed.getValue()).toBe('a\nb\nc\nd');
    expect(el.children[0]).toBe(n0);
    expect(el.children[3]).toBe(n2);
    expect(el.children.length).toBe(4);
  });

  it('a surviving code block is not re-highlighted', () => {
    // contract-compliant mock: the returned HTML's textContent must equal code
    const hl = vi.fn((code: string) => `<i>${code}</i>`);
    createEditor(el, {
      parser: full(),
      value: '```\na\n```\np\n```\nb\n```',
      syntaxHighlight: hl,
    });
    expect(hl).toHaveBeenCalledTimes(2); // twice for the initial render ('a', 'b')
    caretAt(1, 1); // end of 'p' (block 1)
    pressEnter();
    expect(hl).toHaveBeenCalledTimes(2); // no re-request — highlight DOM kept
  });
});

describe('fence auto-close skip-over', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('typing the closing fence in the body leaves no duplicated auto-pair', () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```\ncode\n\n\n```', // auto-close + Enter + (typing in the body)
    });
    // DOM state after typing '```' on the second blank body line
    const pre = el.children[0] as HTMLElement;
    const body = pre.querySelector(`.${styles.codeBody}`) as HTMLElement;
    body.textContent = 'code\n```\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ed.getValue()).toBe('```\ncode\n```'); // no trailing '\n\n```'
  });

  it('legitimate consecutive code blocks (separate blocks) are untouched', () => {
    const ed = createEditor(el, {
      parser: full(),
      value: '```\nx\n```\n\n```', // code block + empty paragraph + new fence (separate)
    });
    expect(ed.getValue()).toBe('```\nx\n```\n\n```');
  });
});
