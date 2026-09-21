import { describe, expect, it } from 'vitest';
import { caretAt, caretInBlock, caretOffset, focusEditor, keys, mount, selectTo, selectRange } from './helpers';

/** Native deletion semantics — element-anchor carets and selection
 *  deletion outcomes only reproduce in a real browser (happy-dom
 *  doesn't do native editing). */
describe('browser: selection deletion and caret', () => {
  it('whole-line selection (B start → C start) + BS → value and caret at the deletion point', async () => {
    const { host, editor } = mount({ value: '- A\n- B\n- C' });
    focusEditor(host);
    caretAt(host, 0, 3);
    selectTo(host, 0, 6);
    await keys.backspace();
    expect(editor.getValue()).toBe('- A\n- C');
    // caret near where B was — not at the block end (past '- C' = total 6)
    const off = await caretOffset(host);
    expect(off).not.toBe(6);
    expect(caretInBlock(host, 0)).toBe(true);
  });

  it('selection inside an li (excluding boundaries) + BS → caret does not jump to the block end', async () => {
    const { host, editor } = mount({ value: '- A\n- B\n- C' });
    focusEditor(host);
    // from B's marker start to B's text end (all inside the li, boundaries excluded)
    caretAt(host, 0, 3);
    selectTo(host, 0, 6);
    await keys.backspace();
    // value: the B line stays blank or merges (native result); the caret stays nearby
    const off = await caretOffset(host);
    expect(off).not.toBe(9); // not the whole-text end ('- A\n\n- C' = 9)
  });

  it('reversed selection (C start ← B start) + BS → deletes normally', async () => {
    const { host, editor } = mount({ value: '- A\n- B\n- C' });
    focusEditor(host);
    selectRange(host, { block: 0, offset: 6 }, { block: 0, offset: 3 }); // anchor on the C side
    await keys.backspace();
    expect(editor.getValue()).toBe('- A\n- C');
  });

  it('mid-paragraph character deletion (native delegation) is reflected', async () => {
    const { host, editor } = mount({ value: 'abc' });
    focusEditor(host);
    caretAt(host, 0, 2);
    await keys.backspace();
    expect(editor.getValue()).toBe('ac');
  });

  it('quote prefix BS×2 (session bug scenario)', async () => {
    const { host, editor } = mount({ value: '> A- B\n- C' });
    focusEditor(host);
    caretAt(host, 0, 3); // after '> A'
    await keys.enter();
    expect(editor.getValue()).toBe('> A\n> - B\n- C');
    await keys.backspace();
    await keys.backspace();
    // '- B' is visible on screen (value↔DOM agreement)
    const dom = host.children[1] as HTMLElement;
    expect(dom.textContent).toContain('- B');
  });
});
