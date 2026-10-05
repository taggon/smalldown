/**
 * smalldown renderer — spec §5
 * AST → VNode. Markdown markers are kept as sd-symbol spans, so a
 * block's textContent equals its markdown source (round-trip guarantee).
 */
import type { BlockNode, InlineNode } from './ast';
import { styles } from './editor/styles';
import { h, type VNode, type VNodeChild } from './vdom';

// Bound per render pass so every symbol span (markers, fences, list
// prefixes) picks up extra classes without threading them call-by-call.
const symOf =
  (extra?: RenderClasses) =>
  (t: string): VNode =>
    h('span', { class: withExtras(styles.symbol, extra?.symbol) }, t);

/**
 * Additive classes per render target, from EditorOptions.classes —
 * appended to the built-in styles, never replacing them.
 */
export interface RenderClasses {
  paragraph?: string[];
  heading?: string[];
  blockquote?: string[];
  list?: string[];
  codeBlock?: string[];
  hr?: string[];
  link?: string[];
  image?: string[];
  /** Syntax marker spans (`**`, `#`, fences) — the dimmed symbols. */
  symbol?: string[];
}

const withExtras = (base: string, extra?: string[]): string =>
  extra?.length ? `${base} ${extra.join(' ')}` : base;

/** Only safe URL schemes pass (spec §5). */
export function safeUrl(url: string): string | null {
  const t = url.trim();
  if (/^(https?:|mailto:)/i.test(t)) return t;
  if (/^[/#.]/.test(t)) return t; // relative path
  return null;
}

export function renderInline(
  nodes: InlineNode[],
  extra?: RenderClasses,
): VNodeChild[] {
  const sym = symOf(extra);
  return nodes.map((n): VNodeChild => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'strong':
        return h(
          'strong',
          null,
          sym(n.marker),
          ...renderInline(n.children, extra),
          sym(n.marker),
        );
      case 'em':
        return h('em', null, sym(n.marker), ...renderInline(n.children, extra), sym(n.marker));
      case 'strongEm':
        // strong>em nesting, single *** marker pair (round-trip).
        return h(
          'strong',
          null,
          h('em', null, sym(n.marker), ...renderInline(n.children, extra), sym(n.marker)),
        );
      case 'del':
        return h('del', null, sym(n.marker), ...renderInline(n.children, extra), sym(n.marker));
      case 'code':
        return h('code', null, sym(n.marker), n.text, sym(n.marker));
      case 'link': {
        const href = safeUrl(n.url);
        // URLs get their own sd-url span for word-break styling; symbol
        // class stays, text total preserved (round-trip).
        const kids = [
          sym(n.marker),
          ...renderInline(n.children, extra),
          sym(']('),
          h('span', { class: `${withExtras(styles.symbol, extra?.symbol)} ${styles.url}` }, n.url),
          ...(n.title ? [sym(` "${n.title}"`)] : []),
          sym(')'),
        ];
        const linkCls = extra?.link?.length ? { class: extra.link.join(' ') } : null;
        return href
          ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', ...linkCls }, ...kids)
          : h('span', linkCls, ...kids);
      }
      case 'image': {
        const src = safeUrl(n.url);
        return h(
          'span',
          { class: withExtras(styles.image, extra?.image) },
          // The image is an atomic widget: not selectable, not deletable
          // directly — edits go through the raw source span below it.
          ...(src
            ? [h('img', { class: styles.img, src, alt: n.alt, contenteditable: 'false', draggable: 'false' })]
            : []),
          h('span', { class: `${withExtras(styles.symbol, extra?.symbol)} ${styles.imageAlt} ${styles.url}` }, n.marker + n.alt + '](' + n.url + ')'),
        );
      }
      case 'autolink': {
        const href = safeUrl(n.url);
        const url = h('span', { class: styles.url }, n.url);
        return href
          ? h(
              'a',
              { href, target: '_blank', rel: 'noopener noreferrer' },
              sym('<'),
              url,
              sym('>'),
            )
          : h('span', null, sym('<'), url, sym('>'));
      }
    }
  });
}

/** Empty inline content gets a <br> anchor (no textContent impact). */
function line(
  tag: string,
  props: Record<string, string> | null,
  kids: VNodeChild[],
): VNode {
  const filtered = kids.filter((k) => typeof k !== 'string' || k !== '');
  return h(tag, props, ...(filtered.length ? filtered : [h('br')]));
}

/** Per-level heading classes, indexed by level-1. */
const HEAD_CLS = [styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6] as const;

export function renderBlock(b: BlockNode, extra?: RenderClasses): VNode {
  const sym = symOf(extra);
  switch (b.type) {
    case 'paragraph':
      return line('p', { class: withExtras(styles.block, extra?.paragraph) }, renderInline(b.children, extra));

    case 'heading': {
      const level = Math.min(6, Math.max(1, b.level));
      return line(
        `h${level}`,
        { class: withExtras(`${styles.block} ${styles.heading} ${HEAD_CLS[level - 1]}`, extra?.heading) },
        [sym('#'.repeat(level) + ' '), ...renderInline(b.children, extra)],
      );
    }

    case 'blockquote': {
      // Draw each line's actual source prefix ('>' or '> '): assuming
      // '> ' breaks value↔DOM when the source used a bare '>'.
      const srcLines = b.source.split('\n');
      return h(
        'blockquote',
        { class: withExtras(`${styles.block} ${styles.quote}`, extra?.blockquote) },
        ...b.lines.map((stripped, i) => {
          const orig = srcLines[i] ?? '';
          const prefix = orig.slice(0, Math.max(0, orig.length - stripped.length)) || '>';
          return line('p', { class: styles.line }, [sym(prefix), ...renderInline(b.children[i] ?? [], extra)]);
        }),
      );
    }

    case 'list': {
      // Flat rendering: every item is a direct li of the container;
      // nesting is the indent text itself — an li's textContent is its
      // markdown source line.
      const tag = b.ordered ? 'ol' : 'ul';
      return h(
        tag,
        { class: withExtras(`${styles.block} ${styles.list}`, extra?.list) },
        ...b.items.map((item, i) =>
          line('li', null, [
            ...(item.indent ? [item.indent] : []),
            sym(item.marker + ' '),
            ...renderInline(b.children[i] ?? [], extra),
          ]),
        ),
      );
    }

    case 'codeBlock': {
      // Symbols use the source's actual first/last lines — normalizing
      // '``` js' or '````' breaks the textContent==source round-trip, and
      // structural newlines depend on body line count ('' vs ['']). The
      // body lives in a sd-code-body span: syntaxHighlight replaces that
      // region via innerHTML (text total preserved).
      const src = b.source.split('\n');
      const open = src[0] ?? '```';
      const close = b.closed ? (src[src.length - 1] ?? '```') : null;
      const kids: VNode[] = [sym(open + (b.closed || b.bodyLines > 0 ? '\n' : ''))];
      kids.push(h('span', { class: styles.codeBody }, b.text));
      if (close !== null)
        kids.push(sym(b.bodyLines > 0 ? '\n' + close : close));
      return h('pre', { class: withExtras(`${styles.block} ${styles.code}`, extra?.codeBlock) }, ...kids);
    }

    case 'hr':
      return h('div', { class: withExtras(`${styles.block} ${styles.hr}`, extra?.hr) }, sym(b.source || '---'));
  }
}
