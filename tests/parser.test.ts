import { describe, expect, it } from 'vitest';
import { createParser, DEFAULT_PARSER_OPTIONS } from '../src/createParser';

describe('createParser options', () => {
  it('defaults are the comment-box set', () => {
    expect(DEFAULT_PARSER_OPTIONS.code).toBe(true);
    expect(DEFAULT_PARSER_OPTIONS.link).toBe(true);
    expect(DEFAULT_PARSER_OPTIONS.list).toBe(true);
    expect(DEFAULT_PARSER_OPTIONS.blockquote).toBe(true);
    expect(DEFAULT_PARSER_OPTIONS.heading).toBe(false);
    expect(DEFAULT_PARSER_OPTIONS.image).toBe(false);
    expect(DEFAULT_PARSER_OPTIONS.strikethrough).toBe(false);
  });

  it('disabled rules stay as plain text', () => {
    const p = createParser({}); // heading off
    const doc = p.parse('# Title');
    expect(doc.children[0]?.type).toBe('paragraph');
    const p2 = createParser({ heading: true });
    expect(p2.parse('# Title').children[0]?.type).toBe('heading');
  });

  it('option combination: strikethrough on, image off', () => {
    const p = createParser({ strikethrough: true, image: false });
    expect(p.parseInline('~~x~~')[0]).toMatchObject({ type: 'del' });
    const doc2 = p.parse('![alt](https://x.com/i.png)');
    expect(doc2.children[0]?.type).toBe('paragraph');
    const kids = (doc2.children[0] as { children: { type: string; text?: string }[] }).children;
    // image off, link on: parsed as '!' + [alt](url) link
    expect(kids[0]).toMatchObject({ type: 'text', text: '!' });
    expect(kids[1]).toMatchObject({ type: 'link', url: 'https://x.com/i.png' });
  });
});

describe('block parsing', () => {
  const p = createParser({
    heading: true,
    codeBlock: true,
    hr: true,
    strikethrough: true,
    image: true,
    autolink: true,
  });

  it('heading: level and body', () => {
    const doc = p.parse('### Hello **world**');
    const h = doc.children[0];
    expect(h?.type).toBe('heading');
    if (h?.type === 'heading') {
      expect(h.level).toBe(3);
      expect(h.children[1]).toMatchObject({ type: 'strong' });
      expect(h.source).toBe('### Hello **world**');
    }
  });

  it('blockquote: consecutive lines group', () => {
    const doc = p.parse('> a\n> b\n\ntext');
    expect(doc.children.map((b) => b.type)).toEqual(['blockquote', 'paragraph', 'paragraph']);
    const q = doc.children[0];
    if (q?.type === 'blockquote') {
      expect(q.lines).toEqual(['a', 'b']);
      expect(q.source).toBe('> a\n> b');
    }
    // blank lines survive as empty paragraphs
    expect(doc.children[1]).toMatchObject({ type: 'paragraph', source: '' });
  });

  it('list: unordered / ordered, no mixing', () => {
    const doc = p.parse('- a\n- b');
    const l = doc.children[0];
    if (l?.type === 'list') {
      expect(l.ordered).toBe(false);
      expect(l.items.map((i) => i.text)).toEqual(['a', 'b']);
      expect(l.items.map((i) => i.marker)).toEqual(['-', '-']);
    }
    const doc2 = p.parse('1. a\n2. b');
    const l2 = doc2.children[0];
    if (l2?.type === 'list') {
      expect(l2.ordered).toBe(true);
      expect(l2.items.map((i) => i.text)).toEqual(['a', 'b']);
      expect(l2.items[1]).toMatchObject({ marker: '2.', indent: '' });
    }
    expect(p.parse('- a\n1. b').children).toHaveLength(2); // mixed markers: separate blocks
  });

  it('list: two leading spaces = one nesting level; marker/indent preserved in source', () => {
    const doc = p.parse('- a\n  - b\n    - c\n- d');
    const l = doc.children[0];
    expect(l?.type).toBe('list');
    if (l?.type === 'list') {
      expect(l.items.map((i) => i.indent)).toEqual(['', '  ', '    ', '']);
      expect(l.items.map((i) => i.text)).toEqual(['a', 'b', 'c', 'd']);
      expect(l.source).toBe('- a\n  - b\n    - c\n- d'); // round-trip
    }
    const ol = p.parse('1. a\n  2. b');
    const lo = ol.children[0];
    if (lo?.type === 'list') {
      expect(lo.ordered).toBe(true);
      expect(lo.items[1]).toMatchObject({ indent: '  ', marker: '2.', text: 'b' });
    }
    // marker numbers stay raw (never regenerated)
    expect(p.parse('3. x').children[0]).toMatchObject({
      type: 'list',
      items: [{ indent: '', marker: '3.', text: 'x' }],
    });
  });

  it('codeBlock: without a closing fence, runs to the end', () => {
    const doc = p.parse('```js\nconst a = 1;\nconsole.log(a);');
    const cb = doc.children[0];
    if (cb?.type === 'codeBlock') {
      expect(cb.lang).toBe('js');
      expect(cb.text).toBe('const a = 1;\nconsole.log(a);');
    }
  });

  it('hr: --- / ***', () => {
    expect(p.parse('---').children[0]?.type).toBe('hr');
    expect(p.parse('***').children[0]?.type).toBe('hr');
    // '- x' is not an hr
    expect(p.parse('- x').children[0]?.type).toBe('list');
  });

  it('blank lines: a run stays as that many empty paragraphs', () => {
    const doc = p.parse('\n\na\n\n\n\nb\n\n');
    expect(doc.children.map((b) => b.source)).toEqual([
      '', '', 'a', '', '', '', 'b', '', '',
    ]);
  });

  it('each block source round-trips exactly (empty paragraphs included)', () => {
    const src = '## T\n\ntext **b**\n\n> q\n\n- i1\n  - i2\n\n```js\nx\n```\n\n---';
    const doc = p.parse(src);
    expect(doc.children.map((b) => b.source).join('\n')).toBe(src);
  });
});

describe('inline parsing', () => {
  const p = createParser({ strikethrough: true, image: true, autolink: true });

  it('bold/em nesting', () => {
    const nodes = p.parseInline('**a *b* c**');
    expect(nodes[0]).toMatchObject({ type: 'strong' });
    const inner = (nodes[0] as { children: unknown[] }).children;
    expect(inner[0]).toMatchObject({ type: 'text', text: 'a ' });
    expect(inner[1]).toMatchObject({ type: 'em' });
  });

  it('***bold italic***: the three emphasis forms are always on', () => {
    const off = createParser({}); // no options
    const nodes = off.parseInline('***bi*** **b** *i*');
    expect(nodes[0]).toMatchObject({ type: 'strongEm', marker: '***' });
    expect((nodes[0] as { children: unknown[] }).children[0]).toMatchObject({
      type: 'text',
      text: 'bi',
    });
    expect(nodes[2]).toMatchObject({ type: 'strong', marker: '**' });
    expect(nodes[4]).toMatchObject({ type: 'em', marker: '*' });
    // italic nested inside
    const nested = off.parseInline('***a *b* c***');
    const kids = (nested[0] as { children: unknown[] }).children;
    expect(kids[1]).toMatchObject({ type: 'em' });
    // empty markers are not emphasis
    expect(off.parseInline('******')[0]).toMatchObject({ type: 'text', text: '******' });
  });

  it('inline code ignores emphasis rules', () => {
    const nodes = p.parseInline('`**not bold**`');
    expect(nodes[0]).toMatchObject({ type: 'code', text: '**not bold**' });
  });

  it('link: with title', () => {
    const nodes = p.parseInline('[t](https://x.com "T")');
    expect(nodes[0]).toMatchObject({
      type: 'link',
      url: 'https://x.com',
      title: 'T',
    });
  });

  it('image', () => {
    const nodes = p.parseInline('![alt](https://x.com/i.png)');
    expect(nodes[0]).toMatchObject({ type: 'image', alt: 'alt', url: 'https://x.com/i.png' });
  });

  it('strikethrough, autolink', () => {
    expect(p.parseInline('~~gone~~')[0]).toMatchObject({ type: 'del' });
    expect(p.parseInline('<https://x.com>')[0]).toMatchObject({
      type: 'autolink',
      url: 'https://x.com',
    });
  });

  it('parser with every line rule off — paragraphs only; autolink still works as an inline rule', () => {
    const off = createParser({ list: false, blockquote: false, autolink: true });
    const doc = off.parse('- a\n> b\n# c\n---\n<https://x.y>');
    expect(doc.children.every((b) => b.type === 'paragraph')).toBe(true);
    expect(off.parseInline('<https://x.y>')[0]!.type).toBe('autolink');
  });

  it('disabled rules stay as text (strikethrough off)', () => {
    const off = createParser({ strikethrough: false });
    expect(off.parseInline('~~gone~~')[0]).toMatchObject({
      type: 'text',
      text: '~~gone~~',
    });
  });
});
