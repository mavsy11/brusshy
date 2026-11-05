import type { DocT, GroupNodeT, NodeT, TextNodeT, TransformT } from "./schema";
import type { OpT } from "./ops";
import { apply, invert, multiply, shapeToPath, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { mappedBounds } from "./warp";
import { cloneSubtreeOps, frameOf } from "./frames";
import { newId } from "./ids";
import { applyOps, subtreeIds } from "./ops";
import { booleanOps } from "./boolean";
import { RepeatRecipe, type MirrorAxis, type PivotMode, type RepeatMode, type RepeatRecipeT } from "./repeat-schema";

/**
 * Exact repeats: radial (N copies rotated about a pivot), mirror (across a vertical and/or
 * horizontal line) and grid arrays. The result is one group named like "Petal ×8" holding the
 * source unit plus its copies; the group keeps the recipe (GroupNode.repeat), so editing the
 * source and calling updateRepeatOps rebuilds the copies. Every copy is a plain editable layer
 * whose transform is the source's composed with one similarity — no eyeballing, no drift.
 */

export interface RBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RepeatError extends Error {}

/**
 * A similarity M = translate · rotate(rot) · k · F, with F = identity, a flip of x
 * (diag(-1, 1)) or a flip of y (diag(1, -1)). Keeping the factors lets copies get exact
 * translate/rotate/scale transforms instead of a decomposed matrix.
 */
export interface Sim {
  m: Mat;
  rot: number;
  k: number;
  flip: "none" | "x" | "y";
}

const ID_SIM: Sim = { m: IDENTITY, rot: 0, k: 1, flip: "none" };
const RAD = Math.PI / 180;

function linear(rot: number, k: number, flip: Sim["flip"]): [number, number, number, number] {
  const c = Math.cos(rot * RAD) * k;
  const s = Math.sin(rot * RAD) * k;
  const fx = flip === "x" ? -1 : 1;
  const fy = flip === "y" ? -1 : 1;
  // R(rot)·k·diag(fx, fy): columns scaled by fx / fy.
  return [c * fx, s * fx, -s * fy, c * fy];
}

/** The similarity that is `linear(rot,k,flip)` about the fixed point p. */
function simAbout(p: [number, number], rot: number, k: number, flip: Sim["flip"]): Sim {
  const [a, b, c, d] = linear(rot, k, flip);
  return { m: [a, b, c, d, p[0] - (a * p[0] + c * p[1]), p[1] - (b * p[0] + d * p[1])], rot, k, flip };
}

export const rotateAbout = (p: [number, number], deg: number): Sim => simAbout(p, deg, 1, "none");
export const scaleAbout = (p: [number, number], k: number): Sim => simAbout(p, 0, k, "none");
export const translateSim = (dx: number, dy: number): Sim => ({ m: [1, 0, 0, 1, dx, dy], rot: 0, k: 1, flip: "none" });

/** Reflection across the line through p at `deg` degrees (0 = horizontal line, 90 = vertical). */
export function reflectAcross(p: [number, number], deg: number): Sim {
  const n = ((deg % 180) + 180) % 180;
  if (Math.abs(n - 90) < 1e-9) return simAbout(p, 0, 1, "x");
  if (Math.abs(n) < 1e-9) return simAbout(p, 0, 1, "y");
  return simAbout(p, 2 * n, 1, "y");
}

/** A·B (apply B first). */
export function composeSim(A: Sim, B: Sim): Sim {
  let rot = A.rot + (A.flip === "none" ? B.rot : -B.rot);
  let flip: Sim["flip"];
  if (A.flip === "none") flip = B.flip;
  else if (B.flip === "none") flip = A.flip;
  else if (A.flip === B.flip) flip = "none";
  else {
    // diag(-1,1)·diag(1,-1) = rotate(180)
    flip = "none";
    rot += 180;
  }
  return { m: multiply(A.m, B.m), rot, k: A.k * B.k, flip };
}

const r6 = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};
const normDeg = (d: number) => {
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return r6(x);
};

/** A node transform after the similarity (exact: similarities keep translate/rotate/scale form). */
export function applySimToTransform(s: Sim, t: TransformT): TransformT {
  const [x, y] = apply(s.m, t.x, t.y);
  const rotation = normDeg(s.rot + (s.flip === "none" ? t.rotation : -t.rotation));
  return {
    x: r6(x),
    y: r6(y),
    rotation,
    scaleX: r6(s.k * (s.flip === "x" ? -1 : 1) * t.scaleX),
    scaleY: r6(s.k * (s.flip === "y" ? -1 : 1) * t.scaleY),
  };
}

// ---------- bounds ----------

export interface RepeatGeomOptions {
  /** Outline text exactly (the studio passes its font engine); otherwise text bounds are estimated. */
  textToPath?: (n: TextNodeT) => string | null;
}

const boxFromPts = (pts: [number, number][]): RBox | null => {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const unionBox = (bs: (RBox | null)[]): RBox | null =>
  boxFromPts(bs.flatMap((b) => (b ? ([[b.x, b.y], [b.x + b.w, b.y + b.h]] as [number, number][]) : [])));
const pad = (b: RBox | null, p: number): RBox | null => (b && p > 0 ? { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p } : b);
const rectIn = (M: Mat, x: number, y: number, w: number, h: number) =>
  boxFromPts(([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][]).map(([a, b]) => apply(M, a, b)));

/** Ink bounds of a node (and its subtree) expressed in the space of `spaceId` (a group or frame; null = canvas). */
export function boundsIn(doc: DocT, id: string, spaceId: string | null, o: RepeatGeomOptions = {}): RBox | null {
  const inv = spaceId ? invert(worldMatrix(doc, spaceId)) : IDENTITY;
  const visit = (nid: string, top: boolean): RBox | null => {
    const n = doc.nodes[nid];
    if (!n || (!top && !n.visible)) return null;
    const M = multiply(inv, worldMatrix(doc, nid));
    const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    const strokePad = n.style.stroke !== null && n.style.strokeWidth > 0 ? (n.style.strokeWidth / 2) * scale : 0;
    switch (n.type) {
      case "path":
        return pad(mappedBounds(n.d, M), strokePad);
      case "shape":
        return pad(mappedBounds(shapeToPath(n), M), strokePad);
      case "text": {
        const d = o.textToPath?.(n);
        if (d) {
          const b = mappedBounds(d, M);
          if (b && b.w > 0) return pad(b, strokePad);
        }
        const w = n.text.length * n.fontSize * 0.56 + Math.max(0, n.text.length - 1) * n.letterSpacing;
        const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
        return rectIn(M, x, -n.fontSize * 0.74, w, n.fontSize * 0.98);
      }
      case "reference":
        return rectIn(M, 0, 0, n.width, n.height);
      case "sketch": {
        const pts: [number, number][] = [];
        let p = 0;
        for (const s of n.strokes) {
          p = Math.max(p, s.size / 2);
          for (const q of s.points) pts.push(apply(M, q[0], q[1]));
        }
        return pad(boxFromPts(pts), p * scale);
      }
      case "group":
        return unionBox(n.children.map((c) => visit(c, false)));
      case "frame":
        return null;
    }
  };
  return visit(id, true);
}

// ---------- instances ----------

/** Similarities for every instance (index 0 = the source itself = identity). `box` = source bounds in the group's space. */
export function repeatInstances(r: RepeatRecipeT, box: RBox): Sim[] {
  const p = r.pivot;
  const c: [number, number] = [box.x + box.w / 2, box.y + box.h / 2];
  if (r.mode === "mirror") {
    const v = reflectAcross(p, 90);
    const h = reflectAcross(p, 0);
    if (r.axis === "vertical") return [ID_SIM, v];
    if (r.axis === "horizontal") return [ID_SIM, h];
    return [ID_SIM, v, h, rotateAbout(p, 180)];
  }
  if (r.mode === "grid") {
    const cols = Math.max(1, r.count);
    const rows = Math.max(1, r.rows);
    const sx = box.w + r.gapX;
    const sy = box.h + r.gapY;
    const out: Sim[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push(i === 0 && j === 0 ? ID_SIM : translateSim(i * sx, j * sy));
    return out;
  }
  // radial
  const n = Math.max(1, r.count);
  const full = Math.abs(r.angle) >= 360 - 1e-9;
  const step = n === 1 ? 0 : full ? r.angle / n : r.angle / (n - 1);
  // Alternate copies shrink toward the side of the unit that faces the centre.
  const anchor: [number, number] = [Math.min(Math.max(p[0], box.x), box.x + box.w), Math.min(Math.max(p[1], box.y), box.y + box.h)];
  const radial = Math.hypot(c[0] - p[0], c[1] - p[1]) > 1e-6 ? (Math.atan2(c[1] - p[1], c[0] - p[0]) * 180) / Math.PI : 90;
  const out: Sim[] = [];
  for (let i = 0; i < n; i++) {
    let base: Sim = ID_SIM;
    if (i % 2 === 1 && r.altScale !== 1) base = composeSim(scaleAbout(anchor, r.altScale), base);
    if (i % 2 === 1 && r.altMirror) base = composeSim(reflectAcross(p, radial), base);
    const phi = i * step;
    if (r.orient) out.push(composeSim(rotateAbout(p, phi), base));
    else {
      const [x, y] = apply(rotateAbout(p, phi).m, c[0], c[1]);
      out.push(composeSim(translateSim(x - c[0], y - c[1]), base));
    }
  }
  return out;
}

// ---------- ops ----------

export interface RepeatOptions {
  mode: RepeatMode;
  /** Radial: instances including the source (default 8). Grid: columns (default 3). */
  count?: number;
  /** Grid: rows (default 1). */
  rows?: number;
  /** Radial sweep in degrees (default 360). */
  angle?: number;
  /** Centre for radial/mirror: the selection's centre, the artboard's centre, or a point in artboard coordinates. */
  pivot?: PivotMode | { x: number; y: number };
  axis?: MirrorAxis;
  /** Grid: gap between copies (both directions unless gapY is given). */
  gap?: number;
  gapY?: number;
  altScale?: number;
  altMirror?: boolean;
  orient?: boolean;
  /** Union the source and its copies into one shape (the source stays, hidden, so Update still works). */
  merge?: boolean;
  /** Group name (default: "<unit> ×N"). */
  name?: string;
}

export interface RepeatResult {
  ops: OpT[];
  groupId: string;
  sourceId: string;
  recipe: RepeatRecipeT;
  /** Generated copies (instances minus the source). */
  copies: number;
  /** History label, e.g. "Radial repeat ×8". */
  label: string;
  /** True when an existing repeat group was rebuilt. */
  updated: boolean;
}

const TYPE_NAMES: Record<string, string> = { path: "Shape", shape: "Shape", text: "Text", group: "Group", sketch: "Sketch", reference: "Image" };
const unitName = (n: NodeT) => n.name.trim() || (n.type === "shape" ? n.shape[0]!.toUpperCase() + n.shape.slice(1) : TYPE_NAMES[n.type] ?? "Unit");

export function repeatInstanceCount(r: Pick<RepeatRecipeT, "mode" | "count" | "rows" | "axis">): number {
  if (r.mode === "mirror") return r.axis === "both" ? 4 : 2;
  if (r.mode === "grid") return Math.max(1, r.count) * Math.max(1, r.rows);
  return Math.max(1, r.count);
}

/** Automatic group name for a recipe ("Petal ×8", "Wing · mirrored", "Dot 4×3"). */
export function repeatName(r: RepeatRecipeT, unit: string): string {
  if (r.mode === "mirror") return `${unit} · ${r.axis === "both" ? "4-way mirror" : "mirrored"}`;
  if (r.mode === "grid") return `${unit} ${r.count}×${r.rows}`;
  return `${unit} ×${r.count}`;
}

/** One line for UIs and tool results ("Radial ×8 · 360° · about the artboard centre"). */
export function describeRepeat(r: RepeatRecipeT): string {
  return describeRecipe(r) + (r.merged ? " · merged into one shape" : "");
}

function describeRecipe(r: RepeatRecipeT): string {
  const where = r.pivotMode === "selection" ? "the unit's centre" : r.pivotMode === "artboard" ? "the artboard centre" : `(${Math.round(r.pivot[0])}, ${Math.round(r.pivot[1])})`;
  if (r.mode === "mirror") return `Mirror ${r.axis === "both" ? "both axes" : r.axis === "vertical" ? "left ↔ right" : "top ↕ bottom"} · through ${where}`;
  if (r.mode === "grid") return `Grid ${r.count}×${r.rows} · gap ${r6(r.gapX)}${r.gapY !== r.gapX ? ` × ${r6(r.gapY)}` : ""}`;
  const extras = [r.altScale !== 1 ? `alternate ${Math.round(r.altScale * 100)}%` : "", r.altMirror ? "alternate mirrored" : "", r.orient ? "" : "upright"].filter(Boolean);
  return `Radial ×${r.count} · ${r6(r.angle)}° · about ${where}${extras.length ? ` · ${extras.join(", ")}` : ""}`;
}

/** The repeat group a node belongs to: the group itself, or the group whose source (or copy) it is. */
export function repeatGroupOf(doc: DocT, id: string | null | undefined): GroupNodeT | null {
  const n = id ? doc.nodes[id] : undefined;
  if (!n) return null;
  if (n.type === "group" && n.repeat) return n;
  const p = n.parent ? doc.nodes[n.parent] : undefined;
  return p?.type === "group" && p.repeat ? p : null;
}

/** A point in artboard (frame-local) coordinates → the space of `spaceId`. */
function fromArtboard(doc: DocT, spaceId: string, x: number, y: number): [number, number] {
  const f = frameOf(doc, spaceId);
  const toCanvas = f ? worldMatrix(doc, f.id) : IDENTITY;
  const m = multiply(invert(worldMatrix(doc, spaceId)), toCanvas);
  const [px, py] = apply(m, x, y);
  return [r6(px), r6(py)];
}

function resolvePivot(doc: DocT, spaceId: string, pivot: RepeatOptions["pivot"], box: RBox, mode: RepeatMode): { point: [number, number]; mode: PivotMode } {
  const want = pivot ?? (mode === "grid" ? "selection" : "artboard");
  if (typeof want === "object") return { point: fromArtboard(doc, spaceId, want.x, want.y), mode: "point" };
  if (want === "artboard") {
    const f = frameOf(doc, spaceId);
    if (f) return { point: fromArtboard(doc, spaceId, f.width / 2, f.height / 2), mode: "artboard" };
  }
  return { point: [r6(box.x + box.w / 2), r6(box.y + box.h / 2)], mode: "selection" };
}

function recipeFrom(o: Partial<RepeatOptions>, base: Partial<RepeatRecipeT>): Partial<RepeatRecipeT> {
  const out: Partial<RepeatRecipeT> = { ...base };
  if (o.mode) out.mode = o.mode;
  if (o.count !== undefined) out.count = Math.round(o.count);
  if (o.rows !== undefined) out.rows = Math.round(o.rows);
  if (o.angle !== undefined) out.angle = o.angle;
  if (o.axis) out.axis = o.axis;
  if (o.gap !== undefined) {
    out.gapX = o.gap;
    if (o.gapY === undefined) out.gapY = o.gap;
  }
  if (o.gapY !== undefined) out.gapY = o.gapY;
  if (o.altScale !== undefined) out.altScale = o.altScale;
  if (o.altMirror !== undefined) out.altMirror = o.altMirror;
  if (o.orient !== undefined) out.orient = o.orient;
  if (o.merge !== undefined) out.merged = o.merge;
  return out;
}

const DEFAULT_COUNT: Record<RepeatMode, number> = { radial: 8, mirror: 2, grid: 3 };

/** Add ops for the copies of `sourceId` inside group `groupId`. */
function copyOps(doc: DocT, groupId: string, sourceId: string, recipe: RepeatRecipeT, box: RBox, unit: string): OpT[] {
  const src = doc.nodes[sourceId]!;
  const sims = repeatInstances(recipe, box);
  const ops: OpT[] = [];
  sims.forEach((s, i) => {
    if (i === 0) return;
    const r = cloneSubtreeOps(doc, sourceId, { parent: groupId, patchRoot: { name: `${unit} ${i + 1}`, transform: applySimToTransform(s, src.transform), visible: true } });
    ops.push(...r.ops);
  });
  return ops;
}

/**
 * Repeat `ids` (siblings) as a new repeat group, one undo step. Passing a repeat group — or
 * its source — rebuilds that group instead (with any options given).
 */
export function repeatOps(doc: DocT, ids: string[], o: RepeatOptions, g: RepeatGeomOptions = {}): RepeatResult {
  const uniq = [...new Set(ids)].filter((id) => doc.nodes[id]);
  if (!uniq.length) throw new RepeatError("Select at least one layer to repeat.");
  if (uniq.length === 1) {
    const grp = repeatGroupOf(doc, uniq[0]);
    if (grp && (grp.id === uniq[0] || grp.repeat!.source === uniq[0])) return updateRepeatOps(doc, grp.id, o, g);
  }
  const nodes = uniq.map((id) => doc.nodes[id]!);
  if (nodes.some((n) => n.type === "frame")) throw new RepeatError("Versions (frames) can't be repeated — select layers inside one.");
  const parent = nodes[0]!.parent;
  if (!parent || nodes.some((n) => n.parent !== parent)) throw new RepeatError("Layers to repeat must sit in the same group or version.");
  const siblings = (doc.nodes[parent] as { children: string[] }).children;
  const ordered = [...uniq].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const index = siblings.indexOf(ordered[0]!);

  const box = unionBox(ordered.map((id) => boundsIn(doc, id, parent, g)));
  if (!box || (box.w <= 0 && box.h <= 0)) throw new RepeatError("Nothing to repeat: the selection has no visible size.");

  const mode = o.mode;
  const pivot = resolvePivot(doc, parent, o.pivot, box, mode);
  const parsed = RepeatRecipe.safeParse({
    count: o.count ?? DEFAULT_COUNT[mode],
    gapX: mode === "grid" ? 24 : 0,
    gapY: mode === "grid" ? 24 : 0,
    ...recipeFrom(o, { mode }),
    source: "_",
    pivot: pivot.point,
    pivotMode: pivot.mode,
  });
  if (!parsed.success) throw new RepeatError(`Bad repeat options: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const groupId = newId("n");
  const ops: OpT[] = [];
  let sourceId: string;
  let unit: string;
  // The group has an identity transform, so moving the sources in keeps them in place.
  ops.push({ op: "add", node: { id: groupId, type: "group", name: "", style: { fill: null } }, parent, index });
  if (ordered.length === 1) {
    sourceId = ordered[0]!;
    unit = unitName(doc.nodes[sourceId]!);
    ops.push({ op: "move", id: sourceId, parent: groupId });
  } else {
    sourceId = newId("n");
    unit = unitName(nodes[0]!);
    ops.push({ op: "add", node: { id: sourceId, type: "group", name: unit, style: { fill: null } }, parent: groupId });
    for (const id of ordered) ops.push({ op: "move", id, parent: sourceId });
  }
  const recipe: RepeatRecipeT = { ...parsed.data, source: sourceId };
  const name = o.name?.trim() || repeatName(recipe, unit);
  (ops[0] as Extract<OpT, { op: "add" }>).node.name = name;
  (ops[0] as Extract<OpT, { op: "add" }>).node.repeat = recipe;

  if (ordered.length === 1) ops.push(...copyOps(doc, groupId, sourceId, recipe, box, unit));
  else {
    // The unit group doesn't exist yet in `doc`: each copy is a fresh group of clones.
    repeatInstances(recipe, box).forEach((sim, i) => {
      if (i === 0) return;
      const gid = newId("n");
      ops.push({ op: "add", node: { id: gid, type: "group", name: `${unit} ${i + 1}`, style: { fill: null }, transform: applySimToTransform(sim, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }) }, parent: groupId });
      for (const id of ordered) ops.push(...cloneSubtreeOps(doc, id, { parent: gid }).ops);
    });
  }
  if (recipe.merged) ops.push(...mergeOps(doc, ops, groupId, sourceId, unit, g));
  const copies = repeatInstanceCount(recipe) - 1;
  return { ops, groupId, sourceId, recipe, copies, label: repeatLabel(recipe), updated: false };
}

/**
 * After `before` (which builds the group with the source and its copies), union everything in
 * the group into one exact path; the copies go, the source stays hidden for later rebuilds.
 */
function mergeOps(doc: DocT, before: OpT[], groupId: string, sourceId: string, unit: string, g: RepeatGeomOptions): OpT[] {
  const tmp = applyOps(doc, before).doc;
  const kids = (tmp.nodes[groupId] as GroupNodeT).children;
  const textOutlines: Record<string, string> = {};
  for (const k of kids)
    for (const id of subtreeIds(tmp, k)) {
      const n = tmp.nodes[id]!;
      const d = n.type === "text" ? g.textToPath?.(n) : null;
      if (d) textOutlines[id] = d;
    }
  const plan = booleanOps(tmp, kids, "union", { textOutlines, newId: () => newId("n") });
  if (plan.error) throw new RepeatError(`Can't merge: ${plan.error}`);
  const ops = plan.ops.filter((o) => !(o.op === "remove" && o.id === sourceId));
  for (const o of ops) if (o.op === "add") o.node.name = `${unit} (merged)`;
  ops.push({ op: "update", id: sourceId, set: { visible: false } });
  return ops;
}

const repeatLabel = (r: RepeatRecipeT) =>
  r.mode === "mirror" ? `Mirror ${r.axis === "both" ? "both ways" : r.axis}` : r.mode === "grid" ? `Grid ${r.count}×${r.rows}` : `Radial repeat ×${r.count}`;

/**
 * Rebuild a repeat group from its source (after the source was edited), optionally with new
 * options (count, angle, pivot, mode…). Hand edits to copies are replaced. One undo step.
 */
export function updateRepeatOps(doc: DocT, groupId: string, patch: Partial<RepeatOptions> = {}, g: RepeatGeomOptions = {}): RepeatResult {
  const grp = doc.nodes[groupId];
  if (!grp || grp.type !== "group" || !grp.repeat) throw new RepeatError(`${groupId} is not a repeat group.`);
  const old = grp.repeat;
  const src = doc.nodes[old.source];
  if (!src || src.parent !== groupId) throw new RepeatError(`The repeat's source layer (${old.source}) is gone — select a layer and repeat it again.`);
  const box = boundsIn(doc, src.id, groupId, g);
  if (!box) throw new RepeatError("The source layer has no visible size.");
  const base = recipeFrom(patch, old);
  if (patch.mode && patch.mode !== old.mode && patch.count === undefined) base.count = DEFAULT_COUNT[patch.mode];
  let pivot = { point: old.pivot, mode: old.pivotMode };
  if (patch.pivot !== undefined) pivot = resolvePivot(doc, groupId, patch.pivot, box, base.mode ?? old.mode);
  const parsed = RepeatRecipe.safeParse({ ...base, source: old.source, pivot: pivot.point, pivotMode: pivot.mode });
  if (!parsed.success) throw new RepeatError(`Bad repeat options: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const recipe = parsed.data;
  const unit = unitName(src);
  const ops: OpT[] = grp.children.filter((id) => id !== src.id).map((id): OpT => ({ op: "remove", id }));
  const autoNamed = !grp.name.trim() || grp.name === repeatName(old, unit);
  const name = patch.name?.trim() || (autoNamed ? repeatName(recipe, unit) : grp.name);
  ops.push({ op: "update", id: groupId, set: { repeat: recipe, name }, replace: true });
  // Keep the source at the bottom of the group.
  if (grp.children.indexOf(src.id) !== 0) ops.push({ op: "move", id: src.id, parent: groupId, index: 0 });
  // A merged repeat keeps its source hidden; show it again for the rebuild.
  if (!src.visible) ops.push({ op: "update", id: src.id, set: { visible: true } });
  ops.push(...copyOps(doc, groupId, src.id, recipe, box, unit));
  if (recipe.merged) ops.push(...mergeOps(doc, ops, groupId, src.id, unit, g));
  return { ops, groupId, sourceId: src.id, recipe, copies: repeatInstanceCount(recipe) - 1, label: `Update ${repeatLabel(recipe).toLowerCase()}`, updated: true };
}

/** Stop treating a group as a repeat (the copies stay as ordinary layers). */
export function releaseRepeatOps(doc: DocT, groupId: string): OpT[] {
  const grp = doc.nodes[groupId];
  if (!grp || grp.type !== "group" || !grp.repeat) return [];
  return [{ op: "update", id: groupId, set: { repeat: null }, replace: true }];
}
