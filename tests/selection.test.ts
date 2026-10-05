import { describe, expect, it } from 'vitest';
import { activeSelection } from '../src/editor/selection';

/**
 * Selection resolution per tree — happy-dom's ShadowRoot has no
 * getSelection, so mounting inside a shadow root here exercises the
 * engine-without-shadow-selection fallback; the shadow-aware path is
 * covered on real Chromium (browser/shadow-dom.spec.ts).
 */
describe('activeSelection', () => {
  it('light DOM resolves to the document selection', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(activeSelection(el, document)).toBe(document.getSelection());
  });

  it('shadow tree falls back to the document selection when the engine has no ShadowRoot.getSelection', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const el = document.createElement('div');
    shadow.appendChild(el);
    expect(activeSelection(el, document)).toBe(document.getSelection());
  });

  it('shadow tree with an engine-provided getSelection returns that selection', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const el = document.createElement('div');
    shadow.appendChild(el);
    const fake = {} as Selection;
    (shadow as unknown as { getSelection: () => Selection | null }).getSelection =
      () => fake;
    expect(activeSelection(el, document)).toBe(fake);
  });

  it('returns null for a document without getSelection (odd embedders)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bare = { getSelection: undefined } as unknown as Document;
    expect(activeSelection(el, bare)).toBeNull();
  });
});
