import {
  booleanOpDWithPolyTree,
  ClipType,
  differenceD,
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  PolyTreeD,
  unionD,
  xorD,
  type PathD,
  type PathsD,
  type PolyPathD,
} from "@countertype/clipper2-ts";
import { apply, invert, multiply, shapeToPath, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { parsePath, serializePath, type Anchor, type P, type SubPath } from "./pathmodel";
import { fitPolyline } from "./fitcurve";
import type { OpT } from "./ops";
import type { DocT, NodeT, StyleT } from "./schema";

/**
 * Shape builder geometry: boolean operations that keep curves exact.
 *
 * Every outline is first described as exact pieces — line segments, circular arcs and cubic
 * Béziers (`Seg`). For the polygon clipping they are flattened finely and run through Clipper2
 * (Boost licence). The clipped rings are then *rebuilt on the original pieces*: every output
 * vertex is matched to the line / circle / cubic it lies on, consecutive vertices on the same
 * piece become one run, corners are moved onto the exact intersection of the two pieces that
 * meet there, and each run is emitted as a straight line, a true circular arc (cubic
 * approximation split at quadrant extremes) or the exact sub-curve of the source cubic.
 * So a lens cut from two circles is two exact arcs with sharp tips, straight edges stay
 * straight, and only stretches that match nothing (never seen in practice) fall back to a fit.
 */

// ───────────────────────── exact pieces ─────────────────────────

export type Seg =
  | { k: "line"; a: P; b: P }
  /** Arc of circle (c, r) from angle a0 (radians, y down) sweeping `sweep` (signed). */
  | { k: "arc"; c: P; r: number; a0: number; sweep: number }
  | { k: "cubic"; p: [P, P, P, P] };

export interface Contour {
  segs: Seg[];
  closed: boolean;
}

export interface Outline {
  contours: Contour[];
  fillRule: "nonzero" | "evenodd";
}

const TAU = Math.PI * 2;
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const addv = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mulv = (a: P, k: number): P => [a[0] * k, a[1] * k];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
const len = (a: P) => Math.hypot(a[0], a[1]);
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const wrapPi = (a: number) => {
  let x = a % TAU;
  if (x <= -Math.PI) x += TAU;
  else if (x > Math.PI) x -= TAU;
  return x;
};
export const arcAt = (c: P, r: number, a: number): P => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];

export function cubicAt(p: readonly [P, P, P, P], t: number): P {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}
function cubicD1(p: readonly [P, P, P, P], t: number): P {
  const u = 1 - t;
  return [
    3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]),
    3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]),
  ];
}
function cubicD2(p: readonly [P, P, P, P], t: number): P {
  return [
    6 * (1 - t) * (p[2][0] - 2 * p[1][0] + p[0][0]) + 6 * t * (p[3][0] - 2 * p[2][0] + p[1][0]),
    6 * (1 - t) * (p[2][1] - 2 * p[1][1] + p[0][1]) + 6 * t * (p[3][1] - 2 * p[2][1] + p[1][1]),
  ];
}
/** The part of a cubic between t0 and t1 (reversed when t0 > t1). */
export function subCubic(p: readonly [P, P, P, P], t0: number, t1: number): [P, P, P, P] {
  const split = (q: readonly [P, P, P, P], t: number): [[P, P, P, P], [P, P, P, P]] => {
    const a = lerp(q[0], q[1], t), b = lerp(q[1], q[2], t), c = lerp(q[2], q[3], t);
    const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
    return [[q[0], a, d, f], [f, e, c, q[3]]];
  };
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  let q: [P, P, P, P] = [p[0], p[1], p[2], p[3]];
  if (hi < 1) q = split(q, hi)[0];
  if (lo > 0) q = split(q, hi > 0 ? lo / hi : 0)[1];
  return t0 > t1 ? [q[3], q[2], q[1], q[0]] : q;
}

export const segStart = (s: Seg): P => (s.k === "line" ? s.a : s.k === "arc" ? arcAt(s.c, s.r, s.a0) : s.p[0]);
export const segEnd = (s: Seg): P => (s.k === "line" ? s.b : s.k === "arc" ? arcAt(s.c, s.r, s.a0 + s.sweep) : s.p[3]);

/** A full circle as one closed contour (starting at the top). */
export const circleContour = (c: P, r: number, clockwise = true): Contour => ({ segs: [{ k: "arc", c, r, a0: -Math.PI / 2, sweep: clockwise ? TAU : -TAU }], closed: true });

export const polygonContour = (pts: P[], closed = true): Contour => ({
  segs: pts.slice(0, closed ? pts.length : pts.length - 1).map((a, i) => ({ k: "line" as const, a, b: pts[(i + 1) % pts.length]! })),
  closed,
});

const isSimilarity = (M: Mat) => Math.abs(M[0] - M[3]) < 1e-9 * (Math.abs(M[0]) + Math.abs(M[3]) + 1) && Math.abs(M[1] + M[2]) < 1e-9 * (Math.abs(M[1]) + Math.abs(M[2]) + 1);

/** Map pieces through an affine matrix (arcs stay arcs under similarities, else become cubics). */
export function transformSegs(segs: Seg[], M: Mat): Seg[] {
  if (M === IDENTITY) return segs;
  const map = (q: P): P => apply(M, q[0], q[1]);
  const det = M[0] * M[3] - M[1] * M[2];
  return segs.flatMap((s): Seg[] => {
    if (s.k === "line") return [{ k: "line", a: map(s.a), b: map(s.b) }];
    if (s.k === "cubic") return [{ k: "cubic", p: [map(s.p[0]), map(s.p[1]), map(s.p[2]), map(s.p[3])] }];
    if (isSimilarity(M)) {
      const k = Math.sqrt(Math.abs(det));
      const rot = Math.atan2(M[1], M[0]);
      const flip = det < 0;
      const a0 = flip ? -s.a0 + rot : s.a0 + rot;
      return [{ k: "arc", c: map(s.c), r: s.r * k, a0, sweep: flip ? -s.sweep : s.sweep }];
    }
    return arcToCubics(s).map((p) => ({ k: "cubic" as const, p: [map(p[0]), map(p[1]), map(p[2]), map(p[3])] as [P, P, P, P] }));
  });
}

/** Arc → cubics: split at quadrant extremes (nodes at top/bottom/left/right), ≤ 90° each. */
export function arcToCubics(s: Extract<Seg, { k: "arc" }>): [P, P, P, P][] {
  const { c, r, a0, sweep } = s;
  const a1 = a0 + sweep;
  const dir = Math.sign(sweep) || 1;
  const cuts: number[] = [a0];
  const q = Math.PI / 2;
  // Interior multiples of 90° (skip ones within ~2.5° of an end: no near-duplicate nodes).
  const minGap = 0.045;
  let k = dir > 0 ? Math.floor(a0 / q) + 1 : Math.ceil(a0 / q) - 1;
  for (;; k += dir) {
    const a = k * q;
    if (dir > 0 ? a >= a1 - minGap : a <= a1 + minGap) break;
    if (Math.abs(a - a0) > minGap) cuts.push(a);
  }
  cuts.push(a1);
  const out: [P, P, P, P][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i]!, s1 = cuts[i + 1]!;
    const d = s1 - s0;
    // Pieces wider than 90° (only when an end sits close to an extreme) are halved.
    const parts = Math.max(1, Math.ceil(Math.abs(d) / (q + 1e-9)));
    for (let j = 0; j < parts; j++) {
      const b0 = s0 + (d * j) / parts, b1 = s0 + (d * (j + 1)) / parts;
      const h = (4 / 3) * Math.tan((b1 - b0) / 4) * r;
      const p0 = arcAt(c, r, b0), p3 = arcAt(c, r, b1);
      out.push([p0, [p0[0] - Math.sin(b0) * h, p0[1] + Math.cos(b0) * h], [p3[0] + Math.sin(b1) * h, p3[1] - Math.cos(b1) * h], p3]);
    }
  }
  return out;
}

function circumcenter(a: P, b: P, c: P): P | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = dot(a, a), b2 = dot(b, b), c2 = dot(c, c);
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

/** Intersection of the infinite lines p + s·u and q + t·v. */
function lineMeet(p: P, u: P, q: P, v: P): P | null {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-12 * len(u) * len(v)) return null;
  const s = cross(sub(q, p), v) / den;
  return addv(p, mulv(u, s));
}

/**
 * Classify a cubic: a straight line, an arc of a circle (as written by arc commands, our own
 * output or any standard arc approximation) or a free curve.
 */
export function classifyCubic(p: [P, P, P, P]): Seg {
  const chord = dist(p[0], p[3]);
  const h1 = sub(p[1], p[0]), h2 = sub(p[2], p[3]);
  const scale = Math.max(chord, len(h1), len(h2), 1e-9);
  // Straight: both handles on the chord.
  if (chord > 1e-9) {
    const dirv = mulv(sub(p[3], p[0]), 1 / chord);
    const off1 = Math.abs(cross(sub(p[1], p[0]), dirv)), off2 = Math.abs(cross(sub(p[2], p[0]), dirv));
    const t1 = dot(sub(p[1], p[0]), dirv), t2 = dot(sub(p[2], p[0]), dirv);
    if (off1 < 1e-6 * scale + 1e-7 && off2 < 1e-6 * scale + 1e-7 && t1 >= -1e-9 && t2 <= chord + 1e-9) return { k: "line", a: p[0], b: p[3] };
  }
  if (len(h1) < 1e-9 || len(h2) < 1e-9 || chord < 1e-9) return { k: "cubic", p };
  const m = cubicAt(p, 0.5);
  // Centre: where the normals at both ends meet (exact for arc approximations), else the circumcentre.
  const n1: P = [-h1[1], h1[0]], n2: P = [-h2[1], h2[0]];
  const angle = Math.abs(cross(mulv(n1, 1 / len(n1)), mulv(n2, 1 / len(n2))));
  const c = (angle > 0.17 ? lineMeet(p[0], n1, p[3], n2) : null) ?? circumcenter(p[0], m, p[3]);
  if (!c) return { k: "cubic", p };
  const r = (dist(c, p[0]) + dist(c, p[3])) / 2;
  if (!(r > 1e-6) || r > 1e7 || Math.abs(dist(c, p[0]) - dist(c, p[3])) > 1e-4 * r + 1e-4) return { k: "cubic", p };
  const thr = 4e-4 * r + 5e-4;
  for (const t of [0.15, 0.3, 0.5, 0.7, 0.85]) if (Math.abs(dist(cubicAt(p, t), c) - r) > thr) return { k: "cubic", p };
  // Handles must be tangent (perpendicular to the radius).
  if (Math.abs(dot(mulv(h1, 1 / len(h1)), mulv(sub(p[0], c), 1 / r))) > 0.02) return { k: "cubic", p };
  if (Math.abs(dot(mulv(h2, 1 / len(h2)), mulv(sub(p[3], c), 1 / r))) > 0.02) return { k: "cubic", p };
  const a0 = Math.atan2(p[0][1] - c[1], p[0][0] - c[0]);
  const a3 = Math.atan2(p[3][1] - c[1], p[3][0] - c[0]);
  const ccw = cross(sub(p[0], c), h1) > 0; // angle increases along the curve
  let sweep = ccw ? (a3 - a0 + TAU * 2) % TAU : -((a0 - a3 + TAU * 2) % TAU);
  if (Math.abs(sweep) < 1e-9) sweep = ccw ? TAU : -TAU;
  const am = Math.atan2(m[1] - c[1], m[0] - c[0]);
  if (Math.abs(wrapPi(am - (a0 + sweep / 2))) > 0.05) return { k: "cubic", p };
  return { k: "arc", c, r, a0, sweep };
}

/** Path data (local coordinates) → exact pieces in the space mapped by M. */
export function outlineFromPath(d: string, M: Mat = IDENTITY, fillRule: "nonzero" | "evenodd" = "nonzero"): Outline {
  const contours: Contour[] = [];
  const map = (q: P): P => apply(M, q[0], q[1]);
  for (const s of parsePath(d)) {
    const a = s.anchors;
    const n = a.length;
    const segs: Seg[] = [];
    const count = s.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const A = a[i]!, B = a[(i + 1) % n]!;
      const p0 = map(A.p), p3 = map(B.p);
      if (!A.cout && !B.cin) {
        if (dist(p0, p3) > 1e-9) segs.push({ k: "line", a: p0, b: p3 });
        continue;
      }
      const seg = classifyCubic([p0, map(A.cout ?? A.p), map(B.cin ?? B.p), p3]);
      if (seg.k === "line" && dist(seg.a, seg.b) < 1e-9) continue;
      segs.push(seg);
    }
    if (segs.length) contours.push({ segs, closed: s.closed });
  }
  return { contours, fillRule };
}

/** A path/shape node's outline (text needs its outline from the caller), mapped by M. */
export function nodeOutline(n: NodeT, M: Mat, textOutline?: string): Outline | null {
  if (n.type === "path") return outlineFromPath(n.d, M, n.style.fillRule);
  if (n.type === "shape") return outlineFromPath(shapeToPath(n), M, n.style.fillRule);
  if (n.type === "text" && textOutline) return outlineFromPath(textOutline, M, "nonzero");
  return null;
}

// ───────────────────────── flattening ─────────────────────────

export function flattenSeg(s: Seg, tol: number): P[] {
  if (s.k === "line") return [s.a, s.b];
  if (s.k === "arc") {
    const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / s.r)));
    const n = Math.min(4096, Math.max(2, Math.ceil(Math.abs(s.sweep) / Math.max(step, 1e-4))));
    return Array.from({ length: n + 1 }, (_, i) => arcAt(s.c, s.r, s.a0 + (s.sweep * i) / n));
  }
  const p = s.p;
  const dd = Math.max(Math.hypot(p[0][0] - 2 * p[1][0] + p[2][0], p[0][1] - 2 * p[1][1] + p[2][1]), Math.hypot(p[1][0] - 2 * p[2][0] + p[3][0], p[1][1] - 2 * p[2][1] + p[3][1]));
  const n = Math.min(512, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / Math.max(1e-6, tol)))));
  return Array.from({ length: n + 1 }, (_, i) => cubicAt(p, i / n));
}

export function flattenContour(c: Contour, tol: number): P[] {
  const out: P[] = [];
  for (const s of c.segs) {
    const pts = flattenSeg(s, tol);
    for (let i = out.length ? 1 : 0; i < pts.length; i++) out.push(pts[i]!);
  }
  if (c.closed && out.length > 1 && dist(out[0]!, out[out.length - 1]!) < 1e-9) out.pop();
  return out;
}

export const toPathD = (pts: P[]): PathD => pts.map(([x, y]) => ({ x, y }));
export const fromPathD = (p: PathD): P[] => p.map((q) => [q.x, q.y]);
/** Clipper precision (decimal places). */
export const PREC = 4;

/** The filled area of an outline as clean polygons (holes reversed). Open contours are closed, as SVG fills them. */
export function outlineRegion(o: Outline, tol: number): PathsD {
  const rings = o.contours.map((c) => flattenContour(c, tol)).filter((r) => r.length >= 3).map(toPathD);
  return rings.length ? unionD(rings, o.fillRule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero) : [];
}

export const ringArea = (p: PathD) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]!.x + p[i]!.x) * (p[j]!.y - p[i]!.y);
  return a / 2;
};

/** Winding number of the point in polygons (non-zero = inside a clean region). */
export function windingAt(paths: PathsD, q: P): number {
  let w = 0;
  for (const ring of paths) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!, b = ring[i]!;
      if (a.y <= q[1]) {
        if (b.y > q[1] && (b.x - a.x) * (q[1] - a.y) - (q[0] - a.x) * (b.y - a.y) > 0) w++;
      } else if (b.y <= q[1] && (b.x - a.x) * (q[1] - a.y) - (q[0] - a.x) * (b.y - a.y) < 0) w--;
    }
  }
  return w;
}

export interface GBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export function pathsBox(paths: PathsD): GBox {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const r of paths)
    for (const q of r) {
      if (q.x < b.x0) b.x0 = q.x;
      if (q.y < b.y0) b.y0 = q.y;
      if (q.x > b.x1) b.x1 = q.x;
      if (q.y > b.y1) b.y1 = q.y;
    }
  return b;
}
export const boxesTouch = (a: GBox, b: GBox, pad = 0) => a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;

/** Connected pieces of a region: each outer ring with its own holes. */
export function regionComponents(paths: PathsD): PathsD[] {
  if (!paths.length) return [];
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(ClipType.Union, paths, null, tree, FillRule.NonZero, PREC);
  const out: PathsD[] = [];
  const visit = (node: PolyPathD) => {
    for (let i = 0; i < node.count; i++) {
      const outer = node.child(i);
      const comp: PathsD = outer.poly ? [outer.poly] : [];
      for (let j = 0; j < outer.count; j++) {
        const hole = outer.child(j);
        if (hole.poly) comp.push(hole.poly);
        visit(hole);
      }
      if (comp.length) out.push(comp);
    }
  };
  visit(tree);
  return out;
}

// ───────────────────────── primitives for rebuilding ─────────────────────────

export type Prim =
  /** Infinite line through a with unit direction u. */
  | { k: "line"; a: P; u: P }
  | { k: "circle"; c: P; r: number }
  | { k: "cubic"; p: [P, P, P, P] };

interface Sample {
  prim: number;
  a: P;
  b: P;
  /** Cubic parameters at a and b. */
  t0: number;
  t1: number;
}

/** The exact pieces boundaries can be rebuilt on, deduplicated, with a spatial index of their samples. */
export class PrimSet {
  prims: Prim[] = [];
  private samples: Sample[] = [];
  private grid = new Map<string, number[]>();
  private cell = 1;
  private built = false;
  constructor(
    public tol: number,
    public eps: number,
  ) {}

  private find(p: Prim): number {
    const e = this.eps * 0.25;
    for (let i = 0; i < this.prims.length; i++) {
      const q = this.prims[i]!;
      if (q.k !== p.k) continue;
      // Circles read back from rounded path data are a hair off: merge within 0.04% of the radius.
      const ec = p.k === "circle" && q.k === "circle" ? Math.max(e, 4e-4 * Math.max(p.r, q.r)) : e;
      if (p.k === "circle" && q.k === "circle" && dist(p.c, q.c) < ec && Math.abs(p.r - q.r) < ec) return i;
      if (p.k === "line" && q.k === "line" && Math.abs(cross(p.u, q.u)) < 1e-7 && Math.abs(cross(sub(p.a, q.a), q.u)) < e) return i;
      if (p.k === "cubic" && q.k === "cubic") {
        const same = p.p.every((v, j) => dist(v, q.p[j]!) < e);
        const rev = p.p.every((v, j) => dist(v, q.p[3 - j]!) < e);
        if (same || rev) return i;
      }
    }
    this.prims.push(p);
    return this.prims.length - 1;
  }

  /** Register a piece (its primitive and its flattened samples). */
  add(s: Seg): number {
    this.built = false;
    let id: number;
    if (s.k === "line") {
      const d = sub(s.b, s.a);
      const l = len(d);
      if (l < 1e-9) return -1;
      let u = mulv(d, 1 / l);
      if (u[0] < -1e-12 || (Math.abs(u[0]) <= 1e-12 && u[1] < 0)) u = mulv(u, -1);
      id = this.find({ k: "line", a: s.a, u });
      this.samples.push({ prim: id, a: s.a, b: s.b, t0: 0, t1: 0 });
      return id;
    }
    if (s.k === "arc") {
      id = this.find({ k: "circle", c: s.c, r: s.r });
      const pts = flattenSeg(s, this.tol);
      for (let i = 0; i < pts.length - 1; i++) this.samples.push({ prim: id, a: pts[i]!, b: pts[i + 1]!, t0: 0, t1: 0 });
      return id;
    }
    id = this.find({ k: "cubic", p: s.p });
    const q = this.prims[id] as Extract<Prim, { k: "cubic" }>;
    const rev = q.p[0] !== s.p[0] && dist(q.p[0], s.p[0]) > this.eps;
    const n = Math.max(8, flattenSeg(s, this.tol).length - 1);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const ta = rev ? 1 - t0 : t0, tb = rev ? 1 - t1 : t1;
      this.samples.push({ prim: id, a: cubicAt(q.p, ta), b: cubicAt(q.p, tb), t0: ta, t1: tb });
    }
    return id;
  }

  addContours(cs: Contour[]) {
    for (const c of cs) for (const s of c.segs) this.add(s);
  }

  private key = (i: number, j: number) => `${i},${j}`;

  private build() {
    if (this.built) return;
    this.built = true;
    this.grid.clear();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.samples) {
      x0 = Math.min(x0, s.a[0], s.b[0]);
      y0 = Math.min(y0, s.a[1], s.b[1]);
      x1 = Math.max(x1, s.a[0], s.b[0]);
      y1 = Math.max(y1, s.a[1], s.b[1]);
    }
    const ext = Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0, 1) : 1;
    this.cell = Math.max(this.eps * 4, ext / 160);
    const e = this.eps * 1.5;
    this.samples.forEach((s, idx) => {
      const i0 = Math.floor((Math.min(s.a[0], s.b[0]) - e) / this.cell), i1 = Math.floor((Math.max(s.a[0], s.b[0]) + e) / this.cell);
      const j0 = Math.floor((Math.min(s.a[1], s.b[1]) - e) / this.cell), j1 = Math.floor((Math.max(s.a[1], s.b[1]) + e) / this.cell);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          // Long lines cross many cells: only keep cells the segment actually passes near.
          if (i1 - i0 > 2 && j1 - j0 > 2) {
            const cc: P = [(i + 0.5) * this.cell, (j + 0.5) * this.cell];
            if (segDist(cc, s.a, s.b) > this.cell * 0.75 + e) continue;
          }
          const k = this.key(i, j);
          const list = this.grid.get(k);
          if (list) list.push(idx);
          else this.grid.set(k, [idx]);
        }
    });
  }

  /** Primitives within `eps` of q, with the distance and (cubics) the parameter there. */
  near(q: P, eps = this.eps): Map<number, { d: number; t: number }> {
    this.build();
    const out = new Map<number, { d: number; t: number }>();
    const list = this.grid.get(this.key(Math.floor(q[0] / this.cell), Math.floor(q[1] / this.cell)));
    if (!list) return out;
    for (const idx of list) {
      const s = this.samples[idx]!;
      const pr = this.prims[s.prim]!;
      let d: number;
      let t = 0;
      if (pr.k === "cubic") {
        const ab = sub(s.b, s.a);
        const L2 = dot(ab, ab);
        const w = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, s.a), ab) / L2)) : 0;
        d = dist(q, lerp(s.a, s.b, w));
        t = s.t0 + (s.t1 - s.t0) * w;
      } else {
        if (segDist(q, s.a, s.b) > eps + this.tol) continue;
        d = primDist(pr, q);
      }
      if (d > eps) continue;
      const cur = out.get(s.prim);
      if (!cur || d < cur.d) out.set(s.prim, { d, t });
    }
    return out;
  }
}

function segDist(q: P, a: P, b: P): number {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const w = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2)) : 0;
  return dist(q, lerp(a, b, w));
}

/** Nearest point on a primitive: its parameter (line: distance along u, circle: angle, cubic: t). */
export function primProject(pr: Prim, q: P, guess?: number): { t: number; q: P; d: number } {
  if (pr.k === "line") {
    const t = dot(sub(q, pr.a), pr.u);
    const f = addv(pr.a, mulv(pr.u, t));
    return { t, q: f, d: dist(q, f) };
  }
  if (pr.k === "circle") {
    const t = Math.atan2(q[1] - pr.c[1], q[0] - pr.c[0]);
    const f = arcAt(pr.c, pr.r, t);
    return { t, q: f, d: dist(q, f) };
  }
  let t = guess ?? 0;
  if (guess === undefined) {
    let best = Infinity;
    for (let i = 0; i <= 64; i++) {
      const d = dist(cubicAt(pr.p, i / 64), q);
      if (d < best) {
        best = d;
        t = i / 64;
      }
    }
  }
  for (let k = 0; k < 12; k++) {
    const b = cubicAt(pr.p, t), d1 = cubicD1(pr.p, t), d2 = cubicD2(pr.p, t);
    const r = sub(b, q);
    const den = dot(d1, d1) + dot(r, d2);
    if (Math.abs(den) < 1e-12) break;
    const nt = Math.max(0, Math.min(1, t - dot(r, d1) / den));
    if (Math.abs(nt - t) < 1e-10) {
      t = nt;
      break;
    }
    t = nt;
  }
  const f = cubicAt(pr.p, t);
  return { t, q: f, d: dist(q, f) };
}

export const primDist = (pr: Prim, q: P): number =>
  pr.k === "line" ? Math.abs(cross(sub(q, pr.a), pr.u)) : pr.k === "circle" ? Math.abs(dist(q, pr.c) - pr.r) : primProject(pr, q).d;

const primPoint = (pr: Prim, t: number): P => (pr.k === "line" ? addv(pr.a, mulv(pr.u, t)) : pr.k === "circle" ? arcAt(pr.c, pr.r, t) : cubicAt(pr.p, t));
const primTangent = (pr: Prim, t: number): P => (pr.k === "line" ? pr.u : pr.k === "circle" ? [-Math.sin(t) * pr.r, Math.cos(t) * pr.r] : cubicD1(pr.p, t));

/** Exact meeting point of two primitives near q (analytic for lines/circles, Newton otherwise). */
export function primMeet(A: Prim, B: Prim, q: P, maxMove: number): P | null {
  const pick = (cands: P[]): P | null => {
    let best: P | null = null;
    for (const c of cands) if (!best || dist(c, q) < dist(best, q)) best = c;
    return best && dist(best, q) <= maxMove ? best : null;
  };
  if (A.k === "line" && B.k === "line") return pick([lineMeet(A.a, A.u, B.a, B.u)].filter((x): x is P => !!x));
  if (A.k === "circle" && B.k === "circle") return pick(circleCircle(A.c, A.r, B.c, B.r, maxMove));
  if (A.k === "line" && B.k === "circle") return pick(lineCircle(A.a, A.u, B.c, B.r, maxMove));
  if (A.k === "circle" && B.k === "line") return pick(lineCircle(B.a, B.u, A.c, A.r, maxMove));
  // Newton on P_A(s) = P_B(t).
  let s = primProject(A, q).t;
  let t = primProject(B, q).t;
  for (let k = 0; k < 30; k++) {
    const pa = primPoint(A, s), pb = primPoint(B, t);
    const r = sub(pa, pb);
    if (len(r) < 1e-9) break;
    const da = primTangent(A, s), db = primTangent(B, t);
    const det = -da[0] * db[1] + da[1] * db[0];
    if (Math.abs(det) < 1e-12) return null;
    // [da, -db] [ds, dt]^T = -r
    const ds = (-r[0] * -db[1] - -db[0] * -r[1]) / det;
    const dt = (da[0] * -r[1] - da[1] * -r[0]) / det;
    s += ds;
    t += dt;
    if (A.k === "cubic") s = Math.max(-0.05, Math.min(1.05, s));
    if (B.k === "cubic") t = Math.max(-0.05, Math.min(1.05, t));
  }
  const pa = primPoint(A, s), pb = primPoint(B, t);
  if (dist(pa, pb) > 1e-5 * (1 + len(pa))) return null;
  return pick([pa]);
}

function circleCircle(c1: P, r1: number, c2: P, r2: number, slack: number): P[] {
  const d = dist(c1, c2);
  if (d < 1e-12) return [];
  const u = mulv(sub(c2, c1), 1 / d);
  // Tangent (or nearly): the touching point on the line of centres.
  if (Math.abs(d - (r1 + r2)) < slack * 0.5) return [addv(c1, mulv(u, r1 + (d - r1 - r2) / 2))];
  if (Math.abs(d - Math.abs(r1 - r2)) < slack * 0.5) {
    const s = r1 >= r2 ? 1 : -1;
    return [addv(c1, mulv(u, s * (r1 + r2 + d * s) / 2))];
  }
  if (d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = addv(c1, mulv(u, a));
  const nrm: P = [-u[1], u[0]];
  return [addv(m, mulv(nrm, h)), addv(m, mulv(nrm, -h))];
}

function lineCircle(a: P, u: P, c: P, r: number, slack: number): P[] {
  const t0 = dot(sub(c, a), u);
  const foot = addv(a, mulv(u, t0));
  const h = dist(foot, c);
  if (Math.abs(h - r) < slack * 0.5) return [foot];
  if (h > r) return [];
  const w = Math.sqrt(r * r - h * h);
  return [addv(foot, mulv(u, w)), addv(foot, mulv(u, -w))];
}

// ───────────────────────── rebuilding rings on primitives ─────────────────────────

interface Run {
  prim: number; // -1 = matches nothing (kept as points)
  pts: P[]; // ring vertices of the run, first and last are its corners
  ts: number[]; // cubic params per vertex
}

/** Rebuild one clipped ring as exact pieces. */
export function rebuildRing(ring: P[], ps: PrimSet): Seg[] {
  const eps = ps.eps;
  // Drop duplicate points.
  const pts: P[] = [];
  for (const q of ring) if (!pts.length || dist(pts[pts.length - 1]!, q) > 1e-7) pts.push(q);
  while (pts.length > 1 && dist(pts[0]!, pts[pts.length - 1]!) <= 1e-7) pts.pop();
  const n = pts.length;
  if (n < 3) return [];
  const cand = pts.map((q) => ps.near(q));
  // Candidate primitives per edge: on both ends and through the middle.
  const edges: Map<number, number>[] = [];
  for (let i = 0; i < n; i++) {
    const a = cand[i]!, b = cand[(i + 1) % n]!;
    const m = lerp(pts[i]!, pts[(i + 1) % n]!, 0.5);
    const e = new Map<number, number>();
    for (const [id, va] of a) {
      const vb = b.get(id);
      if (!vb) continue;
      const pr = ps.prims[id]!;
      const dm = pr.k === "cubic" ? primProject(pr, m, (va.t + vb.t) / 2).d : primDist(pr, m);
      if (dm <= eps) e.set(id, Math.max(va.d, vb.d, dm));
    }
    edges.push(e);
  }
  // Viterbi over the cycle (starting at the least ambiguous edge): fewest piece changes.
  let start = 0;
  let bestCount = Infinity;
  for (let i = 0; i < n; i++) {
    const c = edges[i]!.size || 99;
    if (c < bestCount) {
      bestCount = c;
      start = i;
      if (c === 1) break;
    }
  }
  const order = Array.from({ length: n }, (_, k) => (start + k) % n);
  const FREE = -1;
  const states = order.map((i) => [...edges[i]!.keys(), FREE]);
  const cost: number[][] = [];
  const back: number[][] = [];
  const emit = (i: number, s: number) => (s === FREE ? 3 : (edges[i]!.get(s)! / eps) * 0.05);
  cost.push(states[0]!.map((s) => emit(order[0]!, s) + (s === FREE && states[0]!.length > 1 ? 10 : 0)));
  back.push(states[0]!.map(() => -1));
  for (let k = 1; k < n; k++) {
    const row: number[] = [];
    const brow: number[] = [];
    for (const s of states[k]!) {
      let best = Infinity, bi = 0;
      states[k - 1]!.forEach((ps0, j) => {
        const c = cost[k - 1]![j]! + (ps0 === s ? 0 : 1);
        if (c < best) {
          best = c;
          bi = j;
        }
      });
      row.push(best + emit(order[k]!, s));
      brow.push(bi);
    }
    cost.push(row);
    back.push(brow);
  }
  // Prefer ending on the start state (closes the cycle without an extra change).
  const last = cost[n - 1]!;
  let bj = 0;
  let bc = Infinity;
  last.forEach((c, j) => {
    const v = c + (states[n - 1]![j] === states[0]![0] ? 0 : 1);
    if (v < bc) {
      bc = v;
      bj = j;
    }
  });
  const assign: number[] = new Array(n);
  for (let k = n - 1; k >= 0; k--) {
    assign[k] = states[k]![bj]!;
    bj = back[k]![bj]!;
  }
  // Runs of equal primitives (in `order`), merging the wrap-around.
  const runs: Run[] = [];
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    const j = (i + 1) % n;
    const s = assign[k]!;
    const tOf = (v: number) => cand[v]!.get(s)?.t ?? 0;
    const cur = runs[runs.length - 1];
    if (cur && cur.prim === s) {
      cur.pts.push(pts[j]!);
      cur.ts.push(tOf(j));
    } else runs.push({ prim: s, pts: [pts[i]!, pts[j]!], ts: [tOf(i), tOf(j)] });
  }
  if (runs.length > 1 && runs[0]!.prim === runs[runs.length - 1]!.prim && runs[0]!.prim !== FREE) {
    const l = runs.pop()!;
    runs[0] = { prim: l.prim, pts: [...l.pts, ...runs[0]!.pts.slice(1)], ts: [...l.ts, ...runs[0]!.ts.slice(1)] };
  }
  return runsToSegs(runs, ps);
}

function runsToSegs(runs0: Run[], ps: PrimSet): Seg[] {
  const eps = ps.eps;
  let runs = runs0;
  if (runs.length === 1) {
    const r = runs[0]!;
    const pr = r.prim >= 0 ? ps.prims[r.prim]! : null;
    if (pr?.k === "circle") {
      // A whole circle (orientation from the ring's turning direction) — only if the ring really goes round.
      const sw = measuredSweep([...r.pts, r.pts[0]!], pr.c);
      if (Math.abs(sw) > TAU * 0.95) return [{ k: "arc", c: pr.c, r: pr.r, a0: -Math.PI / 2, sweep: sw >= 0 ? TAU : -TAU }];
      return [];
    }
    return freeSegs(r.pts, ps.tol, true);
  }
  // Corners: exact meeting points of neighbouring runs; degenerate runs (antennas, slivers) are dropped.
  for (let guard = 0; guard < 400; guard++) {
    const m = runs.length;
    if (m < 2) break;
    const corners: P[] = runs.map((r, k) => {
      const prev = runs[(k - 1 + m) % m]!;
      const q = r.pts[0]!;
      if (r.prim < 0 || prev.prim < 0) return q;
      return primMeet(ps.prims[prev.prim]!, ps.prims[r.prim]!, q, eps * 6) ?? q;
    });
    let drop = -1;
    for (let k = 0; k < m; k++) {
      const r = runs[k]!;
      const a = corners[k]!, b = corners[(k + 1) % m]!;
      const pr = r.prim >= 0 ? ps.prims[r.prim]! : null;
      let tiny: boolean;
      if (pr?.k === "circle") tiny = Math.abs(measuredSweep(r.pts, pr.c)) * pr.r < eps * 0.75 && dist(a, b) < eps * 0.75;
      else if (!pr) tiny = polyLen(r.pts) < eps * 0.75;
      else tiny = dist(a, b) < eps * 0.75 && polyLen(r.pts) < eps * 4;
      // Lines only: out-and-back along the same line (antennas from cuts) collapse.
      if (!tiny && pr?.k === "line" && dist(a, b) < eps * 0.75) tiny = true;
      if (tiny) {
        drop = k;
        break;
      }
    }
    if (drop < 0) {
      return runs.flatMap((r, k): Seg[] => emitRun(r, corners[k]!, corners[(k + 1) % m]!, ps));
    }
    const next = runs.filter((_, k) => k !== drop);
    // Merge neighbours that are now on the same primitive.
    const merged: Run[] = [];
    for (const r of next) {
      const cur = merged[merged.length - 1];
      if (cur && cur.prim === r.prim && r.prim >= 0) {
        cur.pts.push(...r.pts.slice(1));
        cur.ts.push(...r.ts.slice(1));
      } else merged.push({ prim: r.prim, pts: [...r.pts], ts: [...r.ts] });
    }
    if (merged.length > 1 && merged[0]!.prim === merged[merged.length - 1]!.prim && merged[0]!.prim >= 0) {
      const l = merged.pop()!;
      merged[0] = { prim: l.prim, pts: [...l.pts, ...merged[0]!.pts.slice(1)], ts: [...l.ts, ...merged[0]!.ts.slice(1)] };
    }
    runs = merged;
    if (runs.length === 1) return runsToSegs(runs, ps);
  }
  return [];
}

const polyLen = (pts: P[]) => pts.reduce((a, q, i) => (i ? a + dist(pts[i - 1]!, q) : 0), 0);
function measuredSweep(pts: P[], c: P): number {
  let sw = 0;
  for (let i = 0; i < pts.length - 1; i++) sw += wrapPi(Math.atan2(pts[i + 1]![1] - c[1], pts[i + 1]![0] - c[0]) - Math.atan2(pts[i]![1] - c[1], pts[i]![0] - c[0]));
  return sw;
}

function emitRun(r: Run, a: P, b: P, ps: PrimSet): Seg[] {
  if (r.prim < 0) {
    const pts = [a, ...r.pts.slice(1, -1), b];
    return freeSegs(pts, ps.tol, false);
  }
  const pr = ps.prims[r.prim]!;
  if (pr.k === "line") return dist(a, b) > 1e-9 ? [{ k: "line", a, b }] : [];
  if (pr.k === "circle") {
    const a0 = Math.atan2(a[1] - pr.c[1], a[0] - pr.c[0]);
    const a1 = Math.atan2(b[1] - pr.c[1], b[0] - pr.c[0]);
    const meas = measuredSweep(r.pts, pr.c);
    let sw = a1 - a0;
    sw += Math.round((meas - sw) / TAU) * TAU;
    if (Math.abs(sw) < 1e-9) return [];
    return [{ k: "arc", c: pr.c, r: pr.r, a0, sweep: sw }];
  }
  const t0 = primProject(pr, a, r.ts[0]).t;
  const t1 = primProject(pr, b, r.ts[r.ts.length - 1]).t;
  if (Math.abs(t1 - t0) < 1e-9) return dist(a, b) > 1e-9 ? [{ k: "line", a, b }] : [];
  const c = subCubic(pr.p, t0, t1);
  // Pin the ends to the exact corners.
  c[0] = a;
  c[3] = b;
  return [{ k: "cubic", p: c }];
}

/** Points that match no primitive: straight runs stay lines, the rest is fitted. */
function freeSegs(pts: P[], tol: number, closed: boolean): Seg[] {
  const s = fitPolyline(pts, closed, tol * 2);
  if (!s) return [];
  const out: Seg[] = [];
  const a = s.anchors;
  const count = closed ? a.length : a.length - 1;
  for (let i = 0; i < count; i++) {
    const A = a[i]!, B = a[(i + 1) % a.length]!;
    if (!A.cout && !B.cin) out.push({ k: "line", a: A.p, b: B.p });
    else out.push({ k: "cubic", p: [A.p, A.cout ?? A.p, B.cin ?? B.p, B.p] });
  }
  return out;
}

/** Exact pieces of a closed contour → editable sub-path (arcs become quadrant-split cubics). */
export function segsToSubPath(segs: Seg[], closed = true): SubPath | null {
  if (!segs.length) return null;
  const anchors: Anchor[] = [{ p: segStart(segs[0]!), cin: null, cout: null }];
  const push = (cout: P | null, cin: P | null, p: P) => {
    anchors[anchors.length - 1]!.cout = cout;
    anchors.push({ p, cin, cout: null });
  };
  for (const s of segs) {
    if (s.k === "line") push(null, null, s.b);
    else if (s.k === "cubic") push(s.p[1], s.p[2], s.p[3]);
    else for (const c of arcToCubics(s)) push(c[1], c[2], c[3]);
  }
  if (closed && anchors.length > 1) {
    const last = anchors.pop()!;
    anchors[0]!.cin = last.cin;
    // Snap the seam exactly.
    anchors[anchors.length - 1]!.cout ??= null;
  }
  return { anchors, closed };
}

/** Clipped region → path data rebuilt on the exact primitives. Specks below the tolerance are dropped. */
export function regionToExactPath(region: PathsD, ps: PrimSet): string {
  const subs: SubPath[] = [];
  const minArea = ps.tol * ps.tol * 8;
  for (const ring of region) {
    if (ring.length < 3) continue;
    // Specks and slivers (clipping leftovers along shared edges): area tiny for their length.
    const a = Math.abs(ringArea(ring));
    let per = 0;
    for (let i = 0; i < ring.length; i++) per += Math.hypot(ring[i]!.x - ring[(i + 1) % ring.length]!.x, ring[i]!.y - ring[(i + 1) % ring.length]!.y);
    if (a < minArea || a < per * ps.tol * 0.5) continue;
    const segs = rebuildRing(fromPathD(ring), ps);
    const s = segsToSubPath(segs, true);
    if (s && s.anchors.length >= 2) subs.push(s);
  }
  return serializePath(subs);
}

// ───────────────────────── boolean operations ─────────────────────────

export const BOOLEAN_OPS = ["union", "subtract", "intersect", "exclude", "divide"] as const;
export type BooleanOp = (typeof BOOLEAN_OPS)[number];

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: "Union",
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
  divide: "Divide",
};

/** Flattening tolerance for a drawing of this size (fine: ~0.004% of the extent). */
export const shapeTolerance = (extent: number) => Math.max(0.005, Math.min(0.25, extent * 4e-5));

export interface BooleanResult {
  /** Path data of each result (one for union/subtract/intersect/exclude, one per piece for divide). */
  paths: string[];
  /** Divide: index of the input that paints each piece (the top-most covering it). */
  owners: number[];
}

/**
 * Booleans on shapes given as outlines in one coordinate space. Each input may be several
 * outlines (a group); inputs are in paint order *as passed*: subtract = input 0 minus the rest,
 * divide = every piece of the overlay, owned by the last input covering it.
 */
export function booleanShapes(inputs: Outline[][], op: BooleanOp, tol?: number): BooleanResult {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of inputs.flat())
    for (const c of o.contours)
      for (const s of c.segs)
        for (const q of [segStart(s), segEnd(s), ...(s.k === "arc" ? [[s.c[0] - s.r, s.c[1] - s.r] as P, [s.c[0] + s.r, s.c[1] + s.r] as P] : [])]) {
          x0 = Math.min(x0, q[0]);
          y0 = Math.min(y0, q[1]);
          x1 = Math.max(x1, q[0]);
          y1 = Math.max(y1, q[1]);
        }
  const t = tol ?? shapeTolerance(Number.isFinite(x0) ? Math.max(x1 - x0, y1 - y0) : 1000);
  const ps = new PrimSet(t, t * 2.5 + 2 * 10 ** -PREC);
  for (const o of inputs.flat()) ps.addContours(o.contours);
  const regions = inputs.map((group) => {
    const parts = group.flatMap((o) => outlineRegion(o, t));
    return parts.length ? unionD(parts, FillRule.NonZero) : [];
  });
  const NZ = FillRule.NonZero;
  const exact = (r: PathsD) => regionToExactPath(r, ps);
  if (op === "divide") {
    // Overlay: split every existing piece by each new input (paint order bottom → top).
    let pieces: { r: PathsD; owner: number }[] = [];
    regions.forEach((R, i) => {
      if (!R.length) return;
      const next: { r: PathsD; owner: number }[] = [];
      for (const p of pieces) {
        const inside = intersectD(p.r, R, NZ, PREC);
        const outside = differenceD(p.r, R, NZ, PREC);
        if (inside.length) next.push({ r: inside, owner: i });
        if (outside.length) next.push({ r: outside, owner: p.owner });
      }
      const covered = pieces.length ? unionD(pieces.map((p) => p.r).flat(), NZ) : [];
      const fresh = covered.length ? differenceD(R, covered, NZ, PREC) : R;
      if (fresh.length) next.push({ r: fresh, owner: i });
      pieces = next;
    });
    const out: BooleanResult = { paths: [], owners: [] };
    for (const p of pieces)
      for (const comp of regionComponents(p.r)) {
        const area = comp.reduce((a, r) => a + ringArea(r), 0);
        if (Math.abs(area) < t * t * 40) continue;
        const d = exact(comp);
        if (d) {
          out.paths.push(d);
          out.owners.push(p.owner);
        }
      }
    return out;
  }
  let res: PathsD;
  if (op === "union") res = unionD(regions.flat(), NZ);
  else if (op === "intersect") res = regions.slice(1).reduce((a, r) => intersectD(a, r, NZ, PREC), regions[0] ?? []);
  else if (op === "subtract") res = differenceD(regions[0] ?? [], unionD(regions.slice(1).flat(), NZ), NZ, PREC);
  else res = regions.slice(1).reduce((a, r) => xorD(a, r, NZ, PREC), regions[0] ?? []);
  const d = exact(res);
  return { paths: d ? [d] : [], owners: d ? [0] : [] };
}

/** Grow/shrink by a hair and back, so adjacent pieces fuse without seams (corners kept with mitres). */
export function fuseRegions(regions: PathsD[], hair: number): PathsD {
  const all = regions.flat();
  if (!all.length) return [];
  const grown = inflatePathsD(all, hair, JoinType.Miter, EndType.Polygon, 1000, PREC);
  return inflatePathsD(unionD(grown, FillRule.NonZero), -hair, JoinType.Miter, EndType.Polygon, 1000, PREC);
}

// ───────────────────────── document level ─────────────────────────

/** Leaves (path/shape/text) under a node, with their matrices into `space`. */
export function shapeLeaves(doc: DocT, id: string, space: Mat): { node: NodeT; M: Mat }[] {
  const inv = invert(space);
  const out: { node: NodeT; M: Mat }[] = [];
  const visit = (nid: string) => {
    const n = doc.nodes[nid];
    if (!n || !n.visible) return;
    if (n.type === "group") return n.children.forEach(visit);
    if (n.type === "path" || n.type === "shape" || n.type === "text") out.push({ node: n, M: multiply(inv, worldMatrix(doc, nid)) });
  };
  visit(id);
  return out;
}

export interface BooleanPlan {
  ops: OpT[];
  /** Ids of the result layers. */
  ids: string[];
  error?: string;
}

/**
 * Ops for a boolean on layers, in one undo step. `ids` order matters: the result keeps
 * ids[0]'s name, style and 3D settings and takes its place; subtract cuts the others out of ids[0].
 * Text layers need their outlines in `textOutlines` (local path data).
 */
export function booleanOps(doc: DocT, ids: string[], op: BooleanOp, o: { textOutlines?: Record<string, string>; newId?: () => string } = {}): BooleanPlan {
  const nodes = ids.map((id) => doc.nodes[id]);
  if (nodes.some((n) => !n)) return { ops: [], ids: [], error: `Not found: ${ids.filter((id) => !doc.nodes[id]).join(", ")}` };
  if (ids.length < (op === "divide" ? 1 : 2)) return { ops: [], ids: [], error: `${BOOLEAN_LABELS[op]} needs ${op === "divide" ? "at least one layer" : "two or more layers"}.` };
  const src = nodes[0]!;
  if (src.type === "frame") return { ops: [], ids: [], error: "Pick shapes, not a whole version." };
  const parentId = src.parent;
  const space = parentId ? worldMatrix(doc, parentId) : IDENTITY;
  const inputs: Outline[][] = [];
  for (const n of nodes) {
    const leaves = shapeLeaves(doc, n!.id, space);
    const outs: Outline[] = [];
    for (const l of leaves) {
      if (l.node.type === "text" && !o.textOutlines?.[l.node.id]) return { ops: [], ids: [], error: `Text "${l.node.type === "text" ? l.node.text : ""}" needs its outline: convert it to a path first.` };
      const ol = nodeOutline(l.node, l.M, o.textOutlines?.[l.node.id]);
      if (ol) outs.push(ol);
    }
    if (!outs.length) return { ops: [], ids: [], error: `"${n!.name || n!.id}" has no shape to combine.` };
    inputs.push(outs);
  }
  const r = booleanShapes(inputs, op);
  if (!r.paths.length) return { ops: [], ids: [], error: `${BOOLEAN_LABELS[op]} leaves nothing (the shapes don't overlap that way).` };
  const siblings = parentId ? ((doc.nodes[parentId] as { children?: string[] }).children ?? []) : doc.root;
  const index = siblings.indexOf(src.id);
  const mk = o.newId ?? (() => `n${Math.random().toString(36).slice(2, 10)}`);
  const styleOf = (n: NodeT): Partial<StyleT> => n.style;
  const ops: OpT[] = [];
  const out: string[] = [];
  r.paths.forEach((d, i) => {
    const owner = nodes[r.owners[i] ?? 0]!;
    const id = mk();
    out.push(id);
    const base = op === "divide" ? owner : src;
    ops.push({
      op: "add",
      node: {
        id,
        type: "path",
        name: op === "divide" && r.paths.length > 1 ? `${base.name || "Piece"} ${i + 1}` : base.name,
        d,
        style: styleOf(base),
        ...(base.extrude ? { extrude: base.extrude } : {}),
      },
      parent: parentId,
      index: index < 0 ? undefined : index + i,
    });
  });
  // Remove the inputs (top-most ancestors only).
  const set = new Set(ids);
  for (const id of ids) {
    let p = doc.nodes[id]!.parent;
    let inside = false;
    while (p) {
      if (set.has(p)) inside = true;
      p = doc.nodes[p]?.parent ?? null;
    }
    if (!inside) ops.push({ op: "remove", id });
  }
  return { ops, ids: out };
}
