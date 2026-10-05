import { isContainerTag, readSource } from './sourceSpace';
import { styles } from './styles';
import { activeSelection } from './selection';

// ---- Pure helpers (module scope) ------------------------------------------

/**
 * Resolve a DOM text offset inside root to (node, offset). Falls back to
 * the end of the last text node — never past a block's <br>, where IME
 * composition breaks (§6.3).
 */
function pointAt(root: Node, offset: number): { node: Node; offset: number } {
  let acc = 0;
  let lastText: Text | null = null;
  const walk = (n: Node): { node: Node; offset: number } | null => {
    if (n.nodeType === 3) {
      lastText = n as Text;
      const len = n.textContent!.length; // text nodes always carry text
      if (offset <= acc + len)
        return { node: n, offset: Math.max(0, offset - acc) };
      acc += len;
      return null;
    }
    for (const c of Array.from(n.childNodes)) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  const r = walk(root);
  if (r) return r;
  const lt = lastText as Text | null;
  if (lt) return { node: lt, offset: lt.textContent!.length };
  return { node: root, offset: 0 };
}

/**
 * End offset of a code block body — the closing fence (if any) is a
 * no-caret zone. Its leading '\n' is the body's line break; unclosed
 * fences have no closer, so everything is editable.
 */
function preBodyEnd(pre: Element): number {
  const close = pre.lastElementChild;
  if (
    !close ||
    close === pre.firstElementChild ||
    close.classList.contains(styles.codeBody)
  )
    return pre.textContent?.length ?? 0;
  const t = close.textContent ?? '';
  const fenceLen = t.startsWith('\n') ? Math.max(0, t.length - 1) : t.length;
  return Math.max(0, (pre.textContent?.length ?? 0) - fenceLen);
}

/**
 * Text length from the start of root to (node, nodeOffset). Range-based
 * so element anchors (e.g. (li,0) after native deletions) measure
 * correctly; element offsets are clamped to child count.
 */
function textOffsetTo(root: Node, node: Node, nodeOffset: number): number {
  try {
    const r = root.ownerDocument!.createRange();
    r.selectNodeContents(root);
    const off =
      node.nodeType === 1
        ? Math.min(nodeOffset, (node as Element).childNodes.length)
        : nodeOffset;
    r.setEnd(node, off);
    return r.toString().length;
  } catch {
    // Real-browser Range failures (detached nodes); happy-dom never throws.
    return 0;
  }
}

/** textOffsetTo for the start of a range. */
function textOffset(root: Node, range: Range): number {
  return textOffsetTo(root, range.startContainer, range.startOffset);
}

/** Text length before the li-th line of a container (text space). */
function textBeforeLine(container: HTMLElement, li: number): number {
  let acc = 0;
  for (let k = 0; k < li; k++)
    acc += container.childNodes[k]!.textContent!.length;
  return acc;
}

// ---- Caret operations (need the host) --------------------------------------

/**
 * Caret arithmetic: block index, line location, caret placement. All
 * offsets are DOM text space (no line separators).
 */
export function createCaret({ el, doc }: { el: HTMLElement; doc: Document }) {
  /** Index of the editor-level block containing node, or -1. */
  function blockIndexOf(node: Node | null): number {
    let n: HTMLElement | null =
      node instanceof HTMLElement ? node : node?.parentElement ?? null;
    while (n && n.parentElement !== el) n = n.parentElement;
    return n ? Array.prototype.indexOf.call(el.children, n) : -1;
  }

  /** Caret as (block, line, offset-in-line). See locateLine for line rules. */
  function caretLine(): { block: number; line: number; offset: number } | null {
    const sel = activeSelection(el, doc);
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return locateLine(range.startContainer, range.startOffset);
  }

  /** Caret as (block, offset-in-block). */
  function caretInfo(): { block: number; offset: number } | null {
    const sel = activeSelection(el, doc);
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const block = blockIndexOf(range.startContainer);
    if (block < 0) return null;
    return { block, offset: textOffset(el.children[block]!, range) };
  }

  /** Place a collapsed caret; inside PRE the closing fence is off-limits. */
  function setCaret(blockIndex: number, offset: number): void {
    const sel = activeSelection(el, doc);
    if (!sel) return;
    const root = el.children[blockIndex] as HTMLElement;
    if (root.tagName === 'PRE') offset = Math.min(offset, preBodyEnd(root));
    const p = pointAt(root, offset);
    const r = doc.createRange();
    r.setStart(p.node, Math.max(0, p.offset));
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Locate an arbitrary position as (block, line, offset-in-line).
   * Lines are direct children of list/quote containers, '\n'-split
   * source lines inside PRE, and 0 for flat blocks.
   */
  function locateLine(
    node: Node,
    nodeOffset: number,
  ): { block: number; line: number; offset: number } | null {
    const block = blockIndexOf(node);
    if (block < 0) return null;
    const blockEl = el.children[block] as HTMLElement;
    const tag = blockEl.tagName;
    if (isContainerTag(tag)) {
      let e: Node | null = node;
      while (e && e.parentNode !== blockEl) e = e.parentNode;
      return {
        block,
        line: Math.max(0, Array.prototype.indexOf.call(blockEl.childNodes, e!)),
        offset: textOffsetTo(e!, node, nodeOffset),
      };
    }
    const abs = textOffsetTo(blockEl, node, nodeOffset);
    if (tag === 'PRE') {
      const lines = readSource(blockEl).split('\n');
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        const len = lines[i]!.length;
        if (abs <= acc + len) return { block, line: i, offset: abs - acc };
        acc += len + 1;
      }
      const last = lines.length - 1;
      return { block, line: last, offset: (lines[last] ?? '').length };
    }
    return { block, line: 0, offset: abs };
  }

  return {
    blockIndexOf,
    caretLine,
    caretInfo,
    pointAt,
    setCaret,
    preBodyEnd,
    textOffsetTo,
    locateLine,
    textBeforeLine,
  };
}

export type Caret = ReturnType<typeof createCaret>;
