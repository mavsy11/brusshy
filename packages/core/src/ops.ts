import { z } from "zod";
import {
  Annotation,
  Artboard,
  Brief,
  Doc,
  Node,
  Scene,
  type AnnotationT,
  type DocT,
  type NodeT,
} from "./schema";
import { newId } from "./ids";
import { BrandPalette } from "./palette-schema";
import { TypeSystem } from "./type-schema";
import { RefBoard } from "./board";

/**
 * Every change to a document is an Op. Ops are serializable, validated, and
 * invertible, so humans and agents share one undo history.
 */
export const Op = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    /** Node fields; id/defaults are filled in. Groups start empty — add children with `parent`. */
    node: z.record(z.string(), z.unknown()),
    parent: z.string().nullable().optional(),
    index: z.number().int().optional(),
  }),
  z.object({
    op: z.literal("update"),
    id: z.string(),
    /** Deep-merged into the node (objects merge, arrays/scalars replace). */
    set: z.record(z.string(), z.unknown()),
    /** Replace top-level keys instead of merging (used by inverses). */
    replace: z.boolean().optional(),
  }),
  z.object({ op: z.literal("remove"), id: z.string() }),
  z.object({
    op: z.literal("move"),
    id: z.string(),
    parent: z.string().nullable(),
    index: z.number().int().optional(),
  }),
  z.object({
    op: z.literal("restore"),
    /** Snapshot of a removed subtree; nodes[0] is the subtree root. */
    nodes: z.array(z.record(z.string(), z.unknown())),
    parent: z.string().nullable(),
    index: z.number().int(),
  }),
  z.object({
    op: z.literal("doc"),
    set: z.object({
      name: z.string().optional(),
      artboard: z.record(z.string(), z.unknown()).optional(),
      scene: z.record(z.string(), z.unknown()).optional(),
      /** Structured design brief (merged field by field; null clears it). */
      brief: z.record(z.string(), z.unknown()).nullable().optional(),
      /** Brand palette (colors/harmony/seed merged key by key; null clears it). */
      palette: z.record(z.string(), z.unknown()).nullable().optional(),
      /** Brand type system (heading/body/sample/note merged key by key; null clears it). */
      typeSystem: z.record(z.string(), z.unknown()).nullable().optional(),
      /** Reference board ({items}; items replace as a whole; null clears it). */
      board: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
    replace: z.boolean().optional(),
  }),
  z.object({ op: z.literal("annotate"), annotation: z.record(z.string(), z.unknown()) }),
  z.object({
    op: z.literal("annotation"),
    id: z.string(),
    set: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal("unannotate"), id: z.string() }),
]);

export type OpT = z.infer<typeof Op>;

export interface ApplyResult {
  doc: DocT;
  /** Ops that undo this batch, already in the order they must be applied. */
  inverse: OpT[];
  /** Ids of nodes created by `add` ops, in order. */
  created: string[];
}

export class OpError extends Error {}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    // Gradients are atomic paints: never merge a gradient into a color or vice versa.
    if (isPlainObject(v) && isPlainObject(cur) && !("stops" in v)) out[k] = deepMerge(cur, v);
    else out[k] = v;
  }
  return out as T;
}

function siblings(doc: DocT, parent: string | null): string[] {
  if (parent === null) return doc.root;
  const p = doc.nodes[parent];
  if (!p) throw new OpError(`Parent ${parent} not found`);
  if (p.type !== "group" && p.type !== "frame") throw new OpError(`Parent ${parent} is a ${p.type}, not a group or frame`);
  return p.children;
}

function insertAt(list: string[], id: string, index?: number) {
  const i = index === undefined || index < 0 || index > list.length ? list.length : index;
  list.splice(i, 0, id);
}

function detach(doc: DocT, id: string): { parent: string | null; index: number } {
  const node = doc.nodes[id]!;
  const list = siblings(doc, node.parent);
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1);
  return { parent: node.parent, index };
}

export function subtreeIds(doc: DocT, id: string): string[] {
  const out: string[] = [];
  const visit = (nid: string) => {
    const n = doc.nodes[nid];
    if (!n) return;
    out.push(nid);
    if (n.type === "group" || n.type === "frame") n.children.forEach(visit);
  };
  visit(id);
  return out;
}

function isAncestor(doc: DocT, maybeAncestor: string, id: string): boolean {
  let cur: string | null = doc.nodes[id]?.parent ?? null;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = doc.nodes[cur]?.parent ?? null;
  }
  return false;
}

function parseNode(raw: unknown): NodeT {
  const r = Node.safeParse(raw);
  if (!r.success) throw new OpError(`Invalid node: ${z.prettifyError(r.error)}`);
  return r.data;
}

function applyOne(doc: DocT, op: OpT, inverse: OpT[], created: string[]) {
  switch (op.op) {
    case "add": {
      // Ids end up in markup and CSS (exports, animation): letters, digits, _ and - only, or a fresh one.
      const id = typeof op.node.id === "string" && /^[\w-]{1,64}$/.test(op.node.id) ? op.node.id : newId(op.node.type === "frame" ? "f" : "n");
      if (doc.nodes[id]) throw new OpError(`Node ${id} already exists`);
      // Without an explicit parent, content goes into the first frame (frames themselves are top-level).
      const firstFrame = doc.root.find((r) => doc.nodes[r]?.type === "frame") ?? null;
      const parent = op.parent !== undefined ? op.parent : op.node.type === "frame" ? null : firstFrame;
      const raw: Record<string, unknown> = { ...op.node, id, parent };
      if (raw.type === "group" || raw.type === "frame") raw.children = [];
      if (raw.type === "frame" && parent !== null) throw new OpError("Frames must be top-level");
      const node = parseNode(raw);
      const list = siblings(doc, parent);
      doc.nodes[id] = node;
      insertAt(list, id, op.index);
      created.push(id);
      inverse.unshift({ op: "remove", id });
      return;
    }
    case "update": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      const { id: _i, type: _t, parent: _p, children: _c, ...set } = op.set as Record<string, unknown>;
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(set)) {
        const v = (node as Record<string, unknown>)[k];
        prev[k] = v === undefined ? null : structuredClone(v);
      }
      let next: Record<string, unknown>;
      if (op.replace) {
        next = { ...node };
        for (const [k, v] of Object.entries(set)) next[k] = v;
      } else {
        next = deepMerge(node as Record<string, unknown>, set);
      }
      // `extrude: null` removes the optional key.
      if (next.extrude === null) delete next.extrude;
      doc.nodes[op.id] = parseNode(next);
      inverse.unshift({ op: "update", id: op.id, set: prev, replace: true });
      return;
    }
    case "remove": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      const ids = subtreeIds(doc, op.id);
      const snapshot = ids.map((nid) => structuredClone(doc.nodes[nid]!) as Record<string, unknown>);
      const { parent, index } = detach(doc, op.id);
      for (const nid of ids) delete doc.nodes[nid];
      for (const a of Object.values(doc.annotations)) if (a.nodeId && ids.includes(a.nodeId)) a.nodeId = null;
      inverse.unshift({ op: "restore", nodes: snapshot, parent, index });
      return;
    }
    case "restore": {
      const nodes = op.nodes.map(parseNode);
      const rootId = nodes[0]?.id;
      if (!rootId) throw new OpError("restore: empty snapshot");
      for (const n of nodes) {
        if (doc.nodes[n.id]) throw new OpError(`Node ${n.id} already exists`);
        doc.nodes[n.id] = n;
      }
      doc.nodes[rootId]!.parent = op.parent;
      insertAt(siblings(doc, op.parent), rootId, op.index);
      inverse.unshift({ op: "remove", id: rootId });
      return;
    }
    case "move": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`Node ${op.id} not found`);
      if (op.parent === op.id || (op.parent && isAncestor(doc, op.id, op.parent)))
        throw new OpError("Cannot move a node into itself");
      if (node.type === "frame" && op.parent !== null) throw new OpError("Frames must be top-level");
      const from = detach(doc, op.id);
      node.parent = op.parent;
      insertAt(siblings(doc, op.parent), op.id, op.index);
      inverse.unshift({ op: "move", id: op.id, parent: from.parent, index: from.index });
      return;
    }
    case "doc": {
      const prev: OpT & { op: "doc" } = { op: "doc", set: {}, replace: true };
      if (op.set.name !== undefined) {
        prev.set.name = doc.name;
        doc.name = op.set.name;
      }
      if (op.set.artboard) {
        prev.set.artboard = structuredClone(doc.artboard);
        const next = op.replace ? op.set.artboard : deepMerge(doc.artboard, op.set.artboard);
        doc.artboard = Artboard.parse(next);
      }
      if (op.set.scene) {
        prev.set.scene = structuredClone(doc.scene);
        const next = op.replace ? op.set.scene : deepMerge(doc.scene, op.set.scene);
        doc.scene = Scene.parse(next);
      }
      if (op.set.brief !== undefined) {
        prev.set.brief = doc.brief ? structuredClone(doc.brief) : null;
        if (op.set.brief === null) delete doc.brief;
        else doc.brief = Brief.parse(op.replace || !doc.brief ? op.set.brief : { ...doc.brief, ...op.set.brief });
      }
      if (op.set.palette !== undefined) {
        prev.set.palette = doc.palette ? structuredClone(doc.palette) : null;
        if (op.set.palette === null) delete doc.palette;
        else doc.palette = BrandPalette.parse(op.replace || !doc.palette ? op.set.palette : { ...doc.palette, ...op.set.palette });
      }
      if (op.set.typeSystem !== undefined) {
        prev.set.typeSystem = doc.typeSystem ? structuredClone(doc.typeSystem) : null;
        if (op.set.typeSystem === null) delete doc.typeSystem;
        else doc.typeSystem = TypeSystem.parse(op.replace || !doc.typeSystem ? op.set.typeSystem : { ...doc.typeSystem, ...op.set.typeSystem });
      }
      if (op.set.board !== undefined) {
        prev.set.board = doc.board ? structuredClone(doc.board) : null;
        if (op.set.board === null) delete doc.board;
        else doc.board = RefBoard.parse(op.replace || !doc.board ? op.set.board : { ...doc.board, ...op.set.board });
      }
      inverse.unshift(prev);
      return;
    }
    case "annotate": {
      const now = Date.now();
      const a = Annotation.parse({
        id: newId("a"),
        createdAt: now,
        updatedAt: now,
        ...op.annotation,
      });
      doc.annotations[a.id] = a;
      created.push(a.id);
      inverse.unshift({ op: "unannotate", id: a.id });
      return;
    }
    case "annotation": {
      const a = doc.annotations[op.id];
      if (!a) throw new OpError(`Annotation ${op.id} not found`);
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(op.set)) prev[k] = (a as Record<string, unknown>)[k];
      doc.annotations[op.id] = Annotation.parse({ ...a, ...op.set, id: a.id, updatedAt: Date.now() });
      inverse.unshift({ op: "annotation", id: op.id, set: prev });
      return;
    }
    case "unannotate": {
      const a = doc.annotations[op.id];
      if (!a) throw new OpError(`Annotation ${op.id} not found`);
      delete doc.annotations[op.id];
      inverse.unshift({ op: "annotate", annotation: a as unknown as Record<string, unknown> });
      return;
    }
  }
}

/** Apply ops atomically: either all succeed and a new doc is returned, or it throws and nothing changes. */
export function applyOps(doc: DocT, ops: unknown[]): ApplyResult {
  const next = structuredClone(doc);
  const inverse: OpT[] = [];
  const created: string[] = [];
  ops.forEach((raw, i) => {
    const parsed = Op.safeParse(raw);
    if (!parsed.success) throw new OpError(`Op #${i}: ${z.prettifyError(parsed.error)}`);
    try {
      applyOne(next, parsed.data, inverse, created);
    } catch (e) {
      throw new OpError(`Op #${i} (${parsed.data.op}): ${(e as Error).message}`);
    }
  });
  next.updatedAt = Date.now();
  return { doc: next, inverse, created };
}

/** Annotation ops are conversation, not design: they stay out of undo history. */
export const isAnnotationOp = (op: OpT) =>
  op.op === "annotate" || op.op === "annotation" || op.op === "unannotate";

export function createDoc(name = "Untitled logo", init: Partial<DocT> = {}): DocT {
  const now = Date.now();
  return withFrames(Doc.parse({ id: newId("d"), name, createdAt: now, updatedAt: now, ...init }));
}

export function parseDoc(raw: unknown): DocT {
  return withFrames(Doc.parse(raw));
}

/**
 * Every document has at least one frame (version). Older single-artboard
 * documents are wrapped into a frame "V1" built from their artboard and scene;
 * their annotations move into it.
 */
export function withFrames(doc: DocT): DocT {
  const loose = doc.root.filter((id) => doc.nodes[id] && doc.nodes[id]!.type !== "frame");
  const hasFrame = doc.root.some((id) => doc.nodes[id]?.type === "frame");
  if (hasFrame && loose.length === 0) return doc;
  const out = structuredClone(doc);
  let frameId = out.root.find((id) => out.nodes[id]?.type === "frame");
  if (!frameId) {
    frameId = newId("f");
    out.nodes[frameId] = Node.parse({
      id: frameId,
      type: "frame",
      name: "V1",
      width: doc.artboard.width,
      height: doc.artboard.height,
      background: doc.artboard.background,
      scene: doc.scene,
      style: { fill: null },
    });
    out.root.unshift(frameId);
  }
  const frame = out.nodes[frameId] as Extract<NodeT, { type: "frame" }>;
  for (const id of loose) {
    out.nodes[id]!.parent = frameId;
    frame.children.push(id);
  }
  out.root = out.root.filter((id) => !loose.includes(id));
  for (const a of Object.values(out.annotations)) if (!a.frameId) a.frameId = frameId;
  return out;
}

export type { AnnotationT };
