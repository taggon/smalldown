import { describe, expect, it } from 'vitest';
import { createElement, h } from '../src/vdom';

describe('vdom', () => {
  it('createElement: element, text, props', () => {
    const el = createElement(h('b', { class: 'x' }, 'hi')) as HTMLElement;
    expect(el.tagName).toBe('B');
    expect(el.getAttribute('class')).toBe('x');
    expect(el.textContent).toBe('hi');
    expect(createElement('t')).toBeInstanceOf(Text);
  });
});
