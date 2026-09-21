/**
 * smalldown parser — spec §4
 *
 * createParser(options) combines only the regex fragments of enabled
 * rules into one line-classifier regex and one inline regex.
 *   const parser = createParser({ table: true, strikethrough: true, image: false });
 */
import type { BlockNode, DocumentNode, InlineNode, ListItemNode } from './ast';

export interface ParserOptions {
  // block
  heading?: boolean;
  blockquote?: boolean;
  list?: boolean;
  codeBlock?: boolean;
  hr?: boolean;
  // inline — bold/italic/bold-italic are always on (spec §4.2)
  strikethrough?: boolean;
  code?: boolean;
  link?: boolean;
  image?: boolean;
  autolink?: boolean;
}

export const DEFAULT_PARSER_OPTIONS: Required<ParserOptions> = {
  heading: false,
  blockquote: true,
  list: true,
  codeBlock: false,
  hr: false,
  // Bold (**), italic (*), bold-italic (***) are always enabled.
  strikethrough: false,
  code: true,
  link: true,
  image: false,
  autolink: false,
};

export interface Parser {
  readonly options: Required<ParserOptions>;
  parse(source: string): DocumentNode;
  parseInline(text: string): InlineNode[];
}

export function createParser(options: ParserOptions = {}): Parser {
  const o: Required<ParserOptions> = { ...DEFAULT_PARSER_OPTIONS, ...options };

  // ---- line rules: classify a single line --------------------------------
  // Regex literals: single-level escaping, syntax checked at compile
  // time; `.source` gives the string the join needs.
  const lineRules = [
    o.heading && /^(?<lHeading>#{1,6} )/.source,
    o.hr && /^(?<lHr>-{3,}|\*{3,})$/.source,
    o.blockquote && /^(?<lQuote>>)/.source,
    o.list && /^(?<lUl> *[-*] )/.source,
    o.list && /^(?<lOl> *\d+\. )/.source,
  ].filter(Boolean) as string[];
  const lineRegex = lineRules.length
    ? new RegExp(lineRules.join('|'))
    : null;

  // ---- inline rules: one regex scans the whole sentence -------------------
  // Each alternative carries an outer named group so the match can tell
  // which rule hit. Emphasis variants (*** → ** → *) in order, always
  // included (§4.2).
  const inlineRules = [
    /(?<bi>\*\*\*(?<biText>(?:[^*\n]|\*(?!\*))+?)\*\*\*)/.source,
    /(?<bold>\*\*(?<boldText>(?:[^*\n]|\*(?!\*))+?)\*\*)/.source,
    /(?<em>\*(?<emText>(?:[^*\n]|\*(?!\*))+?)\*)/.source,
    o.strikethrough && /(?<del>~~(?<delText>[^~\n]+?)~~)/.source,
    o.code && /`(?<codeText>[^`\n]+)`/.source,
    o.link &&
      /(?<link>\[(?<linkText>[^[\]\n]*)\]\((?<linkUrl>[^\s)]+)(?:\s+"(?<linkTitle>[^"\n]*)")?\))/.source,
    o.image && /(?<image>!\[(?<imageAlt>[^[\]\n]*)\]\((?<imageUrl>[^\s)]+)\))/.source,
    o.autolink && /(?<autolink><(?<autolinkUrl>https?:\/\/[^\s<>]+)>)/.source,
  ].filter(Boolean) as string[];
  // Bold/italic/bold-italic are unconditional, so the list is never empty.
  const inlineRegex = new RegExp(inlineRules.join('|'), 'g');

  function parseInline(text: string): InlineNode[] {
    const nodes: InlineNode[] = [];
    let last = 0;
    for (const m of text.matchAll(inlineRegex)) {
      const at = m.index!; // matchAll always reports the index
      if (at > last) nodes.push({ type: 'text', text: text.slice(last, at) });
      nodes.push(inlineNode(m));
      last = at + m[0].length;
    }
    if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
    return nodes;
  }

  function inlineNode(m: RegExpMatchArray): InlineNode {
    const g = m.groups!; // every alternative has named groups
    if (g.bi)
      return { type: 'strongEm', marker: '***', children: parseInline(g.biText!) };
    if (g.bold)
      return { type: 'strong', marker: '**', children: parseInline(g.boldText!) };
    if (g.em)
      return { type: 'em', marker: '*', children: parseInline(g.emText!) };
    if (g.del)
      return { type: 'del', marker: '~~', children: parseInline(g.delText!) };
    if (g.codeText)
      return { type: 'code', marker: '`', text: g.codeText };
    if (g.link)
      return {
        type: 'link',
        marker: '[',
        url: g.linkUrl!,
        ...(g.linkTitle ? { title: g.linkTitle } : {}),
        children: parseInline(g.linkText!),
      };
    if (g.image)
      return { type: 'image', marker: '![', alt: g.imageAlt!, url: g.imageUrl! };
    if (g.autolink)
      return { type: 'autolink', marker: '<', url: g.autolinkUrl! };
    // Unreachable today (alternatives are exhaustive); kept so a new
    // inline rule degrades to plain text instead of crashing.
    return { type: 'text', text: m[0] };
  }

  // ---- block parser: classify lines, group runs --------------------------
  const isFence = (l: string) => l.startsWith('```');

  function parse(source: string): DocumentNode {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks: BlockNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;
      if (!line.trim()) {
        // Each blank line stays its own empty-paragraph block (§4.2): Enter
        // can keep adding blank lines and round-trip stays exact.
        blocks.push({ type: 'paragraph', source: '', children: [] });
        i++;
        continue;
      }

      // Fenced code (runs to the end when never closed).
      if (o.codeBlock && isFence(line)) {
        const lang = line.slice(3).trim();
        const start = i++;
        const body: string[] = [];
        while (i < lines.length && !isFence(lines[i]!)) body.push(lines[i++]!);
        const closed = i < lines.length;
        if (closed) i++;
        const text = body.join('\n');
        const rawEnd = closed ? start + body.length + 2 : lines.length;
        blocks.push({
          type: 'codeBlock',
          lang,
          text,
          closed,
          bodyLines: body.length,
          source: lines.slice(start, rawEnd).join('\n'),
        });
        continue;
      }

      const m = lineRegex ? lineRegex.exec(line) : null;
      const g = m?.groups ?? {};

      if (g.lHeading) {
        const level = g.lHeading.trim().length;
        const text = line.slice(g.lHeading.length);
        blocks.push({
          type: 'heading',
          level,
          children: parseInline(text),
          source: line,
        });
        i++;
        continue;
      }
      if (g.lHr) {
        blocks.push({ type: 'hr', source: line });
        i++;
        continue;
      }
      if (g.lQuote) {
        const start = i;
        const stripped: string[] = [];
        while (i < lines.length && lines[i]!.startsWith('>')) {
          stripped.push(lines[i++]!.replace(/^> ?/, ''));
        }
        blocks.push({
          type: 'blockquote',
          lines: stripped,
          children: stripped.map((l) => parseInline(l)),
          source: lines.slice(start, i).join('\n'),
        });
        continue;
      }
      if (g.lUl || g.lOl) {
        const ordered = !!g.lOl;
        const start = i;
        // Consecutive list lines (2-space indents = 1 nesting level)
        // form one block.
        const itemRegex = ordered ? /^ *\d+\. / : /^ *[-*] /;
        const items: ListItemNode[] = [];
        while (i < lines.length && itemRegex.test(lines[i]!)) {
          const m = /^( *)((?:[-*]|\d+\.) )/.exec(lines[i]!)!;
          items.push({
            indent: m[1]!,
            marker: m[2]!.slice(0, -1),
            text: lines[i++]!.slice(m[0].length),
          });
        }
        blocks.push({
          type: 'list',
          ordered,
          items,
          children: items.map((it) => parseInline(it.text)),
          source: lines.slice(start, i).join('\n'),
        });
        continue;
      }

      // One paragraph per line (§4.2).
      blocks.push({
        type: 'paragraph',
        children: parseInline(line),
        source: line,
      });
      i++;
    }

    return { type: 'document', children: blocks };
  }

  return { options: o, parse, parseInline };
}
