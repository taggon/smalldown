import { describe, expect, it } from 'vitest';
import { caretAt, caretOffset, focusEditor, keys, mount } from './helpers';

/** Line navigation remaps — how the browser's Home/End line concept
 *  interacts with our line model can only be verified in a real
 *  browser. */
describe('browser: line navigation in containers (Home/End)', () => {
  it('End goes to the line end, not the list end', async () => {
    const { host } = mount({ value: '- A\n- B\n- C' });
    focusEditor(host);
    caretAt(host, 0, 5); // middle of the 'B' text
    await keys.end();
    expect(await caretOffset(host)).toBe(6); // '- B' line end (not the list end 9)
  });

  it('Home goes to the line start', async () => {
    const { host } = mount({ value: '- A\n- B\n- C' });
    focusEditor(host);
    caretAt(host, 0, 5);
    await keys.home();
    expect(await caretOffset(host)).toBe(3);
  });

  it('Shift+End selects up to the line end only', async () => {
    const { host } = mount({ value: '- A\n- B\n- C' });
    focusEditor(host);
    caretAt(host, 0, 5); // boundary at the end of B's marker
    await keys.home(); // to the start of the B line
    await keys.shiftEnd(); // select the whole line
    const s = getSelection()!;
    expect(s.toString()).toBe('- B');
  });

  it('Cmd+→/← also move per line', async () => {
    const { host } = mount({ value: '- A\n- B' });
    focusEditor(host);
    caretAt(host, 0, 4);
    await keys.cmdRight();
    expect(await caretOffset(host)).toBe(6);
    await keys.cmdLeft();
    expect(await caretOffset(host)).toBe(3);
  });

  it('paragraphs are not intercepted (default behavior kept)', async () => {
    const { host } = mount({ value: 'p1\np2' });
    focusEditor(host);
    caretAt(host, 1, 0);
    const ev = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    host.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('quote lines move per line too', async () => {
    const { host } = mount({ value: '> a\n> b' });
    focusEditor(host);
    caretAt(host, 0, 5);
    await keys.end();
    expect(await caretOffset(host)).toBe(6); // '> b' line end
    await keys.home();
    expect(await caretOffset(host)).toBe(3); // '> b' line start
  });
});
