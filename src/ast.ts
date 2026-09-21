/** smalldown AST — spec §4.3 */

/** Block nodes. Every block carries its markdown `source` (round-trip
 *  guarantee). */
export type BlockNode =
  | {
      type: 'paragraph';
      source: string;
      children: InlineNode[];
    }
  | {
      type: 'heading';
      source: string;
      level: number; // 1..6
      children: InlineNode[];
    }
  | {
      type: 'blockquote';
      source: string;
      lines: string[]; // with '> ' stripped
      children: InlineNode[][]; // 1:1 with lines
    }
  | {
      type: 'list';
      source: string;
      ordered: boolean;
      items: ListItemNode[]; // indent/marker stripped; the raw form lives on each item
      children: InlineNode[][]; // 1:1 with items
    }
  | {
      type: 'codeBlock';
      source: string;
      lang: string;
      text: string;
      closed: boolean; // closing fence present — an unclosed fence never renders one
      bodyLines: number; // body line count — [] and [''] share the same text
    }
  | { type: 'hr'; source: string };

export interface DocumentNode {
  type: 'document';
  children: BlockNode[];
}

/** List item. Keeps its raw indent and marker so round-trips stay exact
 *  (two indent spaces = one nesting level). */
export interface ListItemNode {
  indent: string; // raw leading spaces ('' | '  ' | '    ' …)
  marker: string; // raw marker ('-' | '*' | '3.' …)
  text: string; // item body
}

/** Inline nodes. Emphasis variants carry their raw marker and children. */
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; marker: string; children: InlineNode[] }
  | { type: 'em'; marker: string; children: InlineNode[] }
  | { type: 'strongEm'; marker: string; children: InlineNode[] }
  | { type: 'del'; marker: string; children: InlineNode[] }
  | { type: 'code'; marker: string; text: string }
  | { type: 'link'; marker: string; url: string; title?: string; children: InlineNode[] }
  | { type: 'image'; marker: string; alt: string; url: string }
  | { type: 'autolink'; marker: string; url: string };
