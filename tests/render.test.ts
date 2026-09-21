import { describe, expect, it } from 'vitest';
import { createParser } from '../src/createParser';
import { renderBlock, renderInline, safeUrl } from '../src/render';
import { createElement } from '../src/vdom';
import { styles } from '../src/editor/styles';
import type { BlockNode } from '../src/ast';

const full = () =>
  createParser({
    heading: true,
    codeBlock: true,
    hr: true,
    strikethrough: true,
    image: true,
    autolink: true,
  });

const html = (b: BlockNode): string => (createElement(renderBlock(b)) as HTMLElement).outerHTML;
const inlineHtml = (nodes: ReturnType<ReturnType<typeof createParser>['parseInline']>): string =>
  (createElement({ type: 'span', props: null, children: renderInline(nodes) }) as HTMLElement).innerHTML;

describe('render', () => {
  it('symbols wrap in an sd-symbol span (spec example)', () => {
    const p = full();
    const doc = p.parse('**Bold**');
    expect(html(doc.children[0]!)).toBe(
      `<p class="${styles.block}"><strong><span class="${styles.symbol}">**</span>Bold<span class="${styles.symbol}">**</span></strong></p>`,
    );
  });

  it('text is escaped (no HTML injection)', () => {
    const p = full();
    const el = createElement(renderBlock(p.parse('<script>alert(1)</script>').children[0]!)) as HTMLElement;
    expect(el.textContent).toBe('<script>alert(1)</script>');
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('unsafe URLs are not linked', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://x.com')).toBe('https://x.com');
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    const p = full();
    const nodes = p.parseInline('[x](javascript:alert(1))');
    const el = createElement({ type: 'span', props: null, children: renderInline(nodes) }) as HTMLElement;
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('[x](javascript:alert(1))');
  });

  it('quote prefixes come from the source as-is — a bare > round-trips too', () => {
    const p = full();
    const el = createElement(renderBlock(p.parse('>x\n> y').children[0]!)) as HTMLElement;
    const ps = Array.from(el.querySelectorAll('p')) as HTMLElement[];
    expect(ps[0]!.textContent).toBe('>x');
    expect(ps[1]!.textContent).toBe('> y');
    expect(el.textContent).toBe('>x> y');
  });

  it('heading/list/blockquote/codeBlock symbols', () => {
    const p = full();
    expect(html(p.parse('## T').children[0]!)).toContain(`<span class="${styles.symbol}">## </span>`);
    expect(html(p.parse('- i').children[0]!)).toContain(`<span class="${styles.symbol}">- </span>`);
    expect(html(p.parse('> q').children[0]!)).toContain(`<span class="${styles.symbol}">&gt; </span>`);
    const pre = html(p.parse('```\nx').children[0]!);
    expect(pre).toContain(styles.symbol);
    expect(pre).toContain('<pre');
  });

  it('nested list: indent spaces stay in the li text; textContent equals the source line', () => {
    const p = full();
    const el = createElement(renderBlock(p.parse('- a\n  - b').children[0]!)) as HTMLElement;
    expect(el.tagName).toBe('UL');
    expect(el.children).toHaveLength(2); // flat structure — nesting is indent text
    const li2 = el.children[1] as HTMLElement;
    expect(li2.textContent).toBe('  - b');
    expect(li2.firstChild!.nodeType).toBe(3); // indent is a plain text node
    expect(el.textContent).toBe('- a  - b'); // li texts concatenate (no separator)
  });

  it('image renders img + source symbol', () => {
    const p = full();
    const el = createElement({ type: 'span', props: null, children: renderInline(p.parseInline('![a](https://x/i.png)')) }) as HTMLElement;
    const img = el.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://x/i.png');
    expect(el.textContent).toBe('![a](https://x/i.png)');
  });

  it('inline round-trip: rendered text equals the source', () => {
    const p = full();
    const src = 'a **b** *c* ***d*** `e` [f](https://x) ~~g~~ <https://y>';
    const el = createElement({ type: 'span', props: null, children: renderInline(p.parseInline(src)) }) as HTMLElement;
    expect(el.textContent).toBe(src);
  });

  it('***bold italic***: renders strong>em with a single *** symbol', () => {
    const p = full();
    const el = createElement({ type: 'span', props: null, children: renderInline(p.parseInline('***bi***')) }) as HTMLElement;
    expect(el.querySelector('strong em')).toBeTruthy();
    expect(el.querySelector(`.${styles.symbol}`)?.textContent).toBe('***');
    expect(el.textContent).toBe('***bi***');
  });

  it('link URL splits into an sd-url span and wraps anywhere', () => {
    const p = full();
    const nodes = p.parseInline('[e](https://example.com/very/long/path "T")');
    const el = createElement({ type: 'span', props: null, children: renderInline(nodes) }) as HTMLElement;
    const url = el.querySelector(`.${styles.url}`) as HTMLElement;
    expect(url.textContent).toBe('https://example.com/very/long/path');
    // round-trip: source as-is, no extra spans
    expect(el.textContent).toBe('[e](https://example.com/very/long/path "T")');
    const auto = createElement({ type: 'span', props: null, children: renderInline(p.parseInline('<https://x.y/long>')) }) as HTMLElement;
    expect(auto.querySelector(`.${styles.url}`)?.textContent).toBe('https://x.y/long');
    expect(auto.textContent).toBe('<https://x.y/long>');
  });

  it('safeUrl: allowed schemes, relative paths, rejections', () => {
    expect(safeUrl('https://x.y')).toBe('https://x.y');
    expect(safeUrl('http://x.y')).toBe('http://x.y');
    expect(safeUrl('HTTPS://X.Y')).toBe('HTTPS://X.Y');
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeUrl(' /rel')).toBe('/rel');
    expect(safeUrl('#a')).toBe('#a');
    expect(safeUrl('./x')).toBe('./x');
    expect(safeUrl('javascript:x')).toBeNull();
    expect(safeUrl('data:x')).toBeNull();
    expect(safeUrl('')).toBeNull();
  });

  it('render branches: bare > quote fallback, indent, unlinkable scheme link/image/autolink, hr/heading fallback, unclosed fence', () => {
    const p = full();
    // bare '>' quote: prefix fallback draws '>'
    const bq = createElement(renderBlock(p.parse('>q').children[0]!)) as HTMLElement;
    expect(bq.firstElementChild!.firstChild!.textContent).toBe('>');
    // ordered item with indent keeps indent text
    const ol = createElement(renderBlock(p.parse('  1. x').children[0]!)) as HTMLElement;
    expect(ol.tagName).toBe('OL');
    expect(ol.firstElementChild!.firstChild!.nodeType).toBe(3);
    // unsafe link → span, not <a>
    const badLink = createElement({ type: 'span', props: null, children: renderInline(p.parseInline('[a](javascript:x)')) }) as HTMLElement;
    expect(badLink.querySelector('a')).toBeNull();
    // valid autolink → <a>
    const auto = createElement({
      type: 'span',
      props: null,
      children: renderInline([{ type: 'autolink', marker: '<', url: 'https://x.y' }]),
    }) as HTMLElement;
    expect(auto.querySelector('a')?.getAttribute('href')).toBe('https://x.y');
    // valid image → <img> present
    const img = createElement({
      type: 'span',
      props: null,
      children: renderInline([{ type: 'image', marker: '![', alt: 'A', url: 'https://x.y/i.png' }]),
    }) as HTMLElement;
    const imgEl = img.querySelector('img')!;
    expect(imgEl.getAttribute('src')).toBe('https://x.y/i.png');
    expect(imgEl.getAttribute('contenteditable')).toBe('false'); // atomic widget
    expect(imgEl.getAttribute('draggable')).toBe('false');
    // link with title renders the quoted title symbol
    const titled = createElement({ type: 'span', props: null, children: renderInline(p.parseInline('[a](https://x.y "T")')) }) as HTMLElement;
    expect(titled.textContent).toBe('[a](https://x.y "T")');
    // unsafe autolink (regex only allows http(s), so hand-make the node)
    const badAuto = createElement({
      type: 'span',
      props: null,
      children: renderInline([{ type: 'autolink', marker: '<', url: 'javascript:x' }]),
    }) as HTMLElement;
    expect(badAuto.querySelector('a')).toBeNull();
    expect(badAuto.textContent).toBe('<javascript:x>');
    // unsafe image → no <img>, raw source span stays
    const badImg = createElement({ type: 'span', props: null, children: renderInline(p.parseInline('![a](javascript:x)')) }) as HTMLElement;
    expect(badImg.querySelector('img')).toBeNull();
    expect(badImg.textContent).toBe('![a](javascript:x)');
    // hr fallback when source empty
    const hr = createElement(renderBlock({ type: 'hr', source: '' })) as HTMLElement;
    expect(hr.textContent).toBe('---');
    // heading level clamps (0 → h1, 9 → h6)
    expect((createElement(renderBlock({ type: 'heading', source: '#', level: 0, children: [] })) as HTMLElement).tagName).toBe('H1');
    expect((createElement(renderBlock({ type: 'heading', source: '#', level: 9, children: [] })) as HTMLElement).tagName).toBe('H6');
    // unclosed fence with empty body: open only, no closer
    const open = createElement(renderBlock({ type: 'codeBlock', source: '```', lang: '', text: '', closed: false, bodyLines: 0 })) as HTMLElement;
    expect(open.textContent).toBe('```');
    // closed fence with empty body: closer without a leading newline
    const closed0 = createElement(renderBlock({ type: 'codeBlock', source: '```\n```', lang: '', text: '', closed: true, bodyLines: 0 })) as HTMLElement;
    expect(closed0.textContent).toBe('```\n```');
  });

  it('classes: every key applies to its target', () => {
    const p = full();
    const extra = {
      paragraph: ['c-para'],
      heading: ['c-head'],
      blockquote: ['c-quote'],
      list: ['c-list'],
      codeBlock: ['c-code'],
      hr: ['c-hr'],
      link: ['c-link'],
      image: ['c-img'],
    };
    expect((createElement(renderBlock(p.parse('p').children[0]!, extra)) as HTMLElement).classList.contains('c-para')).toBe(true);
    expect((createElement(renderBlock(p.parse('# h').children[0]!, extra)) as HTMLElement).classList.contains('c-head')).toBe(true);
    expect((createElement(renderBlock(p.parse('> q').children[0]!, extra)) as HTMLElement).classList.contains('c-quote')).toBe(true);
    expect((createElement(renderBlock(p.parse('```\nx\n```').children[0]!, extra)) as HTMLElement).classList.contains('c-code')).toBe(true);
    expect((createElement(renderBlock(p.parse('- a').children[0]!, extra)) as HTMLElement).classList.contains('c-list')).toBe(true);
    expect((createElement(renderBlock(p.parse('---').children[0]!, extra)) as HTMLElement).classList.contains('c-hr')).toBe(true);
    const inline = createElement({
      type: 'span',
      props: null,
      children: renderInline(p.parseInline('[a](https://x.y) ![i](https://x.y/i.png)'), extra),
    }) as HTMLElement;
    expect(inline.querySelector('a')!.classList.contains('c-link')).toBe(true);
    expect(inline.querySelector(`.${styles.image}`)!.classList.contains('c-img')).toBe(true);
  });

  it('classes: empty arrays append nothing', () => {
    const p = full();
    const pre = createElement(renderBlock(p.parse('```\nx\n```').children[0]!, { codeBlock: [] })) as HTMLElement;
    expect(pre.className).toBe(`${styles.block} ${styles.code}`);
  });

  it('classes option — built-ins kept, extras merged', () => {
    const p = full();
    const extra = {
      blockquote: ['my-quote'],
      codeBlock: ['my-code'],
      link: ['my-link'],
    };
    const bq = createElement(renderBlock(p.parse('> q').children[0]!, extra)) as HTMLElement;
    expect(bq.className).toBe(`${styles.block} ${styles.quote} my-quote`);
    const pre = createElement(renderBlock(p.parse('```\nx\n```').children[0]!, extra)) as HTMLElement;
    expect(pre.className).toBe(`${styles.block} ${styles.code} my-code`);
    const link = createElement({
      type: 'span',
      props: null,
      children: renderInline(p.parseInline('[a](https://x.y)'), extra),
    }) as HTMLElement;
    const a = link.querySelector('a')!;
    expect(a.className).toBe('my-link');
    // no extras → identical to before
    const plain = createElement(renderBlock(p.parse('> q').children[0]!)) as HTMLElement;
    expect(plain.className).toBe(`${styles.block} ${styles.quote}`);
    const noExtra = createElement({
      type: 'span',
      props: null,
      children: renderInline(p.parseInline('[a](https://x.y)')),
    }) as HTMLElement;
    expect(noExtra.querySelector('a')!.className).toBe('');
  });
});
