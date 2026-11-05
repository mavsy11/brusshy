import { booleanOpD, ClipType, differenceD, EndType, FillRule, inflatePathsD, JoinType, reversePathD, type PathD, type PathsD } from "@countertype/clipper2-ts";
import { applyOps } from "./ops";
import { apply, invert, multiply, shapeToPath, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { parsePath, serializePath, type P, type SubPath } from "./pathmodel";
import { fitPolyline } from "./fitcurve";
import { geomFingerprint } from "./warp";
import type { OpT } from "./ops";
import type { DocT, NodeT, PaintT, StyleT } from "./schema";
import type { EffectRecordT } from "./typelab-schema";

/**
 * Type Lab · Effects as real vector layers: outline, inline, drop/long shadow, double outline.
 * Sources are flattened to polygons, merged and offset with Clipper2 (Boost licence), and the
 * result is re-fitted with smooth cubics — so effects export, edit and extrude like any path.
 * Effect layers live next to their sources in an "effects group" and can be regenerated any time.
 */

export const EFFECT_KINDS = ["outline", "inline", "shadow", "double"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface EffectParams {
  color: string;
  /** outline/double: space between the letters and the line. */
  gap: number;
  /** outline/inline/double: line thickness. */
  width: number;
  /** inline: distance from the edge inwards. */
  inset: number;
  /** shadow: direction in degrees (0 = right, 90 = down). */
  angle: number;
  /** shadow: offset (drop) or extrusion length (long). */
  distance: number;
  style: "drop" | "long";
  corners: "round" | "miter";
  /** double: space between the two lines, and the second line's thickness. */
  gap2: number;
  width2: number;
}

export const EFFECT_LABELS: Record<EffectKind, { label: string; layer: string; hint: string }> = {
  outline: { label: "Outline", layer: "outline", hint: "A line around the letters, with a gap" },
  inline: { label: "Inline", layer: "inline", hint: "A fine line inside the strokes" },
  shadow: { label: "Shadow", layer: "shadow", hint: "Drop shadow or solid long shadow" },
  double: { label: "Double", layer: "double outline", hint: "Two concentric outlines" },
};

/** Params each kind uses (the panel and the MCP show only these). */
export const EFFECT_PARAMS: Record<EffectKind, (keyof EffectParams)[]> = {
  outline: ["color", "gap", "width", "corners"],
  inline: ["color", "inset", "width", "corners"],
  shadow: ["color", "style", "angle", "distance"],
  double: ["color", "gap", "width", "gap2", "width2", "corners"],
};

const SCALE_KEYS = ["gap", "width", "inset", "distance", "gap2", "width2"] as const;

// ───────────────────────── colours ─────────────────────────

const solidOf = (p: PaintT | undefined): string | null => (typeof p === "string" ? p : p && typeof p === "object" ? (p.stops[0]?.color ?? null) : null);

function hexRgb(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (x) => x + x) : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** Mix a colour toward black (k > 0) or white (k < 0). */
export function shadeColor(c: string, k: number): string {
  const rgb = hexRgb(c);
  if (!rgb) return c;
  const t = k > 0 ? 0 : 255;
  const a = Math.abs(k);
  return toHex(rgb[0] + (t - rgb[0]) * a, rgb[1] + (t - rgb[1]) * a, rgb[2] + (t - rgb[2]) * a);
}

const luminance = (c: string) => {
  const rgb = hexRgb(c);
  return rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0;
};

// ───────────────────────── geometry ─────────────────────────

const bezAt = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};

/** Flatten a path model into polylines (mapped by M), within `tol`. */
export function flattenSubPaths(subs: SubPath[], tol: number, M: Mat = IDENTITY): { pts: P[]; closed: boolean }[] {
  const map = (q: P): P => apply(M, q[0], q[1]);
  return subs.map((s) => {
    const a = s.anchors;
    const n = a.length;
    const segs = s.closed ? n : n - 1;
    const pts: P[] = [map(a[0]!.p)];
    for (let i = 0; i < segs; i++) {
      const A = a[i]!, B = a[(i + 1) % n]!;
      if (!A.cout && !B.cin) {
        pts.push(map(B.p));
        continue;
      }
      const p0 = map(A.p), p1 = map(A.cout ?? A.p), p2 = map(B.cin ?? B.p), p3 = map(B.p);
      const dd = Math.max(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
      const k = Math.min(96, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / Math.max(1e-6, tol)))));
      for (let j = 1; j <= k; j++) pts.push(bezAt(p0, p1, p2, p3, j / k));
    }
    if (s.closed && pts.length > 1) {
      const f = pts[0]!, l = pts[pts.length - 1]!;
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) pts.pop();
    }
    return { pts, closed: s.closed };
  });
}

const toPathD = (pts: P[]): PathD => pts.map(([x, y]) => ({ x, y }));
const fromPathD = (p: PathD): P[] => p.map((q) => [q.x, q.y]);
const PREC = 3;
const unionD = (paths: PathsD, rule: FillRule): PathsD => booleanOpD(ClipType.Union, paths, null, rule, PREC);

const areaOf = (p: PathD) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]!.x + p[i]!.x) * (p[j]!.y - p[i]!.y);
  return a / 2;
};

/** A source layer as filled polygons in the effects space: its fill area, plus its stroke footprint. */
export function nodeFootprint(d: string, style: Pick<StyleT, "fill" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin" | "fillRule">, M: Mat, tol: number): PathsD {
  const polys = flattenSubPaths(parsePath(d), tol, M);
  const out: PathsD = [];
  if (style.fill !== null) {
    const closed = polys.filter((p) => p.pts.length >= 3).map((p) => toPathD(p.pts));
    if (closed.length) out.push(...unionD(closed, style.fillRule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero));
  }
  if (style.stroke !== null && style.strokeWidth > 0) {
    const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    const half = (style.strokeWidth * scale) / 2;
    const join = style.strokeLinejoin === "miter" ? JoinType.Miter : style.strokeLinejoin === "bevel" ? JoinType.Bevel : JoinType.Round;
    const cap = style.strokeLinecap === "butt" ? EndType.Butt : style.strokeLinecap === "square" ? EndType.Square : EndType.Round;
    for (const p of polys) {
      if (p.pts.length < 2) continue;
      out.push(...inflatePathsD([toPathD(p.pts)], half, join, p.closed ? EndType.Joined : cap, 4, PREC, tol));
    }
  }
  return out.length ? unionD(out, FillRule.NonZero) : [];
}

/** Merge footprints into one clean region. */
export const mergeRegions = (paths: PathsD): PathsD => (paths.length ? unionD(paths, FillRule.NonZero) : []);

const inflate = (r: PathsD, delta: number, corners: "round" | "miter", tol: number): PathsD =>
  Math.abs(delta) < 1e-9 ? r : inflatePathsD(r, delta, corners === "miter" ? JoinType.Miter : JoinType.Round, EndType.Polygon, 3, PREC, tol);

/** Solid extrusion of a region along v: its Minkowski sum with the segment [0, v]. */
export function sweepRegion(region: PathsD, v: P): PathsD {
  const parts: PathsD = [...region, ...region.map((p) => p.map((q) => ({ x: q.x + v[0], y: q.y + v[1] })))];
  const positive = region.length ? areaOf(region.reduce((a, b) => (Math.abs(areaOf(b)) > Math.abs(areaOf(a)) ? b : a))) > 0 : true;
  for (const ring of region) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      let quad: PathD = [a, b, { x: b.x + v[0], y: b.y + v[1] }, { x: a.x + v[0], y: a.y + v[1] }];
      const ar = areaOf(quad);
      if (Math.abs(ar) < 1e-9) continue;
      // Every edge quad winds like the outer rings, so the non-zero union fills the whole sweep.
      if (ar > 0 !== positive) quad = reversePathD(quad);
      parts.push(quad);
    }
  }
  return unionD(parts, FillRule.NonZero);
}

/** The effect's region for a merged source region (all in the effects space). */
export function effectRegion(region: PathsD, kind: EffectKind, p: EffectParams, tol: number): PathsD {
  const c = p.corners;
  if (kind === "outline") {
    const inner = inflate(region, p.gap, c, tol);
    return differenceD(inflate(region, p.gap + p.width, c, tol), inner, FillRule.NonZero, PREC);
  }
  if (kind === "double") {
    const ring1 = differenceD(inflate(region, p.gap + p.width, c, tol), inflate(region, p.gap, c, tol), FillRule.NonZero, PREC);
    const o2 = p.gap + p.width + p.gap2;
    const ring2 = differenceD(inflate(region, o2 + p.width2, c, tol), inflate(region, o2, c, tol), FillRule.NonZero, PREC);
    return unionD([...ring1, ...ring2], FillRule.NonZero);
  }
  if (kind === "inline") {
    const a = inflate(region, -p.inset, c, tol);
    const b = inflate(region, -(p.inset + p.width), c, tol);
    return differenceD(a, b, FillRule.NonZero, PREC);
  }
  const rad = (p.angle * Math.PI) / 180;
  const v: P = [Math.cos(rad) * p.distance, Math.sin(rad) * p.distance];
  if (p.style === "drop") return region.map((r) => r.map((q) => ({ x: q.x + v[0], y: q.y + v[1] })));
  return sweepRegion(region, v);
}

/** Region polygons → smooth path data (curves re-fitted; specks dropped). */
export function regionToPath(region: PathsD, tol: number): string {
  const subs: SubPath[] = [];
  const minArea = tol * tol * 6;
  for (const ring of region) {
    if (ring.length < 3 || Math.abs(areaOf(ring)) < minArea) continue;
    const s = fitPolyline(fromPathD(ring), true, tol * 1.2);
    if (s) subs.push(s);
  }
  return serializePath(subs);
}

// ───────────────────────── document level ─────────────────────────

/** True for a group that holds generated effect layers. */
export const isEffectsGroup = (doc: DocT, id: string | null | undefined): boolean => {
  const n = id ? doc.nodes[id] : undefined;
  return n?.type === "group" && n.children.some((c) => !!doc.nodes[c]?.effect);
};

/** The effects group a node belongs to (itself, its parent, or the parent of an effect layer). */
export function effectsGroupOf(doc: DocT, id: string): string | null {
  if (isEffectsGroup(doc, id)) return id;
  const p = doc.nodes[id]?.parent;
  return p && isEffectsGroup(doc, p) ? p : null;
}

/** Effect layers of an effects group, by kind. */
export function effectLayers(doc: DocT, groupId: string): Partial<Record<EffectKind, string>> {
  const g = doc.nodes[groupId];
  const out: Partial<Record<EffectKind, string>> = {};
  if (g?.type !== "group") return out;
  for (const c of g.children) {
    const e = doc.nodes[c]?.effect;
    if (e) out[e.kind] = c;
  }
  return out;
}

/** Source layers of an effects group (everything that isn't a generated effect). */
export const effectSources = (doc: DocT, groupId: string): string[] => {
  const g = doc.nodes[groupId];
  return g?.type === "group" ? g.children.filter((c) => doc.nodes[c] && !doc.nodes[c]!.effect) : [];
};

/** Texts under the sources (their outlines must be supplied by the caller: glyphs come from fonts). */
export function effectTexts(doc: DocT, ids: string[]): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n || n.effect || !n.visible) return;
    if (n.type === "text") out.push(id);
    else if (n.type === "group") n.children.forEach(visit);
  };
  ids.forEach(visit);
  return out;
}

interface SourceGeom {
  region: PathsD;
  /** Bounds of the region. */
  box: { x: number; y: number; w: number; h: number };
  sig: string;
  fill: string | null;
}

/** Merged footprint of source layers in the coordinate space of `spaceId` (the effects group). */
export function sourceGeometry(doc: DocT, sources: string[], spaceId: string | null, textOutlines: Record<string, string> = {}, tol?: number): SourceGeom {
  const inv = invert(spaceId ? worldMatrix(doc, spaceId) : IDENTITY);
  const leaves: { d: string; style: StyleT; M: Mat }[] = [];
  let fill: string | null = null;
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n || n.effect || !n.visible) return;
    if (n.type === "group") return n.children.forEach(visit);
    let d: string | null = null;
    if (n.type === "path") d = n.d;
    else if (n.type === "shape") d = shapeToPath(n);
    else if (n.type === "text") {
      d = textOutlines[id] ?? null;
      if (!d) throw new Error(`Text "${n.text}" needs its outline (glyphs) for effects`);
    }
    if (!d) return;
    fill ??= solidOf(n.style.fill) ?? solidOf(n.style.stroke);
    leaves.push({ d, style: n.style, M: multiply(inv, worldMatrix(doc, id)) });
  };
  sources.forEach(visit);
  if (!leaves.length) throw new Error("Nothing to build an effect from");
  // Tolerance from the rough size of the sources (0.05% of the larger side).
  let t = tol;
  if (!t) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of leaves)
      for (const s of parsePath(l.d))
        for (const a of s.anchors) {
          const [x, y] = apply(l.M, a.p[0], a.p[1]);
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    t = Math.max(0.02, 5e-4 * Math.max(x1 - x0, y1 - y0, 1));
  }
  const region = mergeRegions(leaves.flatMap((l) => nodeFootprint(l.d, l.style, l.M, t!)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of region)
    for (const q of r) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  const box = Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
  const sig = geomFingerprint(leaves.map((l) => `${l.d}|${l.M.map((v) => v.toFixed(3)).join(",")}|${l.style.stroke ? l.style.strokeWidth : 0}`).join(";"));
  return { region, box, sig, fill };
}

const effTol = (box: { w: number; h: number }) => Math.max(0.02, 5e-4 * Math.max(box.w, box.h, 1));

/** Defaults sized to the sources (the smaller side ≈ letter height for a wordmark). */
export function defaultEffectParams(kind: EffectKind, geom: Pick<SourceGeom, "box" | "fill">, background: string | null = null): EffectParams {
  const m = Math.max(1, Math.min(geom.box.w, geom.box.h));
  const r = (v: number) => Math.round(v * 10) / 10;
  const ink = geom.fill ?? "#0b0c0e";
  const paper = background ?? (luminance(ink) > 0.6 ? "#0b0c0e" : "#ffffff");
  return {
    color: kind === "inline" ? paper : kind === "shadow" ? (luminance(ink) < 0.15 ? "#c9cdcf" : shadeColor(ink, 0.45)) : ink,
    gap: r(m * 0.035),
    width: r(kind === "inline" ? m * 0.018 : m * 0.04),
    inset: r(m * 0.03),
    angle: 45,
    distance: r(m * 0.12),
    style: "long",
    corners: "round",
    gap2: r(m * 0.03),
    width2: r(m * 0.025),
  };
}

/** Normalise loose params (from the panel or an agent) over defaults. */
export function resolveEffectParams(kind: EffectKind, raw: Partial<Record<keyof EffectParams, unknown>> | undefined, defaults: EffectParams): EffectParams {
  const p: EffectParams = { ...defaults };
  if (!raw) return p;
  for (const k of SCALE_KEYS) {
    const v = Number(raw[k]);
    if (raw[k] !== undefined && Number.isFinite(v)) p[k] = Math.max(0, v);
  }
  if (raw.angle !== undefined && Number.isFinite(Number(raw.angle))) p.angle = Number(raw.angle);
  if (typeof raw.color === "string" && raw.color) p.color = raw.color;
  if (raw.style === "drop" || raw.style === "long") p.style = raw.style;
  if (raw.corners === "round" || raw.corners === "miter") p.corners = raw.corners;
  if (kind === "inline" && p.width <= 0) p.width = defaults.width;
  return p;
}

const ORDER: Record<EffectKind, number> = { shadow: 0, double: 1, outline: 2, inline: 9 };

export interface EffectPlan {
  ops: OpT[];
  groupId: string;
  layerId: string;
  params: EffectParams;
  /** The effect's path data (for live previews). */
  d: string;
}

const siblingsOf = (doc: DocT, n: NodeT): string[] => {
  if (!n.parent) return doc.root;
  const p = doc.nodes[n.parent];
  return p && (p.type === "group" || p.type === "frame") ? p.children : doc.root;
};

/**
 * Add (or regenerate with new params) an effect on the selection, as one undo step. Sources that
 * aren't in an effects group yet are wrapped in one (same place in the tree, identity transform);
 * the effect is a sibling path layer named "<name> <effect>". Texts need `textOutlines[id]`.
 */
export function addEffectOps(
  doc: DocT,
  ids: string[],
  kind: EffectKind,
  raw: Partial<Record<keyof EffectParams, unknown>> = {},
  opts: { textOutlines?: Record<string, string>; newId: (prefix: string) => string; background?: string | null },
): EffectPlan {
  const live = ids.filter((id) => doc.nodes[id]);
  if (!live.length) throw new Error("Select the layers to add an effect to");
  const ops: OpT[] = [];
  let groupId = live.length === 1 ? effectsGroupOf(doc, live[0]!) : null;
  if (!groupId) {
    const parents = new Set(live.map((id) => doc.nodes[id]!.parent));
    const shared = live.map((id) => doc.nodes[id]!.parent).find((p) => p && isEffectsGroup(doc, p));
    if (shared && parents.size === 1) groupId = shared;
  }
  if (!groupId) {
    const parents = new Set(live.map((id) => doc.nodes[id]!.parent));
    if (parents.size > 1) throw new Error("Effects need layers with the same parent (group them first)");
    const first = doc.nodes[live[0]!]!;
    if (live.some((id) => doc.nodes[id]!.type === "frame")) throw new Error("Pick layers inside the version, not the version itself");
    const sibs = siblingsOf(doc, first);
    const ordered = [...live].sort((a, b) => sibs.indexOf(a) - sibs.indexOf(b));
    groupId = opts.newId("n");
    const name = live.length === 1 ? first.name || (first.type === "text" ? first.text : "Layer") : "Effects";
    ops.push({ op: "add", node: { id: groupId, type: "group", name, style: { fill: null } }, parent: first.parent, index: sibs.indexOf(ordered[0]!) });
    ordered.forEach((id, i) => ops.push({ op: "move", id, parent: groupId, index: i }));
  }
  const staged = ops.length ? applyLocal(doc, ops) : doc;
  const sources = effectSources(staged, groupId);
  const geom = sourceGeometry(staged, sources, groupId, opts.textOutlines);
  const layers = effectLayers(staged, groupId);
  const existing = layers[kind] ? staged.nodes[layers[kind]!] : undefined;
  const base = existing?.effect ? resolveEffectParams(kind, existing.effect.params as Partial<EffectParams>, defaultEffectParams(kind, geom, opts.background)) : defaultEffectParams(kind, geom, opts.background);
  const params = resolveEffectParams(kind, raw, base);
  const tol = effTol(geom.box);
  const d = regionToPath(effectRegion(geom.region, kind, params, tol), tol);
  if (!d) throw new Error(kind === "inline" ? "The inline doesn't fit inside these strokes — use a smaller inset or width" : "The effect came out empty — try larger values");
  const effect: EffectRecordT = { kind, params: params as unknown as Record<string, number | string>, sig: geom.sig };
  const g = staged.nodes[groupId] as Extract<NodeT, { type: "group" }>;
  const name = `${g.name || "Layer"} ${EFFECT_LABELS[kind].layer}`;
  let layerId: string;
  if (existing) {
    layerId = existing.id;
    ops.push({ op: "update", id: layerId, set: { d, effect, style: { fill: params.color } } });
  } else {
    layerId = opts.newId("n");
    // Shadow at the bottom, outlines under the letters, inline on top.
    const firstSource = g.children.findIndex((c) => !staged.nodes[c]?.effect);
    let index = g.children.length;
    if (ORDER[kind] < 9) {
      index = firstSource < 0 ? 0 : firstSource;
      for (const [k, id] of Object.entries(layers)) if (ORDER[k as EffectKind] > ORDER[kind]) index = Math.min(index, g.children.indexOf(id!));
    }
    ops.push({
      op: "add",
      node: { id: layerId, type: "path", name, d, effect, style: { fill: params.color, stroke: null, strokeWidth: 0, fillRule: "nonzero" } },
      parent: groupId,
      index,
    });
  }
  return { ops, groupId, layerId, params, d };
}

/** Rebuild every effect of an effects group from its current sources (e.g. after a warp or letter edits). */
export function regenerateEffectsOps(doc: DocT, groupId: string, textOutlines: Record<string, string> = {}): OpT[] {
  const layers = effectLayers(doc, groupId);
  const ids = Object.values(layers) as string[];
  if (!ids.length) return [];
  const geom = sourceGeometry(doc, effectSources(doc, groupId), groupId, textOutlines);
  const tol = effTol(geom.box);
  const ops: OpT[] = [];
  for (const id of ids) {
    const n = doc.nodes[id]!;
    const e = n.effect!;
    const params = resolveEffectParams(e.kind, e.params as Partial<EffectParams>, defaultEffectParams(e.kind, geom));
    const d = regionToPath(effectRegion(geom.region, e.kind, params, tol), tol);
    if (!d) continue;
    ops.push({ op: "update", id, set: { d, effect: { ...e, sig: geom.sig } } });
  }
  return ops;
}

/** Effects groups touched by a change to these nodes (themselves, their ancestors, or inside them). */
export function effectsGroupsAround(doc: DocT, ids: string[]): string[] {
  const out = new Set<string>();
  const down = (id: string) => {
    const n = doc.nodes[id];
    if (!n || n.type !== "group") return;
    if (isEffectsGroup(doc, id)) out.add(id);
    n.children.forEach(down);
  };
  for (const id of ids) {
    for (let p: string | null = id; p; p = doc.nodes[p]?.parent ?? null) if (isEffectsGroup(doc, p)) out.add(p);
    down(id);
  }
  return [...out];
}

/** True when an effects group's layers no longer match their sources. */
export function effectsStale(doc: DocT, groupId: string, textOutlines: Record<string, string> = {}): boolean {
  const layers = Object.values(effectLayers(doc, groupId)) as string[];
  if (!layers.length) return false;
  try {
    const sig = sourceGeometry(doc, effectSources(doc, groupId), groupId, textOutlines).sig;
    return layers.some((id) => doc.nodes[id]?.effect?.sig !== sig);
  } catch {
    return false;
  }
}

/** Remove one effect layer; when it was the last one, unwrap the group (sources go back in place). */
export function removeEffectOps(doc: DocT, layerId: string): OpT[] {
  const n = doc.nodes[layerId];
  if (!n?.effect || !n.parent) return [];
  const g = doc.nodes[n.parent];
  const ops: OpT[] = [{ op: "remove", id: layerId }];
  if (g?.type !== "group") return ops;
  const others = g.children.filter((c) => c !== layerId && doc.nodes[c]?.effect);
  const t = g.transform;
  const plain = !t.x && !t.y && !t.rotation && t.scaleX === 1 && t.scaleY === 1 && g.style.opacity === 1 && !g.aiLock && !g.locked;
  if (others.length || !plain) return ops;
  const sibs = siblingsOf(doc, g);
  const at = sibs.indexOf(g.id);
  g.children
    .filter((c) => c !== layerId)
    .forEach((c, i) => ops.push({ op: "move", id: c, parent: g.parent, index: at + i }));
  ops.push({ op: "remove", id: g.id });
  return ops;
}

const applyLocal = (doc: DocT, ops: OpT[]) => applyOps(doc, ops).doc;
