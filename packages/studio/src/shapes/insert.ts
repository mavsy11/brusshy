import { findFrame, listFrames, newId, type DocT, type FrameNodeT, type OpT } from "@brusshy/core";
import { cleanParams, getShape, isIconId, placeGeometry, renderShape, type ParamValues, type ShapeGeometry } from "@brusshy/shapes";
import { dispatch, select, setLive, toast, useStore } from "../lib/store";
import { toWorld } from "../canvas/camera";
import { useShapes } from "./state";

/** Inserting library shapes into the active version as editable paths (one undo step). */

export interface Target {
  frame: FrameNodeT;
  /** Centre in the frame's artboard coordinates. */
  x: number;
  y: number;
}

/** Current parameters for a shape (remembered per shape; icons use the panel's style toggle). */
export function paramsFor(id: string): ParamValues {
  const s = useShapes.getState();
  if (isIconId(id)) return { weight: s.iconWeight };
  return cleanParams(getShape(id)?.params, s.params[id]);
}

export function geometryFor(id: string, params = paramsFor(id)): ShapeGeometry {
  return renderShape(id, params, useShapes.getState().icons);
}

export function brandFill(doc: DocT): string {
  const c = doc.palette?.colors;
  return c?.find((x) => x.role === "primary")?.hex ?? c?.[0]?.hex ?? "#0b0c0e";
}

const canvasEl = () => document.querySelector<HTMLElement>(".pane-2d .canvas");

function frameAt(doc: DocT, w: [number, number]): FrameNodeT | null {
  const frames = listFrames(doc);
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (w[0] >= f.transform.x && w[0] <= f.transform.x + f.width && w[1] >= f.transform.y && w[1] <= f.transform.y + f.height) return f;
  }
  return null;
}

function activeFrame(doc: DocT): FrameNodeT | null {
  const { activeFrame: a } = useStore.getState();
  return findFrame(doc, a) ?? listFrames(doc)[0] ?? null;
}

/** Where a drop at a screen point lands (null when it isn't over the canvas). */
export function dropTarget(clientX: number, clientY: number): Target | null {
  const { doc, camera } = useStore.getState();
  const el = canvasEl();
  if (!doc || !el) return null;
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit || !el.contains(hit) || hit.closest("[data-ui]")) return null;
  const r = el.getBoundingClientRect();
  const w = toWorld(camera, clientX - r.left, clientY - r.top);
  const f = frameAt(doc, w) ?? activeFrame(doc);
  if (!f) return null;
  return { frame: f, x: w[0] - f.transform.x, y: w[1] - f.transform.y };
}

/** The middle of what's visible of the active version (its centre when it's off screen). */
export function viewTarget(): Target | null {
  const { doc, camera } = useStore.getState();
  if (!doc) return null;
  const f = activeFrame(doc);
  if (!f) return null;
  const el = canvasEl();
  if (el) {
    const r = el.getBoundingClientRect();
    const w = toWorld(camera, r.width / 2, r.height / 2);
    const x = w[0] - f.transform.x;
    const y = w[1] - f.transform.y;
    if (x > f.width * 0.15 && x < f.width * 0.85 && y > f.height * 0.15 && y < f.height * 0.85) return { frame: f, x, y };
  }
  return { frame: f, x: f.width / 2, y: f.height / 2 };
}

/** Insert a catalog shape. Returns the new node id. */
export function insertShape(id: string, at?: Target | null): string | null {
  const doc = useStore.getState().doc;
  if (!doc) return null;
  const target = at ?? viewTarget();
  if (!target) return null;
  let g: ShapeGeometry;
  try {
    g = geometryFor(id);
  } catch (e) {
    toast((e as Error).message, "error");
    return null;
  }
  const { frame } = target;
  const size = Math.max(8, Math.round(Math.min(frame.width, frame.height) * 0.4));
  const placed = placeGeometry(g, size);
  const fill = brandFill(doc);
  const name = g.name;
  const style = (fillRule: "nonzero" | "evenodd") => ({ fill, stroke: null, strokeWidth: 0, fillRule });
  const top = newId("n");
  const ops: OpT[] = [];
  const transform = { x: Math.round(target.x * 10) / 10, y: Math.round(target.y * 10) / 10 };
  if (placed.length === 1) ops.push({ op: "add", node: { id: top, type: "path", name, d: placed[0]!.d, transform, style: style(placed[0]!.fillRule) }, parent: frame.id });
  else {
    ops.push({ op: "add", node: { id: top, type: "group", name, transform, style: { fill: null } }, parent: frame.id });
    placed.forEach((p, i) => ops.push({ op: "add", node: { id: newId("n"), type: "path", name: p.name ?? `${name} ${i + 1}`, d: p.d, style: style(p.fillRule) }, parent: top }));
  }
  if (!dispatch(ops, `Insert ${name}`)) return null;
  select([top]);
  useShapes.setState({ linked: { nodeId: top, shapeId: id, size, d: placed.map((p) => p.d) }, picked: id });
  return top;
}

/** Path node ids of a linked insert, in part order. */
function linkedPaths(doc: DocT, nodeId: string): string[] | null {
  const n = doc.nodes[nodeId];
  if (!n) return null;
  if (n.type === "path") return [n.id];
  if (n.type === "group") return n.children.filter((c) => doc.nodes[c]?.type === "path");
  return null;
}

/**
 * Re-shape the last inserted shape with new parameters (only while the user hasn't edited its
 * geometry by hand). Live = preview during a slider drag; otherwise one undo step.
 */
export function reshapeLinked(shapeId: string, params: ParamValues, commit: boolean) {
  const { linked } = useShapes.getState();
  const { doc } = useStore.getState();
  if (!linked || linked.shapeId !== shapeId || !doc) return;
  const ids = linkedPaths(doc, linked.nodeId);
  const same = ids && ids.length === linked.d.length && ids.every((pid, i) => (doc.nodes[pid] as { d?: string }).d === linked.d[i]);
  if (!ids || !same) {
    useShapes.setState({ linked: null });
    return;
  }
  let placed;
  try {
    placed = placeGeometry(renderShape(shapeId, params, useShapes.getState().icons), linked.size);
  } catch {
    return;
  }
  if (placed.length !== ids.length) return;
  if (!commit) {
    ids.forEach((pid, i) => setLive(pid, { d: placed[i]!.d }));
    return;
  }
  ids.forEach((pid) => setLive(pid, null));
  const ops: OpT[] = ids.map((pid, i) => ({ op: "update", id: pid, set: { d: placed[i]!.d, style: { fillRule: placed[i]!.fillRule } } }));
  if (dispatch(ops, `Adjust ${getShape(shapeId)?.name ?? "shape"}`)) useShapes.setState({ linked: { ...linked, d: placed.map((p) => p.d) } });
}
