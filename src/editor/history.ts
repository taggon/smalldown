/** Undo/redo history (spec §6.6) — unit grouping, caps, composition
 *  guard. */
export interface Snapshot {
  value: string;
  sel: { block: number; offset: number } | null;
}

export interface HistoryConfig {
  pauseMs: number;
  limit: number;
}

export function createHistory({
  cfg,
  isComposing,
  current,
  apply,
}: {
  cfg: HistoryConfig | null;
  /** True while composing — undo/redo is refused (§6.3). */
  isComposing: () => boolean;
  /** Current (value, caret) snapshot, for stack pushes. */
  current: () => Snapshot;
  /** Apply a snapshot (rebuild + caret restore); firing change is the
   *  caller's job. */
  apply: (snap: Snapshot) => void;
}) {
  const undoStack: Snapshot[] = [];
  const redoStack: Snapshot[] = [];
  let unitOpen = false;
  let lastKind = '';
  let lastAt = 0;
  let initialized = false;

  /** Record an edit into an undo unit. A new unit opens when none is
   *  open, the kind differs, or the pause threshold elapsed. */
  function recordUnit(
    kind: string,
    prevValue: string,
    prevSel: Snapshot['sel'],
  ): void {
    if (!cfg || !initialized) return;
    const now = Date.now();
    if (!unitOpen || lastKind !== kind || now - lastAt > cfg.pauseMs) {
      undoStack.push({ value: prevValue, sel: prevSel });
      if (undoStack.length > cfg.limit) undoStack.shift();
      redoStack.length = 0;
    }
    unitOpen = true;
    lastKind = kind;
    lastAt = now;
  }

  function undo(): boolean {
    if (isComposing() || !cfg) return false;
    const snap = undoStack.pop();
    if (!snap) return false;
    redoStack.push(current());
    if (redoStack.length > cfg.limit) redoStack.shift(); // undos past the cap are not redoable
    unitOpen = false;
    lastKind = '';
    apply(snap);
    return true;
  }

  function redo(): boolean {
    if (isComposing() || !cfg) return false;
    const snap = redoStack.pop();
    if (!snap) return false;
    undoStack.push(current());
    if (undoStack.length > cfg.limit) undoStack.shift();
    unitOpen = false;
    lastKind = '';
    apply(snap);
    return true;
  }

  return {
    recordUnit,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    /** Initialization done — recordUnit starts filling the stack. */
    markInitialized: () => {
      initialized = true;
    },
    reset: () => {
      undoStack.length = 0;
      redoStack.length = 0;
      unitOpen = false;
    },
  };
}

export type History = ReturnType<typeof createHistory>;
