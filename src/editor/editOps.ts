import type { Parser } from '../createParser';
import type { Caret } from './caret';
import type { Reconcile } from './reconcile';
import { isContainerTag, isListTag, prefixOf, nextPrefix, readSource } from './sourceSpace';

/**
 * Key-driven edits: Enter/Backspace/Tab, text insertion, input
 * classification, fence auto-close. All changes flow through
 * reconcileRecord with an explicit caret hint.
 *
 * Every operation is a module-scope function taking its shared editing
 * surface explicitly (`d`) — the factory only binds. The destructuring at
 * each function top is the dependency list: what it reads is what it
 * names.
 */
interface EditDeps {
  el: HTMLElement;
  doc: Document;
  parser: Parser;
  caret: Caret;
  rec: Reconcile;
  /** Mark the pre-insert caret — execCommand's beforeinput fires
   *  post-mutation in Chromium, too late for a correct undo snapshot. */
  markPreEdit: () => void;
}

/** A caret position within a block: block index, line inside it, offset
 *  in that line's text (caret.locateLine's result shape). */
interface LinePos {
  block: number;
  line: number;
  offset: number;
}

/**
 * Where indentation inserts within a line: after the prefix of quotes and
 * headings (breaking it would change block syntax), at line start
 * elsewhere. Pure function.
 */
function indentPos(line: string, tag: string): number {
  if (tag === 'BLOCKQUOTE') return /^> ?/.exec(line)?.[0].length ?? 0;
  if (tag.startsWith('H')) return /^#{1,6} ?/.exec(line)?.[0].length ?? 0;
  return 0;
}

/** Map an input event to an undo unit kind (§6.6). Pure function. */
function classifyInput(ev: Event): string {
  const it = (ev as InputEvent).inputType ?? '';
  if (it.startsWith('delete')) return 'delete';
  if (it.startsWith('insertParagraph') || it.startsWith('insertLineBreak'))
    return 'newline';
  if (it.startsWith('insertFromPaste') || it.startsWith('insertFromDrop'))
    return 'paste';
  return 'typing';
}

function tagOf(el: HTMLElement, b: number): string {
  return (el.children[b] as HTMLElement).tagName;
}

/** Insert through the browser's editing pipeline when possible:
 * execCommand('insertText') fires real input events and keeps native
 * caret/replacement semantics (deprecated but unreplaced — EditContext
 * is Chromium-only). Range fallback for engines where it fails. */
function insertText(d: EditDeps, text: string): void {
  const { el, doc, markPreEdit } = d;
  markPreEdit();
  try {
    if (doc.execCommand && doc.execCommand('insertText', false, text)) return;
  } catch {
    /* fall through */
  }
  const sel = doc.getSelection?.();
  if (sel?.rangeCount) {
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(doc.createTextNode(text));
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleEnter(d: EditDeps): void {
  const { el, doc, caret, rec } = d;
  // A selection is replaced by Enter — delete it first (§6.4).
  const sel0 = doc.getSelection?.();
  let hadSelection = false;
  if (sel0 && sel0.rangeCount && !sel0.isCollapsed) {
    hadSelection = true;
    const r = sel0.getRangeAt(0);
    r.deleteContents();
    const c = doc.createRange();
    c.setStart(r.startContainer, r.startOffset);
    c.collapse(true);
    sel0.removeAllRanges();
    sel0.addRange(c);
  }
  const cl = caret.caretLine();
  if (!cl) {
    // Root-anchored caret (e.g. after select-all): the deletion above was
    // programmatic so no input event will fire — sync and record here or
    // the DOM and getValue() diverge.
    if (hadSelection) rec.reconcileRecord('newline', [''], { block: 0, offset: 0 });
    return;
  }
  const dom = el.children[cl.block] as HTMLElement;

  // Code block: insert '\n' directly in the source —
  // execCommand('insertText', '\n') behaves inconsistently across browsers.
  if (dom.tagName === 'PRE') {
    const ci = caret.caretInfo();
    if (!ci) return; // no selection — nothing to anchor Enter on
    const src = readSource(dom);
    // Enter at the very end (past the closing fence) escapes the block.
    // When the fence is the last block this is the only way out (§6.4).
    if (ci.offset >= src.length) {
      const sources = rec.readStructure();
      sources.splice(cl.block + 1, 0, '');
      rec.reconcileRecord('newline', sources, { block: cl.block + 1, offset: 0 });
      return;
    }
    const off = Math.max(0, Math.min(ci.offset, caret.preBodyEnd(dom)));
    const sources = rec.readStructure();
    // Auto-indent: a body line starting with 2+ spaces passes its
    // indentation on to the new line.
    const lineStart = src.lastIndexOf('\n', Math.max(0, off - 1)) + 1;
    const lead = /^[ ]{2,}/.exec(src.slice(lineStart, off))?.[0] ?? '';
    sources[cl.block] = src.slice(0, off) + '\n' + lead + src.slice(off);
    rec.reconcileRecord('newline', sources, {
      block: cl.block,
      offset: off + 1 + lead.length,
    });
    return;
  }

  const src = readSource(dom);
  const lines = src.split('\n');
  const li = Math.max(0, Math.min(cl.line, lines.length - 1));
  const line = lines[li]!;
  const inLine = Math.max(0, Math.min(cl.offset, line.length));
  const before = line.slice(0, inLine);
  const after = line.slice(inLine);
  const p = prefixOf(line);
  const isContainer = isContainerTag(dom.tagName);
  const sources = rec.readStructure();

  if (isContainer && p) {
    if (line === p) {
      // Enter on an empty item exits the list/quote — replace the line
      // with an empty paragraph (§6.4).
      lines.splice(li, 1);
      const remains = lines.length > 0;
      if (remains) {
        sources[cl.block] = lines.join('\n');
        sources.splice(cl.block + 1, 0, '');
      } else {
        sources.splice(cl.block, 1, '');
      }
      const target = remains ? cl.block + 1 : cl.block;
      rec.reconcileRecord('newline', sources, { block: target, offset: 0 });
      return;
    }
    if (before === '') {
      // Enter at line start must not inherit the prefix — inheriting
      // would stack it onto the raw source ('- - A'). The blank line
      // becomes its own source entry, matching parse shape so the caret
      // hint points at the exact empty paragraph.
      const head = lines.slice(0, li);
      const tail = lines.slice(li);
      if (head.length) sources.splice(cl.block, 1, head.join('\n'), '', tail.join('\n'));
      else sources.splice(cl.block, 1, '', tail.join('\n'));
      const blankBlock = head.length ? cl.block + 1 : cl.block;
      rec.reconcileRecord('newline', sources, { block: blankBlock, offset: 0 });
      return;
    }
    // New line in the same block: inherit the prefix, bump ordered
    // numbers. Hint offset is block-wide text space: prior lines +
    // before + the new prefix.
    const np = nextPrefix(p);
    const textBefore = caret.textBeforeLine(dom, li);
    lines.splice(li + 1, 0, np + after);
    lines[li] = before;
    sources[cl.block] = lines.join('\n');
    rec.reconcileRecord('newline', sources, {
      block: cl.block,
      offset: textBefore + before.length + np.length,
    });
  } else {
    // Plain split (paragraphs, headings).
    sources.splice(cl.block, 1, before, after);
    rec.reconcileRecord('newline', sources, { block: cl.block + 1, offset: 0 });
  }
}

/**
 * Backspace at line start — intercept only where the native result is
 * broken or a no-op (§6.4); line joins, empty-line deletion and
 * selection deletion are all left to the browser.
 *  1) first block is an empty paragraph — no-op (Chromium) or marker
 *     corruption (some engines): delete the line
 *  2) first block's prefix line — no-op: unindent / strip prefix
 */
function handleBackspace(d: EditDeps): boolean {
  const { el, caret, rec } = d;
  const cl = caret.caretLine();
  if (!cl || cl.offset !== 0) return false;
  if (cl.block !== 0) return false; // not first line — native join applies
  const dom = el.children[0] as HTMLElement;
  const tag = dom.tagName;

  // Delete an empty leading paragraph: at document start the native
  // action does nothing (Chromium) or eats the next block's list marker.
  if (tag === 'P') {
    const sources0 = rec.readStructure();
    if (sources0[0]! === '' && sources0.length > 1) {
      sources0.splice(0, 1);
      rec.reconcileRecord('delete', sources0, { block: 0, offset: 0 });
      return true;
    }
    return false;
  }

  if (!isContainerTag(tag)) return false;

  const sources = rec.readStructure();
  const lines = sources[cl.block]!.split('\n');
  const li = Math.max(0, Math.min(cl.line, lines.length - 1));
  const line = lines[li]!;

  const isList = isListTag(tag);
  const lead = /^ */.exec(line)![0]!.length;
  if (isList && lead > 0) {
    lines[li] = line.slice(Math.min(2, lead));
    sources[0] = lines.join('\n');
    rec.reconcileRecord('delete', sources, {
      block: 0,
      offset: caret.textBeforeLine(dom, li),
    });
    return true;
  }

  // Strip the prefix (after unindent) — first line only; exits the list
  // or quote.
  const p = prefixOf(line);
  if (p) {
    lines[li] = line.slice(p.length);
    sources[0] = lines.join('\n');
    rec.reconcileRecord('delete', sources, {
      block: 0,
      offset: caret.textBeforeLine(dom, li),
    });
    return true;
  }
  return false; // no prefix — let the browser handle it
}

/** Tab on a collapsed caret in a list line: nesting ±1 level, at most
 *  one level deeper than the previous item (§6.4). */
function tabListLine(d: EditDeps, cl: LinePos, shift: boolean): boolean {
  const { rec } = d;
  const sources = rec.readStructure();
  const lines = sources[cl.block]!.split('\n');
  const li = Math.max(0, Math.min(cl.line, lines.length - 1));
  const line = lines[li]!;
  const m = /^( *)((?:[-*]|\d+\.) )/.exec(line);
  if (!m) return false; // bare line — default action

  const lead = m[1]!.length;
  let nextLead = lead;
  if (shift) {
    if (lead >= 2) nextLead = lead - 2;
  } else {
    const prev = li > 0 ? /^ */.exec(lines[li - 1]!)![0]!.length : 0;
    // At most one level deeper than the previous item (§4.2).
    if (Math.floor((lead + 2) / 2) <= Math.floor(prev / 2) + 1) nextLead = lead + 2;
  }
  if (nextLead === lead) return true; // at top level / depth cap — no change

  const inLine = Math.max(0, Math.min(cl.offset, line.length));
  lines[li] = ' '.repeat(nextLead) + line.slice(lead);
  sources[cl.block] = lines.join('\n');
  // Keep the caret at the same position within the line (hint is block
  // DOM text space).
  let offset = Math.min(inLine + (nextLead - lead), lines[li]!.length);
  for (let k = 0; k < li; k++) offset += lines[k]!.length;
  rec.reconcileRecord('indent', sources, { block: cl.block, offset });
  return true;
}

/**
 * Indent (±2 spaces) every line from `s` to `e`. Code fences are
 * left alone; quote/heading lines indent after the prefix. A non-
 * collapsed selection is restored so indent can be undone/redone.
 */
function indentLines(d: EditDeps, s: LinePos, e: LinePos, shift: boolean, collapsed: boolean): boolean {
  const { el, doc, caret, rec } = d;
  const sources = rec.readStructure();
  const oldLines = sources.map((src) => src.split('\n'));
  let changed = false;

  const deltaAt = (b: number, i: number): number => {
    const line = oldLines[b]![i]!;
    const pos = indentPos(line, tagOf(el, b));
    if (shift) {
      const m = /^ {1,2}/.exec(line.slice(pos));
      return m ? -m[0].length : 0;
    }
    return 2;
  };

  for (let b = s.block; b <= e.block; b++) {
    const tag = tagOf(el, b);
    const isPre = tag === 'PRE';
    const lines = oldLines[b]!.slice();
    const from = b === s.block ? Math.max(0, s.line) : 0;
    const to = b === e.block ? Math.min(e.line, lines.length - 1) : lines.length - 1;
    for (let i = from; i <= to; i++) {
      const line = lines[i]!;
      if (isPre && (i === 0 || i === lines.length - 1) && line.startsWith('```'))
        continue; // keep fences intact
      const pos = indentPos(line, tag);
      if (shift) {
        const m = /^ {1,2}/.exec(line.slice(pos));
        if (!m) continue;
        lines[i] = line.slice(0, pos) + line.slice(pos + m[0].length);
      } else {
        lines[i] = line.slice(0, pos) + '  ' + line.slice(pos);
      }
      changed = true;
    }
    sources[b] = lines.join('\n');
  }
  if (!changed) return true; // nothing to unindent — just block the key

  // Shift boundary positions by the indent delta (hint is block DOM text
  // space). PRE separators are real '\n' text; other blocks have none.
  const off = (b: number, i: number, inLine: number): number => {
    const isPre = tagOf(el, b) === 'PRE';
    const lines = sources[b]!.split('\n');
    let acc = 0;
    for (let k = 0; k < i; k++) acc += lines[k]!.length + (isPre ? 1 : 0);
    return (
      acc + Math.max(0, Math.min(inLine + deltaAt(b, i), lines[i]!.length))
    );
  };

  rec.reconcileRecord('indent', sources, { block: s.block, offset: off(s.block, s.line, s.offset) });
  if (!collapsed) {
    const sel = doc.getSelection?.();
    const rootS = el.children[Math.min(s.block, el.children.length - 1)];
    const rootE = el.children[Math.min(e.block, el.children.length - 1)];
    if (sel && rootS && rootE) {
      const ps = caret.pointAt(rootS, off(s.block, s.line, s.offset));
      const pe = caret.pointAt(rootE, off(e.block, e.line, e.offset));
      const r = doc.createRange();
      r.setStart(ps.node, Math.max(0, ps.offset));
      r.setEnd(pe.node, Math.max(0, pe.offset));
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
  return true;
}

/**
 * Tab/Shift+Tab — indent ±1 level (2 spaces), §6.4.
 *  - collapsed: only code block lines and list lines (nesting caps)
 *  - selection: every line the range touches (quotes/headings: after
 *    the prefix)
 * Returns true when handled (default action blocked).
 */
function handleTab(d: EditDeps, shift: boolean): boolean {
  const { el, doc, caret } = d;
  const sel = doc.getSelection?.();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const s = caret.locateLine(range.startContainer, range.startOffset);
  const e = caret.locateLine(range.endContainer, range.endOffset);
  if (!s || !e) return false;

  if (range.collapsed) {
    const tag = tagOf(el, s.block);
    if (isListTag(tag)) return tabListLine(d, s, shift);
    if (tag !== 'PRE') return false; // collapsed in paragraphs/quotes: default
    // Collapsed Tab in code inserts two spaces; only Shift+Tab
    // (dedent) and selections move lines.
    if (!shift) {
      insertText(d, '  ');
      return true;
    }
  }
  return indentLines(d, s, e, shift, range.collapsed);
}

/**
 * When a fresh one-line opening fence (```lang) appears, append an empty
 * body line and a closing fence — otherwise the parser swallows the rest
 * of the document as code. Skipped for paste input: multi-line pastes
 * can transiently look like an empty fence mid-content.
 * Also strips the duplicated pair the moment the user types the closing
 * fence in the body themselves: the block closes early and the
 * auto-inserted ('' + '```') pair is left dangling at the end — skip
 * over it like bracket auto-close. That shape exists only in the PRE
 * text right before reparse, so it can't false-positive.
 */
function autoCloseFence(d: EditDeps, sources: string[]): string[] | null {
  const { el, parser } = d;
  // Only when the parser builds code blocks — without them there is
  // nothing to guard and we would only pollute the value.
  if (!parser.options.codeBlock) return null;
  for (let i = 0; i < sources.length; i++) {
    const dom = el.children[i] as HTMLElement;
    const s = sources[i]!;
    if (dom.tagName === 'PRE') {
      const lines = s.split('\n');
      const n = lines.length;
      if (
        n >= 4 &&
        lines[n - 1]!.startsWith('```') &&
        lines[n - 2] === '' &&
        lines[n - 3]!.startsWith('```')
      ) {
        const out = sources.slice();
        out[i] = lines.slice(0, n - 2).join('\n');
        return out;
      }
      continue;
    }
    if (s.startsWith('```') && !s.includes('\n')) {
      const out = sources.slice();
      out.splice(i + 1, 0, '', '```');
      return out;
    }
  }
  return null;
}

/**
 * Home/End(±Shift)/Cmd+←/→ — remap to our line model only inside
 * list/quote containers: with no newline text between li's, the browser
 * treats the whole container as one line (End jumps to the list end).
 * Paragraphs, headings and PRE (real '\n' text) already behave per
 * line, so we don't touch them (§6.4 minimal interception). Returns
 * true when handled.
 */
function handleLineNav(d: EditDeps, home: boolean, shift: boolean): boolean {
  const { el, doc, caret } = d;
  const cl = caret.caretLine();
  if (!cl) return false;
  const dom = el.children[cl.block] as HTMLElement;
  const tag = dom.tagName;
  if (!isContainerTag(tag)) return false;
  const lineEl = dom.childNodes[cl.line] as ChildNode;
  const lineLen = lineEl.textContent!.length;
  // Land inside the line element itself: a boundary position lives in
  // the previous line's last node, which would read as that line on the
  // next navigation.
  const f = caret.pointAt(lineEl, home ? 0 : lineLen);
  const sel = doc.getSelection?.();
  if (!sel) return false;
  if (shift) {
    // Keep the anchor, move only the focus.
    const a = sel.anchorNode;
    if (!a) return false;
    sel.setBaseAndExtent(a, sel.anchorOffset, f.node, Math.max(0, f.offset));
  } else {
    const r = doc.createRange();
    r.setStart(f.node, Math.max(0, f.offset));
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  return true;
}

export function createEditOps(deps: EditDeps) {
  return {
    insertText: (text: string) => insertText(deps, text),
    handleEnter: () => handleEnter(deps),
    handleBackspace: () => handleBackspace(deps),
    handleTab: (shift: boolean) => handleTab(deps, shift),
    autoCloseFence: (sources: string[]) => autoCloseFence(deps, sources),
    handleLineNav: (home: boolean, shift: boolean) => handleLineNav(deps, home, shift),
    classifyInput,
  };
}

export type EditOps = ReturnType<typeof createEditOps>;
