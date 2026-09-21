/**
 * smalldown's bundled mini vdom — spec §3
 * Minimal implementation for block-level rendering and IME deferral,
 * with no external libraries.
 */

export type VNodeChild = VNode | string;

export interface VNode {
  type: string;
  props: Record<string, string> | null;
  children: VNodeChild[];
}

export function h(
  type: string,
  props: Record<string, string> | null = null,
  ...children: VNodeChild[]
): VNode {
  // No empty-string text nodes: browsers may drop them, and landing the
  // caret at the end of the last text node (a prefix symbol) is safer.
  return {
    type,
    props,
    children: children.flat().filter((c) => typeof c !== 'string' || c !== ''),
  };
}

export function createElement(v: VNodeChild): Node {
  if (typeof v === 'string') return document.createTextNode(v);
  const el = document.createElement(v.type);
  if (v.props) {
    for (const [k, val] of Object.entries(v.props)) {
      if (k === 'style') el.style.cssText = val;
      else el.setAttribute(k, val);
    }
  }
  for (const c of v.children) el.appendChild(createElement(c));
  return el;
}


