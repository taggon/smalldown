/** Shared mutable editor state, injected into the subsystems. */
export interface EditorState {
  /** Per-block sources of the last render — the reconcile rerender
   *  criterion. */
  oldSources: string[];
  /** oldSources.join('\n'), cached so repeated joins don't run on every
   *  keystroke. Invariant: value === oldSources.join('\n') — always
   *  update via setSources, never assign directly. */
  value: string;
  /** Blocks whose DOM has drifted from oldSources (deferred edits). */
  dirty: Set<number>;
  /** Index of the composing block — null = not composing, -1 =
   *  composing but block undetermined. */
  composingBlock: number | null;
}

export function createState(): EditorState {
  return { oldSources: [], value: '', dirty: new Set<number>(), composingBlock: null };
}

/** The only way to update oldSources — keeps the value cache in sync. */
export function setSources(state: EditorState, sources: string[]): void {
  state.oldSources = sources;
  state.value = sources.join('\n');
}
