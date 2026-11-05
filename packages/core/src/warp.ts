import { newId } from "./ids";
import { applyOps, type OpT } from "./ops";
import { apply, invert, multiply, shapeToPath, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { parsePath, serializePath, type Anchor, type P, type SubPath } from "./pathmodel";
import { letteringOps, type GlyphOutline } from "./lettering";
import type { DocT, NodeT } from "./schema";
import type { EnvelopeNodeT, EnvelopeT, WarpRecordT } from "./typelab-schema";

/**
 * Type Lab · Warp. Envelope distortions for any selection, as one piece:
 * - presets (arch, arc, bulge…) are closed-form maps of the selection's bounds;
 * - a free envelope is a mesh of Coons patches the user drags.
 * Path data is warped segment by segment with Hermite fitting: each cubic keeps its end points
 * and end tangents mapped exactly (through the warp's Jacobian), and is split only where the
 * fitted curve strays from the true warped curve by more than a tolerance — smooth curves, no
 * faceting, and node counts that grow only where the warp actually bends things.
 */

export const WARP_PRESETS = ["arch", "arc", "bulge", "pinch", "flag", "rise", "fisheye", "squeeze", "shell-upper", "shell-lower", "perspective"] as const;
export type WarpPreset = (typeof WARP_PRESETS)[number];
export type WarpOrientation = "horizontal" | "vertical";
export type WarpFn = (p: P) => P;

export interface WBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WarpSpec {
  preset: WarpPreset | "envelope";
  /** −100…100 (presets only). */
  amount: number;
  orientation: WarpOrientation;
  /** Normalised mesh (preset "envelope"). */
  envelope?: EnvelopeT | null;
}

export const WARP_LABELS: Record<WarpPreset, { label: string; hint: string }> = {
  arch: { label: "Arch", hint: "Both edges bow together; letters stay upright" },
  arc: { label: "Arc", hint: "Bend onto a circle; letters fan out like on a badge" },
  bulge: { label: "Bulge", hint: "Taller in the middle (negative: narrower waist)" },
  pinch: { label: "Pinch", hint: "A narrow waist at the centre (negative: a swell)" },
  flag: { label: "Flag", hint: "A wave runs through, like a flag in the wind" },
  rise: { label: "Rise", hint: "Climbs from left to right with a smooth ramp" },
  fisheye: { label: "Fisheye", hint: "Magnify the centre like a lens" },
  squeeze: { label: "Squeeze", hint: "Sides pinched in at mid-height (negative: barrel)" },
  "shell-upper": { label: "Shell ↑", hint: "Top edge bows, bottom stays straight" },
  "shell-lower": { label: "Shell ↓", hint: "Bottom edge bows, top stays straight" },
  perspective: { label: "Perspective", hint: "Recede into depth (negative: the other side)" },
};

/** Amount a fresh click on a preset starts with (subtle reads best on logos). */
export const WARP_DEFAULT_AMOUNT: Record<WarpPreset, number> = {
  arch: 35,
  arc: 40,
  bulge: 35,
  pinch: 35,
  flag: 40,
  rise: 40,
  fisheye: 45,
  squeeze: 35,
  "shell-upper": 35,
  "shell-lower": 35,
  perspective: 40,
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ───────────────────────── presets ─────────────────────────

/** Map from the unit square to a quad (p0 top-left, p1 top-right, p2 bottom-right, p3 bottom-left). */
export function squareToQuad(p0: P, p1: P, p2: P, p3: P): (u: number, v: number) => P {
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-12;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1], f = p0[1];
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

/** A preset along the horizontal axis of `box` (a in −1…1). */
function horizontalPreset(preset: WarpPreset, a: number, box: WBox): WarpFn {
  const { x: bx, y: by } = box;
  const W = Math.max(1e-6, box.w);
  const H = Math.max(1e-6, box.h);
  const cx = bx + W / 2;
  const cy = by + H / 2;
  const norm = (p: P) => {
    const u = (p[0] - bx) / W;
    const v = (p[1] - by) / H;
    return { u, v, s: 2 * u - 1, t: 2 * v - 1 };
  };
  if (Math.abs(a) < 1e-6) return (p) => p;
  switch (preset) {
    case "arch": {
      // Both edges bow by the same parabola: letters shear vertically and stay upright.
      const A = a * 0.2 * Math.max(W, H);
      return (p) => {
        const { s } = norm(p);
        return [p[0], p[1] - A * (1 - s * s)];
      };
    }
    case "arc": {
      // Bend onto a circle: x → angle, y → radius. The middle line keeps its length; at ±100 the sweep is 180°.
      const sweep = a * Math.PI;
      const R = W / sweep;
      return (p) => {
        const { s } = norm(p);
        const phi = (s * sweep) / 2;
        const r = R - (p[1] - cy);
        return [cx + r * Math.sin(phi), cy + R - r * Math.cos(phi)];
      };
    }
    case "bulge": {
      const k = a * 0.5;
      return (p) => {
        const { s } = norm(p);
        return [p[0], cy + (p[1] - cy) * (1 + k * (1 - s * s))];
      };
    }
    case "pinch": {
      // A narrow waist at the centre (bulge is broad); the ends pull in slightly at mid-height.
      const k = a * 0.5;
      const side = a * 0.22 * Math.min(W, H);
      return (p) => {
        const { s, t } = norm(p);
        const g = Math.exp(-4.5 * s * s);
        return [p[0] - s * side * (1 - t * t) * (1 - g), cy + (p[1] - cy) * (1 - k * g)];
      };
    }
    case "flag": {
      const A = a * 0.3 * H;
      return (p) => {
        const { u } = norm(p);
        return [p[0], p[1] - A * Math.sin(2 * Math.PI * u)];
      };
    }
    case "rise": {
      const A = a * 0.8 * H;
      return (p) => {
        const u = clamp(norm(p).u, 0, 1);
        const e = u * u * (3 - 2 * u);
        return [p[0], p[1] - A * (e - 0.5)];
      };
    }
    case "fisheye": {
      // Radial magnification inside the box's circumscribed ellipse (corners stay put, edges round out).
      const k = a * 0.5;
      return (p) => {
        const { s, t } = norm(p);
        const r2 = (s * s + t * t) / 2;
        if (r2 >= 1) return p;
        const f = 1 + k * (1 - r2);
        return [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f];
      };
    }
    case "squeeze": {
      // Sides pinched in at mid-height by up to ~a third of the shorter side (barrel when negative).
      const A = a * 0.35 * Math.min(W, H);
      return (p) => {
        const { s, t } = norm(p);
        return [p[0] - s * A * (1 - t * t), p[1]];
      };
    }
    case "shell-upper": {
      const A = a * 0.6 * H;
      return (p) => {
        const { s, v } = norm(p);
        return [p[0], p[1] - A * (1 - s * s) * (1 - v)];
      };
    }
    case "shell-lower": {
      const A = a * 0.6 * H;
      return (p) => {
        const { s, v } = norm(p);
        return [p[0], p[1] + A * (1 - s * s) * v];
      };
    }
    case "perspective": {
      // A true projective map: straight lines stay straight, spacing foreshortens.
      const k = Math.abs(a) * 0.55 * H * 0.5;
      const q =
        a > 0
          ? squareToQuad([bx, by], [bx + W, by + k], [bx + W, by + H - k], [bx, by + H])
          : squareToQuad([bx, by + k], [bx + W, by], [bx + W, by + H], [bx, by + H - k]);
      return (p) => {
        const { u, v } = norm(p);
        return q(u, v);
      };
    }
  }
}

/** The warp of a preset over `box` (amount −100…100). Vertical orientation runs the same map along the y axis. */
export function presetWarp(preset: WarpPreset, amount: number, box: WBox, orientation: WarpOrientation = "horizontal"): WarpFn {
  const a = clamp(amount, -100, 100) / 100;
  if (orientation === "vertical") {
    const f = horizontalPreset(preset, a, { x: box.y, y: box.x, w: box.h, h: box.w });
    return (p) => {
      const q = f([p[1], p[0]]);
      return [q[1], q[0]];
    };
  }
  return horizontalPreset(preset, a, box);
}

// ───────────────────────── free envelope (Coons mesh) ─────────────────────────

const bez = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};

export const envIndex = (env: Pick<EnvelopeT, "cols">, row: number, col: number) => row * (env.cols + 1) + col;

/** Flat envelope (no distortion) with `rows`×`cols` patches, in normalised coordinates. */
export function identityEnvelope(rows = 1, cols = 1): EnvelopeT {
  const nodes: EnvelopeNodeT[] = [];
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      const p: P = [j / cols, i / rows];
      const dx = 1 / cols / 3, dy = 1 / rows / 3;
      nodes.push({ p, l: [p[0] - dx, p[1]], r: [p[0] + dx, p[1]], u: [p[0], p[1] - dy], d: [p[0], p[1] + dy] });
    }
  return { rows, cols, nodes };
}

/** Coons patch of one mesh cell at local (s, t) — extrapolates smoothly outside 0…1. */
function coons(env: EnvelopeT, row: number, col: number, s: number, t: number): P {
  const n00 = env.nodes[envIndex(env, row, col)]!;
  const n10 = env.nodes[envIndex(env, row, col + 1)]!;
  const n01 = env.nodes[envIndex(env, row + 1, col)]!;
  const n11 = env.nodes[envIndex(env, row + 1, col + 1)]!;
  const top = bez(n00.p, n00.r, n10.l, n10.p, s);
  const bot = bez(n01.p, n01.r, n11.l, n11.p, s);
  const left = bez(n00.p, n00.d, n01.u, n01.p, t);
  const right = bez(n10.p, n10.d, n11.u, n11.p, t);
  const x =
    (1 - t) * top[0] + t * bot[0] + (1 - s) * left[0] + s * right[0] -
    ((1 - s) * (1 - t) * n00.p[0] + s * (1 - t) * n10.p[0] + (1 - s) * t * n01.p[0] + s * t * n11.p[0]);
  const y =
    (1 - t) * top[1] + t * bot[1] + (1 - s) * left[1] + s * right[1] -
    ((1 - s) * (1 - t) * n00.p[1] + s * (1 - t) * n10.p[1] + (1 - s) * t * n01.p[1] + s * t * n11.p[1]);
  return [x, y];
}

/** Envelope point at normalised (u, v). */
export function envelopeAt(env: EnvelopeT, u: number, v: number): P {
  const col = clamp(Math.floor(u * env.cols), 0, env.cols - 1);
  const row = clamp(Math.floor(v * env.rows), 0, env.rows - 1);
  return coons(env, row, col, u * env.cols - col, v * env.rows - row);
}

/** The warp of a free envelope (normalised mesh) over `box`. */
export function envelopeWarp(env: EnvelopeT, box: WBox): WarpFn {
  const W = Math.max(1e-6, box.w);
  const H = Math.max(1e-6, box.h);
  return (p) => {
    const q = envelopeAt(env, (p[0] - box.x) / W, (p[1] - box.y) / H);
    return [box.x + q[0] * W, box.y + q[1] * H];
  };
}

/** Directional derivative of f at p along v (central differences, step `h` in units of p). */
function along(f: WarpFn, p: P, v: P, h: number): P {
  const len = Math.hypot(v[0], v[1]);
  if (len < 1e-12) return [0, 0];
  const k = h / len;
  const a = f([p[0] + v[0] * k, p[1] + v[1] * k]);
  const b = f([p[0] - v[0] * k, p[1] - v[1] * k]);
  return [(a[0] - b[0]) / (2 * k), (a[1] - b[1]) / (2 * k)];
}

/**
 * Sample any warp onto an envelope mesh (normalised to `box`): nodes land on the warped grid and
 * handles follow its tangents — so "Edit as envelope" starts exactly from the current preset.
 */
export function envelopeFromWarp(f: WarpFn, box: WBox, rows = 1, cols = 1): EnvelopeT {
  const W = Math.max(1e-6, box.w);
  const H = Math.max(1e-6, box.h);
  const h = Math.max(W, H) * 1e-4;
  const toN = (q: P): P => [(q[0] - box.x) / W, (q[1] - box.y) / H];
  const nodes: EnvelopeNodeT[] = [];
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      const g: P = [box.x + (j / cols) * W, box.y + (i / rows) * H];
      const q = f(g);
      const dx: P = [W / cols / 3, 0];
      const dy: P = [0, H / rows / 3];
      const r = along(f, g, dx, h);
      const d = along(f, g, dy, h);
      nodes.push({ p: toN(q), l: toN(sub(q, r)), r: toN(add(q, r)), u: toN(sub(q, d)), d: toN(add(q, d)) });
    }
  return { rows, cols, nodes };
}

/** Same envelope with more patches (2×2 from 1×1, etc.), keeping its current shape. */
export function refineEnvelope(env: EnvelopeT, rows: number, cols: number): EnvelopeT {
  const unit: WBox = { x: 0, y: 0, w: 1, h: 1 };
  return envelopeFromWarp((p) => envelopeAt(env, p[0], p[1]), unit, rows, cols);
}

export const isIdentityEnvelope = (env: EnvelopeT) => {
  const id = identityEnvelope(env.rows, env.cols);
  return env.nodes.every((n, i) => {
    const m = id.nodes[i]!;
    return (["p", "l", "r", "u", "d"] as const).every((k) => dist(n[k], m[k]) < 1e-6);
  });
};

// ───────────────────────── path warping ─────────────────────────

type Piece = { line: true; p0: P; p3: P } | { line: false; c: [P, P, P, P] };

function splitCubic(c: [P, P, P, P], t: number): [[P, P, P, P], [P, P, P, P]] {
  const [p0, p1, p2, p3] = c;
  const ab = lerp(p0, p1, t), bc = lerp(p1, p2, t), cd = lerp(p2, p3, t);
  const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t);
  const m = lerp(abc, bcd, t);
  return [
    [p0, ab, abc, m],
    [m, bcd, cd, p3],
  ];
}

const distToLine = (p: P, a: P, b: P) => {
  const d = sub(b, a);
  const L = Math.hypot(d[0], d[1]);
  if (L < 1e-12) return dist(p, a);
  return Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L;
};

const SAMPLES = [0.12, 0.3, 0.5, 0.7, 0.88];

function warpCubic(c: [P, P, P, P], f: WarpFn, tol: number, h: number, depth: number, out: Piece[]) {
  const q0 = f(c[0]);
  const q3 = f(c[3]);
  // Hermite fit: exact end points and end tangents (Jacobian · original handle vectors).
  const fit: [P, P, P, P] = [q0, add(q0, along(f, c[0], sub(c[1], c[0]), h)), add(q3, along(f, c[3], sub(c[2], c[3]), h)), q3];
  let err = 0;
  for (const t of SAMPLES) {
    err = Math.max(err, dist(f(bez(c[0], c[1], c[2], c[3], t)), bez(fit[0], fit[1], fit[2], fit[3], t)));
    if (err > tol) break;
  }
  if (err <= tol || depth <= 0 || !Number.isFinite(err)) {
    out.push({ line: false, c: fit });
    return;
  }
  const [a, b] = splitCubic(c, 0.5);
  warpCubic(a, f, tol, h, depth - 1, out);
  warpCubic(b, f, tol, h, depth - 1, out);
}

function warpLine(p0: P, p3: P, f: WarpFn, tol: number, h: number, depth: number, out: Piece[]) {
  const q0 = f(p0);
  const q3 = f(p3);
  // Lines that stay straight (perspective, flat regions) stay lines — clean nodes, no fake curves.
  let straight = true;
  for (const t of [0.25, 0.5, 0.75]) {
    if (distToLine(f(lerp(p0, p3, t)), q0, q3) > tol) {
      straight = false;
      break;
    }
  }
  if (straight) {
    out.push({ line: true, p0: q0, p3: q3 });
    return;
  }
  warpCubic([p0, lerp(p0, p3, 1 / 3), lerp(p0, p3, 2 / 3), p3], f, tol, h, depth, out);
}

/** Warp an editable path model. `tol` is the max deviation from the exact warp (same units as the path). */
export function warpSubPaths(subs: SubPath[], f: WarpFn, tol: number, maxDepth = 6): SubPath[] {
  const pts = subs.flatMap((s) => s.anchors.map((a) => a.p));
  let size = 1;
  if (pts.length) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    size = Math.max(1e-3, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  const h = size * 1e-4;
  return subs.map((s) => {
    const a = s.anchors;
    const n = a.length;
    if (n === 0) return s;
    if (n === 1) return { ...s, anchors: [{ p: f(a[0]!.p), cin: null, cout: null }] };
    const segs = s.closed ? n : n - 1;
    const pieces: Piece[] = [];
    for (let i = 0; i < segs; i++) {
      const A = a[i]!;
      const B = a[(i + 1) % n]!;
      if (!A.cout && !B.cin) warpLine(A.p, B.p, f, tol, h, maxDepth, pieces);
      else warpCubic([A.p, A.cout ?? A.p, B.cin ?? B.p, B.p], f, tol, h, maxDepth, pieces);
    }
    const first = pieces[0]!;
    const anchors: Anchor[] = [{ p: first.line ? first.p0 : first.c[0], cin: null, cout: null }];
    pieces.forEach((pc, i) => {
      const prev = anchors[anchors.length - 1]!;
      const last = s.closed && i === pieces.length - 1;
      if (pc.line) {
        prev.cout = null;
        if (last) anchors[0]!.cin = null;
        else anchors.push({ p: pc.p3, cin: null, cout: null });
      } else {
        prev.cout = pc.c[1];
        if (last) anchors[0]!.cin = pc.c[2];
        else anchors.push({ p: pc.c[3], cin: pc.c[2], cout: null });
      }
    });
    return { anchors, closed: s.closed };
  });
}

/** Warp path data. `M` maps the path's local space into the space where `f` is defined. */
export function warpPathData(d: string, f: WarpFn, tol: number, M: Mat = IDENTITY): string {
  const subs = parsePath(d);
  if (!subs.length) return d;
  const identity = M.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-12);
  if (identity) return serializePath(warpSubPaths(subs, f, tol));
  const inv = invert(M);
  const g: WarpFn = (q) => {
    const w = f(apply(M, q[0], q[1]));
    return apply(inv, w[0], w[1]);
  };
  const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
  return serializePath(warpSubPaths(subs, g, tol / scale));
}

/** Bounds of path data mapped by M (curves sampled). */
export function mappedBounds(d: string, M: Mat = IDENTITY): WBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const addPt = (q: P) => {
    const [x, y] = apply(M, q[0], q[1]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const s of parsePath(d)) {
    const a = s.anchors;
    const segs = s.closed ? a.length : a.length - 1;
    addPt(a[0]!.p);
    for (let i = 0; i < segs; i++) {
      const A = a[i]!, B = a[(i + 1) % a.length]!;
      if (!A.cout && !B.cin) {
        addPt(B.p);
        continue;
      }
      for (let k = 1; k <= 12; k++) addPt(bez(A.p, A.cout ?? A.p, B.cin ?? B.p, B.p, k / 12));
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Short fingerprint of a string (FNV-1a), to notice hand edits after a warp or stale effects. */
export function geomFingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`;
}

/** The warp function for a spec over a box. */
export function warpFor(spec: WarpSpec, box: WBox): WarpFn {
  if (spec.preset === "envelope") return spec.envelope ? envelopeWarp(spec.envelope, box) : (p) => p;
  return presetWarp(spec.preset, spec.amount, box, spec.orientation);
}

export const isIdentitySpec = (spec: WarpSpec) =>
  spec.preset === "envelope" ? !spec.envelope || isIdentityEnvelope(spec.envelope) : Math.abs(spec.amount) < 1e-9;

// ───────────────────────── document level ─────────────────────────

const siblingsOf = (doc: DocT, n: NodeT): string[] => {
  if (!n.parent) return doc.root;
  const p = doc.nodes[n.parent];
  return p && (p.type === "group" || p.type === "frame") ? p.children : doc.root;
};

/** Selected ids without descendants of other selected ids. */
function topIds(doc: DocT, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id, i) => {
    if (!doc.nodes[id] || ids.indexOf(id) !== i) return false;
    for (let p = doc.nodes[id]!.parent; p; p = doc.nodes[p]?.parent ?? null) if (set.has(p)) return false;
    return true;
  });
}

/** Path leaves a warp moves under `id` (generated effect layers are skipped: they are regenerated instead). */
function pathLeaves(doc: DocT, id: string, out: string[] = []): string[] {
  const n = doc.nodes[id];
  if (!n || n.effect) return out;
  if (n.type === "path") out.push(id);
  else if (n.type === "group") for (const c of n.children) pathLeaves(doc, c, out);
  return out;
}

/** Text and shape layers under the ids (they become letters / paths before warping). */
export function warpConversions(doc: DocT, ids: string[]): { texts: string[]; shapes: string[] } {
  const texts: string[] = [];
  const shapes: string[] = [];
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n || n.effect) return;
    if (n.type === "text") texts.push(id);
    else if (n.type === "shape") shapes.push(id);
    else if (n.type === "group") n.children.forEach(visit);
  };
  topIds(doc, ids).forEach(visit);
  return { texts, shapes };
}

function lowestCommonAncestor(doc: DocT, ids: string[]): string | null {
  const chain = (id: string | null): string[] => {
    const out: string[] = [];
    for (let c = id; c; c = doc.nodes[c]?.parent ?? null) out.push(c);
    return out;
  };
  const parents = ids.map((id) => doc.nodes[id]?.parent ?? null);
  let common = chain(parents[0] ?? null);
  for (const p of parents.slice(1)) {
    const c = new Set(chain(p));
    common = common.filter((x) => c.has(x));
  }
  return common[0] ?? null;
}

export interface WarpLeaf {
  id: string;
  /** Top-level selected node this leaf belongs to. */
  member: string;
  /** Path data the warp starts from (the original if a valid warp record exists). */
  base: string;
  /** Leaf local → common warp space. */
  M: Mat;
}

export interface WarpTarget {
  /** Document after the structural steps (texts lettered, shapes as paths), not yet committed. */
  doc: DocT;
  /** Ops for those structural steps (prepend them to the commit). */
  structOps: OpT[];
  members: string[];
  leaves: WarpLeaf[];
  /** Bounds of the original geometry in the common space. */
  box: WBox;
  /** Common space → world (for drawing the envelope on the canvas). */
  space: Mat;
  /** The warp currently applied (valid record), if any. */
  current: WarpSpec | null;
  /** Record id to keep across re-edits. */
  recordId: string;
  /** Original layers that are drawn differently until commit: text/shape id → leaf ids that replace it. */
  pending: Record<string, string[]>;
  /** Nodes below the members that hold an older copy of the record (cleared on commit). */
  holders: string[];
  /** Tolerance in common-space units. */
  tol: number;
}

function subtreeOf(doc: DocT, id: string, out: string[] = []): string[] {
  const n = doc.nodes[id];
  if (!n) return out;
  out.push(id);
  if (n.type === "group") n.children.forEach((c) => subtreeOf(doc, c, out));
  return out;
}

/** Nodes in the members' subtrees (members included) that carry a warp record. */
function recordHolders(doc: DocT, members: string[]): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n || n.effect) return;
    if (n.warp) out.push(id);
    if (n.type === "group") n.children.forEach(visit);
  };
  members.forEach(visit);
  return out;
}

/**
 * The warp the selection carries, if it still matches the document: one record id whose stored
 * leaves are exactly the selection's leaves, none reshaped since. Holders may sit below the members
 * (e.g. lettering that was wrapped into an effects group after warping).
 */
function validRecord(doc: DocT, members: string[]): { rec: WarpRecordT; base: Record<string, string> } | null {
  const holders = recordHolders(doc, members);
  if (!holders.length) return null;
  const first = doc.nodes[holders[0]!]!.warp!;
  const base: Record<string, string> = {};
  const out: Record<string, string> = {};
  for (const h of holders) {
    const r = doc.nodes[h]!.warp!;
    if (r.id !== first.id) return null;
    Object.assign(base, r.base);
    Object.assign(out, r.out);
  }
  const leaves = members.flatMap((m) => pathLeaves(doc, m));
  if (Object.keys(base).length !== leaves.length) return null;
  for (const l of leaves) {
    const n = doc.nodes[l];
    if (n?.type !== "path" || !(l in base) || out[l] !== geomFingerprint(n.d)) return null;
  }
  return { rec: first, base };
}

/** The warp record the selection belongs to (any member), for "select the warped set". */
export function warpRecordOf(doc: DocT, id: string): WarpRecordT | null {
  for (let c: string | null = id; c; c = doc.nodes[c]?.parent ?? null) {
    const r: WarpRecordT | null | undefined = doc.nodes[c]?.warp;
    if (r && r.members.includes(c)) return r;
  }
  const inside = recordHolders(doc, [id])[0];
  return inside ? doc.nodes[inside]!.warp! : null;
}

/**
 * Prepare a selection for warping. Texts need their glyph outlines (`glyphs[textId]`, from the
 * studio's fonts); they become lettering groups (one path per letter), shapes become paths —
 * all as ops that go into the same undo step as the warp.
 */
export function prepareWarp(doc0: DocT, ids: string[], opts: { glyphs?: Record<string, GlyphOutline[]>; tolerance?: number } = {}): WarpTarget {
  const members = topIds(doc0, ids).filter((id) => {
    const t = doc0.nodes[id]!.type;
    return t === "path" || t === "shape" || t === "text" || t === "group";
  });
  if (!members.length) throw new Error("Select text, lettering, paths, shapes or groups to warp");
  let doc = doc0;
  const structOps: OpT[] = [];
  const pending: Record<string, string[]> = {};
  const { texts, shapes } = warpConversions(doc0, members);
  for (const id of shapes) {
    const n = doc.nodes[id];
    if (n?.type !== "shape") continue;
    const { id: _id, type: _t, parent: _p, shape: _s, width: _w, height: _h, radius: _r, sides: _si, innerRatio: _ir, ...rest } = n;
    const ops: OpT[] = [
      { op: "remove", id },
      { op: "add", node: { ...rest, id, type: "path", name: n.name || n.shape, d: shapeToPath(n) }, parent: n.parent, index: siblingsOf(doc, n).indexOf(id) },
    ];
    doc = applyOps(doc, ops).doc;
    structOps.push(...ops);
    pending[id] = [id];
  }
  for (const id of texts) {
    const g = opts.glyphs?.[id];
    if (!g) throw new Error(`Text ${id} needs its glyph outlines to be warped (outline it first)`);
    const { ops, letterIds } = letteringOps(doc, id, g);
    doc = applyOps(doc, ops).doc;
    structOps.push(...ops);
    pending[id] = letterIds;
  }

  const valid = structOps.length ? null : validRecord(doc, members);
  const spaceId = members.length === 1 ? members[0]! : lowestCommonAncestor(doc, members);
  const space = spaceId ? worldMatrix(doc, spaceId) : IDENTITY;
  const inv = invert(space);
  const leaves: WarpLeaf[] = [];
  for (const m of members)
    for (const l of pathLeaves(doc, m)) {
      const n = doc.nodes[l] as Extract<NodeT, { type: "path" }>;
      leaves.push({ id: l, member: m, base: valid?.base[l] ?? n.d, M: multiply(inv, worldMatrix(doc, l)) });
    }
  if (!leaves.length) throw new Error("Nothing to warp (no shapes inside the selection)");
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of leaves) {
    const b = mappedBounds(l.base, l.M);
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) throw new Error("Nothing to warp (empty shapes)");
  const box = { x: x0, y: y0, w: Math.max(1e-3, x1 - x0), h: Math.max(1e-3, y1 - y0) };
  const rec = valid?.rec;
  // Only part of a warped set is selected: re-edit that part under its own record.
  let partial = false;
  if (rec) {
    const inside = new Set(members.flatMap((m) => subtreeOf(doc, m)));
    partial = Object.values(doc.nodes).some((n) => n.warp?.id === rec.id && !inside.has(n.id));
  }
  const current: WarpSpec | null = rec
    ? { preset: rec.preset as WarpSpec["preset"], amount: rec.amount, orientation: rec.orientation, envelope: rec.envelope ?? null }
    : null;
  return {
    doc,
    structOps,
    members,
    leaves,
    box,
    space,
    current,
    recordId: rec && !partial ? rec.id : newId("w"),
    holders: recordHolders(doc, members).filter((h) => !members.includes(h)),
    pending,
    tol: opts.tolerance ?? Math.max(0.01, 4e-4 * Math.max(box.w, box.h)),
  };
}

/** Warped path data per leaf (local coordinates). */
export function warpResult(t: WarpTarget, spec: WarpSpec): Record<string, string> {
  const out: Record<string, string> = {};
  if (isIdentitySpec(spec)) {
    for (const l of t.leaves) out[l.id] = l.base;
    return out;
  }
  const f = warpFor(spec, t.box);
  for (const l of t.leaves) out[l.id] = warpPathData(l.base, f, t.tol, l.M);
  return out;
}

/**
 * Ops that apply a warp (structural steps + new path data + the warp record on every member),
 * as one undo step. An identity spec (amount 0) restores the original geometry and clears the record.
 */
export function warpCommitOps(t: WarpTarget, spec: WarpSpec, out = warpResult(t, spec)): OpT[] {
  const ops: OpT[] = [...t.structOps];
  for (const l of t.leaves) {
    const n = t.doc.nodes[l.id];
    if (n?.type === "path" && n.d !== out[l.id]) ops.push({ op: "update", id: l.id, set: { d: out[l.id] } });
  }
  const clear = isIdentitySpec(spec);
  for (const m of t.members) {
    const mine = t.leaves.filter((l) => l.member === m);
    const warp: WarpRecordT | null = clear
      ? null
      : {
          id: t.recordId,
          members: t.members,
          preset: spec.preset,
          amount: Math.round(spec.amount * 100) / 100,
          orientation: spec.orientation,
          envelope: spec.preset === "envelope" ? (spec.envelope ?? null) : null,
          base: Object.fromEntries(mine.map((l) => [l.id, l.base])),
          out: Object.fromEntries(mine.map((l) => [l.id, geomFingerprint(out[l.id]!)])),
        };
    if (warp || t.doc.nodes[m]?.warp) ops.push({ op: "update", id: m, set: { warp }, replace: true });
  }
  for (const h of t.holders) if (t.doc.nodes[h]?.warp) ops.push({ op: "update", id: h, set: { warp: null }, replace: true });
  return ops;
}

/** Envelope corners of the target's box in world space (for overlays and agent feedback). */
export function warpSpaceToWorld(t: Pick<WarpTarget, "space" | "box">, u: number, v: number): P {
  return apply(t.space, t.box.x + u * t.box.w, t.box.y + v * t.box.h);
}

export function describeWarp(spec: WarpSpec): string {
  if (spec.preset === "envelope") return "free envelope";
  return `${WARP_LABELS[spec.preset].label} ${Math.round(spec.amount)}${spec.orientation === "vertical" ? " (vertical)" : ""}`;
}

/** The warp currently applied to a selection (from its record), or null — no glyphs needed. */
export function currentWarp(doc: DocT, ids: string[]): WarpSpec | null {
  const members = topIds(doc, ids);
  if (!members.length) return null;
  const v = validRecord(doc, members);
  if (!v) return null;
  return { preset: v.rec.preset as WarpSpec["preset"], amount: v.rec.amount, orientation: v.rec.orientation, envelope: v.rec.envelope ?? null };
}
