import type { BlockNode } from '../ast';
import type { Parser } from '../createParser';
import { renderBlock, type RenderClasses } from '../render';
import { createElement } from '../vdom';
import type { Caret } from './caret';
import type { History, Snapshot } from './history';
import type { Highlight } from './highlight';
import { setSources, type EditorState } from './state';
import { styles } from './styles';
import {
  absOf,
  blockTag,
  domOffOf,
  locateAbs,
  normalize,
  readSource,
  srcOffOf,
} from './sourceSpace';

/** Caret hint tri-state (easy to confuse):
 *  - undefined: read the caret from the DOM
 *  - null: skip caret restoration (external setValue etc.)
 *  - object: explicit (block, offset), relative to the new structure */
export type CaretHint = { block: number; offset: number } | null;

/** Shared reconcile surface every operation takes explicitly; the
 * factory only binds. */
interface RecDeps {
  el: HTMLElement;
  parser: Parser;
  state: EditorState;
  caret: Caret;
  highlight: Highlight | null;
  history: History;
  fireChange: () => void;
  extraClasses?: RenderClasses;
}

/** Equal source arrays? Compares element-wise without joining. */
function sameSources(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i]);
}

/**
 * Render/reconcile — read the DOM, parse, apply per block. Operations
 * are module-scope functions declaring their deps at the top; the
 * factory only binds them.
 */

function readStructure(d: RecDeps): string[] {
  return Array.from(d.el.children).map(readSource);
}

/** Full rebuild. caretAbs is an absolute source-space offset from
 * the document start. */
function rebuildAll(d: RecDeps, nb: BlockNode[], caretAbs: number | null): void {
  const { el, state, highlight, caret, extraClasses } = d;
  el.replaceChildren();
  state.dirty.clear();
  nb.forEach((b) => {
    const nv = renderBlock(b, extraClasses);
    const node = createElement(nv);
    el.appendChild(node);
    if (highlight && b.type === 'codeBlock')
      highlight.requestHighlight(node as HTMLElement, true);
  });
  if (caretAbs === null) return;
  const rel = locateAbs(
    nb.map((b) => b.source),
    caretAbs,
  );
  const b = nb[rel.block]!;
  caret.setCaret(rel.block, domOffOf(b.source, rel.offset, b.type === 'codeBlock'));
}

function updateEmpty(d: RecDeps): void {
  d.el.classList.toggle(styles.empty, d.state.oldSources.every((s) => !s));
}

/**
 * Apply structural changes with a minimal keyed splice: shared
 * prefix/suffix blocks stay untouched, only the changed middle is
 * swapped — surviving blocks keep their DOM (and code highlighting),
 * so one Enter doesn't repaint the document. Falls back to a full
 * rebuild when the DOM↔oldSources 1:1 mapping is broken.
 */
function spliceBlocks(d: RecDeps, nb: BlockNode[], caretAbs: number | null): void {
  const { el, state, highlight, caret, extraClasses } = d;
  const old = state.oldSources;
  if (old.length !== el.children.length) {
    rebuildAll(d, nb, caretAbs);
    return;
  }
  let i = 0;
  while (i < old.length && i < nb.length && old[i] === nb[i]!.source) i++;
  let tail = 0;
  while (
    tail < old.length - i &&
    tail < nb.length - i &&
    old[old.length - 1 - tail] === nb[nb.length - 1 - tail]!.source
  )
    tail++;
  const delTo = old.length - tail;
  const insTo = nb.length - tail;
  if (i !== delTo || i !== insTo) {
    // item() is null out of bounds — no fallback branch needed
    const anchor = el.children.item(delTo) as HTMLElement | null;
    for (let k = i; k < insTo; k++) {
      const node = createElement(renderBlock(nb[k]!, extraClasses));
      el.insertBefore(node, anchor);
      if (highlight && nb[k]!.type === 'codeBlock')
        highlight.requestHighlight(node as HTMLElement, true);
    }
    for (let k = delTo - 1; k >= i; k--) el.children[k]!.remove();
    state.dirty.clear();
  }
  if (caretAbs === null) return;
  const rel = locateAbs(
    nb.map((b) => b.source),
    caretAbs,
  );
  const b = nb[rel.block]!;
  caret.setCaret(rel.block, domOffOf(b.source, rel.offset, b.type === 'codeBlock'));
}

/** reconcile + undo record + change notification — record before
 * notify so onChange listeners can read canUndo/canRedo. `preSel` is
 * the pre-edit caret (beforeinput); the live caret at input time has
 * already moved past the edit. */
function reconcileRecord(
  d: RecDeps,
  kind: string,
  override?: string[],
  caretHint?: CaretHint,
  preSel?: { block: number; offset: number } | null,
): boolean {
  const { state, caret, history, fireChange } = d;
  const prevValue = state.value;
  const prevSel = preSel ?? caret.caretInfo();
  const changed = reconcile(d, override, caretHint);
  if (changed) history.recordUnit(kind, prevValue, prevSel);
  if (changed) fireChange();
  return changed;
}

/** Apply a snapshot — full rebuild, not recorded into history. */
function applySnapshot(d: RecDeps, snap: Snapshot): void {
  const { parser, state, caret } = d;
  const nb = normalize(parser.parse(snap.value).children);
  rebuildAll(d, nb, null);
  setSources(state, nb.map((b) => b.source));
  updateEmpty(d);
  if (snap.sel) {
    const block = Math.min(Math.max(snap.sel.block, 0), nb.length - 1);
    caret.setCaret(block, snap.sel.offset);
  }
}

/**
 * Read the DOM (or the override sources), parse, apply per block.
 * - same block count, changed source/type: rerender changed blocks
 *   only (caret restored)
 * - block count changed, or override changed the structure: minimal
 *   splice (best-effort caret)
 * - composing blocks: deferred (marked dirty)
 * Returns whether the value actually changed (the undo criterion).
 */
function reconcile(d: RecDeps, override?: string[], caretHint?: CaretHint): boolean {
  const { el, state, parser, caret, highlight, extraClasses } = d;
  const domSources = readStructure(d);
  // Fast path: DOM identical to the last render and nothing deferred
  // → skip parsing entirely. IME composition fires frequent inputs;
  // equal plaintext can't change parse results, so the O(document)
  // reparse per keystroke is pure waste.
  if (
    override === undefined &&
    domSources.length === state.oldSources.length &&
    state.dirty.size === 0 &&
    domSources.every((s, i) => s === state.oldSources[i])
  )
    return false;
  const sources = override ?? domSources;
  const value = sources.join('\n');
  const nb = normalize(parser.parse(value).children);
  const prevValue = state.value;
  // An override that differs from the DOM (Enter/Backspace changed the
  // structure) forces a splice even at equal block counts — the caret
  // hint is relative to the new structure.
  const structural =
    override !== undefined && !sameSources(override, domSources);
  const comp = state.composingBlock;

  // Normalize caret hints (block-relative, DOM text space) to an
  // absolute offset: against the override structure when hinted,
  // against the current DOM otherwise (§6.2).
  const fromDom = caretHint === undefined;
  const rel = fromDom ? caret.caretInfo() : caretHint;
  let abs: number | null = null;
  if (rel) {
    const base = fromDom ? domSources : sources;
    if (base.length) {
      const blk = Math.min(Math.max(rel.block, 0), base.length - 1);
      const isPre = fromDom
        ? (el.children[blk] as HTMLElement | undefined)?.tagName === 'PRE'
        : nb[Math.min(blk, nb.length - 1)]?.type === 'codeBlock';
      abs = absOf(base, blk, srcOffOf(base[blk] ?? '', rel.offset, isPre));
    } else {
      abs = rel.offset;
    }
  }

  if (structural || nb.length !== el.children.length) {
    if (comp !== null) return false; // no rebuild while composing — applied at compositionend
    spliceBlocks(d, nb, abs);
  } else {
    const ci = abs === null ? null : locateAbs(sources, abs);
    for (let i = 0; i < nb.length; i++) {
      const dom = el.children[i] as HTMLElement;
      // Same source but different type (P↔PRE): rerender. Compared as
      // "to-draw (nb) vs last drawn (oldSources)" — when content
      // migrates into a block after a prefix deletion, this block's DOM
      // text is unchanged but more must be drawn (prevents loss).
      const changed =
        nb[i]!.source !== state.oldSources[i] ||
        sources[i] !== state.oldSources[i] ||
        state.dirty.has(i) ||
        dom.tagName !== blockTag(nb[i]!);
      if (!changed) continue;
      // Composing blocks (or all, when the block is unknown) are
      // deferred (§6.3).
      if (comp !== null && (comp === -1 || i === comp)) {
        state.dirty.add(i);
        continue;
      }
      // Code blocks: the user-edited DOM text is already exact — a
      // plain rerender would flash the highlight away. Keep the DOM,
      // re-request highlight only (sync now, async debounced).
      if (highlight && nb[i]!.type === 'codeBlock' && dom.tagName === 'PRE') {
        state.dirty.delete(i);
        highlight.requestHighlight(dom);
        continue;
      }
      const nv = renderBlock(nb[i]!, extraClasses);
      const node = createElement(nv);
      dom.replaceWith(node);
      state.dirty.delete(i);
      if (highlight && nb[i]!.type === 'codeBlock')
        highlight.requestHighlight(node as HTMLElement, true);
      // If the rerender dropped the caret, restore it at the same
      // offset (§6.2).
      if (ci && ci.block === i)
        caret.setCaret(
          i,
          domOffOf(sources[i]!, ci.offset, nb[i]!.type === 'codeBlock'),
        );
    }
  }

  setSources(state, nb.map((b) => b.source));
  updateEmpty(d);
  return state.value !== prevValue;
}

export function createReconcile(deps: RecDeps) {
  return {
    readStructure: () => readStructure(deps),
    rebuildAll: (nb: BlockNode[], caretAbs: number | null) => rebuildAll(deps, nb, caretAbs),
    updateEmpty: () => updateEmpty(deps),
    reconcile: (override?: string[], caretHint?: CaretHint) => reconcile(deps, override, caretHint),
    reconcileRecord: (
      kind: string,
      override?: string[],
      caretHint?: CaretHint,
      preSel?: { block: number; offset: number } | null,
    ) => reconcileRecord(deps, kind, override, caretHint, preSel),
    applySnapshot: (snap: Snapshot) => applySnapshot(deps, snap),
  };
}

export type Reconcile = ReturnType<typeof createReconcile>;
