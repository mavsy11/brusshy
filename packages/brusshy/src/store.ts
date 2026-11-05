import fs from "node:fs";
import path from "node:path";
import {
  applyOps,
  createDoc,
  History,
  isAnnotationOp,
  parseDoc,
  Op,
  type Author,
  type DocMeta,
  type DocT,
  type LogEntry,
  type NodeT,
  type OpT,
} from "@brusshy/core";
import { slugify, writeFileAtomic, type Layout } from "./paths";

interface Entry {
  doc: DocT;
  file: string;
  history: History;
  log: LogEntry[];
  saveTimer?: NodeJS.Timeout;
}

export interface ChangeEvent {
  doc: DocT;
  author: Author;
  label: string;
  /** Client request that caused the change (lets the sender drop its optimistic copy). */
  reqId?: string;
}

const LOG_LIMIT = 500;

const KEY_NAMES: Record<string, string> = {
  d: "shape (path)",
  transform: "position/size/rotation",
  style: "color/stroke/opacity",
  width: "size",
  height: "size",
  radius: "corner radius",
  sides: "sides",
  innerRatio: "star ratio",
  text: "text",
  fontFamily: "font",
  fontWeight: "font weight",
  fontSize: "font size",
  letterSpacing: "letter spacing",
  anchor: "text alignment",
  extrude: "3D depth/material",
  scene: "3D look",
  strokes: "sketch strokes",
  visible: "visibility",
  locked: "lock",
  aiLock: "AI lock",
  role: "reference role",
  name: "name",
  background: "background",
};

/** Turn ops into short human-readable lines (the agent reads these to respect user edits). */
export function describeOps(before: DocT, after: DocT, ops: OpT[], created: string[]): string[] {
  const label = (id: string) => {
    const n = after.nodes[id] ?? before.nodes[id];
    if (!n) return id;
    const nm = n.name || (n.type === "text" ? n.text : n.type === "shape" ? n.shape : n.type);
    return `"${nm}" (${id})`;
  };
  const out: string[] = [];
  let ci = 0;
  for (const op of ops) {
    switch (op.op) {
      case "add":
        out.push(`added ${String(op.node.type)} ${label(created[ci++] ?? String(op.node.id ?? ""))}`);
        break;
      case "update": {
        const keys = [...new Set(Object.keys(op.set).map((k) => KEY_NAMES[k] ?? k))];
        out.push(`${label(op.id)}: ${keys.join(", ")}`);
        break;
      }
      case "remove":
        out.push(`deleted ${label(op.id)}`);
        break;
      case "restore":
        out.push(`restored ${label(String(op.nodes[0]?.id ?? ""))}`);
        break;
      case "move":
        out.push(`moved ${label(op.id)} in the layer tree`);
        break;
      case "doc":
        out.push(`document: ${Object.keys(op.set).join(", ")}`);
        break;
      case "annotate":
        ci++;
        out.push(`left a note: "${String(op.annotation.note ?? "")}"`);
        break;
      case "annotation":
        out.push(`updated a note (${Object.keys(op.set).join(", ")})`);
        break;
      case "unannotate":
        out.push("deleted a note");
        break;
    }
  }
  return out;
}

/** Owns every logo document in the project: load, apply ops, undo/redo, persist. */
export class DocStore {
  private entries = new Map<string, Entry>();
  activeId = "";
  private seq = 0;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private docsListeners = new Set<() => void>();

  constructor(private l: Layout) {}

  private historyFile(file: string) {
    return file.replace(/\.brusshy\.json$/, ".history.json");
  }

  load() {
    for (const f of fs.readdirSync(this.l.root)) {
      if (!f.endsWith(".brusshy.json")) continue;
      const file = path.join(this.l.root, f);
      try {
        const doc = parseDoc(JSON.parse(fs.readFileSync(file, "utf8")));
        let history = new History();
        try {
          history = History.from(JSON.parse(fs.readFileSync(this.historyFile(file), "utf8")));
        } catch {
          /* no saved history yet */
        }
        this.entries.set(doc.id, { doc, file, history, log: [] });
      } catch (e) {
        console.error(`[brusshy] skipping ${f}: ${(e as Error).message}`);
      }
    }
    if (this.entries.size === 0) this.create("Untitled logo");
    const latest = [...this.entries.values()].sort((a, b) => b.doc.updatedAt - a.doc.updatedAt)[0]!;
    this.activeId = latest.doc.id;
  }

  onChange(fn: (e: ChangeEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onDocs(fn: () => void) {
    this.docsListeners.add(fn);
    return () => this.docsListeners.delete(fn);
  }

  private entry(id = this.activeId): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Document ${id} not found`);
    return e;
  }

  get active(): DocT {
    return this.entry().doc;
  }

  history(id = this.activeId) {
    return this.entry(id).history;
  }

  /** Activity log entries after `since` (a sequence number) for the active document. */
  logSince(since: number): { seq: number; entries: LogEntry[] } {
    return { seq: this.seq, entries: this.entry().log.filter((e) => e.seq > since) };
  }

  list(): DocMeta[] {
    return [...this.entries.values()]
      .map((e) => ({ id: e.doc.id, name: e.doc.name, file: path.basename(e.file), updatedAt: e.doc.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(name = "Untitled logo"): DocT {
    const doc = createDoc(name);
    const base = slugify(name);
    let file = path.join(this.l.root, `${base}.brusshy.json`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(this.l.root, `${base}-${i}.brusshy.json`);
    this.entries.set(doc.id, { doc, file, history: new History(), log: [] });
    this.saveNow(doc.id);
    this.activeId = doc.id;
    this.docsListeners.forEach((f) => f());
    return doc;
  }

  open(id: string) {
    this.entry(id);
    this.activeId = id;
    this.docsListeners.forEach((f) => f());
  }

  private record(e: Entry, author: Author, label: string, details: string[]) {
    e.log.push({ seq: ++this.seq, at: Date.now(), author, label, details });
    if (e.log.length > LOG_LIMIT) e.log.splice(0, e.log.length - LOG_LIMIT);
  }

  /** Apply ops to the active doc. Throws (and changes nothing) if any op is invalid. */
  apply(ops: unknown[], author: Author, label: string, reqId?: string): { doc: DocT; created: string[] } {
    const e = this.entry();
    const parsed = ops.map((o) => Op.parse(o));
    if (author === "agent") assertNotAiLocked(e.doc, parsed);
    const before = e.doc;
    const r = applyOps(e.doc, parsed);
    e.doc = r.doc;
    // Record the normalized ops (with generated ids) so redo recreates the same nodes.
    const designOps = parsed.filter((o) => !isAnnotationOp(o));
    if (designOps.length) {
      const normalized = normalizeAdds(parsed, r.created, r.doc).filter((o) => !isAnnotationOp(o));
      const inverse = r.inverse.filter((o) => !isAnnotationOp(o));
      e.history.push({ ops: normalized, inverse, author, label, at: Date.now() });
    }
    this.record(e, author, label, describeOps(before, r.doc, parsed, r.created));
    this.changed(e, author, label, reqId);
    return { doc: e.doc, created: r.created };
  }

  undo(author: Author = "user"): boolean {
    const e = this.entry();
    const h = e.history.undo();
    if (!h) return false;
    const r = applyOps(e.doc, h.inverse);
    h.redo = r.inverse;
    e.doc = r.doc;
    this.record(e, author, `Undo ${h.label}`, [`undid "${h.label}" (by ${h.author === "agent" ? "the AI" : "the user"})`]);
    this.changed(e, author, `Undo ${h.label}`);
    return true;
  }

  redo(author: Author = "user"): boolean {
    const e = this.entry();
    const h = e.history.redo();
    if (!h) return false;
    const r = applyOps(e.doc, h.redo ?? h.ops);
    h.inverse = r.inverse;
    e.doc = r.doc;
    this.record(e, author, `Redo ${h.label}`, [`redid "${h.label}"`]);
    this.changed(e, author, `Redo ${h.label}`);
    return true;
  }

  /** Jump to a point in the timeline: undo/redo until `index` steps are applied. */
  goto(index: number, author: Author = "user"): boolean {
    const e = this.entry();
    const target = Math.max(0, Math.floor(index));
    let moved = false;
    let guard = 1000;
    while (e.history.size > target && guard-- > 0) {
      const h = e.history.undo()!;
      const r = applyOps(e.doc, h.inverse);
      h.redo = r.inverse;
      e.doc = r.doc;
      moved = true;
    }
    while (e.history.size < target && e.history.canRedo && guard-- > 0) {
      const h = e.history.redo()!;
      const r = applyOps(e.doc, h.redo ?? h.ops);
      h.inverse = r.inverse;
      e.doc = r.doc;
      moved = true;
    }
    if (moved) {
      this.record(e, author, "Jump in history", [`went back/forward in history to step ${target}`]);
      this.changed(e, author, "Jump in history");
    }
    return moved;
  }

  private changed(e: Entry, author: Author, label: string, reqId?: string) {
    this.scheduleSave(e);
    this.listeners.forEach((f) => f({ doc: e.doc, author, label, reqId }));
  }

  private scheduleSave(e: Entry) {
    clearTimeout(e.saveTimer);
    e.saveTimer = setTimeout(() => this.saveNow(e.doc.id), 250);
  }

  saveNow(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    clearTimeout(e.saveTimer);
    writeFileAtomic(e.file, JSON.stringify(e.doc, null, 2));
    writeFileAtomic(this.historyFile(e.file), JSON.stringify(e.history));
  }

  flush() {
    for (const id of this.entries.keys()) this.saveNow(id);
  }
}

/** Give `add`/`annotate` ops the ids they were assigned, in creation order. */
function normalizeAdds(ops: OpT[], created: string[], doc: DocT): OpT[] {
  let i = 0;
  return ops.map((o) => {
    if (o.op === "add") {
      const id = created[i++]!;
      // Pin the parent the op defaulted to, so redo lands in the same frame.
      return { ...o, node: { ...o.node, id }, parent: o.parent !== undefined ? o.parent : (doc.nodes[id]?.parent ?? null) };
    }
    if (o.op === "annotate") {
      const id = created[i++];
      return { ...o, annotation: { ...o.annotation, id } };
    }
    return o;
  });
}

/** The user can lock parts for the AI (aiLock on a node or any ancestor): agent edits to them are refused. */
function assertNotAiLocked(doc: DocT, ops: OpT[]) {
  const locked = (id: string): string | null => {
    let n: NodeT | undefined = doc.nodes[id];
    while (n) {
      if (n.aiLock) return n.name || n.id;
      n = n.parent ? doc.nodes[n.parent] : undefined;
    }
    return null;
  };
  for (const op of ops) {
    const id = op.op === "update" || op.op === "remove" || op.op === "move" ? op.id : null;
    const hit = id ? locked(id) : null;
    if (hit) throw new Error(`"${hit}" is locked by the user — leave it unchanged and work around it.`);
    if ((op.op === "add" || op.op === "move") && op.parent) {
      const p = locked(op.parent);
      if (p && doc.nodes[op.parent]?.type !== "frame") throw new Error(`"${p}" is locked by the user — don't add inside it.`);
    }
  }
}
