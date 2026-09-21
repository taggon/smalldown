import { createEditor, createParser, DEFAULT_PARSER_OPTIONS } from './index';
import type { Editor, EditorClasses, ParserOptions } from './index';

const ALL_RULES = Object.keys(DEFAULT_PARSER_OPTIONS) as (keyof ParserOptions)[];

const initial: ParserOptions = {
  heading: true,
  strikethrough: true,
  image: true,
  codeBlock: true,
  hr: true,
  autolink: true,
};

const SAMPLE = [
  '## Try it live',
  'Type **bold**, *italic*, ***both***, ~~struck~~, `code` and [links](https://example.com) — or paste one: <https://example.com>',
  '> Quotes keep their marker as a dimmed symbol.',
  '- List items are plain text with a marker',
  '- **Nested** items just indent two spaces',
  '',
  '한국어 문단 — 조합형 입력(IME) 중에는 DOM을 바꾸지 않아 한글이 끊기지 않습니다.',
  '中文段落 — 全角标点与折行按原文往返。',
  '日本語の段落 — 変換中も DOM が置き換わらない。',
  '',
  '![preview](https://picsum.photos/160/80)',
  '',
  '---',
  '',
  '```js',
  'function greet(name) {',
  '  return `hi ${name}`;',
  '}',
  '```',
  '',
  '```ts',
  'type Point = { x: number; y: number };',
  'const zero: Point = { x: 0, y: 0 };',
  '```',
].join('\n');

const rulesEl = document.getElementById('rules')!;

const options: ParserOptions = { ...DEFAULT_PARSER_OPTIONS, ...initial };
const PLACEHOLDER = '댓글을 입력하세요… 마크다운도 됩니다';

/** Syntax highlight via the hidden double-buffer: Prism.highlightElement
 *  returns markup whose textContent is identical to the source. */
const prismBuffer = document.createElement('div');
prismBuffer.setAttribute('aria-hidden', 'true');
prismBuffer.style.display = 'none';
document.body.appendChild(prismBuffer);

function prismHighlight(code: string, lang: string): string | null {
  const P = (window as unknown as { Prism?: any }).Prism;
  if (!P?.highlightElement) return null;
  const name = lang.trim().toLowerCase();
  if (!name || !P.languages[name]) return null; // unsupported language
  prismBuffer.textContent = code;
  prismBuffer.className = `language-${name}`;
  P.highlightElement(prismBuffer);
  return prismBuffer.innerHTML;
}

/** twinkleplop languages via esm.sh — loaded once, cached. Each language()
 *  returns (code) => HTML synchronously; output preserves textContent.
 *  URL variables keep this a runtime-only import (TS can't resolve https). */
const esm = (pkg: string) => `https://esm.sh/${pkg}`;
const twinkleplop = Promise.all([
  import(/* @vite-ignore */ esm('@twinkleplop/javascript@0.1.5')),
  import(/* @vite-ignore */ esm('@twinkleplop/typescript@0.1.5')),
  import(/* @vite-ignore */ esm('@twinkleplop/python@0.1.5')),
  import(/* @vite-ignore */ esm('@twinkleplop/bash@0.1.5')),
  import(/* @vite-ignore */ esm('@twinkleplop/json@0.1.5')),
]).then(([js, ts, py, sh, json]) => ({
  js: (js as any).language() as (code: string) => string,
  ts: (ts as any).language() as (code: string) => string,
  py: (py as any).language() as (code: string) => string,
  sh: (sh as any).language() as (code: string) => string,
  json: (json as any).language() as (code: string) => string,
}));

const TP_ALIASES: Record<string, keyof Awaited<typeof twinkleplop>> = {
  js: 'js', javascript: 'js',
  ts: 'ts', typescript: 'ts',
  py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
  json: 'json', jsonc: 'json',
};

async function twinkleplopHighlight(code: string, lang: string): Promise<string | null> {
  const key = TP_ALIASES[lang.trim().toLowerCase()];
  if (!key) return null;
  const tp = await twinkleplop;
  // The wrapper would nest a <pre> inside our own — the theme hook
  // lives on the editor's pre via classes.codeBlock instead.
  return tp[key](code).replace(/<(?:pre|code)[^>]*>/gi, '');
}

interface Section {
  hostId: string;
  srcId: string;
  undoId: string;
  redoId: string;
  highlight: (code: string, lang: string) => string | null | Promise<string | null>;
  classes?: EditorClasses;
}

function mountSection(s: Section, value: string): Editor {
  const host = document.getElementById(s.hostId)!;
  const src = document.getElementById(s.srcId)!;
  const btnUndo = document.getElementById(s.undoId) as HTMLButtonElement;
  const btnRedo = document.getElementById(s.redoId) as HTMLButtonElement;
  const refresh = (ed: Editor) => {
    btnUndo.disabled = !ed.canUndo();
    btnRedo.disabled = !ed.canRedo();
  };
  const ed = createEditor(host, {
    parser: createParser({ ...options }),
    value,
    placeholder: PLACEHOLDER,
    syntaxHighlight: s.highlight,
    classes: s.classes,
    onChange: (v) => {
      src.textContent = v;
      refresh(ed);
    },
  });
  btnUndo.onclick = () => ed.undo();
  btnRedo.onclick = () => ed.redo();
  refresh(ed);
  src.textContent = ed.getValue();
  return ed;
}

let prismEditor = mountSection(
  { hostId: 'editor-prism', srcId: 'src-prism', undoId: 'prism-undo', redoId: 'prism-redo', highlight: prismHighlight },
  SAMPLE,
);

let tpValue = SAMPLE;
let tpEditor: Editor | null = null;
twinkleplop.then(() => {
  // Mount only after the languages resolve, so the initial render is
  // already highlighted (later mounts reuse the cache).
  tpEditor = mountSection(
    {
      hostId: 'editor-tp',
      srcId: 'src-tp',
      undoId: 'tp-undo',
      redoId: 'tp-redo',
      highlight: twinkleplopHighlight,
      // the wrapper is stripped, so re-attach the theme hook to our pre
      classes: { codeBlock: ['twinkleplop'] },
    },
    tpValue,
  );
});

for (const rule of ALL_RULES) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = `rule-${rule}`;
  box.checked = options[rule] ?? false;
  box.addEventListener('change', () => {
    options[rule] = box.checked;
    const value = prismEditor.getValue();
    prismEditor.destroy();
    prismEditor = mountSection(
      { hostId: 'editor-prism', srcId: 'src-prism', undoId: 'prism-undo', redoId: 'prism-redo', highlight: prismHighlight },
      value,
    );
    prismEditor.focus();
    if (tpEditor) {
      tpValue = tpEditor.getValue();
      tpEditor.destroy();
      tpEditor = mountSection(
        {
          hostId: 'editor-tp',
          srcId: 'src-tp',
          undoId: 'tp-undo',
          redoId: 'tp-redo',
          highlight: twinkleplopHighlight,
          classes: { codeBlock: ['twinkleplop'] },
        },
        tpValue,
      );
    }
  });
  label.append(box, document.createTextNode(rule));
  rulesEl.append(label);
}
