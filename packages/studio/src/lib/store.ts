import { create } from "zustand";
import { useMemo } from "react";
import {
  applyOps,
  findFrame,
  frameDoc,
  frameOf,
  listFrames,
  newId,
  type Timeline,
  type AgentStatus,
  type ChatState,
  type DocMeta,
  type DocT,
  type NodeT,
  type OpT,
  type ServerMsg,
  type ViewMode,
} from "@brusshy/core";
import { socket } from "./socket";

export type Tool =
  | "select"
  | "node"
  | "hand"
  | "rect"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "brush"
  | "comment"
  | "builder";

export interface Camera {
  /** Screen offset of the artboard origin, in CSS px. */
  x: number;
  y: number;
  zoom: number;
}

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "error" | "agent";
}

interface State {
  doc: DocT | null;
  docs: DocMeta[];
  canUndo: boolean;
  canRedo: boolean;
  agent: AgentStatus;
  connected: boolean;
  projectDir: string;
  version: string;

  selection: string[];
  /** The frame (version) the user is working in: split/3D/export and the AI target it. */
  activeFrame: string | null;
  /** Undo timeline for the History panel. */
  timeline: Timeline;
  hoverId: string | null;
  /** Ids the agent just touched (briefly highlighted). */
  flashIds: string[];
  /** Layers the AI just added → drawn in (id → stagger order). */
  fresh: Record<string, number>;
  /** Canvas chat with the user's AI. */
  chat: ChatState | null;
  tool: Tool;
  view: ViewMode;
  camera: Camera;
  /** Path being node-edited (node tool). */
  editingId: string | null;
  /** Selected anchors in the node editor, as "subpath:index" keys. */
  nodeSel: string[];
  /** Soft (proportional) selection for node edits: radius in the path's units, 0 = off. */
  softRadius: number;
  /** Text node whose content is being typed. */
  textEditId: string | null;
  brush: { size: number; color: string };
  openAnnotation: string | null;
  /** Draftsman guides dragged out of the rulers (artboard units; per document, kept in localStorage). */
  guides: { axis: "x" | "y"; at: number }[];
  showAnnotations: boolean;
  /** Millimetre-style rulers on the top/left edges (off by default: more room for the canvas). */
  showRulers: boolean;
  exportOpen: boolean;
  helpOpen: boolean;
  toasts: Toast[];
  /** In-flight local batches not yet confirmed by the daemon (for rebasing). */
  pending: { reqId: string; ops: OpT[] }[];
  /** Node patches applied live during a drag (not yet committed). */
  live: Record<string, Partial<NodeT>>;
}

export const useStore = create<State>(() => ({
  doc: null,
  docs: [],
  canUndo: false,
  canRedo: false,
  agent: { state: "idle", message: "", at: 0 },
  connected: false,
  projectDir: "",
  version: "",
  selection: [],
  activeFrame: null,
  timeline: { items: [], cursor: 0, offset: 0 },
  hoverId: null,
  flashIds: [],
  fresh: {},
  chat: null,
  tool: "select",
  view: "2d",
  camera: { x: 0, y: 0, zoom: 1 },
  editingId: null,
  nodeSel: [],
  softRadius: 0,
  textEditId: null,
  brush: { size: 6, color: "#0b0c0e" },
  openAnnotation: null,
  guides: [],
  showAnnotations: true,
  showRulers: readRulers(),
  exportOpen: false,
  helpOpen: false,
  toasts: [],
  pending: [],
  live: {},
}));

function readRulers(): boolean {
  try {
    return localStorage.getItem("brusshy:rulers") === "1";
  } catch {
    return false;
  }
}

export function toggleRulers() {
  const on = !useStore.getState().showRulers;
  useStore.setState({ showRulers: on });
  try {
    localStorage.setItem("brusshy:rulers", on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

const set = useStore.setState;
const get = useStore.getState;

/** Give new nodes/annotations ids up front so local and daemon state agree. */
function withIds(ops: OpT[]): OpT[] {
  return ops.map((o) => {
    if (o.op === "add" && !o.node.id) return { ...o, node: { ...o.node, id: newId("n") } };
    if (o.op === "annotate" && !o.annotation.id) return { ...o, annotation: { ...o.annotation, id: newId("a") } };
    return o;
  });
}

/** Apply ops optimistically and send them to the daemon. Returns created ids, or null on error. */
export function dispatch(ops: OpT[], label = "Edit"): string[] | null {
  const { doc } = get();
  if (!doc || ops.length === 0) return [];
  const withId = withIds(ops);
  try {
    const r = applyOps(doc, withId);
    const reqId = newId("r");
    set((s) => ({ doc: r.doc, pending: [...s.pending, { reqId, ops: withId }] }));
    socket.send({ t: "ops", ops: withId, label, reqId });
    return r.created;
  } catch (e) {
    toast((e as Error).message, "error");
    return null;
  }
}

export function undo() {
  socket.send({ t: "undo" });
}
export function redo() {
  socket.send({ t: "redo" });
}

export function select(ids: string[]) {
  const doc = get().doc;
  const f = doc && ids.length ? frameOf(doc, ids[0]) : null;
  set({ selection: ids, ...(f ? { activeFrame: f.id } : {}) });
  socket.send({ t: "select", ids, frame: f?.id ?? get().activeFrame });
}

export function setActiveFrame(id: string) {
  if (get().activeFrame === id) return;
  set({ activeFrame: id });
  socket.send({ t: "select", ids: get().selection, frame: id });
}

/** Active frame id, falling back to the first frame. */
export function activeFrameId(doc = get().doc): string | null {
  if (!doc) return null;
  return (findFrame(doc, get().activeFrame) ?? listFrames(doc)[0])?.id ?? null;
}

/** A frame (by id/name, default active) as a standalone single-artboard document. */
export function frameDocFor(frame?: string | null): DocT | null {
  const doc = get().doc;
  if (!doc) return null;
  const id = (frame ? findFrame(doc, frame)?.id : null) ?? activeFrameId(doc);
  return id ? frameDoc(doc, id) : doc;
}

/** React hook: the active frame projected as its own document (for 3D, export, previews). */
export function useFrameDoc(): DocT | null {
  const doc = useStore((s) => s.doc);
  const active = useStore((s) => s.activeFrame);
  return useMemo(() => {
    if (!doc) return null;
    const id = (findFrame(doc, active) ?? listFrames(doc)[0])?.id;
    return id ? frameDoc(doc, id) : doc;
  }, [doc, active]);
}

export function setTool(tool: Tool) {
  set({ tool, editingId: tool === "node" ? get().editingId : null, textEditId: null });
}

export function setView(view: ViewMode) {
  set({ view });
  socket.send({ t: "view", mode: view });
}

export function setLive(id: string, patch: Partial<NodeT> | null) {
  set((s) => {
    const live = { ...s.live };
    if (patch) live[id] = patch;
    else delete live[id];
    return { live };
  });
}

export function clearLive() {
  set({ live: {} });
}

export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = newId("t");
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === "error" ? 6000 : 3200);
}

/** Node with any live drag patch applied. */
export function liveNode(doc: DocT, id: string): NodeT | undefined {
  const n = doc.nodes[id];
  const p = get().live[id];
  return n && p ? ({ ...n, ...p } as NodeT) : n;
}

function rebase(server: DocT, pending: { ops: OpT[] }[]): DocT {
  let doc = server;
  for (const batch of pending) {
    try {
      doc = applyOps(doc, batch.ops).doc;
    } catch {
      /* the daemon rejected or superseded it */
    }
  }
  return doc;
}

socket.on((msg: ServerMsg) => {
  switch (msg.t) {
    case "hello": {
      const prev = get().doc;
      set({
        doc: msg.doc,
        docs: msg.docs,
        canUndo: msg.canUndo,
        canRedo: msg.canRedo,
        agent: msg.agent,
        projectDir: msg.projectDir,
        version: msg.version,
        timeline: msg.timeline ?? { items: [], cursor: 0, offset: 0 },
        pending: [],
        live: {},
      });
      if (prev?.id !== msg.doc.id) set({ selection: [], editingId: null, openAnnotation: null });
      return;
    }
    case "doc": {
      if (msg.author === "agent") markFresh(get().doc, msg.doc);
      const pending = msg.reqId ? get().pending.filter((p) => p.reqId !== msg.reqId) : get().pending;
      const doc = rebase(msg.doc, pending);
      const sel = get().selection.filter((id) => doc.nodes[id]);
      set({ doc, pending, canUndo: msg.canUndo, canRedo: msg.canRedo, selection: sel, timeline: msg.timeline ?? get().timeline });
      if (get().activeFrame && !doc.nodes[get().activeFrame!]) set({ activeFrame: listFrames(doc)[0]?.id ?? null });
      if (get().editingId && !doc.nodes[get().editingId!]) set({ editingId: null });
      return;
    }
    case "docs":
      set({ docs: msg.docs });
      return;
    case "chat":
      set({ chat: msg.chat });
      return;
    case "agent":
      set({ agent: msg.agent });
      return;
    case "focus":
      set({ flashIds: msg.ids });
      setTimeout(() => {
        if (get().flashIds === msg.ids) set({ flashIds: [] });
      }, 1400);
      return;
    case "ack":
      // The echo normally clears the batch already; the ack makes sure it never lingers.
      set((s) => ({ pending: s.pending.filter((p) => p.reqId !== msg.reqId) }));
      if (!msg.ok && msg.error) toast(msg.error, "error");
      return;
  }
});

socket.onStatus((connected) => set({ connected }));

let freshTimer: ReturnType<typeof setTimeout> | undefined;
/** New drawable layers from an AI edit get a short draw-in on the canvas. */
function markFresh(prev: DocT | null, next: DocT) {
  if (!prev || prev.id !== next.id) return;
  const ids = Object.keys(next.nodes).filter((id) => !prev.nodes[id] && next.nodes[id]!.type !== "frame" && next.nodes[id]!.type !== "group");
  if (!ids.length || ids.length > 400) return;
  set({ fresh: Object.fromEntries(ids.map((id, i) => [id, i / ids.length])) });
  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => set({ fresh: {} }), 2400);
}

const guidesKey = (docId: string) => `brusshy:guides:${docId}`;

export function setGuides(guides: State["guides"]) {
  set({ guides });
  const id = get().doc?.id;
  try {
    if (id) localStorage.setItem(guidesKey(id), JSON.stringify(guides));
  } catch {
    /* storage unavailable */
  }
}

useStore.subscribe((s, prev) => {
  if (s.doc?.id && s.doc.id !== prev.doc?.id) {
    let guides: State["guides"] = [];
    try {
      guides = JSON.parse(localStorage.getItem(guidesKey(s.doc.id)) ?? "[]");
    } catch {
      /* ignore */
    }
    set({ guides });
  }
});
