import type { AnnotationT, DocT, FrameNodeT, NodeT } from "./schema";
import { subtreeIds } from "./ops";
import { newId } from "./ids";

/** All frames (versions) in canvas order. */
export function listFrames(doc: DocT): FrameNodeT[] {
  return doc.root.map((id) => doc.nodes[id]).filter((n): n is FrameNodeT => n?.type === "frame");
}

/** The frame a node lives in (or the node itself if it is a frame). */
export function frameOf(doc: DocT, id: string | null | undefined): FrameNodeT | null {
  let n: NodeT | undefined = id ? doc.nodes[id] : undefined;
  while (n) {
    if (n.type === "frame") return n;
    n = n.parent ? doc.nodes[n.parent] : undefined;
  }
  return null;
}

/** Find a frame by id or by (case-insensitive) name. */
export function findFrame(doc: DocT, ref: string | null | undefined): FrameNodeT | null {
  if (!ref) return null;
  const byId = doc.nodes[ref];
  if (byId?.type === "frame") return byId;
  const r = ref.trim().toLowerCase();
  return listFrames(doc).find((f) => f.name.trim().toLowerCase() === r) ?? null;
}

/**
 * One frame seen as a standalone single-artboard document: its children become
 * top-level, its size/background/scene become the artboard/scene. Renderers,
 * exporters and the 3D view all work on this projection.
 */
export function frameDoc(doc: DocT, frameId: string): DocT {
  const f = doc.nodes[frameId];
  if (!f || f.type !== "frame") return doc;
  const nodes: Record<string, NodeT> = {};
  for (const id of subtreeIds(doc, frameId)) {
    if (id === frameId) continue;
    const n = doc.nodes[id]!;
    nodes[id] = n.parent === frameId ? ({ ...n, parent: null } as NodeT) : n;
  }
  const annotations: Record<string, AnnotationT> = {};
  for (const a of Object.values(doc.annotations)) if (a.frameId === frameId) annotations[a.id] = a;
  return {
    ...doc,
    name: listFrames(doc).length > 1 ? `${doc.name} ${f.name}`.trim() : doc.name,
    artboard: { width: f.width, height: f.height, background: f.background },
    scene: f.scene,
    root: [...f.children],
    nodes,
    annotations,
  };
}

/** Next free version name: V2, V3… */
export function nextVersionName(doc: DocT): string {
  const used = new Set(listFrames(doc).map((f) => f.name.trim().toUpperCase().replace(/\s+[A-H]$/, "")));
  for (let i = 1; ; i++) if (!used.has(`V${i}`)) return `V${i}`;
}

/** Canvas position for a new frame: to the right of the right-most one. */
export function nextFramePosition(doc: DocT, gap = 160): { x: number; y: number } {
  const frames = listFrames(doc);
  if (!frames.length) return { x: 0, y: 0 };
  const right = frames.reduce((a, f) => (f.transform.x + f.width > a.transform.x + a.width ? f : a));
  return { x: right.transform.x + right.width + gap, y: right.transform.y };
}

/**
 * Add ops that deep-copy a subtree with fresh ids (used to duplicate a frame as a new
 * version, or any layer). `patchRoot` overrides fields on the copied root.
 */
export function cloneSubtreeOps(
  doc: DocT,
  id: string,
  opts: { parent?: string | null; index?: number; patchRoot?: Record<string, unknown>; idFor?: (oldId: string) => string },
): { ops: import("./ops").OpT[]; rootId: string } {
  const all = subtreeIds(doc, id);
  const map = new Map<string, string>();
  for (const sid of all) map.set(sid, opts.idFor ? opts.idFor(sid) : newId(doc.nodes[sid]!.type === "frame" ? "f" : "n"));
  const ops: import("./ops").OpT[] = [];
  for (const sid of all) {
    const src = doc.nodes[sid]!;
    const isRoot = sid === id;
    const { id: _id, parent: _p, ...rest } = src as NodeT & { children?: string[] };
    delete (rest as { children?: string[] }).children;
    const node = { ...rest, id: map.get(sid)!, ...(isRoot ? opts.patchRoot : {}) };
    ops.push({
      op: "add",
      node: node as unknown as Record<string, unknown>,
      parent: isRoot ? (opts.parent !== undefined ? opts.parent : src.parent) : map.get(src.parent!)!,
      index: isRoot ? opts.index : undefined,
    });
  }
  return { ops, rootId: map.get(id)! };
}

/** Duplicate a frame (background, logo and 3D look) as the next version, placed to the right. */
export function duplicateFrameOps(doc: DocT, frameId: string, name?: string): { ops: import("./ops").OpT[]; rootId: string } {
  const pos = nextFramePosition(doc);
  const src = doc.nodes[frameId]!;
  return cloneSubtreeOps(doc, frameId, {
    parent: null,
    patchRoot: { name: name ?? nextVersionName(doc), transform: { ...src.transform, x: pos.x, y: pos.y } },
  });
}
