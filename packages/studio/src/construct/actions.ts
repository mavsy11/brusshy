import {
  BOOLEAN_LABELS,
  booleanOps,
  constructionTemplate,
  fillRegionOps,
  frameArrangement,
  mergeConstruction,
  mergeFaces,
  newId,
  primaryColor,
  regionToExactPath,
  setConstructionOps,
  subtractRegionOps,
  subtreeIds,
  type Arrangement,
  type BooleanOp,
  type ConstructionKind,
  type ConstructionT,
  type DocT,
  type Face,
  type FrameNodeT,
  type GuideT,
  type TemplateParams,
} from "@brusshy/core";
import { activeFrameId, dispatch, select, toast, useStore } from "../lib/store";
import { topSelection } from "../lib/actions";
import { textToPath } from "../lib/fonts";
import { setConstructionVisible, useConstruct } from "./state";

const get = useStore.getState;

export function frameNode(doc: DocT | null, id: string | null | undefined): FrameNodeT | null {
  const f = doc && id ? doc.nodes[id] : undefined;
  return f?.type === "frame" ? f : null;
}

/** Outlined text (local path data) for every text node under the given ids. */
export function textOutlinesFor(doc: DocT, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids)
    for (const sid of subtreeIds(doc, id)) {
      const n = doc.nodes[sid];
      if (n?.type === "text") {
        const d = textToPath(n);
        if (d) out[sid] = d;
      }
    }
  return out;
}

export function commitConstruction(frameId: string, c: ConstructionT | null, label: string) {
  dispatch(setConstructionOps(frameId, c), label);
}

const TEMPLATE_LABEL: Record<ConstructionKind, string> = {
  "circle-grid": "Circle grid",
  "square-grid": "Square grid",
  keylines: "Keylines",
  radial: "Radial grid",
  circles: "Guide circles",
  lines: "Guide lines",
  polygon: "Guide polygon",
};

/** Insert a construction set into the active version (added to what's there). */
export function addTemplate(kind: ConstructionKind, params: TemplateParams = {}) {
  const doc = get().doc;
  const f = frameNode(doc, activeFrameId(doc));
  if (!doc || !f) return;
  const add = constructionTemplate(kind, f, params);
  commitConstruction(f.id, mergeConstruction(f.construction, add), `Add ${TEMPLATE_LABEL[kind].toLowerCase()}`);
  setConstructionVisible(true);
  useConstruct.setState({ menu: false });
}

export function clearConstruction(frameId = activeFrameId(get().doc)) {
  const f = frameNode(get().doc, frameId);
  if (!f?.construction?.guides.length) return toast("This version has no construction");
  commitConstruction(f.id, null, "Clear construction");
  useConstruct.setState({ guide: null });
}

export function addGuide(frameId: string, g: GuideT, label: string) {
  const f = frameNode(get().doc, frameId);
  if (!f) return;
  commitConstruction(f.id, mergeConstruction(f.construction, { guides: [g] }), label);
}

export function replaceGuide(frameId: string, g: GuideT, label: string) {
  const f = frameNode(get().doc, frameId);
  if (!f?.construction) return;
  commitConstruction(f.id, { ...f.construction, guides: f.construction.guides.map((x) => (x.id === g.id ? g : x)) }, label);
}

export function deleteGuide(frameId: string, id: string) {
  const f = frameNode(get().doc, frameId);
  if (!f?.construction) return;
  const guides = f.construction.guides.filter((x) => x.id !== id);
  commitConstruction(f.id, guides.length ? { ...f.construction, guides } : null, "Delete guide");
  useConstruct.setState({ guide: null });
}

// ───────────────────────── arrangement (cached per doc + frame) ─────────────────────────

let cache: { doc: DocT; frame: string; arr: Arrangement } | null = null;

export function arrangementFor(doc: DocT, frameId: string): Arrangement {
  if (cache && cache.doc === doc && cache.frame === frameId) return cache.arr;
  const f = frameNode(doc, frameId)!;
  const arr = frameArrangement(doc, frameId, { textOutlines: textOutlinesFor(doc, f.children) });
  cache = { doc, frame: frameId, arr };
  return arr;
}

export const fillColor = (doc: DocT) => useConstruct.getState().fill ?? primaryColor(doc);

/** Fill faces as one new path (or merge into `into`, a region path made just before). */
export function fillFaces(frameId: string, faces: Face[], into?: string | null): string | null {
  const doc = get().doc;
  if (!doc || !faces.length) return null;
  const arr = arrangementFor(doc, frameId);
  const region = mergeFaces(arr, faces);
  const d = regionToExactPath(region, arr.prims);
  if (!d) return null;
  const prev = into ? doc.nodes[into] : undefined;
  if (prev?.type === "path" && prev.parent === frameId) {
    // Shift-click: union with the previous region (its outline is part of the arrangement already).
    const plan = booleanOps(
      {
        ...doc,
        nodes: { ...doc.nodes, __face: { ...prev, id: "__face", d, transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } } },
      } as DocT,
      [prev.id, "__face"],
      "union",
      { newId: () => newId("n") },
    );
    if (!plan.error) {
      const ops = plan.ops.filter((o) => !(o.op === "remove" && o.id === "__face"));
      const ids = dispatch(ops, "Merge region");
      if (ids?.[0]) return ids[0];
    }
  }
  const id = newId("n");
  const ok = dispatch([{ op: "add", node: { id, type: "path", name: "Region", d, style: { fill: fillColor(doc), stroke: null, strokeWidth: 0 } }, parent: frameId }], faces.length > 1 ? `Fill ${faces.length} regions` : "Fill region");
  return ok ? id : null;
}

/** ⌥-click: cut the face under the point out of the top-most filled layer there. */
export function subtractAt(frameId: string, q: [number, number]) {
  const doc = get().doc;
  if (!doc) return;
  const plan = subtractRegionOps(doc, frameId, q, { arrangement: arrangementFor(doc, frameId), textOutlines: textOutlinesFor(doc, frameNode(doc, frameId)?.children ?? []), newId: () => newId("n") });
  if (plan.error) return toast(plan.error);
  // Fresh arrangement next time (the target's outline was added to the cached primitives).
  cache = null;
  dispatch(plan.ops, "Subtract region");
  if (plan.ids[0]) select([plan.ids[0]]);
}

/** Fill the faces under points (frame coordinates) — used by the palette/tests. */
export function fillPoints(frameId: string, pts: [number, number][], merge = true) {
  const doc = get().doc;
  if (!doc) return;
  const plan = fillRegionOps(doc, frameId, pts, { merge, color: fillColor(doc), arrangement: arrangementFor(doc, frameId), newId: () => newId("n") });
  if (plan.error) return toast(plan.error);
  dispatch(plan.ops, "Fill region");
}

// ───────────────────────── booleans ─────────────────────────

/** Paint order index of every node (bottom = 0). */
function paintOrder(doc: DocT): Map<string, number> {
  const m = new Map<string, number>();
  let i = 0;
  const visit = (id: string) => {
    m.set(id, i++);
    const n = doc.nodes[id];
    if (n?.type === "group" || n?.type === "frame") n.children.forEach(visit);
  };
  doc.root.forEach(visit);
  return m;
}

/** Layers a boolean can use from the selection. */
export function booleanTargets(doc: DocT, selection: string[]): string[] {
  return topSelection(doc, selection).filter((id) => {
    const n = doc.nodes[id];
    return !!n && (n.type === "path" || n.type === "shape" || n.type === "text" || n.type === "group") && !n.locked;
  });
}

/**
 * Boolean on the selection, one undo step. Union/intersect/exclude keep the top-most layer's
 * name and style; subtract cuts everything above out of the bottom-most layer (which keeps its style).
 */
export function runBoolean(op: BooleanOp) {
  const doc = get().doc;
  if (!doc) return;
  const ids = booleanTargets(doc, get().selection);
  if (ids.length < (op === "divide" ? 1 : 2)) return toast(op === "divide" ? "Select the shapes to divide" : `Select two or more shapes to ${BOOLEAN_LABELS[op].toLowerCase()}`);
  const order = paintOrder(doc);
  const bottomFirst = [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const ordered = op === "subtract" || op === "divide" ? bottomFirst : [...bottomFirst].reverse();
  const plan = booleanOps(doc, ordered, op, { textOutlines: textOutlinesFor(doc, ids), newId: () => newId("n") });
  if (plan.error) return toast(plan.error, "error");
  const created = dispatch(plan.ops, BOOLEAN_LABELS[op]);
  if (created?.length) select(created);
}
