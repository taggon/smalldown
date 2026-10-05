import type { Caret } from './caret';
import type { EditOps } from './editOps';
import type { History, Snapshot } from './history';
import type { Reconcile } from './reconcile';
import type { EditorState } from './state';
import { styles } from './styles';
import { activeSelection } from './selection';

/** Shared editing surface every handler takes explicitly; the factory
 * only binds. */
interface EventsDeps {
  el: HTMLElement;
  doc: Document;
  state: EditorState;
  caret: Caret;
  ops: EditOps;
  history: History;
  rec: Reconcile;
  fireChange: () => void;
  /** Applies a setValue received mid-composition, after it ends. */
  applyPendingSet: () => void;
  /** Mark the pre-edit caret (first write wins; see createEditor). */
  markPreEdit: () => void;
  /** Read and clear the pre-edit caret. */
  takePreSel: () => Snapshot['sel'];
}

/** Mutable cross-event state: written by one handler, read by another. */
interface EventState {
  /** e.g. paste — kind known before the input event fires. */
  pendingKind: string | null;
  /** State at composition start (§6.3). */
  compStart: Snapshot | null;
}

/**
 * Event wiring: beforeinput/input/keydown/paste/drop/composition/blur
 * plus the widget-caret normalizer. Handlers are module-scope functions
 * declaring their deps at the top; the factory only registers them.
 */

/** Shared composition-end rule: commit, record one composition unit,
 *  apply a pending setValue. */
function endComposition(d: EventsDeps, s: EventState): void {
  const { state, rec, history, fireChange, applyPendingSet } = d;
  const start = s.compStart;
  s.compStart = null;
  const b = state.composingBlock;
  state.composingBlock = null;
  if (b !== null && b >= 0) state.dirty.add(b); // commit the composed block
  const changed = rec.reconcile();
  // Record the whole composition as one unit — mid-composition inputs
  // already updated oldSources, so compare against the start value
  // rather than trusting `changed` (§6.6).
  if (start && state.value !== start.value) {
    history.recordUnit('composition', start.value, start.sel);
    fireChange(); // notify after recording (canUndo ordering)
  } else if (changed) {
    fireChange();
  }
  applyPendingSet();
}

function onInput(d: EventsDeps, s: EventState, ev: Event): void {
  const { state, ops, rec } = d;
  const preSel = d.takePreSel();
  const kind = s.pendingKind ?? ops.classifyInput(ev);
  s.pendingKind = null;
  if (state.composingBlock !== null) {
    if (rec.reconcile()) d.fireChange(); // no recording mid-composition (§6.6)
    return;
  }
  const domSources = rec.readStructure();
  const closed = kind === 'paste' ? null : ops.autoCloseFence(domSources);
  rec.reconcileRecord(kind, closed ?? undefined, undefined, preSel);
}

function onKeydown(d: EventsDeps, ev: Event): void {
  const { doc, ops, history } = d;
  const e = ev as KeyboardEvent;
  if (e.isComposing) return; // composition keys belong to the browser (§6.3)
  const mod = e.metaKey || e.ctrlKey;
  // Block native formatting shortcuts on the fallback
  // (contenteditable="true") path — inserted <b>/<i> would survive in
  // the DOM since reconcile never removes them.
  if (mod && !e.altKey && /^[biu]$/i.test(e.key)) {
    e.preventDefault();
    return;
  }
  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if (mod && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    history.redo();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    ops.handleEnter();
  } else if (e.key === 'Backspace') {
    // Intercept only collapsed carets on a prefix line we handle; the
    // rest falls through to native deletion → input → reconcile (§6.4).
    const sel = activeSelection(d.el, doc);
    if ((!sel || sel.isCollapsed) && ops.handleBackspace()) e.preventDefault();
  } else if (e.key === 'Tab' && !mod) {
    if (ops.handleTab(e.shiftKey)) e.preventDefault();
  } else if (
    // Line navigation inside containers — Home/End and macOS Cmd+←/→
    // (§6.4). Arrows only with meta: Ctrl+←/→ is word-wise travel on
    // Windows/Linux, leave it alone.
    e.key === 'Home' ||
    e.key === 'End' ||
    (e.metaKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
  ) {
    const home = e.key === 'Home' || (mod && e.key === 'ArrowLeft');
    if (ops.handleLineNav(home, e.shiftKey)) e.preventDefault();
  }
}

function insertPlainText(d: EventsDeps, s: EventState, text: string): void {
  if (!text) return;
  s.pendingKind = 'paste';
  d.ops.insertText(text);
}

function onPaste(d: EventsDeps, s: EventState, ev: Event): void {
  ev.preventDefault();
  const text = (ev as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
  insertPlainText(d, s, text);
}

// Drop mirrors paste — closes the hole where native drop inserts rich
// HTML on the fallback (contenteditable="true") path.
function onDrop(d: EventsDeps, s: EventState, ev: Event): void {
  ev.preventDefault();
  const text = (ev as DragEvent).dataTransfer?.getData('text/plain') ?? '';
  insertPlainText(d, s, text);
}

function onCompositionStart(d: EventsDeps, s: EventState, ev: Event): void {
  const { state, caret } = d;
  // Identify the composing block: event target first, else the current
  // selection. Both failing (-1) defers everything until the
  // composition ends — safety first (§6.3).
  let b = caret.blockIndexOf(ev.target as Node);
  if (b < 0) {
    const cl = caret.caretLine();
    b = cl ? cl.block : -1;
  }
  state.composingBlock = b;
  s.compStart = { value: state.value, sel: caret.caretInfo() };
}

// Safety net for focus leaving mid-composition (missed
// compositionend): record the composition unit by the same rule.
function onBlur(d: EventsDeps, s: EventState): void {
  if (d.state.composingBlock !== null) endComposition(d, s);
}

/**
 * The image preview is a widget: the caret must never render beside
 * it. Chromium can anchor boundary seats on the widget wrapper itself
 * ((span,0)…) or on its parent next to the wrapper ((p, idx)…) when
 * stepping over it — remap those to the equivalent text seats. A seat
 * alone can't tell the travel direction; whether the PREVIOUS anchor
 * was inside the widget's source text can, so the caret always moves
 * away from where it came: into the source at the leading boundary,
 * out to the next text at the trailing one.
 */
function createWidgetCaretNormalizer({
  el,
  doc,
  caret,
}: {
  el: HTMLElement;
  doc: Document;
  caret: Caret;
}) {
  let prevInWidget = false;
  let normalizing = false; // setCaret fires selectionchange synchronously in some engines
  const withinWidget = (n: Node | null): boolean => {
    const e = n instanceof Element ? n : n?.parentElement ?? null;
    return !!e?.closest(`.${styles.image}`);
  };
  function handler(): void {
    if (normalizing) return;
    const sel = activeSelection(el, doc);
    if (!sel || sel.rangeCount === 0) return;
    const a = sel.anchorNode;
    if (!a || !el.contains(a)) return;
    if (!sel.isCollapsed) {
      prevInWidget = withinWidget(a);
      return;
    }
    const isWidget = (n: Node | null | undefined): n is HTMLElement =>
      n instanceof HTMLElement && n.classList.contains(styles.image);
    const childAt = (k: number): ChildNode | undefined =>
      a instanceof Element ? a.childNodes[k] : undefined;
    let lead = false; // seat right before the widget's source text
    let trail = false; // seat right after it
    if (isWidget(a)) {
      lead = sel.anchorOffset <= 1;
      trail = sel.anchorOffset >= 2;
    } else if (isWidget(childAt(sel.anchorOffset - 1))) {
      trail = true;
    } else if (isWidget(childAt(sel.anchorOffset))) {
      lead = true;
    }
    if (lead || trail) {
      const span = (isWidget(a)
        ? a
        : (childAt(sel.anchorOffset) ?? childAt(sel.anchorOffset - 1))) as HTMLElement;
      const block = caret.blockIndexOf(span);
      if (block >= 0) {
        const offset = caret.textOffsetTo(el.children[block]!, a, sel.anchorOffset);
        const len = (el.children[block] as HTMLElement).textContent?.length ?? 0;
        const fwd = lead ? !prevInWidget : prevInWidget;
        normalizing = true;
        try {
          caret.setCaret(block, Math.min(offset + (fwd ? 1 : 0), len));
        } finally {
          normalizing = false;
        }
      }
    }
    prevInWidget = withinWidget(activeSelection(el, doc)?.anchorNode ?? null);
  }
  // Shadow trees fire their own selectionchange; light-DOM editors
  // get the document event only (getRootNode() === doc).
  const root = el.getRootNode();
  doc.addEventListener('selectionchange', handler);
  if (root !== doc) root.addEventListener('selectionchange', handler);
  return {
    destroy: () => {
      doc.removeEventListener('selectionchange', handler);
      if (root !== doc) root.removeEventListener('selectionchange', handler);
    },
  };
}

export function createEvents(deps: EventsDeps) {
  const { el, markPreEdit } = deps;
  const s: EventState = { pendingKind: null, compStart: null };
  const listeners: Array<[string, EventListener]> = [];
  const on = (type: string, fn: EventListener) => {
    el.addEventListener(type, fn);
    listeners.push([type, fn]);
  };

  // Last point where the caret is still where the user left it
  // (native typing fires this before the mutation).
  on('beforeinput', markPreEdit);
  on('input', (ev) => onInput(deps, s, ev));
  on('keydown', (ev) => onKeydown(deps, ev));
  on('paste', (ev) => onPaste(deps, s, ev));
  on('drop', (ev) => onDrop(deps, s, ev));
  on('compositionstart', (ev) => onCompositionStart(deps, s, ev));
  on('compositionend', () => endComposition(deps, s));
  on('blur', () => onBlur(deps, s));

  const widget = createWidgetCaretNormalizer(deps);

  return {
    destroy: () => {
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
      listeners.length = 0;
      widget.destroy();
      s.compStart = null;
      s.pendingKind = null;
    },
  };
}

export type Events = ReturnType<typeof createEvents>;
