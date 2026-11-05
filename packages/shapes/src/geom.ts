import { EndType, inflatePathsD, JoinType } from "@countertype/clipper2-ts";
import { fitPolyline } from "@brusshy/core/fitcurve";

/**
 * Tiny vector toolkit the shape generators are written with. Everything is kept as
 * closed contours of lines and cubics (arcs become cubics), so contours can be
 * transformed, reversed and oriented: solids run clockwise on screen, holes
 * counter-clockwise, which lets overlapping parts union under the nonzero rule.
 */

export type Pt = [number, number];
export type Seg = { p: Pt; c1?: Pt; c2?: Pt };
/** A closed contour: the last segment ends back at `start`. */
export interface Contour {
  start: Pt;
  segs: Seg[];
}

export const TAU = Math.PI * 2;
export const rad = (deg: number) => (deg * Math.PI) / 180;
const eq = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const unit = (a: Pt): Pt => {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
};
export const perp = (a: Pt): Pt => [-a[1], a[0]];

/** Compass polar point: 0° = up, angles grow clockwise on screen. */
export const polar = (cx: number, cy: number, r: number, deg: number): Pt => {
  const a = rad(deg - 90);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** Regular polygon vertices around (cx, cy), first vertex at `rot` (compass degrees). */
export const ngon = (n: number, r: number, rot = 0, cx = 50, cy = 50): Pt[] => Array.from({ length: n }, (_, i) => polar(cx, cy, r, rot + (360 * i) / n));

/** Star vertices: n outer points, alternating with inner ones. */
export const starPts = (n: number, ro: number, ri: number, rot = 0, cx = 50, cy = 50): Pt[] =>
  Array.from({ length: n * 2 }, (_, i) => polar(cx, cy, i % 2 ? ri : ro, rot + (180 * i) / n));

// ---------- building contours ----------

export const poly = (pts: Pt[]): Contour => close({ start: pts[0]!, segs: pts.slice(1).map((p) => ({ p })) });

export function close(c: Contour): Contour {
  const last = c.segs.length ? c.segs[c.segs.length - 1]!.p : c.start;
  if (!eq(last, c.start)) c.segs.push({ p: c.start });
  return c;
}

/** Cubic segments for an elliptical arc (standard angles in radians, y down = clockwise). */
export function arcSegs(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, rot = 0): Seg[] {
  const out: Seg[] = [];
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const da = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(da / 4);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const at = (a: number): Pt => {
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return [cx + x * cr - y * sr, cy + x * sr + y * cr];
  };
  const d = (a: number): Pt => {
    const x = -rx * Math.sin(a);
    const y = ry * Math.cos(a);
    return [x * cr - y * sr, x * sr + y * cr];
  };
  for (let i = 0; i < n; i++) {
    const s = a0 + da * i;
    const e = s + da;
    const p0 = at(s);
    const p1 = at(e);
    out.push({ c1: add(p0, mul(d(s), k)), c2: sub(p1, mul(d(e), k)), p: p1 });
  }
  return out;
}

/** Arc with compass degrees (0 = up, clockwise). */
export const arcC = (cx: number, cy: number, r: number, deg0: number, deg1: number, ry = r): Seg[] => arcSegs(cx, cy, r, ry, rad(deg0 - 90), rad(deg1 - 90));

export const circle = (cx: number, cy: number, r: number): Contour => ({ start: polar(cx, cy, r, 0), segs: arcC(cx, cy, r, 0, 360) });

export const ellipse = (cx: number, cy: number, rx: number, ry: number, rotDeg = 0): Contour => {
  const segs = arcSegs(cx, cy, rx, ry, 0, TAU, rad(rotDeg));
  return { start: segs[segs.length - 1]!.p, segs };
};

/** Fluent builder for contours mixing lines, cubics and arcs. */
export class Pen {
  private c: Contour;
  constructor(start: Pt) {
    this.c = { start, segs: [] };
  }
  get at(): Pt {
    return this.c.segs.length ? this.c.segs[this.c.segs.length - 1]!.p : this.c.start;
  }
  line(...ps: Pt[]) {
    for (const p of ps) this.c.segs.push({ p });
    return this;
  }
  curve(c1: Pt, c2: Pt, p: Pt) {
    this.c.segs.push({ c1, c2, p });
    return this;
  }
  /** Quadratic curve (converted to a cubic). */
  quad(q: Pt, p: Pt) {
    const a = this.at;
    return this.curve(lerp(a, q, 2 / 3), lerp(p, q, 2 / 3), p);
  }
  /** Arc around (cx, cy) in compass degrees; draws a line to the arc start first if needed. */
  arc(cx: number, cy: number, r: number, deg0: number, deg1: number, ry = r) {
    const s = polar(cx, cy, 1, deg0);
    const p0: Pt = [cx + (s[0] - cx) * r, cy + (s[1] - cy) * ry];
    if (!eq(this.at, p0)) this.line(p0);
    this.c.segs.push(...arcC(cx, cy, r, deg0, deg1, ry));
    return this;
  }
  /** Circular arc around `center` from the current point to `to` (clockwise on screen by default). */
  arcAround(center: Pt, to: Pt, cw = true) {
    const from = this.at;
    const r = len(sub(from, center));
    const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
    let a1 = Math.atan2(to[1] - center[1], to[0] - center[0]);
    if (cw) while (a1 <= a0 + 1e-9) a1 += TAU;
    else while (a1 >= a0 - 1e-9) a1 -= TAU;
    const segs = arcSegs(center[0], center[1], r, r, a0, a1);
    segs[segs.length - 1]!.p = to;
    this.c.segs.push(...segs);
    return this;
  }
  close(): Contour {
    return close(this.c);
  }
}

/** Exact annular sector between radii r1 < r2 (compass degrees), optionally with round ends. */
export function arcBand(cx: number, cy: number, r1: number, r2: number, deg0: number, deg1: number, round = false): Contour {
  const pen = new Pen(polar(cx, cy, r2, deg0)).arc(cx, cy, r2, deg0, deg1);
  const rm = (r1 + r2) / 2;
  const rc = (r2 - r1) / 2;
  const sgn = deg1 >= deg0 ? 1 : -1;
  if (round) {
    const c = polar(cx, cy, rm, deg1);
    pen.arc(c[0], c[1], rc, deg1, deg1 + 180 * sgn);
  }
  pen.arc(cx, cy, r1, deg1, deg0);
  if (round) {
    const c = polar(cx, cy, rm, deg0);
    pen.arc(c[0], c[1], rc, deg0 + 180 * sgn, deg0 + 360 * sgn);
  }
  return pen.close();
}

/** Polygon with rounded corners; `r` is the corner radius (per vertex if an array). */
export function roundPoly(pts: Pt[], r: number | number[]): Contour {
  const n = pts.length;
  const radius = (i: number) => (Array.isArray(r) ? (r[i] ?? 0) : r);
  if (pts.every((_, i) => radius(i) <= 1e-6)) return poly(pts);
  const corners = pts.map((C, i) => {
    const P = pts[(i - 1 + n) % n]!;
    const N = pts[(i + 1) % n]!;
    const v1 = unit(sub(C, P));
    const v2 = unit(sub(N, C));
    const cos = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1]));
    const th = Math.acos(cos);
    let rr = radius(i);
    if (th < 1e-4 || rr <= 1e-6) return { a: C, b: C, round: false as const };
    let d = rr * Math.tan(th / 2);
    const maxd = Math.min(len(sub(C, P)), len(sub(N, C))) / 2;
    if (d > maxd) {
      d = maxd;
      rr = d / Math.tan(th / 2);
    }
    const h = (4 / 3) * Math.tan(th / 4) * rr;
    const a = sub(C, mul(v1, d));
    const b = add(C, mul(v2, d));
    return { a, b, c1: add(a, mul(v1, h)), c2: sub(b, mul(v2, h)), round: true as const };
  });
  const segs: Seg[] = [];
  corners.forEach((k, i) => {
    if (k.round) segs.push({ c1: k.c1, c2: k.c2, p: k.b });
    const next = corners[(i + 1) % n]!;
    if (!eq(k.b, next.a)) segs.push({ p: next.a });
  });
  return close({ start: corners[0]!.a, segs });
}

/** Contour from fitted anchors (sampled curves become a few smooth cubics). */
export function fit(pts: Pt[], tol = 0.08, cornerDeg = 38): Contour {
  const sp = fitPolyline(pts, true, tol, cornerDeg);
  if (!sp || sp.anchors.length < 2) return poly(pts);
  const a = sp.anchors;
  const segs: Seg[] = [];
  for (let i = 0; i < a.length; i++) {
    const A = a[i]!;
    const B = a[(i + 1) % a.length]!;
    if (A.cout || B.cin) segs.push({ c1: (A.cout ?? A.p) as Pt, c2: (B.cin ?? B.p) as Pt, p: B.p as Pt });
    else segs.push({ p: B.p as Pt });
  }
  return close({ start: a[0]!.p as Pt, segs });
}

/** Closed Catmull-Rom spline through points (smooth blobs). */
export function smooth(pts: Pt[], tension = 1): Contour {
  const n = pts.length;
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    segs.push({ c1: add(p1, mul(sub(p2, p0), tension / 6)), c2: sub(p2, mul(sub(p3, p1), tension / 6)), p: p2 });
  }
  return { start: pts[0]!, segs };
}

/** Sample a parametric closed curve and fit it. */
export const sampled = (f: (t: number) => Pt, n = 96, tol = 0.06): Contour => fit(Array.from({ length: n }, (_, i) => f(i / n)), tol);

export type Cap = "round" | "butt" | "square";

/**
 * Outline of an open polyline drawn with a pen of width w (filled shape, not a stroke).
 * Dense input (a sampled curve) gives a smooth band; sharp turns keep mitred corners.
 */
export function stroke(pts: Pt[], w: number, cap: Cap = "round", opts: { profile?: (t: number) => number; tol?: number } = {}): Contour {
  const n = pts.length;
  const h = w / 2;
  const width = (i: number) => h * (opts.profile ? opts.profile(n > 1 ? i / (n - 1) : 0) : 1);
  const dirs = pts.slice(1).map((p, i) => unit(sub(p, pts[i]!)));
  const normals = pts.map((_, i) => {
    const a = dirs[Math.max(0, i - 1)]!;
    const b = dirs[Math.min(dirs.length - 1, i)]!;
    const m = unit(add(perp(a), perp(b)));
    const c = m[0] * perp(b)[0] + m[1] * perp(b)[1];
    return mul(m, 1 / Math.max(0.25, c));
  });
  const L = pts.map((p, i) => add(p, mul(normals[i]!, width(i))));
  const R = pts.map((p, i) => sub(p, mul(normals[i]!, width(i))));
  const capPts = (center: Pt, from: Pt, dir: Pt, r: number): Pt[] => {
    if (cap === "butt" || r < 1e-6) return [];
    if (cap === "square") {
      const o = mul(dir, r);
      const nrm = sub(from, center);
      return [add(from, o), sub(add(center, o), nrm)];
    }
    const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
    const fwd = Math.atan2(dir[1], dir[0]);
    const sgn = Math.cos(a0 + Math.PI / 2 - fwd) > 0 ? 1 : -1;
    const k = 14;
    return Array.from({ length: k - 1 }, (_, j) => {
      const a = a0 + (sgn * Math.PI * (j + 1)) / k;
      return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)] as Pt;
    });
  };
  const ring: Pt[] = [
    ...L,
    ...capPts(pts[n - 1]!, L[n - 1]!, dirs[dirs.length - 1]!, width(n - 1)),
    ...R.slice().reverse(),
    ...capPts(pts[0]!, R[0]!, mul(dirs[0]!, -1), width(0)),
  ];
  return fit(ring, opts.tol ?? 0.06, 30);
}

/** Band along a closed polyline: outer contour + hole. */
export function ringStroke(pts: Pt[], w: number): [Contour, Contour] {
  const n = pts.length;
  const out: Pt[] = [];
  const inn: Pt[] = [];
  pts.forEach((p, i) => {
    const a = unit(sub(p, pts[(i - 1 + n) % n]!));
    const b = unit(sub(pts[(i + 1) % n]!, p));
    const m = unit(add(perp(a), perp(b)));
    const c = m[0] * perp(b)[0] + m[1] * perp(b)[1];
    const nn = mul(m, w / 2 / Math.max(0.25, c));
    out.push(add(p, nn));
    inn.push(sub(p, nn));
  });
  return [fit(out, 0.05, 30), fit(inn, 0.05, 30)];
}

/** Sample a parametric open curve. */
export const curvePts = (f: (t: number) => Pt, n = 80): Pt[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));

// ---------- transforms ----------

export function mapC(c: Contour, f: (p: Pt) => Pt): Contour {
  return { start: f(c.start), segs: c.segs.map((s) => (s.c1 ? { c1: f(s.c1), c2: f(s.c2!), p: f(s.p) } : { p: f(s.p) })) };
}
export const rotateC = (c: Contour, deg: number, cx = 50, cy = 50): Contour => {
  const a = rad(deg);
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return mapC(c, ([x, y]) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]);
};
export const moveC = (c: Contour, dx: number, dy: number) => mapC(c, ([x, y]) => [x + dx, y + dy]);
export const scaleC = (c: Contour, sx: number, sy = sx, cx = 50, cy = 50) => mapC(c, ([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
export const mirrorX = (c: Contour, cx = 50) => reverse(mapC(c, ([x, y]) => [2 * cx - x, y]));

export function reverse(c: Contour): Contour {
  const ends = [c.start, ...c.segs.map((s) => s.p)];
  const segs: Seg[] = [];
  for (let i = c.segs.length - 1; i >= 0; i--) {
    const s = c.segs[i]!;
    const to = ends[i]!;
    segs.push(s.c1 ? { c1: s.c2!, c2: s.c1, p: to } : { p: to });
  }
  return { start: ends[ends.length - 1]!, segs };
}

/** Points along the contour (for area / bounds). */
export function flatten(c: Contour, k = 12): Pt[] {
  const out: Pt[] = [c.start];
  let prev = c.start;
  for (const s of c.segs) {
    if (s.c1) {
      for (let j = 1; j <= k; j++) {
        const t = j / k;
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
        out.push([a * prev[0] + b * s.c1[0] + cc * s.c2![0] + d * s.p[0], a * prev[1] + b * s.c1[1] + cc * s.c2![1] + d * s.p[1]]);
      }
    } else out.push(s.p);
    prev = s.p;
  }
  return out;
}

/** Signed area: positive = clockwise on screen (y down). */
export function area(c: Contour): number {
  const p = flatten(c, 8);
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!;
    const r = p[(i + 1) % p.length]!;
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}

export function bounds(cs: Contour[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cs)
    for (const [x, y] of flatten(c, 24)) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return { x0, y0, x1, y1 };
}

const f2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export function contourD(c: Contour): string {
  let d = `M${f2(c.start[0])} ${f2(c.start[1])}`;
  const segs = c.segs.length && eq(c.segs[c.segs.length - 1]!.p, c.start) && !c.segs[c.segs.length - 1]!.c1 ? c.segs.slice(0, -1) : c.segs;
  for (const s of segs) d += s.c1 ? `C${f2(s.c1[0])} ${f2(s.c1[1])} ${f2(s.c2![0])} ${f2(s.c2![1])} ${f2(s.p[0])} ${f2(s.p[1])}` : `L${f2(s.p[0])} ${f2(s.p[1])}`;
  return d + "Z";
}

// ---------- seeded randomness ----------

export function rng(seed: number) {
  let s = (Math.floor(seed) * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Uniform offset of a closed contour (negative = inset), rounded joins; refitted to curves. */
export function offset(c: Contour, delta: number): Contour[] {
  const path = flatten(area(c) > 0 ? c : reverse(c), 24).map(([x, y]) => ({ x, y }));
  const out = inflatePathsD([path], delta, JoinType.Round, EndType.Polygon, 2, 3);
  return out.filter((p) => p.length > 2).map((p) => fit(p.map((q) => [q.x, q.y] as Pt), 0.035, 32));
}
