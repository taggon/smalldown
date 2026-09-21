import { describe, expect, it } from 'vitest';
import {
  EMPTY_PARAGRAPH,
  normalize,
  blockTag,
  isContainerTag,
  isListTag,
  readSource,
  prefixOf,
  nextPrefix,
  absOf,
  locateAbs,
  srcOffOf,
  domOffOf,
} from '../src/editor/sourceSpace';
import { createCaret } from '../src/editor/caret';

describe('sourceSpace', () => {
  it('normalize: an empty parse result becomes one empty paragraph', () => {
    const nb = normalize([]);
    expect(nb).toHaveLength(1);
    expect(nb[0]).toEqual(EMPTY_PARAGRAPH());
    expect(nb[0]!.type).toBe('paragraph');
    expect(normalize([{ type: 'hr', source: '---' }])).toHaveLength(1); // non-empty passes through
  });

  it('blockTag: every block type + level clamp', () => {
    expect(blockTag({ type: 'paragraph', source: '', children: [] })).toBe('P');
    expect(blockTag({ type: 'heading', source: '#', level: 2, children: [] })).toBe('H2');
    expect(blockTag({ type: 'heading', source: '#', level: 0, children: [] })).toBe('H1');
    expect(blockTag({ type: 'heading', source: '#', level: 9, children: [] })).toBe('H6');
    expect(blockTag({ type: 'blockquote', source: '>', lines: [], children: [] })).toBe('BLOCKQUOTE');
    expect(blockTag({ type: 'list', source: '-', ordered: true, items: [], children: [] })).toBe('OL');
    expect(blockTag({ type: 'list', source: '-', ordered: false, items: [], children: [] })).toBe('UL');
    expect(blockTag({ type: 'codeBlock', source: '```', lang: '', text: '', closed: true, bodyLines: 0 })).toBe('PRE');
    expect(blockTag({ type: 'hr', source: '---' })).toBe('DIV');
  });

  it('isContainerTag / isListTag', () => {
    for (const t of ['UL', 'OL', 'BLOCKQUOTE']) expect(isContainerTag(t)).toBe(true);
    expect(isContainerTag('P')).toBe(false);
    for (const t of ['UL', 'OL']) expect(isListTag(t)).toBe(true);
    expect(isListTag('BLOCKQUOTE')).toBe(false);
    expect(isListTag('PRE')).toBe(false);
  });

  it('readSource: containers join childNodes lines, others take textContent', () => {
    const ul = document.createElement('ul');
    const li1 = document.createElement('li'); li1.textContent = '- a';
    const stray = document.createTextNode('- b'); // browser-inserted text node
    ul.append(li1, stray);
    expect(readSource(ul)).toBe('- a\n- b');
    const p = document.createElement('p'); p.textContent = 'x';
    expect(readSource(p)).toBe('x');
  });

  it('prefixOf: quote, list and none branches', () => {
    expect(prefixOf('> a')).toBe('> ');
    expect(prefixOf('>a')).toBe('>');
    expect(prefixOf('- a')).toBe('- ');
    expect(prefixOf('* a')).toBe('* ');
    expect(prefixOf('  1. a')).toBe('  1. ');
    expect(prefixOf('plain')).toBe('');
    expect(prefixOf('')).toBe('');
  });

  it('nextPrefix: ordered increments, others unchanged', () => {
    expect(nextPrefix('1. ')).toBe('2. ');
    expect(nextPrefix('  9. ')).toBe('  10. ');
    expect(nextPrefix('- ')).toBe('- ');
    expect(nextPrefix('> ')).toBe('> ');
  });

  it('absOf / locateAbs: source-space mapping + bounds, out-of-range, empty', () => {
    const sources = ['a', 'bc', ''];
    expect(absOf(sources, 1, 1)).toBe(3); // 1 + 'a' + separator
    expect(absOf(sources, 2, 2)).toBe(7); // 2 + 'a'\n + 'bc'\n
    expect(locateAbs(sources, 1)).toEqual({ block: 0, offset: 1 }); // end of 'a'
    expect(locateAbs(sources, 2)).toEqual({ block: 1, offset: 0 }); // same point, next block
    expect(locateAbs(sources, 4)).toEqual({ block: 1, offset: 2 });
    expect(locateAbs(sources, 99)).toEqual({ block: 2, offset: 0 }); // beyond end → last block
    expect(locateAbs([], 0)).toEqual({ block: 0, offset: 0 }); // empty sources
    // holes in the array are tolerated
    expect(absOf(['a', undefined as unknown as string, 'b'], 2, 0)).toBe(3);
  });

  it('srcOffOf / domOffOf: PRE identity, container newline-skip round-trip', () => {
    expect(srcOffOf('a\nb', 2, true)).toBe(2);
    expect(domOffOf('a\nb', 2, true)).toBe(2);
    const src = '- a\n- b';
    expect(domOffOf(src, 7, false)).toBe(6); // source end → DOM end (one separator dropped)
    expect(srcOffOf(src, 6, false)).toBe(7); // inverse
    // round-trip over every DOM-seated offset
    for (let s = 0; s <= src.length; s++) {
      if (src[s - 1] === '\n') continue; // positions inside separators have no DOM seat
      expect(srcOffOf(src, domOffOf(src, s, false), false)).toBe(s);
    }
  });

  it('textOffsetTo returns 0 for nodes outside the tree', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const caret = createCaret({ el: host, doc: document });
    const detached = document.createTextNode('x');
    expect(caret.textOffsetTo(host, detached, 0)).toBe(0);
  });
});
