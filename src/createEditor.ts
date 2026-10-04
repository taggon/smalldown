import { createParser, type Parser, type ParserOptions } from './createParser';
import type { RenderClasses } from './render';
import { createCaret } from './editor/caret';
import { createEditOps } from './editor/editOps';
import { createEvents } from './editor/events';
import {
  createHistory,
  type HistoryConfig,
  type Snapshot,
} from './editor/history';
import { createHighlight } from './editor/highlight';
import { createReconcile } from './editor/reconcile';
import { createState, setSources } from './editor/state';
import { injectBaseCss, styles } from './editor/styles';
import { normalize } from './editor/sourceSpace';

export interface HistoryOptions {
  /** Edits of the same kind split into a new undo unit after this idle
   *  gap (ms). Default 500. */
  pauseMs?: number;
  /** Undo stack size cap. Default 200. */
  limit?: number;
}

export interface EditorClasses extends RenderClasses {
  /** Classes added to the host element itself. */
  editor?: string[];
}

export interface EditorOptions {
  parser?: Parser;
  parserOptions?: ParserOptions;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Undo/redo — false to disable, or { pauseMs, limit }. */
  history?: false | HistoryOptions;
  /** Additive classes per render target (host, blocks, links, images) —
   *  appended to the built-in styles, never replacing them. */
  classes?: EditorClasses;
  /**
   * Syntax highlighter for code blocks. Returns an HTML string whose
   * textContent must equal `code` exactly (round-trip guarantee), null
   * to leave the block plain, or a Promise of either. Applies debounced
   * while typing, with the caret preserved (spec §6.1).
   *
   * The returned HTML is inserted with innerHTML and is not sanitized —
   * only supply output you trust (e.g. Prism.highlight, not raw user
   * input). Example: highlight into a detached buffer element and
   * return its innerHTML.
   */
  syntaxHighlight?: (code: string, lang: string) => string | null | Promise<string | null>;
}

export interface Editor {
  getValue(): string;
  setValue(text: string): void;
  /** Replace the value AND drop all undo history — the post-submit
   * reset. Unlike setValue(''), nothing is left for Cmd+Z to restore. */
  reset(text?: string): void;
  /** Lock/unlock editing (contenteditable flip, aria-readonly sync). */
  setReadonly(readonly: boolean): void;
  focus(): void;
  onChange(cb: (value: string) => void): () => void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  destroy(): void;
}

/**
 * contenteditable markdown editor — composition root. Subsystems in
 * src/editor/: sourceSpace (pure transforms) → caret → highlight →
 * history → reconcile → editOps → events. Shared mutable state lives
 * in the state object.
 */
export function createEditor(el: HTMLElement, opts: EditorOptions = {}): Editor {
  // When both a parser and parserOptions are given, the options win —
  // the more specific intent (spec discourages passing both).
  const parser =
    opts.parserOptions !== undefined
      ? createParser(opts.parserOptions)
      : (opts.parser ?? createParser());
  const doc = el.ownerDocument;
  injectBaseCss(el);

  el.classList.add(styles.editor, ...(opts.classes?.editor ?? []));
  el.setAttribute('contenteditable', 'plaintext-only');
  if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true'); // fallback
  // Bare contenteditable reads poorly to assistive tech — declare the
  // role explicitly, and mirror the placeholder as a label unless the
  // embedder already provides one.
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');
  const setLabel = !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby');
  if (opts.placeholder) {
    el.setAttribute('data-sd-ph', opts.placeholder);
    if (setLabel) el.setAttribute('aria-label', opts.placeholder);
  }
  // What contenteditable value restores after readonly toggles off.
  const editableAttr = el.getAttribute('contenteditable')!;

  const state = createState();
  const changeCallbacks = new Set<(v: string) => void>();
  if (opts.onChange) changeCallbacks.add(opts.onChange);

  const fireChange = (): void => {
    const v = state.value;
    for (const cb of changeCallbacks) cb(v);
  };

  const historyCfg: HistoryConfig | null =
    opts.history === false ? null : { pauseMs: 500, limit: 200, ...opts.history };

  const caret = createCaret({ el, doc });
  const highlight = opts.syntaxHighlight
    ? createHighlight({
        el,
        doc,
        fn: opts.syntaxHighlight,
        caret,
        isComposingBlock: () => state.composingBlock,
      })
    : null;
  const history = createHistory({
    cfg: historyCfg,
    isComposing: () => state.composingBlock !== null,
    current: (): Snapshot => ({ value: state.value, sel: caret.caretInfo() }),
    apply: (snap) => {
      rec.applySnapshot(snap);
      fireChange();
    },
  });
  const rec = createReconcile({
    el,
    parser,
    state,
    caret,
    highlight,
    history,
    fireChange,
    extraClasses: opts.classes,
  });
  // Pre-edit state for undo snapshots. The input event fires AFTER the
  // DOM change, so the caret captured there has already moved past the
  // edit. Sources: beforeinput (native typing — pre-mutation) and
  // markPreEdit before execCommand (whose beforeinput fires
  // post-mutation in Chromium). First write wins.
  let preEdit: { value: string; sel: Snapshot['sel'] } | null = null;
  const markPreEdit = (): void => {
    if (!preEdit) preEdit = { value: state.value, sel: caret.caretInfo() };
  };
  const takePreSel = (): Snapshot['sel'] => {
    const p = preEdit;
    preEdit = null;
    // A beforeinput that never produced an input (canceled edit) keeps a
    // stale seat once the value moved on (e.g. via setValue) — discard it.
    return p && p.value === state.value ? p.sel : null;
  };

  const ops = createEditOps({ el, doc, parser, caret, rec, markPreEdit });

  let pendingSet: string | null = null; // setValue received mid-composition
  let pendingReset = false; // reset received mid-composition
  let initialized = false;

  const setValue = (text: string): void => {
    // Same-value re-sets are no-ops: an echo pattern (onChange→setValue)
    // would rebuild per keystroke, wiping the caret — and mid-composition
    // it would kill the IME session.
    if (initialized && text === state.value) return;
    // External updates during composition wait until it ends (§6.3 — no
    // DOM replacement). getValue stays consistent; the pending value
    // applies after compositionend.
    if (state.composingBlock !== null) {
      pendingSet = text;
      return;
    }
    const prevValue = state.value;
    const prevSel = caret.caretInfo();
    const nb = normalize(parser.parse(text).children);
    rec.rebuildAll(nb, null);
    setSources(state, nb.map((b) => b.source));
    rec.updateEmpty();
    if (initialized && text !== prevValue) {
      history.recordUnit('setValue', prevValue, prevSel);
    }
  };
  setValue(opts.value ?? '');
  initialized = true;
  history.markInitialized();

  /** Fresh slate: replace the value AND drop all undo history. After a
   * comment submit, setValue('') would leave an undo unit that resurrects
   * the submitted text via Cmd+Z — reset leaves nothing to restore. */
  const reset = (text = ''): void => {
    if (state.composingBlock !== null) {
      pendingSet = text;
      pendingReset = true;
      return;
    }
    const prev = state.value;
    setValue(text);
    history.reset();
    // setValue itself is silent (programmatic); a reset is a state
    // machine event the embedder wants to observe (e.g. re-disable the
    // submit button).
    if (text !== prev) fireChange();
  };

  /** Lock/unlock editing by flipping contenteditable. Toggling during a
   * composition makes the browser cancel it; compositionend then runs
   * the normal flush path. */
  const setReadonly = (readonly: boolean): void => {
    el.setAttribute('contenteditable', readonly ? 'false' : editableAttr);
    // Not toggleAttribute: ARIA booleans need the literal "true" value,
    // toggleAttribute would emit aria-readonly="".
    if (readonly) el.setAttribute('aria-readonly', 'true');
    else el.removeAttribute('aria-readonly');
  };

  const events = createEvents({
    el,
    doc,
    state,
    caret,
    ops,
    history,
    rec,
    fireChange,
    markPreEdit,
    takePreSel,
    applyPendingSet: () => {
      if (pendingSet === null) return;
      const v = pendingSet;
      const wasReset = pendingReset;
      const prev = state.value;
      pendingSet = null;
      pendingReset = false;
      setValue(v);
      if (wasReset) {
        history.reset();
        if (v !== prev) fireChange();
      }
    },
  });

  return {
    getValue: () => state.value,
    setValue,
    reset,
    setReadonly,
    focus: () => el.focus(),
    onChange(cb) {
      changeCallbacks.add(cb);
      return () => changeCallbacks.delete(cb);
    },
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    destroy() {
      highlight?.destroy();
      events.destroy();
      state.composingBlock = null;
      state.dirty.clear();
      history.reset();
      changeCallbacks.clear();
      el.classList.remove(styles.editor, styles.empty, ...(opts.classes?.editor ?? []));
      const attrs = [
        'contenteditable',
        'data-sd-ph',
        'role',
        'aria-multiline',
        'aria-readonly',
        'aria-label',
      ];
      for (const at of attrs) el.removeAttribute(at);
      el.replaceChildren();
    },
  };
}
