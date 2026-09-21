/**
 * Styles — CSS Modules pattern.
 * Rules are flat single-class selectors; class names get a suffix at
 * load time (`sd-{name}-{xxxxx}`) to dodge collisions with host-document
 * CSS. A base-36 tag of the clock tail differs per module load and
 * keeps class names short. Embedders override via the public styles map:
 * `.${styles.symbol}{opacity:1}`.
 */

/** Every logical style name — the single source of truth. RULES
 *  entries are validated against it and the public styles map is
 *  derived from it, so a typo can't compile and a new name can't be
 *  forgotten. Some names (image, codeBody) exist only as DOM hooks —
 *  selected in code, never styled by a rule. */
const STYLE_NAMES = [
  'editor',
  'block',
  'heading',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'symbol',
  'quote',
  'line',
  'list',
  'url',
  'code',
  'hr',
  'image',
  'imageAlt',
  'img',
  'codeBody',
  'empty',
] as const;

/** A valid style name — usable as a styles map key. */
export type StyleName = (typeof STYLE_NAMES)[number];

/** Flat rules — name: logical name, sel: pseudo-selector on the class. */
const RULES: ReadonlyArray<{ name: StyleName; sel?: string; decl: string }> = [
  {
    name: 'editor',
    decl:
      'position:relative;min-height:80px;padding:10px 12px;border:1px solid #d0d7de;border-radius:8px;outline:none;cursor:text;font-size:14px;line-height:1.6;overflow-wrap:break-word;white-space:pre-wrap',
  },
  { name: 'editor', sel: ':focus', decl: 'border-color:#0969da' },
  { name: 'block', decl: 'margin:0 0 4px' },
  { name: 'block', sel: ':last-child', decl: 'margin-bottom:0' },
  // Headings: typography distinct from plain blocks — sizes step 1.75em
  // → 1em by 0.15em; em margins scale with the level's own size.
  { name: 'heading', decl: 'font-weight:600;line-height:1.3;margin:.67em 0 .33em' },
  { name: 'heading', sel: ':first-child', decl: 'margin-top:0' },
  { name: 'h1', decl: 'font-size:1.75em' },
  { name: 'h2', decl: 'font-size:1.6em' },
  { name: 'h3', decl: 'font-size:1.45em' },
  { name: 'h4', decl: 'font-size:1.3em' },
  { name: 'h5', decl: 'font-size:1.15em' },
  { name: 'h6', decl: 'font-size:1em' },
  { name: 'symbol', decl: 'opacity:.45' },
  { name: 'quote', decl: 'border-left:3px solid #d0d7de;padding-left:10px;color:#57606a' },
  { name: 'line', decl: 'margin:0' },
  { name: 'list', decl: 'list-style:none;padding-left:0' },
  { name: 'url', decl: 'word-break:break-all' },
  {
    name: 'code',
    decl:
      'background:#f6f8fa;border-radius:6px;padding:8px 10px;font-family:monospace;font-size:13px',
  },
  { name: 'hr', decl: 'color:#d0d7de;letter-spacing:2px;user-select:none' },
  { name: 'imageAlt', decl: 'font-size:11px' },
  {
    name: 'img',
    // Block on its own line: no caret seat ever renders beside the image
    // (the boundary seats land on the text lines above/below instead).
    decl: 'display:block;max-width:100%;margin:2px 0;user-select:none;-webkit-user-select:none',
  },
  {
    name: 'empty',
    sel: '::before',
    decl: 'content:attr(data-sd-ph);color:#8b949e;position:absolute;pointer-events:none',
  },
];

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const SUFFIX = (Date.now() % 1e5).toString(36);
const cls = (name: StyleName): string => `sd-${kebab(name)}-${SUFFIX}`;

/** Logical name → suffixed class, derived from STYLE_NAMES.
 *  Referenced by renderer, editor and tests alike. */
export const styles: Record<StyleName, string> = Object.fromEntries(
  STYLE_NAMES.map((n) => [n, cls(n)]),
) as Record<StyleName, string>; // fromEntries loses literal keys
export type EditorStyles = typeof styles;

/** Flat stylesheet — each rule is one class (+pseudo) selector. */
export const STYLESHEET: string = RULES.map(
  (r) => `.${cls(r.name)}${r.sel ?? ''}{${r.decl}}`,
).join('');

// One <style> per document.
const injectedDocs = new WeakSet<Document>();
export function injectBaseCss(doc: Document): void {
  if (injectedDocs.has(doc) || !doc.head) return;
  injectedDocs.add(doc);
  const style = doc.createElement('style');
  style.textContent = STYLESHEET;
  doc.head.appendChild(style);
}
