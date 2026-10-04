/**
 * Selection resolution for the editor's tree.
 *
 * document.getSelection() retargets anchors inside a shadow tree to the
 * shadow host, so every caret read/write against it fails for embeds
 * that render inside a ShadowRoot (e.g. comment widgets). Where the
 * engine exposes it, ShadowRoot.getSelection() sees the real nodes.
 * Engines without it keep the document-selection behavior.
 */
type ShadowRootWithSelection = ShadowRoot & {
  getSelection?: () => Selection | null;
};

export function activeSelection(el: HTMLElement, doc: Document): Selection | null {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const sel = (root as ShadowRootWithSelection).getSelection?.();
    if (sel) return sel;
  }
  return doc.getSelection?.() ?? null;
}
