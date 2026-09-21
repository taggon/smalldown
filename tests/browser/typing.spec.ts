import { describe, expect, it } from 'vitest';
import { caretAt, caretOffset, focusEditor, keys, mount, selectRange, type } from './helpers';

/** Input flows verifiable only with real keyboard events (§6.4). */
describe('browser: native typing', () => {
  it('list Enter inheritance: - A → Enter → B → Enter → C', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('- A');
    await keys.enter();
    await type('B');
    await keys.enter();
    await type('C');
    expect(editor.getValue()).toBe('- A\n- B\n- C');
  });

  it('ordered list Enter: numbers increment (1. → 2.)', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('1. a');
    await keys.enter();
    expect(editor.getValue()).toBe('1. a\n2. ');
  });

  it('quote inheritance + empty-item Enter escape', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('> a');
    await keys.enter();
    await keys.enter();
    expect(editor.getValue()).toBe('> a\n');
  });

  it('- on a blank line → list switch', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('a');
    await keys.enter();
    await type('- b');
    expect(editor.getValue()).toBe('a\n- b');
  });

  it('Korean typing lands exactly in the value', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('한글 테스트');
    expect(editor.getValue()).toBe('한글 테스트');
  });
});

describe('browser: code fence flow', () => {
  it('type ``` → auto-close → body → type the closing fence → no duplicates', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('```'); // auto-close: ```\n\n```
    expect(editor.getValue()).toBe('```\n\n```');
    await keys.enter();
    await type('code');
    await keys.enter();
    await type('```'); // typing the closing fence in the body — skip-over
    expect(editor.getValue()).toBe('```\ncode\n```');
  });

  it('Enter at the code block end (past the closing fence) escapes', async () => {
    const { host, editor } = mount({ value: '```\nx\n```' });
    focusEditor(host);
    caretAt(host, 0, 9); // end of the whole source (incl. closing fence)
    await keys.enter();
    expect(editor.getValue()).toBe('```\nx\n```\n');
  });

  it('code block Tab: collapsed inserts two spaces, selections indent lines', async () => {
    const { host, editor } = mount({ value: '```\n  a\n  b\n```' });
    focusEditor(host);
    caretAt(host, 0, 7); // end of '  a' (collapsed)
    await keys.tab();
    expect(editor.getValue()).toBe('```\n  a  \n  b\n```');
    // selection across both body lines → indent all, keep selection
    selectRange(host, { block: 0, offset: 4 }, { block: 0, offset: 11 });
    await keys.tab();
    expect(editor.getValue()).toBe('```\n    a  \n    b\n```');
    expect(getSelection()!.isCollapsed).toBe(false);
  });

  it('Enter on an indented code line → auto-indent', async () => {
    const { host, editor } = mount({ value: '```\n  a\n```' });
    focusEditor(host);
    caretAt(host, 0, 7); // end of '  a'
    await keys.enter();
    expect(editor.getValue()).toBe('```\n  a\n  \n```');
    // caret sits after the inherited indent — typing continues indented
    await type('b');
    expect(editor.getValue()).toBe('```\n  a\n  b\n```');
  });

  it('unclosed fence round-trip: no closing fence invented in the value', async () => {
    const { host, editor } = mount({ value: '```\ncode' });
    expect(editor.getValue()).toBe('```\ncode');
    focusEditor(host);
    caretAt(host, 0, 8);
    await type('!');
    expect(editor.getValue()).toBe('```\ncode!');
  });
});

describe('browser: undo', () => {
  it('undo restores the pre-edit caret position (typing mid-character)', async () => {
    const { host, editor } = mount({ value: 'abcd' });
    focusEditor(host);
    caretAt(host, 0, 2); // ab|cd
    await keys.char('X');
    expect(editor.getValue()).toBe('abXcd');
    await keys.undo();
    expect(editor.getValue()).toBe('abcd');
    expect(await caretOffset(host)).toBe(2); // pre-edit caret, not 3
  });

  it('undo after a Tab insert — back to where Tab was pressed', async () => {
    const { host, editor } = mount({ value: '```\nab\n```' });
    focusEditor(host);
    caretAt(host, 0, 6); // after 'ab' in the body
    await keys.tab();
    expect(editor.getValue()).toBe('```\nab  \n```');
    await keys.undo();
    expect(editor.getValue()).toBe('```\nab\n```');
    expect(await caretOffset(host)).toBe(6);
  });

  it('a typing burst reverts with one Cmd+Z', async () => {
    const { host, editor } = mount();
    focusEditor(host);
    await type('hello');
    await keys.undo();
    expect(editor.getValue()).toBe('');
  });

  it('select-all + Enter → empty document, Cmd+Z restores', async () => {
    const { host, editor } = mount({ value: 'a\nb\nc' });
    focusEditor(host);
    await keys.selectAll();
    await keys.enter();
    expect(editor.getValue()).toBe('');
    await keys.undo();
    expect(editor.getValue()).toBe('a\nb\nc');
  });
});
