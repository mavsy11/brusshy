import { dispatch, setLive, useStore } from "./store";
import { parsePath, serializePath, type SubPath } from "./pathmodel";
import { cornerNodes, deformPathData, smoothNodes, type PivotKind } from "./deform";

/** Commands for the node editor bar and the Deform panel (all one undo step each). */

const get = () => useStore.getState();

function editing(): { id: string; subs: SubPath[] } | null {
  const { doc, editingId } = get();
  const n = doc && editingId ? doc.nodes[editingId] : undefined;
  return n?.type === "path" ? { id: n.id, subs: parsePath(n.d) } : null;
}

export function smoothSelectedNodes() {
  const e = editing();
  if (!e) return;
  const sel = new Set(get().nodeSel);
  dispatch([{ op: "update", id: e.id, set: { d: serializePath(smoothNodes(e.subs, sel)) } }], sel.size ? "Smooth nodes" : "Smooth path");
}

export function cornerSelectedNodes() {
  const e = editing();
  if (!e) return;
  const sel = new Set(get().nodeSel);
  dispatch([{ op: "update", id: e.id, set: { d: serializePath(cornerNodes(e.subs, sel)) } }], "Corner nodes");
}

export function selectAllNodes() {
  const e = editing();
  if (!e) return;
  useStore.setState({ nodeSel: e.subs.flatMap((s, si) => s.anchors.map((_, ai) => `${si}:${ai}`)) });
}

export const deformPath = deformPathData;

export function previewDeform(id: string, baseD: string, kind: "bend" | "twist", degrees: number, pivot: PivotKind) {
  setLive(id, degrees ? { d: deformPath(baseD, kind, degrees, pivot) } : null);
}

export function commitDeform(id: string, baseD: string, kind: "bend" | "twist", degrees: number, pivot: PivotKind) {
  setLive(id, null);
  if (!degrees) return;
  dispatch([{ op: "update", id, set: { d: deformPath(baseD, kind, degrees, pivot) } }], kind === "bend" ? `Bend ${Math.round(degrees)}°` : `Twist ${Math.round(degrees)}°`);
}
