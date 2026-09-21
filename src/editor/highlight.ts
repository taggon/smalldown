import type { Caret } from './caret';
import { styles } from './styles';

/** Body span of a PRE (pure function). */
export function codeBodyOf(pre: HTMLElement): HTMLElement | null {
  return pre.querySelector(`.${styles.codeBody}`);
}

/** Body text with the appended structural newline removed — plain and
 *  highlighted bodies differ by exactly that one '\n' (closed blocks
 *  only; source bodies never end with a newline themselves). Pure. */
export function bodyCode(body: Element): string {
  const t = body.textContent ?? '';
  return t.endsWith('\n') ? t.slice(0, -1) : t;
}

/** Shared highlight surface every operation takes explicitly; the
 *  factory only binds. */
interface HighlightDeps {
  doc: Document;
  fn: (code: string, lang: string) => string | null | Promise<string | null>;
  caret: Caret;
  /** Composing block index (null = not composing, -1 = defer all) —
   *  read from state. */
  isComposingBlock: () => number | null;
}

/** Mutable scheduling state: what is pending and when it flushes. */
interface HighlightState {
  pending: Set<HTMLElement>;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Syntax highlight pipeline (spec §6.1) — debounce, caret
 * preservation, composition guard. Operations are module-scope
 * functions declaring their deps at the top; the factory only binds.
 */

/** Apply highlight HTML to the body with caret preservation and
 *  stale/composition guards. */
function applyHtml(d: HighlightDeps, pre: HTMLElement, code: string, html: string | null): void {
  const { doc, caret, isComposingBlock } = d;
  if (html === null || html === code) return; // unsupported language
  const body = codeBodyOf(pre)!; // renderer-built PREs always carry a body span
  if (!pre.isConnected) return; // already rebuilt/removed
  if (bodyCode(body) !== code) return; // edited again — later request wins
  const comp = isComposingBlock();
  if (comp !== null && (comp === -1 || caret.blockIndexOf(pre) === comp)) return;

  // Preserve caret/selection inside the body (equal text totals make
  // this exact).
  const sel = doc.getSelection?.();
  let start: number | null = null;
  let end: number | null = null;
  if (sel && sel.rangeCount && sel.anchorNode && body.contains(sel.anchorNode)) {
    start = caret.textOffsetTo(body, sel.anchorNode, sel.anchorOffset);
    end = sel.isCollapsed
      ? start
      : sel.focusNode
        ? caret.textOffsetTo(body, sel.focusNode, sel.focusOffset)
        : start;
  }
  // Closed blocks keep the structural newline INSIDE the highlighted
  // body (highlighter output rarely ends with one, so the last line
  // hugs the fence) — the newline moves out of the close-fence symbol,
  // keeping the textContent==source round-trip. Unclosed blocks have
  // no fence to compensate, so they take the HTML as-is.
  const closeText = body.nextElementSibling?.firstChild ?? null;
  const closed =
    closeText?.nodeType === 3 && /^\n?```/.test(closeText.textContent ?? '');
  body.innerHTML = closed ? `${html}\n` : html;
  if (closed && closeText.textContent!.startsWith('\n')) {
    closeText.textContent = closeText.textContent!.slice(1);
  }
  if (start !== null && end !== null && sel) {
    const ps = caret.pointAt(body, start);
    const pe = caret.pointAt(body, end);
    const r = doc.createRange();
    r.setStart(ps.node, Math.max(0, ps.offset));
    r.setEnd(pe.node, Math.max(0, pe.offset));
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/** Invoke the highlighter: sync results apply now, Promises when they
 *  settle (the stale guard ignores intervening edits). Returns the
 *  pending Promise, if any. */
function runHighlight(d: HighlightDeps, pre: HTMLElement): Promise<unknown> | null {
  const { fn } = d;
  const body = codeBodyOf(pre)!;
  const code = bodyCode(body);
  const fence = pre.firstElementChild?.textContent ?? '';
  const lang = fence.replace(/^```/, '').replace(/\n$/, '').trim();
  const html: string | null | Promise<string | null> = fn(code, lang);
  if (html !== null && typeof (html as Promise<string | null>).then === 'function') {
    const p = html as Promise<string | null>;
    void p.then((h) => applyHtml(d, pre, code, h)).catch(() => {
      /* highlighter failure ≡ no highlight */
    });
    return p;
  }
  applyHtml(d, pre, code, html as string | null);
  return null;
}

function flushHighlights(d: HighlightDeps, s: HighlightState): void {
  const { caret, isComposingBlock } = d;
  for (const pre of Array.from(s.pending)) {
    s.pending.delete(pre);
    if (!pre.isConnected) continue;
    // Blocks being composed are skipped — they get re-requested at
    // compositionend.
    const comp = isComposingBlock();
    if (comp !== null && (comp === -1 || caret.blockIndexOf(pre) === comp)) continue;
    runHighlight(d, pre); // sync results apply immediately, async on settle
  }
}

/** Highlight request after a code block render.
 *  - immediate (initial/structural render): call now; async results
 *    apply when they resolve.
 *  - otherwise (typing): debounce — the existing highlighted DOM stays
 *    in place, so there is no flash of plain text. */
function requestHighlight(d: HighlightDeps, s: HighlightState, pre: HTMLElement, immediate = false): void {
  if (immediate) {
    runHighlight(d, pre);
    return;
  }
  s.pending.add(pre);
  if (s.timer !== null) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    flushHighlights(d, s);
  }, 150);
}

export function createHighlight(deps: HighlightDeps) {
  const s: HighlightState = { pending: new Set(), timer: null };
  return {
    requestHighlight: (pre: HTMLElement, immediate?: boolean) =>
      requestHighlight(deps, s, pre, immediate),
    flushHighlights: () => flushHighlights(deps, s),
    destroy: () => {
      if (s.timer !== null) clearTimeout(s.timer);
      s.timer = null;
      s.pending.clear();
    },
  };
}

export type Highlight = ReturnType<typeof createHighlight>;
