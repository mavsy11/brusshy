import type { Anchor, P, SubPath } from "./pathmodel";

/**
 * Polyline → smooth cubic Béziers (Schneider's "An Algorithm for Automatically Fitting Digitized
 * Curves", Graphics Gems 1990). Corners (sharp turns) are kept as corner nodes; everything in
 * between becomes as few smooth cubics as fit within `tol`.
 */

type V = P;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const norm = (a: V): V => {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
};
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);

type Cubic = [V, V, V, V];

const q = (c: Cubic, t: number): V => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
  return [a * c[0][0] + b * c[1][0] + cc * c[2][0] + d * c[3][0], a * c[0][1] + b * c[1][1] + cc * c[2][1] + d * c[3][1]];
};
const qprime = (c: Cubic, t: number): V => {
  const u = 1 - t;
  return [
    3 * u * u * (c[1][0] - c[0][0]) + 6 * u * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]),
    3 * u * u * (c[1][1] - c[0][1]) + 6 * u * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]),
  ];
};
const qprime2 = (c: Cubic, t: number): V => [
  6 * (1 - t) * (c[2][0] - 2 * c[1][0] + c[0][0]) + 6 * t * (c[3][0] - 2 * c[2][0] + c[1][0]),
  6 * (1 - t) * (c[2][1] - 2 * c[1][1] + c[0][1]) + 6 * t * (c[3][1] - 2 * c[2][1] + c[1][1]),
];

function chordParams(pts: V[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1]! + dist(pts[i]!, pts[i - 1]!));
  const total = u[u.length - 1]! || 1;
  return u.map((x) => x / total);
}

function generate(pts: V[], u: number[], t1: V, t2: V): Cubic {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const C = [
    [0, 0],
    [0, 0],
  ];
  const X = [0, 0];
  for (let i = 0; i < pts.length; i++) {
    const t = u[i]!;
    const b1 = 3 * t * (1 - t) * (1 - t);
    const b2 = 3 * t * t * (1 - t);
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    C[0]![0]! += dot(a1, a1);
    C[0]![1]! += dot(a1, a2);
    C[1]![1]! += dot(a2, a2);
    const b0 = (1 - t) ** 3, b3 = t ** 3;
    const tmp = sub(pts[i]!, add(mul(first, b0 + b1), mul(last, b2 + b3)));
    X[0]! += dot(a1, tmp);
    X[1]! += dot(a2, tmp);
  }
  C[1]![0] = C[0]![1]!;
  const det = C[0]![0]! * C[1]![1]! - C[1]![0]! * C[0]![1]!;
  let alpha1 = 0, alpha2 = 0;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (X[0]! * C[1]![1]! - X[1]! * C[0]![1]!) / det;
    alpha2 = (C[0]![0]! * X[1]! - C[1]![0]! * X[0]!) / det;
  }
  const seg = dist(first, last);
  const eps = 1e-6 * seg;
  if (alpha1 < eps || alpha2 < eps || alpha1 > seg * 3 || alpha2 > seg * 3) {
    alpha1 = alpha2 = seg / 3;
  }
  return [first, add(first, mul(t1, alpha1)), add(last, mul(t2, alpha2)), last];
}

function maxError(pts: V[], c: Cubic, u: number[]): { err: number; at: number } {
  let err = 0;
  let at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(q(c, u[i]!), pts[i]!);
    if (d > err) {
      err = d;
      at = i;
    }
  }
  return { err, at };
}

function reparam(pts: V[], u: number[], c: Cubic): number[] {
  return u.map((t, i) => {
    const d = sub(q(c, t), pts[i]!);
    const q1 = qprime(c, t);
    const q2 = qprime2(c, t);
    const den = dot(q1, q1) + dot(d, q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(d, q1) / den));
  });
}

function fitRun(pts: V[], t1: V, t2: V, tol: number, out: Cubic[], depth = 0) {
  if (pts.length === 2) {
    const s = dist(pts[0]!, pts[1]!) / 3;
    out.push([pts[0]!, add(pts[0]!, mul(t1, s)), add(pts[1]!, mul(t2, s)), pts[1]!]);
    return;
  }
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let { err, at } = maxError(pts, c, u);
  if (err <= tol) return void out.push(c);
  if (err <= tol * 40) {
    for (let k = 0; k < 12; k++) {
      u = reparam(pts, u, c);
      c = generate(pts, u, t1, t2);
      ({ err, at } = maxError(pts, c, u));
      if (err <= tol) return void out.push(c);
    }
  }
  if (depth > 24 || pts.length < 3) return void out.push(c);
  const at2 = Math.min(pts.length - 2, Math.max(1, at));
  let tc = norm(sub(pts[at2 - 1]!, pts[at2 + 1]!));
  if (len(tc) < 1e-9) tc = norm(sub(pts[at2 - 1]!, pts[at2]!));
  fitRun(pts.slice(0, at2 + 1), t1, tc, tol, out, depth + 1);
  fitRun(pts.slice(at2), mul(tc, -1), t2, tol, out, depth + 1);
}

/** Drop consecutive duplicates (and the closing duplicate of a ring). */
function clean(pts: V[], closed: boolean, eps: number): V[] {
  const out: V[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1]!, p) > eps) out.push(p);
  if (closed && out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= eps) out.pop();
  return out;
}

const isLineRun = (pts: V[], tol: number) => {
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-9) return false;
  return pts.every((p) => Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L <= tol * 0.5);
};

/**
 * Fit a closed or open polyline with cubics. Turns sharper than `cornerDeg` stay corners;
 * straight runs stay lines.
 */
export function fitPolyline(raw: V[], closed: boolean, tol: number, cornerDeg = 38): SubPath | null {
  const pts = clean(raw, closed, tol * 0.05);
  if (pts.length < (closed ? 3 : 2)) return null;
  const n = pts.length;
  const cosLimit = Math.cos((cornerDeg * Math.PI) / 180);
  const corner = pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const a = norm(sub(p, pts[(i - 1 + n) % n]!));
    const b = norm(sub(pts[(i + 1) % n]!, p));
    return dot(a, b) < cosLimit;
  });
  // Runs of point indices between corners (a closed ring without corners is one run from 0 back to 0).
  const cornerIdx = corner.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const smoothRing = closed && cornerIdx.length === 0;
  const runs: number[][] = [];
  if (smoothRing) runs.push([...pts.keys(), 0]);
  else if (closed)
    cornerIdx.forEach((s, k) => {
      const e = cornerIdx[(k + 1) % cornerIdx.length]!;
      const run = [s];
      for (let i = (s + 1) % n; ; i = (i + 1) % n) {
        run.push(i);
        if (i === e) break;
      }
      runs.push(run);
    });
  else for (let k = 0; k < cornerIdx.length - 1; k++) runs.push(Array.from({ length: cornerIdx[k + 1]! - cornerIdx[k]! + 1 }, (_, j) => cornerIdx[k]! + j));
  const anchors: Anchor[] = [];
  for (const idx of runs) {
    const run = idx.map((i) => pts[i]!);
    if (!anchors.length) anchors.push({ p: run[0]!, cin: null, cout: null });
    if (isLineRun(run, tol)) {
      anchors[anchors.length - 1]!.cout = null;
      anchors.push({ p: run[run.length - 1]!, cin: null, cout: null });
      continue;
    }
    // Corners take one-sided tangents; the seam of a smooth ring takes the tangent through its neighbours.
    const t1 = smoothRing ? norm(sub(pts[1]!, pts[n - 1]!)) : norm(sub(run[1]!, run[0]!));
    const t2 = smoothRing ? mul(t1, -1) : norm(sub(run[run.length - 2]!, run[run.length - 1]!));
    const cubics: Cubic[] = [];
    fitRun(run, t1, t2, tol, cubics);
    for (const c of cubics) {
      anchors[anchors.length - 1]!.cout = c[1];
      anchors.push({ p: c[3], cin: c[2], cout: null });
    }
  }
  if (closed && anchors.length > 1) {
    // The last anchor is the first point again: merge it.
    const last = anchors.pop()!;
    anchors[0]!.cin = last.cin;
  }
  return anchors.length ? { anchors, closed } : null;
}
