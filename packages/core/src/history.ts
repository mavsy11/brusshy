import type { OpT } from "./ops";

export type Author = "user" | "agent";

export interface HistoryEntry {
  ops: OpT[];
  inverse: OpT[];
  /** Set on undo: the ops that redo this entry exactly (ids included). */
  redo?: OpT[];
  author: Author;
  label: string;
  at: number;
}

/** Linear undo/redo stack shared by the user and the agent. */
export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(private limit = 300) {}

  push(entry: HistoryEntry) {
    if (entry.ops.length === 0) return;
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Returns the entry to undo; the caller applies `entry.inverse`. */
  undo(): HistoryEntry | undefined {
    const e = this.past.pop();
    if (e) this.future.push(e);
    return e;
  }

  /** Returns the entry to redo; the caller re-applies `entry.ops`. */
  redo(): HistoryEntry | undefined {
    const e = this.future.pop();
    if (e) this.past.push(e);
    return e;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Past + undone entries in chronological order; `cursor` = how many are applied. */
  timeline(limit = 120): { items: { label: string; author: Author; at: number; ops: number }[]; cursor: number; offset: number } {
    const all = [...this.past, ...[...this.future].reverse()];
    const offset = Math.max(0, all.length - limit);
    return {
      items: all.slice(offset).map(({ label, author, at, ops }) => ({ label, author, at, ops: ops.length })),
      cursor: this.past.length - offset,
      offset,
    };
  }

  get size() {
    return this.past.length;
  }

  toJSON() {
    return { past: this.past, future: this.future };
  }

  static from(raw: { past?: HistoryEntry[]; future?: HistoryEntry[] } | null, limit = 300): History {
    const h = new History(limit);
    if (raw) {
      h.past = raw.past ?? [];
      h.future = raw.future ?? [];
    }
    return h;
  }

  summary(n = 20) {
    return this.past.slice(-n).map(({ author, label, at, ops }) => ({ author, label, at, ops: ops.length }));
  }
}
