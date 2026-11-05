import {
  applyOps,
  docToSvg,
  duplicateFrameOps,
  frameOf,
  newId,
  shapeToPath,
  svgToOps,
  subtreeIds,
  worldMatrix,
  invert,
  apply,
  type DocT,
  type NodeT,
  type OpT,
} from "@brusshy/core";
import { activeFrameId, dispatch, select, toast, useStore } from "./store";
import { api } from "./socket";
import { textToPath } from "./fonts";
import { selectionBox, worldBox } from "./geom";
import { flipPatch, movePatch } from "./transform";

/** Editing commands shared by shortcuts, menus and panels. */

const get = () => useStore.getState();

/** Selected ids without descendants of other selected ids. */
export function topSelection(doc: DocT, ids = get().selection): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let p = doc.nodes[id]?.parent ?? null;
    while (p) {
      if (set.has(p)) return false;
      p = doc.nodes[p]?.parent ?? null;
    }
    return !!doc.nodes[id];
  });
}

function siblingsOf(doc: DocT, n: NodeT): string[] {
  if (!n.parent) return doc.root;
  const p = doc.nodes[n.parent];
  return p?.type === "group" ? p.children : doc.root;
}

export function deleteSelection() {
  const { doc } = get();
  if (!doc) return;
  const ids = topSelection(doc);
  if (!ids.length) return;
  dispatch(ids.map((id) => ({ op: "remove", id })), "Delete");
  select([]);
}

/** Deep-copy subtrees as add ops with fresh ids. */
function cloneOps(doc: DocT, ids: string[], offset: number, parentOverride?: string | null): { ops: OpT[]; roots: string[] } {
  const ops: OpT[] = [];
  const roots: string[] = [];
  const map = new Map<string, string>();
  for (const id of ids) {
    const n = doc.nodes[id]!;
    const all = subtreeIds(doc, id);
    for (const sid of all) map.set(sid, newId("n"));
    const sibs = siblingsOf(doc, n);
    for (const sid of all) {
      const src = doc.nodes[sid]!;
      const isRoot = sid === id;
      const { id: _id, parent: _p, ...rest } = src as NodeT & { children?: string[] };
      delete (rest as { children?: string[] }).children;
      const node = { ...rest, id: map.get(sid)!, transform: isRoot ? { ...src.transform, x: src.transform.x + offset, y: src.transform.y + offset } : src.transform };
      ops.push({
        op: "add",
        node: node as unknown as Record<string, unknown>,
        parent: isRoot ? (parentOverride !== undefined ? parentOverride : n.parent) : map.get(src.parent!)!,
        index: isRoot ? sibs.indexOf(id) + 1 + roots.length : undefined,
      });
    }
    roots.push(map.get(id)!);
  }
  return { ops, roots };
}

export function duplicateSelection(offset = 24) {
  const { doc } = get();
  if (!doc) return;
  const ids = topSelection(doc);
  if (!ids.length) return;
  // A selected version (frame) is duplicated whole — background, logo and 3D look — next to the others.
  const frames = ids.filter((id) => doc.nodes[id]?.type === "frame");
  if (frames.length) {
    let d = doc;
    const all: OpT[] = [];
    const roots: string[] = [];
    for (const id of frames) {
      const { ops, rootId } = duplicateFrameOps(d, id);
      all.push(...ops);
      roots.push(rootId);
      d = applyOps(d, ops).doc;
    }
    if (dispatch(all, frames.length > 1 ? "Duplicate versions" : "Duplicate version")) {
      select(roots);
      toast(`New version ${roots.map((r) => d.nodes[r]?.name).join(", ")} — your AI can work on it with frame="${d.nodes[roots[0]!]?.name}"`);
    }
    return;
  }
  const { ops, roots } = cloneOps(doc, ids, offset);
  if (dispatch(ops, "Duplicate")) select(roots);
}

/** ⌘A: everything in the active version. */
export function selectAllInFrame() {
  const { doc } = get();
  if (!doc) return;
  const fid = activeFrameId(doc);
  const f = fid ? doc.nodes[fid] : undefined;
  const ids = f?.type === "frame" ? f.children : doc.root;
  select(ids.filter((id) => !doc.nodes[id]?.locked));
}

let clipboard: { doc: DocT; ids: string[] } | null = null;

export function copySelection() {
  const { doc } = get();
  if (!doc) return;
  const ids = topSelection(doc);
  if (!ids.length) return;
  clipboard = { doc: structuredClone(doc), ids };
  // Also put SVG on the system clipboard so it pastes into other apps.
  void navigator.clipboard?.writeText?.(selectionSvg(doc, ids)).catch(() => {});
}

export function selectionSvg(doc: DocT, ids: string[]): string {
  return docToSvg({ ...doc, root: ids }, { textToPath, pretty: true });
}

export function pasteInternal(): boolean {
  const { doc } = get();
  if (!doc || !clipboard) return false;
  const src = clipboard.doc;
  const { ops, roots } = cloneOps(src, clipboard.ids.filter((id) => src.nodes[id]), 24, activeFrameId(doc));
  // Paste into the active version, on top of everything.
  const fixed = ops.map((o) => (o.op === "add" && roots.includes(String(o.node.id)) ? { ...o, index: undefined } : o));
  if (dispatch(fixed, "Paste")) select(roots);
  clipboard = { doc: src, ids: clipboard.ids.map((id) => id) };
  return true;
}

export function importSvgText(svg: string, frameId?: string | null) {
  try {
    const { ops, ids } = svgToOps(svg, { parent: frameId ?? activeFrameId() });
    if (!ops.length) return toast("Nothing drawable in that SVG", "error");
    if (dispatch(ops, "Paste SVG")) select(ids);
  } catch (e) {
    toast(`Could not read SVG: ${(e as Error).message}`, "error");
  }
}

/** Upload an image to brusshy/refs/ and add it as a tracing reference layer at the bottom. */
export async function addReferenceImage(file: File, at?: [number, number], frameId?: string | null) {
  const { doc } = get();
  if (!doc) return;
  const fid = frameId ?? activeFrameId(doc);
  const frame = fid ? doc.nodes[fid] : undefined;
  const area = frame?.type === "frame" ? { width: frame.width, height: frame.height } : doc.artboard;
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 });
    img.onerror = () => resolve({ w: 512, h: 512 });
    img.src = URL.createObjectURL(file);
  });
  try {
    const r = await api<{ src: string }>(`/api/refs?name=${encodeURIComponent(file.name || "reference.png")}`, { method: "POST", body: file });
    const fit = Math.min((area.width * 0.8) / dims.w, (area.height * 0.8) / dims.h, 1);
    const w = Math.round(dims.w * fit);
    const h = Math.round(dims.h * fit);
    const cx = at?.[0] ?? area.width / 2;
    const cy = at?.[1] ?? area.height / 2;
    const created = dispatch(
      [
        {
          op: "add",
          node: {
            type: "reference",
            name: file.name.replace(/\.[^.]+$/, "") || "Reference",
            src: r.src,
            width: w,
            height: h,
            transform: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) },
            style: { opacity: 0.45, fill: null },
          },
          parent: fid,
          index: 0,
        },
      ],
      "Add reference image",
    );
    if (created) select(created);
    toast("Reference added — trace over it. It is never exported.");
  } catch (e) {
    toast(`Upload failed: ${(e as Error).message}`, "error");
  }
}

export function groupSelection() {
  const { doc } = get();
  if (!doc) return;
  const ids = topSelection(doc);
  if (ids.length < 1) return;
  const first = doc.nodes[ids[0]!]!;
  const parent = first.parent;
  const sibs = siblingsOf(doc, first);
  const order = [...ids].sort((a, b) => sibs.indexOf(a) - sibs.indexOf(b));
  const index = Math.min(...order.map((id) => sibs.indexOf(id)).filter((i) => i >= 0));
  const gid = newId("n");
  // Children keep their world placement: only move ones that share the parent.
  const ops: OpT[] = [{ op: "add", node: { id: gid, type: "group", name: "Group", style: { fill: null } }, parent, index }];
  order.forEach((id, i) => ops.push({ op: "move", id, parent: gid, index: i }));
  if (dispatch(ops, "Group")) select([gid]);
}

export function ungroupSelection() {
  const { doc } = get();
  if (!doc) return;
  const ops: OpT[] = [];
  const out: string[] = [];
  for (const id of topSelection(doc)) {
    const g = doc.nodes[id];
    if (!g || g.type !== "group") continue;
    const sibs = siblingsOf(doc, g);
    let index = sibs.indexOf(id);
    const gt = g.transform;
    const identity = !gt.x && !gt.y && !gt.rotation && gt.scaleX === 1 && gt.scaleY === 1;
    for (const c of g.children) {
      ops.push({ op: "move", id: c, parent: g.parent, index: index++ });
      if (!identity) {
        // Bake the group's translation into children (rotation/scale groups keep it simple: translate only).
        const ct = doc.nodes[c]!.transform;
        ops.push({ op: "update", id: c, set: { transform: { x: ct.x + gt.x, y: ct.y + gt.y } } });
      }
      out.push(c);
    }
    ops.push({ op: "remove", id });
  }
  if (ops.length && dispatch(ops, "Ungroup")) select(out);
}

export function reorder(dir: "up" | "down" | "top" | "bottom") {
  const { doc } = get();
  if (!doc) return;
  const ops: OpT[] = [];
  for (const id of topSelection(doc)) {
    const n = doc.nodes[id]!;
    const sibs = siblingsOf(doc, n);
    const i = sibs.indexOf(id);
    const to = dir === "up" ? i + 1 : dir === "down" ? i - 1 : dir === "top" ? sibs.length - 1 : 0;
    if (to < 0 || to >= sibs.length || to === i) continue;
    ops.push({ op: "move", id, parent: n.parent, index: to });
  }
  if (ops.length) dispatch(ops, "Reorder");
}

export function nudge(dx: number, dy: number) {
  const { doc } = get();
  if (!doc) return;
  const ops: OpT[] = topSelection(doc)
    .filter((id) => !doc.nodes[id]!.locked)
    .map((id) => ({ op: "update", id, set: movePatch(doc, doc.nodes[id]!, dx, dy) as Record<string, unknown> }));
  if (ops.length) dispatch(ops, "Nudge");
}

export function flipSelection(axis: "x" | "y") {
  const { doc } = get();
  if (!doc) return;
  const ops: OpT[] = topSelection(doc).map((id) => ({ op: "update", id, set: flipPatch(doc, doc.nodes[id]!, axis) as Record<string, unknown> }));
  if (ops.length) dispatch(ops, axis === "x" ? "Flip horizontal" : "Flip vertical");
}

export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Align to the selection bounds, or to the artboard when one node is selected. */
export function alignSelection(a: Align) {
  const { doc } = get();
  if (!doc) return;
  const ids = topSelection(doc);
  if (!ids.length) return;
  // One layer aligns to its version's artboard; several align to their combined bounds.
  const f = ids.length === 1 ? frameOf(doc, doc.nodes[ids[0]!]!.parent) : null;
  const target = f ? { x: f.transform.x, y: f.transform.y, w: f.width, h: f.height } : selectionBox(doc, ids)!;
  const ops: OpT[] = [];
  for (const id of ids) {
    const n = doc.nodes[id]!;
    const b = worldBox(doc, n);
    let dx = 0;
    let dy = 0;
    if (a === "left") dx = target.x - b.x;
    if (a === "hcenter") dx = target.x + target.w / 2 - (b.x + b.w / 2);
    if (a === "right") dx = target.x + target.w - (b.x + b.w);
    if (a === "top") dy = target.y - b.y;
    if (a === "vcenter") dy = target.y + target.h / 2 - (b.y + b.h / 2);
    if (a === "bottom") dy = target.y + target.h - (b.y + b.h);
    if (dx || dy) ops.push({ op: "update", id, set: movePatch(doc, n, dx, dy) as Record<string, unknown> });
  }
  if (ops.length) dispatch(ops, "Align");
}

/** Replace a shape/text with an equivalent editable path (same id, same place in the tree). */
export function convertToPath(id: string): boolean {
  const { doc } = get();
  if (!doc) return false;
  const n = doc.nodes[id];
  if (!n) return false;
  if (n.type === "path") return true;
  let d: string | null = null;
  if (n.type === "shape") d = shapeToPath(n);
  if (n.type === "text") d = textToPath(n);
  if (!d) {
    toast("This layer can't be converted to a path yet", "error");
    return false;
  }
  const sibs = siblingsOf(doc, n);
  const ok = dispatch(
    [
      { op: "remove", id },
      {
        op: "add",
        node: { id, type: "path", name: n.name || (n.type === "text" ? n.text : n.type === "shape" ? n.shape : ""), d, transform: n.transform, style: n.style, extrude: n.extrude, visible: n.visible },
        parent: n.parent,
        index: sibs.indexOf(id),
      },
    ],
    "Convert to path",
  );
  return !!ok;
}

/** Convert a world point into a node's local coordinates. */
export function worldToLocal(doc: DocT, id: string, x: number, y: number): [number, number] {
  return apply(invert(worldMatrix(doc, id)), x, y);
}
