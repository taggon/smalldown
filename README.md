# smalldown

A small markdown editor for small writing, comments, issue
descriptions, commit messages.

It renders in place, so there's no Write/Preview toggle to click.
Syntax markers (`**`, `- `, `> `) stay visible as dimmed symbols
instead of vanishing when the cursor leaves the line: the text you
see is the markdown you'll ship. Code blocks get highlighted, images
render inline. 10 KB, zero dependencies.

```js
import { createParser, createEditor } from 'smalldown';

const editor = createEditor(el, {
  parser: createParser({ heading: false, strikethrough: true }),
  placeholder: 'Write a comment…',
  onChange: (v) => console.log(v),
});
```

## Why it's different

- **Round-trip guarantee.** Every block's `textContent` equals its
  markdown source line. `getValue()` is never a re-render guess — what
  the user sees is exactly what is saved.
- **IME-safe.** Composition (Korean/Japanese/Chinese input) never
  triggers DOM replacement mid-session. Composition blocks are deferred
  and committed on `compositionend`; blur during composition is handled.
- **Native where possible.** The editor edits as
  `contenteditable="plaintext-only"` and intercepts only what the browser
  gets wrong: Enter semantics, prefix Backspace, Tab indents, line
  navigation inside lists/quotes. Everything else stays native, so
  deletion, selection and caret behavior feel exactly like the platform.
- **Minimal DOM churn.** Per-block rerender for content changes, a keyed
  splice for structural ones — one Enter does not repaint the document,
  and code highlighting survives edits without flicker.
- **Small.** ~10 kB gzip, no dependencies. Tree-shakeable parser rules.
- **Image previews are widgets.** `![alt](url)` renders an unselectable
  preview above its source line; the caret never renders beside the
  image, and arrows step over it into the source text.

## Install

```sh
npm install smalldown
```

Works in Chromium, Safari and Firefox (`plaintext-only` where available,
plain `contenteditable` fallback elsewhere). TypeScript types included.
Accessibility: the host gets `role="textbox"` + `aria-multiline`, and
`placeholder` doubles as `aria-label` unless the element already carries
one.

## Editor API

`createEditor(el, options)` → `Editor`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `parser` | `Parser` | `createParser()` | See parser options below. |
| `parserOptions` | `ParserOptions` | — | Shorthand; wins over `parser` if both are given. |
| `value` | `string` | `''` | Initial markdown. |
| `placeholder` | `string` | — | Shown when the document is empty. |
| `onChange` | `(value) => void` | — | Fires after undo history is recorded. |
| `history` | `false \| { pauseMs, limit }` | `{ 500, 200 }` | Undo/redo config, or off. |
| `classes` | `{ editor?, paragraph?, heading?, blockquote?, list?, codeBlock?, hr?, link?, image?: string[] }` | — | Additive classes per render target, merged with (never replacing) the built-ins. Attributes only — no effect on the value round-trip. |
| `syntaxHighlight` | `(code, lang) => string \| null \| Promise` | — | Code block highlighter. |

`Editor` methods: `getValue()`, `setValue(text)`, `reset(text?)`,
`setReadonly(bool)`, `focus()`, `onChange(cb) → unsubscribe`, `undo()`,
`redo()`, `canUndo()`, `canRedo()`, `destroy()`.

`reset` replaces the value AND drops the undo history — the post-submit
"fresh slate": `setValue('')` leaves an undo unit that resurrects the
submitted text via Cmd/Ctrl+Z, `reset()` leaves nothing. Fires `onChange`
when the value changes (unlike the silent `setValue`). `setReadonly`
locks editing via `contenteditable=false` and syncs `aria-readonly`.

Undo units group naturally: a burst of typing is one step, a composition
is one step, structural edits start new steps.

### Syntax highlighting

Return HTML whose `textContent` equals `code` exactly (round-trip
guarantee) — for closed blocks the engine appends one `\n` to your
result and moves the structural newline out of the closing fence, so
the last line never hugs the ```` ``` ````. A detached-buffer Prism example:

```js
const buffer = document.createElement('div');
buffer.style.display = 'none';
document.body.appendChild(buffer);

const syntaxHighlight = (code, lang) => {
  const P = window.Prism;
  if (!P?.highlightElement || !P.languages[lang]) return null;
  buffer.textContent = code;
  buffer.className = `language-${lang}`;
  P.highlightElement(buffer);
  return buffer.innerHTML;
};
```

Applied synchronously on `setValue`, debounced (150 ms) while typing,
caret preserved. **The returned HTML is inserted as-is (innerHTML) —
only return markup you trust.**

## Parser options

All optional, all combinable:

| Option | Default | Parses |
| --- | --- | --- |
| `blockquote` | `true` | `> quote` |
| `list` | `true` | `- a` / `1. a` (2-space nesting) |
| `code` | `true` | `` `code` `` |
| `link` | `true` | `[text](url)` |
| `heading` | `false` | `# … ######` |
| `strikethrough` | `false` | `~~del~~` |
| `image` | `false` | `![alt](url)` |
| `autolink` | `false` | `<https://…>` |
| `codeBlock` | `false` | ` ``` ` fences |
| `hr` | `false` | `---` / `***` |

`**bold**`, `*italic*` and `***both***` are always on.

Links only allow `http(s):`, `mailto:`, and relative `/#.` URLs; other
schemes render as plain text.

## Custom Styles

Give the render targets your own class names — they are added
alongside the built-ins, so your stylesheet targets stable names of
your choosing:

```js
createEditor(el, {
  classes: { editor: 'my-editor', blockquote: 'my-quote' },
});
```

```css
.my-editor { font: 15px/1.6 system-ui; }
.my-quote { border-left-color: crimson; }
```

Every render target takes extra classes: `editor`, `paragraph`,
`heading`, `blockquote`, `list`, `codeBlock`, `hr`, `link`, `image`.
They are additive (built-ins stay) and never affect the value
round-trip.

For retheming the built-ins themselves, they are flat single-class
rules injected once per document, with load-time class suffixes
(`sd-block-xxxxx`) to avoid collisions with host CSS. The exported
`styles` map hands you those generated names:

```js
import { styles } from 'smalldown';

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>.${styles.symbol}{opacity:1}</style>`,
);
```

Built-in heading typography: one shared rule (weight 600, line-height
1.3, em margins that scale with the level) plus per-level sizes stepping
1.75 em → 1 em by 0.15 em — override `.${styles.h2}` etc. to retheme.

## Security notes

- Paste and drop accept `text/plain` only — rich HTML never enters.
- Link URLs are scheme-allowlisted (no `javascript:`).
- `syntaxHighlight` output is trusted HTML by contract; sanitize before
  returning if the input is untrusted.

## Testing

```sh
npm test            # everything (coverage gate: 92% on all four metrics)
npm run test:unit   # happy-dom: parser/render round-trips, edit ops, events
npm run test:browser # real Chromium: native typing/deletion semantics,
                    # line navigation, paste/drop, splice, styles, highlight
```

The browser layer exists because several behaviors (element-anchor
carets after native deletion, Home/End line concepts, IME) only
reproduce in a real engine.

## License

MIT
