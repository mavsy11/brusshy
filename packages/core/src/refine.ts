import { booleanOpD, ClipType, EndType, FillRule, inflatePathsD, JoinType, reversePathD, type PathD, type PathsD } from "@countertype/clipper2-ts";
import { apply, invert, multiply, shapeToPath, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { parsePath, serializePath, type Anchor, type P, type SubPath } from "./pathmodel";
import { fitPolyline } from "./fitcurve";
import { frameOf } from "./frames";
import { lockupMetrics, visualCentreOf, type TypeMetricsFn } from "./lockup";
import type { OpT } from "./ops";
import type { DocT, NodeT, ShapeNodeT } from "./schema";

/**
 * Quick refinements on a selection — pure geometry, no AI tokens. Every action works in the
 * version's artboard space (each layer's transform is applied to its outline and undone after),
 * so results are true to what the user sees, whatever the groups, scales or rotations.
 *
 *  simplify        fewer nodes within a tolerance: runs between corners are re-fitted (Schneider)
 *  smooth          runs between corners are resampled, Taubin-smoothed (no shrinking) and re-fitted
 *  bolder/thinner  the filled outline is offset out/in (Clipper2, mitred corners) and re-fitted;
 *                  stroke-only layers just change their stroke width
 *  round           sharp corners get a circular-arc fillet (cubic), trimmed into curved neighbours
 *  optical-center  the selection moves so its visual centre (ink mass, see lockup.ts) sits at the
 *                  centre of its version
 *  snap-grid       every anchor rounds to the grid step (handles travel with their anchor)
 *  symmetric       one half is mirrored onto the other about a vertical axis found by search
 *                  (min. asymmetric area); outlines crossing the axis are split exactly there
 */

export const REFINE_ACTIONS = ["simplify", "smooth", "bolder", "thinner", "round", "optical-center", "snap-grid", "symmetric"] as const;
export type RefineAction = (typeof REFINE_ACTIONS)[number];

export const REFINE_LABELS: Record<RefineAction, { label: string; verb: string; hint: string }> = {
  simplify: { label: "Simplify", verb: "Simplify", hint: "Fewer nodes, same shape — corners stay sharp" },
  smooth: { label: "Smooth", verb: "Smooth", hint: "Even out wobbly curves — corners stay sharp" },
  bolder: { label: "Bolder", verb: "Bolder", hint: "Offset the outline outward" },
  thinner: { label: "Thinner", verb: "Thinner", hint: "Offset the outline inward" },
  round: { label: "Rounder corners", verb: "Round corners", hint: "Round sharp corners by a radius" },
  "optical-center": { label: "Optical center", verb: "Optical center", hint: "Center in the version by visual mass, not the bounding box" },
  "snap-grid": { label: "Snap to grid", verb: "Snap to grid", hint: "Round every anchor to the grid step" },
  symmetric: { label: "Make symmetric", verb: "Make symmetric", hint: "Mirror one half onto the other (vertical axis)" },
};

/** Grid steps offered for snap-grid (artboard units). */
export const SNAP_STEPS = [1, 2, 4, 8, 16, 32] as const;

export interface RefineAmountSpec {
  min: number;
  max: number;
  step: number;
  /** Default for this selection. */
  value: number;
  unit: string;
  label: string;
}

export interface RefineOptions {
  /** Strength (simplify/smooth 0–100), offset (bolder/thinner), radius (round) or grid step (snap-grid). Default: from the selection. */
  amount?: number;
  /** symmetric: which half to keep (default left). */
  side?: "left" | "right";
  /** symmetric: mirror even when the selection is far from symmetric. */
  force?: boolean;
  /** Outlines of text layers (local path data) — text is converted to a path by geometry actions. */
  textOutlines?: Record<string, string>;
  /** Layers to leave alone (e.g. AI-locked for agents). */
  skip?: (n: NodeT) => boolean;
}

export interface RefineResult {
  ops: OpT[];
  /** Live-preview patches (node id → patch merged over the node), same result as the ops. */
  patches: Record<string, Partial<NodeT>>;
  changed: string[];
  label: string;
  /** One-line result, e.g. "Simplify · 214 → 96 nodes". */
  summary: string;
  notes: string[];
  amount: number | null;
}

// ───────────────────────── vectors ─────────────────────────

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const addv = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (v: P): P | null => {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-9 ? null : [v[0] / l, v[1] / l];
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const cloneA = (a: Anchor): Anchor => ({ p: [a.p[0], a.p[1]], cin: a.cin && [a.cin[0], a.cin[1]], cout: a.cout && [a.cout[0], a.cout[1]] });

/** Map every anchor and handle through an affine matrix (exact for Béziers). */
export function mapSubPaths(subs: SubPath[], M: Mat): SubPath[] {
  const m = (q: P): P => apply(M, q[0], q[1]);
  return subs.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ p: m(a.p), cin: a.cin && m(a.cin), cout: a.cout && m(a.cout) })) }));
}

export const countNodes = (subs: SubPath[]) => subs.reduce((n, s) => n + s.anchors.length, 0);

const isLine = (A: Anchor, B: Anchor) => !A.cout && !B.cin;

const bez = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};
const segCtrl = (A: Anchor, B: Anchor): [P, P, P, P] => [A.p, A.cout ?? A.p, B.cin ?? B.p, B.p];
const segAt = (A: Anchor, B: Anchor, t: number): P => (isLine(A, B) ? lerp(A.p, B.p, t) : bez(...segCtrl(A, B), t));

/** Points along a segment (excluding A, including B) within `tol`; straight lines get evenly spaced points every `lineStep`. */
function segPoints(A: Anchor, B: Anchor, tol: number, lineStep = Infinity): P[] {
  if (isLine(A, B)) {
    const k = Math.min(256, Math.max(1, Math.ceil(dist(A.p, B.p) / lineStep)));
    return Array.from({ length: k }, (_, j) => lerp(A.p, B.p, (j + 1) / k));
  }
  const [p0, p1, p2, p3] = segCtrl(A, B);
  const dd = Math.max(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
  const k = Math.min(256, Math.max(2, Math.ceil(Math.sqrt((0.75 * dd) / Math.max(1e-6, tol))), Math.ceil(dist(p0, p3) / lineStep)));
  return Array.from({ length: k }, (_, j) => bez(p0, p1, p2, p3, (j + 1) / k));
}

/** Bounds of path geometry (curves sampled). */
export function subPathsBox(subs: SubPath[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (q: P) => {
    if (q[0] < x0) x0 = q[0];
    if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1];
    if (q[1] > y1) y1 = q[1];
  };
  for (const s of subs) {
    const a = s.anchors;
    if (!a.length) continue;
    add(a[0]!.p);
    const segs = s.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const A = a[i]!, B = a[(i + 1) % a.length]!;
      if (isLine(A, B)) add(B.p);
      else for (let k = 1; k <= 12; k++) add(segAt(A, B, k / 12));
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
const diagOf = (b: { w: number; h: number } | null) => (b ? Math.hypot(b.w, b.h) : 0);

// ───────────────────────── corners & runs ─────────────────────────

const EPS = 1e-6;
function inTangent(s: SubPath, i: number): P | null {
  const a = s.anchors, n = a.length;
  if (!s.closed && i === 0) return null;
  const A = a[(i - 1 + n) % n]!, B = a[i]!;
  const from = B.cin && dist(B.cin, B.p) > EPS ? B.cin : A.cout && dist(A.cout, B.p) > EPS ? A.cout : A.p;
  return unit(sub(B.p, from));
}
function outTangent(s: SubPath, i: number): P | null {
  const a = s.anchors, n = a.length;
  if (!s.closed && i === n - 1) return null;
  const B = a[i]!, C = a[(i + 1) % n]!;
  const to = B.cout && dist(B.cout, B.p) > EPS ? B.cout : C.cin && dist(C.cin, B.p) > EPS ? C.cin : C.p;
  return unit(sub(to, B.p));
}
/** Turn at an anchor in degrees (0 = smooth, 180 = cusp); open ends count as 180. */
export function turnAt(s: SubPath, i: number): number {
  const u = inTangent(s, i), v = outTangent(s, i);
  if (!u || !v) return 180;
  return (Math.acos(clamp(dot(u, v), -1, 1)) * 180) / Math.PI;
}

/**
 * Turn at each anchor measured over chords of length R on both sides: a jaggy outline has big
 * local turns but small turns at the scale of the refinement, a real corner has both.
 */
function scaleTurns(s: SubPath, R: number): number[] {
  const a = s.anchors, n = a.length;
  const segs = s.closed ? n : n - 1;
  const pts: P[] = [a[0]!.p];
  const at = [0];
  for (let i = 0; i < segs; i++) {
    pts.push(...segPoints(a[i]!, a[(i + 1) % n]!, R * 0.01, R / 4));
    at.push(pts.length - 1);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i]!, pts[i - 1]!));
  const T = cum[cum.length - 1]!;
  const pointAt = (len: number): P => {
    let L = len;
    if (s.closed && T > 0) L = ((L % T) + T) % T;
    else L = clamp(L, 0, T);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= L) lo = mid;
      else hi = mid;
    }
    const span = cum[hi]! - cum[lo]!;
    return lerp(pts[lo]!, pts[hi]!, span > 0 ? (L - cum[lo]!) / span : 0);
  };
  return a.map((x, i) => {
    if (!s.closed && (i === 0 || i === n - 1)) return 180;
    const L = cum[at[i]!]!;
    const u = unit(sub(x.p, pointAt(L - R))), v = unit(sub(pointAt(L + R), x.p));
    return u && v ? (Math.acos(clamp(dot(u, v), -1, 1)) * 180) / Math.PI : 0;
  });
}

/** Segment indices between consecutive break anchors: [[b0, b0+1, …, b1], …] (anchor indices, wrapping for closed). */
function runsBetween(s: SubPath, brk: boolean[]): number[][] {
  const n = s.anchors.length;
  const idx = brk.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  const runs: number[][] = [];
  if (s.closed) {
    idx.forEach((st, k) => {
      const e = idx[(k + 1) % idx.length]!;
      const run = [st];
      for (let i = (st + 1) % n; ; i = (i + 1) % n) {
        run.push(i);
        if (i === e) break;
      }
      runs.push(run);
    });
  } else for (let k = 0; k < idx.length - 1; k++) runs.push(Array.from({ length: idx[k + 1]! - idx[k]! + 1 }, (_, j) => idx[k]! + j));
  return runs;
}

function runPoints(s: SubPath, run: number[], tol: number, lineStep: number): P[] {
  const a = s.anchors;
  const pts: P[] = [a[run[0]!]!.p];
  for (let k = 0; k < run.length - 1; k++) pts.push(...segPoints(a[run[k]!]!, a[run[k + 1]!]!, tol, lineStep));
  return pts;
}

function ringPoints(s: SubPath, tol: number, lineStep: number): P[] {
  const a = s.anchors;
  const pts: P[] = [a[0]!.p];
  for (let i = 0; i < a.length; i++) pts.push(...segPoints(a[i]!, a[(i + 1) % a.length]!, tol, lineStep));
  pts.pop(); // back at the start
  return pts;
}

/** Stitch fitted runs back into one subpath (each run starts where the previous ended). */
function stitch(runs: Anchor[][], closed: boolean): SubPath {
  const out: Anchor[] = [];
  for (const r of runs) {
    if (!r.length) continue;
    if (!out.length) out.push(cloneA(r[0]!));
    else out[out.length - 1]!.cout = r[0]!.cout && [r[0]!.cout[0], r[0]!.cout[1]];
    for (let k = 1; k < r.length; k++) out.push(cloneA(r[k]!));
  }
  if (closed && out.length > 1) {
    const last = out.pop()!;
    out[0]!.cin = last.cin;
  }
  return { anchors: out, closed };
}

const runAnchors = (s: SubPath, run: number[]): Anchor[] =>
  run.map((i, k) => {
    const a = s.anchors[i]!;
    return { p: a.p, cin: k === 0 ? null : a.cin, cout: k === run.length - 1 ? null : a.cout };
  });

// ───────────────────────── simplify ─────────────────────────

/** Fewer nodes within `tol` (artboard units). Corners sharper than `cornerDeg` and line/curve joints stay. Never adds nodes. */
export function simplifySubPath(s: SubPath, tol: number, cornerDeg = 24): SubPath {
  const a = s.anchors, n = a.length;
  if (n < 3 || tol <= 0) return s;
  const sampleTol = tol * 0.04;
  const lineStep = tol * 6;
  const segIsLine = (i: number) => isLine(a[i]!, a[(i + 1) % n]!);
  const wide = scaleTurns(s, tol * 8);
  const brk = a.map((_, i) => {
    if (!s.closed && (i === 0 || i === n - 1)) return true;
    if (turnAt(s, i) > cornerDeg && wide[i]! > cornerDeg) return true;
    // A line meeting a curve stays a joint, so straight edges stay exactly straight.
    return segIsLine((i - 1 + n) % n) !== segIsLine(i);
  });
  if (!brk.some(Boolean)) {
    const fit = fitPolyline(ringPoints(s, sampleTol, lineStep), true, tol, 179);
    return fit && fit.anchors.length < n ? fit : s;
  }
  const runs = runsBetween(s, brk).map((run) => {
    const orig = runAnchors(s, run);
    if (run.length <= 2) return orig;
    const fit = fitPolyline(runPoints(s, run, sampleTol, lineStep), false, tol, 179);
    if (!fit || fit.anchors.length >= orig.length) return orig;
    // Exact corner positions at both ends.
    fit.anchors[0]!.p = orig[0]!.p;
    fit.anchors[fit.anchors.length - 1]!.p = orig[orig.length - 1]!.p;
    return fit.anchors;
  });
  const out = stitch(runs, s.closed);
  return out.anchors.length < n ? out : s;
}

// ───────────────────────── smooth ─────────────────────────

function resample(pts: P[], h: number, closed: boolean): P[] {
  const ring = closed ? [...pts, pts[0]!] : pts;
  const cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1]! + dist(ring[i]!, ring[i - 1]!));
  const L = cum[cum.length - 1]!;
  if (L < 1e-9) return pts;
  const k = Math.max(closed ? 8 : 2, Math.round(L / h));
  const out: P[] = [];
  let j = 0;
  const count = closed ? k : k + 1;
  for (let i = 0; i < count; i++) {
    const at = (i / k) * L;
    while (j < cum.length - 2 && cum[j + 1]! < at) j++;
    const seg = cum[j + 1]! - cum[j]!;
    out.push(lerp(ring[j]!, ring[j + 1]!, seg > 0 ? (at - cum[j]!) / seg : 0));
  }
  if (!closed) out[out.length - 1] = pts[pts.length - 1]!;
  return out;
}

/** Taubin λ|μ smoothing: removes wiggles without shrinking the shape. Open runs keep their ends. */
function taubin(pts: P[], iters: number, closed: boolean): P[] {
  let a = pts.map((p) => [p[0], p[1]] as P);
  const n = a.length;
  if (n < 3) return a;
  for (let it = 0; it < iters; it++)
    for (const f of [0.5, -0.53]) {
      const b = a.map((p) => [p[0], p[1]] as P);
      for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) continue;
        const p = a[(i - 1 + n) % n]!, q = a[(i + 1) % n]!;
        b[i] = [a[i]![0] + f * ((p[0] + q[0]) / 2 - a[i]![0]), a[i]![1] + f * ((p[1] + q[1]) / 2 - a[i]![1])];
      }
      a = b;
    }
  return a;
}

/** Smooth curves over `radius` (artboard units); corners sharper than `cornerDeg` stay put. */
export function smoothSubPath(s: SubPath, radius: number, cornerDeg = 40): SubPath {
  const a = s.anchors, n = a.length;
  if (n < 2 || radius <= 0) return s;
  const box = subPathsBox([s]);
  const outline = s.closed ? ringPoints(s, radius * 0.02, Infinity) : runPoints(s, a.map((_, i) => i), radius * 0.02, Infinity);
  const per = outline.reduce((acc, p, i, arr) => (i ? acc + dist(p, arr[i - 1]!) : acc), 0);
  const h = Math.max(radius / 3, per / 3000, 1e-3);
  const fitTol = Math.max(h * 0.3, diagOf(box) * 2e-4);
  const wide = scaleTurns(s, radius * 2);
  const brk = a.map((_, i) => (!s.closed && (i === 0 || i === n - 1)) || (turnAt(s, i) > cornerDeg && wide[i]! > cornerDeg));
  if (!brk.some(Boolean)) {
    const pts = taubin(resample(ringPoints(s, h * 0.05, h), h, true), 24, true);
    return fitPolyline(pts, true, fitTol, 179) ?? s;
  }
  const runs = runsBetween(s, brk).map((run) => {
    const orig = runAnchors(s, run);
    const raw = runPoints(s, run, h * 0.05, h);
    if (raw.length < 3) return orig;
    const pts = taubin(resample(raw, h, false), 24, false);
    const fit = fitPolyline(pts, false, fitTol, 179);
    if (!fit) return orig;
    fit.anchors[0]!.p = orig[0]!.p;
    fit.anchors[fit.anchors.length - 1]!.p = orig[orig.length - 1]!.p;
    return fit.anchors;
  });
  return stitch(runs, s.closed);
}

// ───────────────────────── offset (bolder / thinner) ─────────────────────────

const PREC = 3;
const toPathD = (pts: P[]): PathD => pts.map(([x, y]) => ({ x, y }));
const fromPathD = (p: PathD): P[] => p.map((q) => [q.x, q.y]);
const areaD = (p: PathD) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j]!.x + p[i]!.x) * (p[j]!.y - p[i]!.y);
  return s / 2;
};
const perimD = (p: PathD) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y);
  return s;
};

/** Filled region of path geometry (as SVG fills it: open subpaths close implicitly). */
export function fillRegion(subs: SubPath[], tol: number, rule: "nonzero" | "evenodd" = "nonzero"): PathsD {
  const polys = subs.filter((s) => s.anchors.length >= 2).map((s) => (s.closed ? ringPoints(s, tol, Infinity) : runPoints(s, s.anchors.map((_, i) => i), tol, Infinity)));
  const paths = polys.filter((p) => p.length >= 3).map(toPathD);
  return paths.length ? booleanOpD(ClipType.Union, paths, null, rule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero, PREC) : [];
}

/** Region rings → smooth path geometry (curves re-fitted, corners kept, specks dropped). */
export function regionToSubPaths(region: PathsD, tol: number, cornerDeg = 25): SubPath[] {
  const out: SubPath[] = [];
  for (const ring of region) {
    if (ring.length < 3 || Math.abs(areaD(ring)) < tol * tol * 6) continue;
    const s = fitPolyline(fromPathD(ring), true, tol, cornerDeg);
    if (s) out.push(s);
  }
  return out;
}

/** Offset filled geometry by `delta` (artboard units; > 0 grows). Corners stay mitred. */
export function offsetSubPaths(subs: SubPath[], delta: number, rule: "nonzero" | "evenodd" = "nonzero"): SubPath[] {
  const d = diagOf(subPathsBox(subs));
  if (!d || Math.abs(delta) < 1e-9) return subs;
  const tol = Math.max(0.004, d * 1.5e-4);
  const region = fillRegion(subs, tol, rule);
  const grown = inflatePathsD(region, delta, JoinType.Miter, EndType.Polygon, 3, PREC, tol);
  return regionToSubPaths(grown, Math.max(tol * 2, d * 5e-4));
}

/** Area-weighted stroke weight of filled geometry: 2·area / perimeter. */
export function stemOf(subs: SubPath[], rule: "nonzero" | "evenodd" = "nonzero"): { area: number; perimeter: number } {
  const d = diagOf(subPathsBox(subs));
  if (!d) return { area: 0, perimeter: 0 };
  const region = fillRegion(subs, Math.max(0.01, d * 5e-4), rule);
  return { area: Math.abs(region.reduce((s, r) => s + areaD(r), 0)), perimeter: region.reduce((s, r) => s + perimD(r), 0) };
}

// ───────────────────────── round corners ─────────────────────────

function segLength(A: Anchor, B: Anchor): number {
  if (isLine(A, B)) return dist(A.p, B.p);
  let L = 0, prev = A.p;
  for (let k = 1; k <= 32; k++) {
    const q = segAt(A, B, k / 32);
    L += dist(prev, q);
    prev = q;
  }
  return L;
}
/** Parameter at arc length `len` from the start (fromEnd: measured from B). */
function paramAt(A: Anchor, B: Anchor, len: number, fromEnd: boolean): number {
  if (isLine(A, B)) {
    const L = dist(A.p, B.p) || 1;
    return fromEnd ? 1 - len / L : len / L;
  }
  const N = 64;
  const cum = [0];
  let prev = A.p;
  for (let k = 1; k <= N; k++) {
    const q = segAt(A, B, k / N);
    cum.push(cum[k - 1]! + dist(prev, q));
    prev = q;
  }
  const L = cum[N]!;
  const target = fromEnd ? L - len : len;
  let k = 0;
  while (k < N - 1 && cum[k + 1]! < target) k++;
  const span = cum[k + 1]! - cum[k]!;
  return clamp((k + (span > 0 ? (target - cum[k]!) / span : 0)) / N, 0, 1);
}
/** Part [t0, t1] of a cubic segment. */
function subCubic(c: [P, P, P, P], t0: number, t1: number): [P, P, P, P] {
  const split = (q: [P, P, P, P], t: number): [[P, P, P, P], [P, P, P, P]] => {
    const ab = lerp(q[0], q[1], t), bc = lerp(q[1], q[2], t), cd = lerp(q[2], q[3], t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
    return [
      [q[0], ab, abc, m],
      [m, bcd, cd, q[3]],
    ];
  };
  let q = c;
  if (t1 < 1) q = split(q, t1)[0];
  if (t0 > 0) q = split(q, t1 > 0 ? t0 / t1 : 0)[1];
  return q;
}
const tangentAt = (A: Anchor, B: Anchor, t: number): P | null => {
  const e = 1e-4;
  return unit(sub(segAt(A, B, Math.min(1, t + e)), segAt(A, B, Math.max(0, t - e))));
};

/** Round corners turning more than `minTurn` degrees with fillets of `radius` (clamped so neighbours never overlap). */
export function roundSubPath(s: SubPath, radius: number, minTurn = 10): SubPath {
  const a = s.anchors, n = a.length;
  if (n < 2 || radius <= 0) return s;
  const segs = s.closed ? n : n - 1;
  const segLen = Array.from({ length: segs }, (_, i) => segLength(a[i]!, a[(i + 1) % n]!));
  const turn = a.map((_, i) => (!s.closed && (i === 0 || i === n - 1) ? 0 : turnAt(s, i)));
  const rounds = turn.map((t) => t > minTurn && t < 178);
  if (!rounds.some(Boolean)) return s;
  // Trim length at each rounded corner.
  const trim = a.map((_, i) => {
    if (!rounds[i]) return 0;
    const phi = (turn[i]! * Math.PI) / 180;
    const want = radius * Math.tan(phi / 2);
    const iin = (i - 1 + n) % n, iout = i;
    const capIn = segLen[iin]! * (rounds[(i - 1 + n) % n] ? 0.499 : 0.95);
    const capOut = segLen[iout]! * (rounds[(i + 1) % n] ? 0.499 : 0.95);
    return Math.max(0, Math.min(want, capIn, capOut));
  });
  // Each segment trimmed at its ends → [t0, t1].
  const span = Array.from({ length: segs }, (_, i) => {
    const A = a[i]!, B = a[(i + 1) % n]!;
    return [trim[i]! > 0 ? paramAt(A, B, trim[i]!, false) : 0, trim[(i + 1) % n]! > 0 ? paramAt(A, B, trim[(i + 1) % n]!, true) : 1] as [number, number];
  });
  const piece = (i: number) => {
    const A = a[i]!, B = a[(i + 1) % n]!;
    const [t0, t1] = span[i]!;
    if (isLine(A, B)) return { p0: lerp(A.p, B.p, t0), c1: null as P | null, c2: null as P | null, p3: lerp(A.p, B.p, t1) };
    const q = subCubic(segCtrl(A, B), t0, t1);
    return { p0: q[0], c1: q[1], c2: q[2], p3: q[3] };
  };
  const pieces = Array.from({ length: segs }, (_, i) => piece(i));
  const out: Anchor[] = [];
  for (let i = 0; i < n; i++) {
    const inc = s.closed || i > 0 ? pieces[(i - 1 + n) % n]! : null;
    const outp = s.closed || i < n - 1 ? pieces[i]! : null;
    if (!rounds[i] || trim[i]! <= 1e-6 || !inc || !outp) {
      out.push({ p: a[i]!.p, cin: inc ? inc.c2 : null, cout: outp ? outp.c1 : null });
      continue;
    }
    const P1 = inc.p3, P2 = outp.p0;
    const T1 = tangentAt(a[(i - 1 + n) % n]!, a[i]!, span[(i - 1 + n) % n]![1]) ?? unit(sub(a[i]!.p, P1)) ?? [1, 0];
    const T2 = tangentAt(a[i]!, a[(i + 1) % n]!, span[i]![0]) ?? unit(sub(P2, a[i]!.p)) ?? [1, 0];
    const phi = Math.acos(clamp(dot(T1, T2), -1, 1));
    const chord = dist(P1, P2);
    const r = phi > 1e-6 ? chord / (2 * Math.sin(phi / 2)) : 0;
    const k = (4 / 3) * Math.tan(phi / 4) * r;
    out.push({ p: P1, cin: inc.c2, cout: addv(P1, mul(T1, k)) });
    out.push({ p: P2, cin: sub(P2, mul(T2, k)), cout: outp.c1 });
  }
  return { anchors: out, closed: s.closed };
}

// ───────────────────────── snap ─────────────────────────

export function snapSubPath(s: SubPath, step: number): SubPath {
  if (step <= 0) return s;
  const g = (v: number) => Math.round(v / step) * step;
  return {
    closed: s.closed,
    anchors: s.anchors.map((a) => {
      const d: P = [g(a.p[0]) - a.p[0], g(a.p[1]) - a.p[1]];
      return { p: addv(a.p, d), cin: a.cin && addv(a.cin, d), cout: a.cout && addv(a.cout, d) };
    }),
  };
}

// ───────────────────────── mirror ─────────────────────────

const mirX = (q: P, ax: number): P => [2 * ax - q[0], q[1]];

/** Mirror about x = ax and reverse, so the winding (and holes) stay the same. */
export function mirrorSubPath(s: SubPath, ax: number): SubPath {
  const m = (q: P | null) => q && mirX(q, ax);
  return { closed: s.closed, anchors: [...s.anchors].reverse().map((a) => ({ p: mirX(a.p, ax), cin: m(a.cout), cout: m(a.cin) })) };
}
const reverseSubPath = (s: SubPath): SubPath => ({ closed: s.closed, anchors: [...s.anchors].reverse().map((a) => ({ p: a.p, cin: a.cout, cout: a.cin })) });

/** Parameters in (0,1) where a segment crosses x = ax. */
function crossingsX(A: Anchor, B: Anchor, ax: number): number[] {
  const f = (t: number) => segAt(A, B, t)[0] - ax;
  const out: number[] = [];
  const N = isLine(A, B) ? 1 : 48;
  let t0 = 0, f0 = f(0);
  for (let k = 1; k <= N; k++) {
    const t1 = k / N, f1 = f(t1);
    if ((f0 < 0 && f1 > 0) || (f0 > 0 && f1 < 0)) {
      let lo = t0, hi = t1, flo = f0;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if (fm < 0 === flo < 0) {
          lo = mid;
          flo = fm;
        } else hi = mid;
      }
      const t = (lo + hi) / 2;
      if (t > 1e-4 && t < 1 - 1e-4) out.push(t);
    }
    t0 = t1;
    f0 = f1;
  }
  return out;
}

function splitAt(s: SubPath, i: number, t: number): void {
  const a = s.anchors, j = (i + 1) % a.length;
  const A = a[i]!, B = a[j]!;
  if (isLine(A, B)) {
    a.splice(i + 1, 0, { p: lerp(A.p, B.p, t), cin: null, cout: null });
    return;
  }
  const [p0, p1, p2, p3] = segCtrl(A, B);
  const ab = lerp(p0, p1, t), bc = lerp(p1, p2, t), cd = lerp(p2, p3, t);
  const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t);
  A.cout = ab;
  B.cin = cd;
  a.splice(i + 1, 0, { p: lerp(abc, bcd, t), cin: abc, cout: bcd });
}

/** Make a crossing handle perpendicular to the axis when it nearly is, so the join is smooth. */
function levelHandle(anchor: P, h: P | null): P | null {
  if (!h) return null;
  const v = sub(h, anchor);
  const L = Math.hypot(v[0], v[1]);
  if (L < 1e-9) return h;
  return Math.abs(v[1]) / L < Math.sin((15 * Math.PI) / 180) ? [anchor[0] + Math.sign(v[0] || 1) * L, anchor[1]] : h;
}

/**
 * Symmetrize one subpath that crosses x = ax: split it exactly on the axis and replace the
 * discarded half by the mirror of the kept one. Null when it crosses more than twice (closed)
 * or more than once (open).
 */
export function symmetrizeCrossing(s0: SubPath, ax: number, keep: "left" | "right", eps: number): SubPath | null {
  let s: SubPath = { closed: s0.closed, anchors: s0.anchors.map(cloneA) };
  const keepSign = keep === "left" ? -1 : 1;
  // Anchors on the axis sit exactly on it.
  for (const a of s.anchors)
    if (Math.abs(a.p[0] - ax) < eps) {
      const dx = ax - a.p[0];
      a.p = [ax, a.p[1]];
      if (a.cin) a.cin = [a.cin[0] + dx, a.cin[1]];
      if (a.cout) a.cout = [a.cout[0] + dx, a.cout[1]];
    }
  const segCount = () => (s.closed ? s.anchors.length : s.anchors.length - 1);
  for (let i = segCount() - 1; i >= 0; i--) {
    const ts = crossingsX(s.anchors[i]!, s.anchors[(i + 1) % s.anchors.length]!, ax).sort((x, y) => y - x);
    let scale = 1;
    for (const t of ts) {
      splitAt(s, i, t / scale);
      s.anchors[i + 1]!.p = [ax, s.anchors[i + 1]!.p[1]];
      scale = t;
    }
  }
  const a = s.anchors, n = a.length;
  const segs = segCount();
  const side = Array.from({ length: segs }, (_, i) => {
    const x = segAt(a[i]!, a[(i + 1) % n]!, 0.5)[0] - ax;
    return Math.abs(x) < eps ? 0 : Math.sign(x);
  });
  // Segments along the axis take their neighbour's side.
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < segs; i++) if (!side[i]) side[i] = side[(i - 1 + segs) % segs] || (s.closed || i < segs - 1 ? side[(i + 1) % segs]! : 0);
  if (side.every((v) => !v)) return null;
  const cross: number[] = [];
  for (let i = s.closed ? 0 : 1; i < (s.closed ? n : n - 1); i++) if (side[(i - 1 + segs) % segs] !== side[i % segs]) cross.push(i);
  if (s.closed) {
    if (cross.length !== 2) return null;
    const p = cross.find((i) => side[i % segs] === keepSign)!;
    const q = cross.find((i) => i !== p)!;
    const K: Anchor[] = [];
    for (let i = p; ; i = (i + 1) % n) {
      K.push(a[i]!);
      if (i === q) break;
    }
    if (K.length < 2) return null;
    const m = K.length - 1;
    const first = { ...K[0]!, cout: levelHandle(K[0]!.p, K[0]!.cout) };
    const last = { ...K[m]!, cin: levelHandle(K[m]!.p, K[m]!.cin) };
    const out: Anchor[] = [{ p: first.p, cin: first.cout && mirX(first.cout, ax), cout: first.cout }];
    for (let i = 1; i < m; i++) out.push(K[i]!);
    out.push({ p: last.p, cin: last.cin, cout: last.cin && mirX(last.cin, ax) });
    for (let i = m - 1; i >= 1; i--) out.push({ p: mirX(K[i]!.p, ax), cin: K[i]!.cout && mirX(K[i]!.cout!, ax), cout: K[i]!.cin && mirX(K[i]!.cin!, ax) });
    return dropAxisJoints({ anchors: out, closed: true }, ax);
  }
  if (cross.length !== 1) return null;
  if (side[0] !== keepSign) {
    s = reverseSubPath(s);
    return symmetrizeCrossing(s, ax, keep, eps);
  }
  const q = cross[0]!;
  const K = a.slice(0, q + 1);
  const m = K.length - 1;
  const last = { ...K[m]!, cin: levelHandle(K[m]!.p, K[m]!.cin) };
  const out: Anchor[] = K.slice(0, m).map(cloneA);
  out.push({ p: last.p, cin: last.cin, cout: last.cin && mirX(last.cin, ax) });
  for (let i = m - 1; i >= 0; i--) out.push({ p: mirX(K[i]!.p, ax), cin: K[i]!.cout && mirX(K[i]!.cout!, ax), cout: K[i]!.cin && mirX(K[i]!.cin!, ax) });
  return dropAxisJoints({ anchors: out, closed: false }, ax);
}

const signedArea = (pts: P[]) => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
  return s / 2;
};

/** Drop anchors on the axis that just continue a straight line (left by the split). */
function dropAxisJoints(s: SubPath, ax: number): SubPath {
  const a = s.anchors, n = a.length;
  if (n < 4) return s;
  const keep = a.filter((x, i) => {
    if (Math.abs(x.p[0] - ax) > 1e-6 || (!s.closed && (i === 0 || i === n - 1))) return true;
    const prev = a[(i - 1 + n) % n]!, next = a[(i + 1) % n]!;
    return !(isLine(prev, x) && isLine(x, next) && turnAt(s, i) < 0.5);
  });
  return keep.length === n ? s : { closed: s.closed, anchors: keep };
}

/** Fallback for outlines crossing the axis many times: keep half the region, union with its mirror, re-fit. */
function symmetrizeRegion(s: SubPath, ax: number, keep: "left" | "right", tol: number): SubPath[] {
  const pts = ringPoints(s, tol, Infinity);
  const orient = Math.sign(signedArea(pts)) || 1;
  const b = subPathsBox([s])!;
  const big = Math.max(b.w, b.h) * 4 + 10;
  const half: PathD = keep === "left"
    ? toPathD([[ax - big, b.y - big], [ax, b.y - big], [ax, b.y + b.h + big], [ax - big, b.y + b.h + big]])
    : toPathD([[ax, b.y - big], [ax + big, b.y - big], [ax + big, b.y + b.h + big], [ax, b.y + b.h + big]]);
  const kept = booleanOpD(ClipType.Intersection, [toPathD(pts)], [half], FillRule.NonZero, PREC);
  const mirrored = kept.map((r) => reversePathD(r.map((q) => ({ x: 2 * ax - q.x, y: q.y }))));
  const merged = booleanOpD(ClipType.Union, [...kept, ...mirrored], null, FillRule.NonZero, PREC);
  return regionToSubPaths(merged, tol * 2).map((r) => {
    const o = Math.sign(signedArea(r.anchors.map((x) => x.p))) || 1;
    return o === orient ? r : reverseSubPath(r);
  });
}

// ───────────────────────── document level ─────────────────────────

/** Matrix from a node's local space to its version's artboard space. */
export function artboardMatrix(doc: DocT, id: string): Mat {
  const f = frameOf(doc, id);
  const W = worldMatrix(doc, id);
  return f && f.id !== id ? multiply(invert(worldMatrix(doc, f.id)), W) : W;
}
const parentArtboard = (doc: DocT, n: NodeT): Mat => (n.parent && doc.nodes[n.parent] && doc.nodes[n.parent]!.type !== "frame" ? artboardMatrix(doc, n.parent) : IDENTITY);
const isTranslation = (M: Mat) => Math.abs(M[0] - 1) < 1e-9 && Math.abs(M[3] - 1) < 1e-9 && Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9;
const scaleOf = (M: Mat) => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;

/** Transform patch that moves a node by an artboard-space delta. */
function moveBy(doc: DocT, n: NodeT, dx: number, dy: number): Partial<NodeT> {
  const inv = invert(parentArtboard(doc, n));
  const px = inv[0] * dx + inv[2] * dy, py = inv[1] * dx + inv[3] * dy;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { transform: { ...n.transform, x: r3(n.transform.x + px), y: r3(n.transform.y + py) } };
}

interface Leaf {
  n: Extract<NodeT, { type: "path" | "shape" | "text" }>;
  /** Local → artboard. */
  M: Mat;
  /** Outline in artboard space. */
  subs: SubPath[];
}

/** Selected ids without descendants of other selected ids (a selected version means its content). */
function topIds(doc: DocT, ids: string[]): string[] {
  const expanded = ids.flatMap((id) => (doc.nodes[id]?.type === "frame" ? (doc.nodes[id] as Extract<NodeT, { type: "frame" }>).children : [id]));
  const set = new Set(expanded);
  return expanded.filter((id, i) => {
    if (!doc.nodes[id] || expanded.indexOf(id) !== i) return false;
    for (let p = doc.nodes[id]!.parent; p; p = doc.nodes[p]?.parent ?? null) if (set.has(p)) return false;
    return true;
  });
}

function collectLeaves(doc: DocT, ids: string[], opts: RefineOptions, notes: Set<string>, geometry: boolean): Leaf[] {
  const out: Leaf[] = [];
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    if (opts.skip?.(n)) return void notes.add(`Left “${n.name || n.id}” alone (locked for the AI).`);
    if (n.effect) return; // generated effect layers follow their sources
    if (n.type === "group") return n.children.forEach(visit);
    if (n.type !== "path" && n.type !== "shape" && n.type !== "text") return;
    if (n.locked) return void notes.add("Locked layers were left alone.");
    let d: string | null = null;
    if (n.type === "path") d = n.d;
    else if (n.type === "shape") d = shapeToPath(n);
    else d = opts.textOutlines?.[n.id] ?? null;
    if (!d) {
      if (geometry) notes.add(`Text “${n.type === "text" ? n.text : n.name}” needs its outlines (open the studio) — skipped.`);
      if (!geometry) out.push({ n, M: artboardMatrix(doc, n.id), subs: [] });
      return;
    }
    const M = artboardMatrix(doc, n.id);
    let subs: SubPath[];
    try {
      subs = mapSubPaths(parsePath(d), M);
    } catch {
      return;
    }
    out.push({ n, M, subs });
  };
  topIds(doc, ids).forEach(visit);
  return out;
}

class Builder {
  ops: OpT[] = [];
  patches: Record<string, Partial<NodeT>> = {};
  changed: string[] = [];
  before = 0;
  after = 0;
  constructor(private doc: DocT) {}

  /** New outline (artboard space) for a leaf: paths update `d`, shapes/text become paths (same id and place). */
  geometry(leaf: Leaf, subs: SubPath[]) {
    const d = serializePath(mapSubPaths(subs, invert(leaf.M)));
    const n = leaf.n;
    this.before += countNodes(leaf.subs);
    this.after += countNodes(subs);
    if (n.type === "path") {
      if (d === n.d) return;
      this.ops.push({ op: "update", id: n.id, set: { d } });
      this.patches[n.id] = { d } as Partial<NodeT>;
    } else {
      const parent = n.parent;
      const sibs = parent ? ((this.doc.nodes[parent] as { children?: string[] } | undefined)?.children ?? this.doc.root) : this.doc.root;
      const name = n.name || (n.type === "text" ? n.text : n.shape);
      const node: Record<string, unknown> = { id: n.id, type: "path", name, d, transform: n.transform, style: n.style, visible: n.visible, locked: n.locked, aiLock: n.aiLock };
      if (n.extrude) node.extrude = n.extrude;
      this.ops.push({ op: "remove", id: n.id }, { op: "add", node, parent, index: sibs.indexOf(n.id) });
      this.patches[n.id] = { type: "path", d } as unknown as Partial<NodeT>;
    }
    this.changed.push(n.id);
  }

  update(n: NodeT, set: Record<string, unknown>, patch: Partial<NodeT>) {
    this.ops.push({ op: "update", id: n.id, set });
    this.patches[n.id] = { ...(this.patches[n.id] ?? {}), ...patch };
    if (!this.changed.includes(n.id)) this.changed.push(n.id);
  }
}

function selectionStats(leaves: Leaf[], withStem = true) {
  const boxes = leaves.map((l) => subPathsBox(l.subs)).filter((b): b is NonNullable<typeof b> => !!b);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  const box = boxes.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  if (!withStem) return { box, diag: diagOf(box), stem: 0 };
  // Stroke weight: filled parts by 2·area/perimeter, stroke-only parts by their stroke width.
  let A = 0, Per = 0, sw = 0, swN = 0;
  for (const l of leaves) {
    if (!l.subs.length) continue;
    if (l.n.style.fill !== null) {
      const s = stemOf(l.subs, l.n.style.fillRule);
      A += s.area;
      Per += s.perimeter;
    } else if (l.n.style.strokeWidth > 0) {
      sw += l.n.style.strokeWidth * scaleOf(l.M);
      swN++;
    }
  }
  const stem = Per > 0 ? (2 * A) / Per : swN ? sw / swN : box ? Math.min(box.w, box.h) * 0.15 : 10;
  return { box, diag: diagOf(box), stem };
}

const nice = (v: number) => (v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);

/** Slider spec (range and default) for an action on a selection; null when the action takes no amount. */
export function refineAmountSpec(doc: DocT, ids: string[], action: RefineAction, opts: Pick<RefineOptions, "textOutlines" | "skip"> = {}): RefineAmountSpec | null {
  if (action === "simplify") return { min: 0, max: 100, step: 1, value: 40, unit: "%", label: "Tolerance" };
  if (action === "smooth") return { min: 0, max: 100, step: 1, value: 50, unit: "%", label: "Strength" };
  if (action === "snap-grid") return { min: 1, max: 64, step: 1, value: 8, unit: "", label: "Grid step" };
  if (action === "optical-center" || action === "symmetric") return null;
  const st = selectionStats(collectLeaves(doc, ids, opts, new Set(), true));
  const stem = Math.max(st.stem, 0.5);
  if (action === "round") {
    const minSide = st.box ? Math.min(st.box.w, st.box.h) : 100;
    const max = nice(Math.max(stem * 1.5, minSide * 0.2, 2));
    return { min: 0, max, step: max > 40 ? 1 : 0.1, value: nice(Math.min(max, Math.max(stem * 0.3, minSide * 0.04, 0.5))), unit: "", label: "Radius" };
  }
  const max = nice(Math.max(stem * (action === "bolder" ? 0.6 : 0.45), 1));
  return { min: 0, max, step: max > 40 ? 1 : 0.1, value: nice(Math.max(stem * 0.1, 0.2)), unit: "", label: action === "bolder" ? "Grow by" : "Shrink by" };
}

/** Asymmetric share of a region about x = ax: area(region XOR mirror) / 2·area. */
function asymmetry(region: PathsD, ax: number): number {
  const area = Math.abs(region.reduce((s, r) => s + areaD(r), 0));
  if (area < 1e-9) return 1;
  const mir = region.map((r) => reversePathD(r.map((q) => ({ x: 2 * ax - q.x, y: q.y }))));
  const x = booleanOpD(ClipType.Xor, region, mir, FillRule.NonZero, PREC);
  return Math.abs(x.reduce((s, r) => s + areaD(r), 0)) / (2 * area);
}

/** The vertical axis that makes a set of outlines most symmetric (searched around their centre). */
export function symmetryAxis(subsList: SubPath[][]): { axis: number; asymmetry: number } | null {
  const all = subsList.flat();
  const box = subPathsBox(all);
  if (!box || box.w <= 0) return null;
  const tol = Math.max(0.02, diagOf(box) * 1e-3);
  const region = booleanOpD(ClipType.Union, subsList.flatMap((s) => fillRegion(s, tol)), null, FillRule.NonZero, PREC);
  const c = box.x + box.w / 2;
  let best = { axis: c, asymmetry: asymmetry(region, c) };
  let span = box.w * 0.08;
  for (let round = 0; round < 3; round++) {
    const centre = best.axis;
    for (let k = -6; k <= 6; k++) {
      if (!k) continue;
      const ax = centre + (k / 6) * span;
      const v = asymmetry(region, ax);
      if (v < best.asymmetry - 1e-6) best = { axis: ax, asymmetry: v };
    }
    span /= 5;
  }
  // Prefer the plain centre when it is as good (round numbers, no drift).
  if (asymmetry(region, c) <= best.asymmetry + 0.002) best = { axis: c, asymmetry: asymmetry(region, c) };
  return best;
}

const boxIoU = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  const u = a.w * a.h + b.w * b.h - i;
  return u > 0 ? i / u : 0;
};

/**
 * Plan a refinement of the selected layers (groups and versions refine their contents).
 * Returns ops for one undo step plus equivalent live-preview patches.
 */
export function refineOps(doc: DocT, ids: string[], action: RefineAction, opts: RefineOptions = {}): RefineResult {
  const notes = new Set<string>();
  const b = new Builder(doc);
  const label = REFINE_LABELS[action].verb;
  const geometric = action !== "optical-center" && action !== "snap-grid";
  const leaves = collectLeaves(doc, ids, opts, notes, geometric);
  const amount = opts.amount ?? refineAmountSpec(doc, ids, action, opts)?.value ?? null;
  const done = (summary: string): RefineResult => ({ ops: b.ops, patches: b.patches, changed: b.changed, label, summary, notes: [...notes], amount });
  const nodesSummary = () => `${label} · ${b.before} → ${b.after} nodes`;
  if (!leaves.length && action !== "optical-center") {
    if (!notes.size) notes.add("Select paths, shapes, text or groups to refine.");
    return done(`${label} · nothing to change`);
  }
  const st = selectionStats(leaves, false);

  if (action === "simplify" || action === "smooth") {
    const s = clamp(amount ?? 0, 0, 100) / 100;
    for (const l of leaves) {
      if (!l.subs.length) continue;
      const ld = diagOf(subPathsBox(l.subs));
      let next: SubPath[];
      if (action === "simplify") {
        const tol = Math.min(st.diag * (0.0006 + 0.012 * s * s), ld * 0.03);
        next = l.subs.map((sp) => simplifySubPath(sp, tol));
        if (countNodes(next) >= countNodes(l.subs)) {
          // Unchanged: still count it so the summary shows the real node count.
          b.before += countNodes(l.subs);
          b.after += countNodes(l.subs);
          continue;
        }
      } else {
        const radius = Math.min(st.diag * 0.06 * s, ld * 0.2);
        next = l.subs.map((sp) => smoothSubPath(sp, radius, 35 + 20 * s));
      }
      b.geometry(l, next);
    }
    if (!b.ops.length) notes.add(action === "simplify" ? "Already as simple as it gets at this tolerance." : "Nothing to smooth.");
    return done(nodesSummary());
  }

  if (action === "bolder" || action === "thinner") {
    const delta = Math.max(0, amount ?? 0) * (action === "bolder" ? 1 : -1);
    if (!delta) return done(`${label} · no change`);
    for (const l of leaves) {
      if (!l.subs.length) continue;
      const st2 = l.n.style;
      if (st2.fill === null && st2.strokeWidth > 0) {
        const w = Math.max(0.1, r2(st2.strokeWidth + (2 * delta) / scaleOf(l.M)));
        b.update(l.n, { style: { strokeWidth: w } }, { style: { ...st2, strokeWidth: w } });
        continue;
      }
      const next = offsetSubPaths(l.subs, delta, st2.fillRule);
      if (!next.length) {
        notes.add(`“${l.n.name || l.n.id}” would vanish at this amount — left as is.`);
        continue;
      }
      b.geometry(l, next);
    }
    return done(`${label} · ${nice(Math.abs(delta))} unit${Math.abs(delta) === 1 ? "" : "s"}`);
  }

  if (action === "round") {
    const r = Math.max(0, amount ?? 0);
    if (!r) return done(`${label} · no change`);
    let corners = 0;
    for (const l of leaves) {
      if (!l.subs.length) continue;
      const n = l.n;
      if (n.type === "shape" && n.shape !== "ellipse") {
        const local = r2(r / scaleOf(l.M));
        if (local !== n.radius) b.update(n, { radius: local }, { radius: local } as Partial<NodeT>);
        continue;
      }
      if (n.type === "shape") continue;
      const next = l.subs.map((sp) => roundSubPath(sp, r));
      const added = countNodes(next) - countNodes(l.subs);
      if (!added) continue;
      corners += added;
      b.geometry(l, next);
    }
    if (!b.ops.length) notes.add("No sharp corners to round.");
    return done(corners ? `${label} · ${corners} corner${corners === 1 ? "" : "s"} · r ${nice(r)}` : `${label} · r ${nice(r)}`);
  }

  if (action === "snap-grid") {
    const step = Math.max(0.01, amount ?? 8);
    for (const l of leaves) {
      const n = l.n;
      if (n.type === "path") {
        const next = l.subs.map((sp) => snapSubPath(sp, step));
        b.geometry(l, next);
        continue;
      }
      // Shapes and text keep their parameters: snap the origin (and a shape's size when unrotated/unscaled).
      const o = apply(l.M, 0, 0);
      const g = (v: number) => Math.round(v / step) * step;
      const patch = moveBy(doc, n, g(o[0]) - o[0], g(o[1]) - o[1]) as Record<string, unknown>;
      if (n.type === "shape" && isTranslation(l.M)) {
        patch.width = Math.max(step, g(n.width));
        patch.height = Math.max(step, g(n.height));
      }
      const same = JSON.stringify(patch.transform) === JSON.stringify(n.transform) && (patch.width ?? (n as ShapeNodeT).width) === (n as ShapeNodeT).width && (patch.height ?? (n as ShapeNodeT).height) === (n as ShapeNodeT).height;
      if (!same) b.update(n, patch, patch as Partial<NodeT>);
    }
    return done(`${label} · step ${nice(step)}`);
  }

  if (action === "optical-center") {
    const top = topIds(doc, ids).filter((id) => doc.nodes[id] && !opts.skip?.(doc.nodes[id]!));
    const f = top.length ? frameOf(doc, top[0]) : null;
    if (!f) {
      notes.add("Optical center works inside a version.");
      return done(`${label} · nothing to change`);
    }
    const tm: TypeMetricsFn | undefined = opts.textOutlines
      ? (n) => (opts.textOutlines![n.id] ? { capHeight: n.fontSize * 0.7, xHeight: n.fontSize * 0.5, d: opts.textOutlines![n.id]! } : null)
      : undefined;
    let vc: P | null = null;
    try {
      const m = lockupMetrics(doc, f.id, { parts: { mark: top, wordmark: [], source: "selection" }, typeMetrics: tm });
      if (m.mark) vc = visualCentreOf(m.mark);
    } catch {
      vc = null;
    }
    if (!vc) {
      notes.add("Nothing visible to center.");
      return done(`${label} · nothing to change`);
    }
    const dx = f.width / 2 - vc[0], dy = f.height / 2 - vc[1];
    if (Math.hypot(dx, dy) < 0.05) {
      notes.add("Already optically centered.");
      return done(`${label} · already centered`);
    }
    for (const id of top) {
      const n = doc.nodes[id]!;
      const patch = moveBy(doc, n, dx, dy);
      b.update(n, patch as Record<string, unknown>, patch);
    }
    const sg = (v: number) => `${v < 0 ? "−" : "+"}${nice(Math.abs(v))}`;
    return done(`${label} · moved x ${sg(dx)}, y ${sg(dy)}`);
  }

  // ── symmetric
  const keep = opts.side ?? "left";
  const shapes = leaves.filter((l) => l.subs.length && l.n.type !== "text");
  const found = symmetryAxis(shapes.map((l) => l.subs));
  if (!found) {
    notes.add("Nothing to mirror.");
    return done(`${label} · nothing to change`);
  }
  const { axis: ax } = found;
  const pct = Math.round(found.asymmetry * 100);
  if (found.asymmetry < 0.003 && Math.abs(ax - (st.box!.x + st.box!.w / 2)) < 0.5) {
    notes.add("Already symmetric.");
    return done(`${label} · already symmetric`);
  }
  if (found.asymmetry > 0.35 && !opts.force) {
    notes.add(`This isn't nearly symmetric (${pct}% of the ink differs from its mirror) — nothing changed. Select the parts that should mirror each other.`);
    return done(`${label} · not nearly symmetric`);
  }
  const eps = Math.max(1e-3, st.diag * 1e-3);
  const keepSide = (x0: number, x1: number): "kept" | "discard" | "cross" => {
    const kept = keep === "left" ? x1 <= ax + eps : x0 >= ax - eps;
    const disc = keep === "left" ? x0 >= ax - eps : x1 <= ax + eps;
    return kept ? "kept" : disc ? "discard" : "cross";
  };
  const sideOf = (subs: SubPath[]) => {
    const bx = subPathsBox(subs);
    return bx ? keepSide(bx.x, bx.x + bx.w) : "kept";
  };
  const keptLeaves = leaves.filter((l) => l.subs.length && l.n.type !== "text" && sideOf(l.subs) === "kept");
  const used = new Set<string>();
  let mirrored = 0;
  for (const l of leaves) {
    const n = l.n;
    if (!l.subs.length) continue;
    const side = sideOf(l.subs);
    if (side === "kept") continue;
    if (n.type === "text") {
      if (side === "cross") {
        const bx = subPathsBox(l.subs)!;
        const dx = ax - (bx.x + bx.w / 2);
        if (Math.abs(dx) > 0.01) {
          const patch = moveBy(doc, n, dx, 0);
          b.update(n, patch as Record<string, unknown>, patch);
        }
      } else notes.add(`Text “${n.text}” can't be mirrored — left as is.`);
      continue;
    }
    if (side === "discard") {
      // Replace by the mirror of its counterpart on the kept side.
      const bx = subPathsBox(l.subs)!;
      let best: { leaf: Leaf; iou: number } | null = null;
      for (const k of keptLeaves) {
        if (used.has(k.n.id)) continue;
        const kb = subPathsBox(k.subs)!;
        const iou = boxIoU(bx, { x: 2 * ax - (kb.x + kb.w), y: kb.y, w: kb.w, h: kb.h });
        if (iou > 0.3 && (!best || iou > best.iou)) best = { leaf: k, iou };
      }
      if (!best) {
        notes.add(`“${n.name || n.id}” has no counterpart on the other side — left as is.`);
        continue;
      }
      used.add(best.leaf.n.id);
      b.geometry(l, best.leaf.subs.map((sp) => mirrorSubPath(sp, ax)));
      mirrored++;
      continue;
    }
    // Crossing the axis: plain symmetric shapes just move onto it.
    if (n.type === "shape" && isTranslation(l.M) && n.transform.rotation === 0 && (n.shape === "rect" || n.shape === "ellipse" || n.shape === "polygon" || n.shape === "star")) {
      const bx = subPathsBox(l.subs)!;
      const dx = ax - (bx.x + bx.w / 2);
      if (Math.abs(dx) > 0.01) {
        const patch = moveBy(doc, n, dx, 0);
        b.update(n, patch as Record<string, unknown>, patch);
      }
      mirrored++;
      continue;
    }
    const out: SubPath[] = [];
    const tol = Math.max(0.01, diagOf(subPathsBox(l.subs)) * 4e-4);
    for (const sp of l.subs) {
      const bx = subPathsBox([sp]);
      const sd = bx ? keepSide(bx.x, bx.x + bx.w) : "kept";
      if (sd === "kept") out.push(sp, mirrorSubPath(sp, ax));
      else if (sd === "cross") {
        const exact = symmetrizeCrossing(sp, ax, keep, eps);
        if (exact) out.push(exact);
        else if (sp.closed) out.push(...symmetrizeRegion(sp, ax, keep, tol));
        else {
          out.push(sp);
          notes.add("An open line crossing the axis several times was left as is.");
        }
      }
    }
    b.geometry(l, out);
    mirrored++;
  }
  if (!mirrored && !b.ops.length) notes.add("Already symmetric.");
  else notes.add(`Mirrors the ${keep} half about x = ${nice(ax)} (${pct < 1 ? "under 1" : pct}% of the ink differed).`);
  return done(`${label} · ${keep} half kept`);
}

/** Refine raw path data (local coordinates) — handy for tests and one-off tools. */
export function refinePathData(d: string, action: Exclude<RefineAction, "optical-center">, amount: number, opts: { side?: "left" | "right"; axis?: number } = {}): string {
  const subs = parsePath(d);
  const diag = diagOf(subPathsBox(subs));
  switch (action) {
    case "simplify":
      return serializePath(subs.map((s) => simplifySubPath(s, diag * (0.0006 + 0.012 * (amount / 100) ** 2))));
    case "smooth":
      return serializePath(subs.map((s) => smoothSubPath(s, diag * 0.06 * (amount / 100))));
    case "bolder":
    case "thinner":
      return serializePath(offsetSubPaths(subs, action === "bolder" ? amount : -amount));
    case "round":
      return serializePath(subs.map((s) => roundSubPath(s, amount)));
    case "snap-grid":
      return serializePath(subs.map((s) => snapSubPath(s, amount)));
    case "symmetric": {
      const ax = opts.axis ?? symmetryAxis([subs])?.axis ?? 0;
      const keep = opts.side ?? "left";
      const b = subPathsBox(subs)!;
      const eps = Math.max(1e-3, diagOf(b) * 1e-3);
      const out: SubPath[] = [];
      for (const s of subs) {
        const bx = subPathsBox([s])!;
        const kept = keep === "left" ? bx.x + bx.w <= ax + eps : bx.x >= ax - eps;
        const disc = keep === "left" ? bx.x >= ax - eps : bx.x + bx.w <= ax + eps;
        if (kept) out.push(s, mirrorSubPath(s, ax));
        else if (!disc) out.push(symmetrizeCrossing(s, ax, keep, eps) ?? s);
      }
      return serializePath(out);
    }
  }
}
