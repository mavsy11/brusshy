import { apply, IDENTITY, multiply, shapeToPath, transformMatrix, type Mat } from "./geometry";
import { parsePath, type P } from "./pathmodel";
import type { DocT, NodeT, PaintT, TextNodeT } from "./schema";
import type { OpT } from "./ops";
import { describeColor, parseColor, rgbToHex, rgbToLab, styleProfile, type RGB } from "./style";
import { contrastRatio, hexToOklch, oklchToHex } from "./palette";
import { isTypeNode } from "./lockup";
import type { GlyphOutline } from "./lettering";

/**
 * Design critique of one version (a projected frame document, see frameDoc): deterministic
 * checks a senior designer would run by eye, each with a 0–100 score, a one-line verdict
 * and concrete findings anchored to a layer and a point on the artboard.
 *
 * - legibility  — thin parts and gaps/counters that vanish or close at 16 / 24 px
 *                 (a colour-region raster + distance transform: every ridge narrower than
 *                 a pixel at 16 px is a hairline; every background ridge is a gap)
 * - balance     — visual (ink-weighted) centre vs the artboard centre, margins, lean
 * - contrast    — palette vs background (WCAG 3:1 for graphics, 4.5:1 for small text),
 *                 neighbouring colours separated only by hue
 * - complexity  — nodes, colours, gradients, tiny details
 * - consistency — near-equal stroke/stem weights and corner radii, mixed corners and caps
 * - alignment   — parts that miss a shared edge or centre by 1–3 units
 * - spacing     — optical letter gaps in the wordmark (area per band, capped at ¼ em)
 *
 * Pure: the studio passes its font outlines (textGlyphs); without them text is estimated
 * and the text-dependent checks say so.
 */

// ---------------------------------------------------------------- types

export const CRITIQUE_CATEGORIES = ["legibility", "balance", "contrast", "complexity", "consistency", "alignment", "spacing"] as const;
export type CritiqueCategoryId = (typeof CRITIQUE_CATEGORIES)[number];

export const CRITIQUE_LABELS: Record<CritiqueCategoryId, string> = {
  legibility: "Small sizes",
  balance: "Balance",
  contrast: "Contrast",
  complexity: "Complexity",
  consistency: "Consistency",
  alignment: "Alignment",
  spacing: "Spacing",
};

export const CRITIQUE_HINTS: Record<CritiqueCategoryId, string> = {
  legibility: "Thin parts and closing gaps at 16 and 24 px",
  balance: "Visual centre, margins and lean",
  contrast: "Colours against the background (WCAG)",
  complexity: "Nodes, colours and tiny details",
  consistency: "Stroke weights and corner radii",
  alignment: "Parts that just miss an edge or centre",
  spacing: "Optical gaps between letters",
};

/** How much each category counts in the overall score. */
export const CRITIQUE_WEIGHTS: Record<CritiqueCategoryId, number> = {
  legibility: 0.24,
  contrast: 0.18,
  balance: 0.14,
  complexity: 0.14,
  consistency: 0.1,
  alignment: 0.1,
  spacing: 0.1,
};

export type CritiqueSeverity = "high" | "medium" | "low";

export interface CritiqueBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CritiqueFinding {
  /** Stable within a report: `<category>-<n>`. */
  id: string;
  category: CritiqueCategoryId;
  severity: CritiqueSeverity;
  /** One short line. */
  title: string;
  /** The measurement behind it. */
  detail: string;
  /** A concrete fix. */
  fix: string;
  /** Layer it is about (null = the whole artwork / artboard). */
  nodeId: string | null;
  nodeName: string;
  /** Anchor point in artboard (frame) coordinates — where a note is pinned. */
  x: number;
  y: number;
  /** Area to highlight, artboard coordinates. */
  box: CritiqueBox | null;
}

export interface CritiqueCategory {
  id: CritiqueCategoryId;
  label: string;
  /** 0–100, or null when there is nothing to judge (e.g. no wordmark). */
  score: number | null;
  verdict: string;
  findings: CritiqueFinding[];
  metrics: Record<string, number | string | boolean | null>;
}

export interface CritiqueReport {
  frame: { name: string; width: number; height: number; background: string | null };
  /** Weighted 0–100, null when the version is empty. */
  overall: number | null;
  verdict: string;
  categories: CritiqueCategory[];
  /** Every finding, most important first. */
  findings: CritiqueFinding[];
  /** Text was measured on real glyph outlines (false = estimated from the font size). */
  exactType: boolean;
  empty: boolean;
}

export interface CritiqueOptions {
  /** Glyph outlines of a text node (local coordinates, baseline y=0) — the studio's fonts. */
  textGlyphs?: (n: TextNodeT) => GlyphOutline[] | null;
  /** Version name for the report (default: the projected document's name). */
  name?: string;
  /** Raster cells across the artboard's long side (default 320: 20 cells = 1 px at 16 px). */
  resolution?: number;
}

// ---------------------------------------------------------------- small helpers

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Units for prose: whole numbers above 10, one decimal below. */
const u = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(r1(v)));
const px = (v: number) => (v < 0.1 ? "<0.1" : String(r1(v)));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[clamp(Math.floor(q * (sorted.length - 1) + 0.5), 0, sorted.length - 1)] : NaN);
const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);
const deltaE = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const SEV_ORDER: Record<CritiqueSeverity, number> = { high: 0, medium: 1, low: 2 };
const SEV_FACTOR: Record<CritiqueSeverity, number> = { high: 0.76, medium: 0.88, low: 0.96 };
const downgrade = (s: CritiqueSeverity): CritiqueSeverity | null => (s === "high" ? "medium" : s === "medium" ? "low" : null);

function scoreFrom(base: number, findings: { severity: CritiqueSeverity }[], factor: Record<CritiqueSeverity, number> = SEV_FACTOR): number {
  let s = base;
  for (const f of findings) s *= factor[f.severity];
  return Math.round(clamp(s, 0, 100));
}

function nodeLabel(n: NodeT | undefined): string {
  if (!n) return "the artwork";
  if (n.name.trim()) return n.name.trim();
  if (n.type === "text") return n.text.length > 24 ? `${n.text.slice(0, 22)}…` : n.text;
  if (n.type === "shape") return n.shape;
  return n.type;
}

// ---------------------------------------------------------------- geometry

interface Poly {
  pts: P[];
  closed: boolean;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Edge made by a straight run (left, top, right, bottom) — round edges overshoot on purpose. */
  flat: [boolean, boolean, boolean, boolean];
}

const cubicAt = (a: P, b: P, c: P, d: P, t: number): P => {
  const s = 1 - t;
  const k0 = s * s * s, k1 = 3 * s * s * t, k2 = 3 * s * t * t, k3 = t * t * t;
  return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]];
};

/** Parameters in (0, 1) where one coordinate of a cubic has a turning point. */
function extremaT(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return out.filter((t) => t > 1e-6 && t < 1 - 1e-6);
}

function safeParse(d: string) {
  try {
    return parsePath(d);
  } catch {
    return [];
  }
}

/** World-space outline polygons (12 steps per curve). */
function flatten(d: string, m: Mat): Poly[] {
  const out: Poly[] = [];
  for (const s of safeParse(d)) {
    const a = s.anchors;
    const n = a.length;
    const segs = s.closed ? n : n - 1;
    const pts: P[] = [apply(m, a[0].p[0], a[0].p[1])];
    for (let i = 0; i < segs; i++) {
      const A = a[i], B = a[(i + 1) % n];
      if (!A.cout && !B.cin) {
        pts.push(apply(m, B.p[0], B.p[1]));
        continue;
      }
      const p1 = A.cout ?? A.p, p2 = B.cin ?? B.p;
      for (let k = 1; k <= 12; k++) {
        const q = cubicAt(A.p, p1, p2, B.p, k / 12);
        pts.push(apply(m, q[0], q[1]));
      }
    }
    if (pts.length > 1) out.push({ pts, closed: s.closed });
  }
  return out;
}

/** Exact ink bounds (curve extrema solved in world space) plus which edges are flat. */
function exactBounds(d: string, m: Mat, half: number): Bounds | null {
  const pts: P[] = [];
  for (const s of safeParse(d)) {
    const a = s.anchors;
    const n = a.length;
    const segs = s.closed ? n : n - 1;
    pts.push(apply(m, a[0].p[0], a[0].p[1]));
    for (let i = 0; i < segs; i++) {
      const A = a[i], B = a[(i + 1) % n];
      const q3 = apply(m, B.p[0], B.p[1]);
      pts.push(q3);
      if (!A.cout && !B.cin) continue;
      const q0 = apply(m, A.p[0], A.p[1]);
      const c1 = A.cout ?? A.p, c2 = B.cin ?? B.p;
      const q1 = apply(m, c1[0], c1[1]);
      const q2 = apply(m, c2[0], c2[1]);
      for (const ax of [0, 1])
        for (const t of extremaT(q0[ax], q1[ax], q2[ax], q3[ax])) pts.push(cubicAt(q0, q1, q2, q3, t));
    }
  }
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const w = x1 - x0, h = y1 - y0;
  const eps = Math.max(1e-3, 1e-4 * Math.max(w, h));
  const flatSide = (on: (p: P) => boolean, along: (p: P) => number, size: number) => {
    const vs = pts.filter(on).map(along);
    return vs.length >= 2 && Math.max(...vs) - Math.min(...vs) >= Math.max(0.02 * size, eps * 10);
  };
  return {
    x0: x0 - half,
    y0: y0 - half,
    x1: x1 + half,
    y1: y1 + half,
    flat: [
      flatSide((p) => p[0] <= x0 + eps, (p) => p[1], h),
      flatSide((p) => p[1] <= y0 + eps, (p) => p[0], w),
      flatSide((p) => p[0] >= x1 - eps, (p) => p[1], h),
      flatSide((p) => p[1] >= y1 - eps, (p) => p[0], w),
    ],
  };
}

function unionBounds(bs: Bounds[]): Bounds | null {
  if (!bs.length) return null;
  const out: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, flat: [false, false, false, false] };
  for (const b of bs) {
    out.x0 = Math.min(out.x0, b.x0);
    out.y0 = Math.min(out.y0, b.y0);
    out.x1 = Math.max(out.x1, b.x1);
    out.y1 = Math.max(out.y1, b.y1);
  }
  const eps = 1e-3 * Math.max(out.x1 - out.x0, out.y1 - out.y0, 1);
  out.flat = [
    bs.some((b) => b.flat[0] && b.x0 <= out.x0 + eps),
    bs.some((b) => b.flat[1] && b.y0 <= out.y0 + eps),
    bs.some((b) => b.flat[2] && b.x1 >= out.x1 - eps),
    bs.some((b) => b.flat[3] && b.y1 >= out.y1 - eps),
  ];
  return out;
}

const toBox = (b: { x0: number; y0: number; x1: number; y1: number }): CritiqueBox => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

function polyArea(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.pts.length; i++) {
    const q = p.pts[i], r = p.pts[(i + 1) % p.pts.length];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}

function polyPerimeter(p: Poly): number {
  let L = 0;
  for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]);
  if (p.closed) L += Math.hypot(p.pts[0][0] - p.pts[p.pts.length - 1][0], p.pts[0][1] - p.pts[p.pts.length - 1][1]);
  return L;
}

/** Left/right ink extent of outlines on one horizontal line. */
function spanAt(polys: Poly[], y: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (const p of polys) {
    const n = p.pts.length;
    for (let k = 0; k < n; k++) {
      const a = p.pts[k], b = p.pts[(k + 1) % n];
      if (a[1] <= y !== b[1] <= y) {
        const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Rounded corners in a path: a short curve between two straight runs that turns the outline (radius in world units). */
function pathRadii(d: string, scale: number): number[] {
  const out: number[] = [];
  const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
  const len = (v: P) => Math.hypot(v[0], v[1]);
  const ang = (a: P, b: P) => Math.acos(clamp((a[0] * b[0] + a[1] * b[1]) / (len(a) * len(b) || 1), -1, 1));
  for (const s of safeParse(d)) {
    const a = s.anchors;
    const n = a.length;
    const segs = s.closed ? n : n - 1;
    const kind = (i: number) => (a[i].cout || a[(i + 1) % n].cin ? "curve" : "line");
    for (let i = 0; i < segs; i++) {
      if (kind(i) !== "curve") continue;
      const pi = s.closed ? (i - 1 + segs) % segs : i - 1;
      const ni = s.closed ? (i + 1) % segs : i + 1;
      if (pi < 0 || ni >= segs || kind(pi) !== "line" || kind(ni) !== "line") continue;
      const A = a[i], B = a[(i + 1) % n];
      const din = sub(A.p, a[pi].p);
      const dout = sub(a[(ni + 1) % n].p, B.p);
      const turn = ang(din, dout);
      if (turn < Math.PI / 6 || turn > (5 * Math.PI) / 6) continue;
      const chord = len(sub(B.p, A.p));
      if (chord > 1.5 * Math.min(len(din), len(dout))) continue;
      out.push((chord / (2 * Math.sin(turn / 2))) * scale);
    }
  }
  return out;
}

// ---------------------------------------------------------------- leaves

interface Ink {
  rgb: RGB;
  alpha: number;
  lab: [number, number, number];
  hex: string;
}

function inkOf(p: PaintT): Ink | null {
  if (p === null) return null;
  const stops = typeof p === "string" ? [p] : p.stops.map((s) => s.color);
  const cs = stops.map((c) => parseColor(c)).filter((c): c is NonNullable<typeof c> => !!c);
  if (!cs.length) return null;
  // A gradient counts as its average colour (its bands are not separate shapes).
  const rgb = [0, 1, 2].map((i) => cs.reduce((a, c) => a + c.rgb[i], 0) / cs.length) as RGB;
  const alpha = cs.reduce((a, c) => a + c.alpha, 0) / cs.length;
  if (alpha <= 0.02) return null;
  return { rgb, alpha, lab: rgbToLab(rgb), hex: rgbToHex(rgb) };
}

const paintHexes = (p: PaintT): string[] => {
  if (p === null) return [];
  const list = typeof p === "string" ? [p] : p.stops.map((s) => s.color);
  return list.map((c) => parseColor(c)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => rgbToHex(c.rgb));
};

interface Glyph {
  ch: string;
  polys: Poly[];
  box: Bounds;
}

interface Leaf {
  idx: number;
  id: string;
  node: NodeT;
  name: string;
  /** Alignment unit (the leaf, or the type group it belongs to). */
  unit: string;
  /** Ancestor group ids inside the version. */
  chain: string[];
  typeLike: boolean;
  effect: boolean;
  text: TextNodeT | null;
  /** Text without outlines: a box estimate (not painted into the raster). */
  estimated: boolean;
  polys: Poly[];
  fill: Ink | null;
  stroke: Ink | null;
  sw: number;
  rule: "nonzero" | "evenodd";
  opacity: number;
  bounds: Bounds | null;
  area: number;
  perimeter: number;
  anchors: number;
  radii: number[];
  colors: string[];
  gradient: boolean;
  glyphs: Glyph[] | null;
  m: Mat;
  scale: number;
  open: boolean;
}

function collectLeaves(pdoc: DocT, o: CritiqueOptions): Leaf[] {
  const out: Leaf[] = [];
  const walk = (id: string, m: Mat, opacity: number, unit: string | null, typeLike: boolean, chain: string[]) => {
    const n = pdoc.nodes[id];
    if (!n || !n.visible) return;
    if (n.type === "sketch" || n.type === "reference" || n.type === "frame") return;
    const mm = multiply(m, transformMatrix(n.transform));
    if (n.type === "group") {
      const tl = typeLike || isTypeNode(pdoc, n.id);
      const uu = unit ?? (tl ? n.id : null);
      n.children.forEach((c) => walk(c, mm, opacity * n.style.opacity, uu, tl, [...chain, n.id]));
      return;
    }
    const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
    const s = n.style;
    let d: string | null = null;
    let glyphs: Glyph[] | null = null;
    let estimated = false;
    let anchors = 0;
    let radii: number[] = [];
    if (n.type === "path") {
      d = n.d;
      anchors = safeParse(n.d).reduce((a, sp) => a + sp.anchors.length, 0);
      radii = pathRadii(n.d, scale);
    } else if (n.type === "shape") {
      d = shapeToPath(n);
      const r = n.shape === "rect" ? Math.min(n.radius, n.width / 2, n.height / 2) : n.radius;
      anchors = n.shape === "ellipse" ? 4 : n.shape === "rect" ? (r > 0 ? 8 : 4) : n.shape === "star" ? n.sides * 2 : n.sides;
      if (n.shape !== "ellipse" && r > 0) radii = [r * scale];
    } else if (n.type === "text") {
      if (!n.text.trim()) return;
      const gs = o.textGlyphs?.(n) ?? null;
      if (gs && gs.some((g) => g.d)) {
        d = gs.map((g) => g.d).join("");
        glyphs = gs
          .map((g) => {
            const polys = g.d ? flatten(g.d, mm) : [];
            const box = g.d ? exactBounds(g.d, mm, 0) : null;
            return box ? { ch: g.text, polys, box } : { ch: g.text, polys: [], box: { x0: 0, y0: 0, x1: 0, y1: 0, flat: [false, false, false, false] as Bounds["flat"] } };
          });
      } else {
        // Box estimate: cap height 0.7 em, 0.56 em per character.
        const chars = Array.from(n.text);
        const w = chars.length * n.fontSize * 0.56 + Math.max(0, chars.length - 1) * n.letterSpacing;
        const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
        d = `M${x} ${-n.fontSize * 0.7}H${x + w}V0H${x}Z`;
        estimated = true;
      }
    }
    if (!d) return;
    const polys = flatten(d, mm);
    if (!polys.length) return;
    const fill = inkOf(s.fill);
    const stroke = s.strokeWidth > 0 ? inkOf(s.stroke) : null;
    const sw = stroke ? s.strokeWidth * scale : 0;
    const op = opacity * s.opacity;
    if (op <= 0.02 || (!fill && !stroke)) return;
    out.push({
      idx: out.length,
      id: n.id,
      node: n,
      name: nodeLabel(n),
      unit: unit ?? n.id,
      chain,
      typeLike: typeLike || n.type === "text",
      effect: !!n.effect,
      text: n.type === "text" ? n : null,
      estimated,
      polys,
      fill,
      stroke,
      sw,
      rule: s.fillRule,
      opacity: op,
      bounds: exactBounds(d, mm, sw / 2),
      area: fill ? Math.abs(polys.reduce((a, p) => a + polyArea(p), 0)) : 0,
      perimeter: polys.reduce((a, p) => a + polyPerimeter(p), 0),
      anchors,
      radii,
      colors: [...paintHexes(s.fill), ...(stroke ? paintHexes(s.stroke) : [])],
      gradient: (s.fill !== null && typeof s.fill === "object") || (!!stroke && s.stroke !== null && typeof s.stroke === "object"),
      glyphs,
      m: mm,
      scale,
      open: polys.some((p) => !p.closed),
    });
  };
  pdoc.root.forEach((id) => walk(id, IDENTITY, 1, null, false, []));
  return out;
}

// ---------------------------------------------------------------- raster

interface Raster {
  R: number;
  cell: number;
  nx: number;
  ny: number;
  ox: number;
  oy: number;
  /** Colour region per cell (0 = background, knockouts included). */
  label: Int16Array;
  /** Leaf index that painted the cell (-1 = none). */
  owner: Int32Array;
  /** CIE lightness of the composited cell. */
  L: Float32Array;
  /** Region colours; index 0 is the background. */
  colors: { lab: [number, number, number]; hex: string; cells: number }[];
  /** Distance (cells) from each cell to the nearest cell of another region. */
  dist: Float32Array;
  bg: { hex: string; lab: [number, number, number]; transparent: boolean; dark: boolean };
  inkCells: number;
}

const INF = 1e20;

function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Exact Euclidean distance transform (Felzenszwalb): distance from mask cells to the nearest non-mask cell. */
function edt(mask: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const tmp = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0;
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = tmp[y * w + x];
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = mask[y * w + x] ? Math.sqrt(d[x]) : 0;
  }
  return out;
}

function rasterize(leaves: Leaf[], W: number, H: number, background: string | null, R: number): Raster {
  const long = Math.max(W, H);
  const cell = long / R;
  const pad = Math.ceil(R * 0.08);
  const nxIn = Math.max(1, Math.ceil(W / cell));
  const nyIn = Math.max(1, Math.ceil(H / cell));
  const nx = nxIn + 2 * pad;
  const ny = nyIn + 2 * pad;
  const N = nx * ny;
  const ox = -pad * cell;
  const oy = -pad * cell;
  const cx = (i: number) => ox + (i + 0.5) * cell;
  const cy = (j: number) => oy + (j + 0.5) * cell;
  const inX = (i: number) => i >= pad && i < pad + nxIn && cx(i) < W;
  const inY = (j: number) => j >= pad && j < pad + nyIn && cy(j) < H;

  const painted = leaves.filter((l) => !l.estimated);
  const stamp = new Int32Array(N);
  let tick = 0;
  const cellsOf = (lf: Leaf, kind: "fill" | "stroke"): number[] => {
    tick++;
    const list: number[] = [];
    const add = (k: number) => {
      if (stamp[k] !== tick) {
        stamp[k] = tick;
        list.push(k);
      }
    };
    const b = lf.bounds;
    if (!b) return list;
    if (kind === "fill") {
      const j0 = Math.max(0, Math.floor((b.y0 - oy) / cell - 0.5));
      const j1 = Math.min(ny - 1, Math.ceil((b.y1 - oy) / cell - 0.5));
      const xs: { x: number; w: number }[] = [];
      for (let j = j0; j <= j1; j++) {
        if (!inY(j)) continue;
        const y = cy(j);
        xs.length = 0;
        for (const p of lf.polys) {
          const n = p.pts.length;
          for (let k = 0; k < n; k++) {
            const a = p.pts[k], c = p.pts[(k + 1) % n];
            if (a[1] <= y !== c[1] <= y) xs.push({ x: a[0] + ((y - a[1]) * (c[0] - a[0])) / (c[1] - a[1]), w: c[1] > a[1] ? 1 : -1 });
          }
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p.x - q.x);
        let wind = 0;
        for (let k = 0; k < xs.length - 1; k++) {
          wind = lf.rule === "evenodd" ? wind ^ 1 : wind + xs[k].w;
          if (!wind) continue;
          const i0 = Math.max(0, Math.ceil((xs[k].x - ox) / cell - 0.5));
          const i1 = Math.min(nx - 1, Math.floor((xs[k + 1].x - ox) / cell - 0.5));
          for (let i = i0; i <= i1; i++) if (inX(i)) add(j * nx + i);
        }
      }
    } else {
      // Hairlines still cover the cells they pass through, so they are measured instead of skipped.
      const hw = Math.max(lf.sw / 2, cell * 0.5);
      const hw2 = hw * hw;
      const seg = (a: P, c: P) => {
        const i0 = Math.max(0, Math.floor((Math.min(a[0], c[0]) - hw - ox) / cell));
        const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], c[0]) + hw - ox) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(a[1], c[1]) - hw - oy) / cell));
        const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], c[1]) + hw - oy) / cell));
        const dx = c[0] - a[0], dy = c[1] - a[1];
        const L2 = dx * dx + dy * dy || 1e-12;
        for (let j = j0; j <= j1; j++) {
          if (!inY(j)) continue;
          for (let i = i0; i <= i1; i++) {
            if (!inX(i)) continue;
            const px0 = cx(i), py0 = cy(j);
            const t = clamp(((px0 - a[0]) * dx + (py0 - a[1]) * dy) / L2, 0, 1);
            const ex = px0 - a[0] - t * dx, ey = py0 - a[1] - t * dy;
            if (ex * ex + ey * ey <= hw2) add(j * nx + i);
          }
        }
      };
      for (const p of lf.polys) {
        for (let k = 1; k < p.pts.length; k++) seg(p.pts[k - 1], p.pts[k]);
        if (p.closed) seg(p.pts[p.pts.length - 1], p.pts[0]);
      }
    }
    return list;
  };
  const masks = painted.map((lf) => ({ lf, fill: lf.fill ? cellsOf(lf, "fill") : [], stroke: lf.stroke ? cellsOf(lf, "stroke") : [] }));

  const compose = (bgRgb: RGB) => {
    const r = new Float32Array(N).fill(bgRgb[0]);
    const g = new Float32Array(N).fill(bgRgb[1]);
    const b = new Float32Array(N).fill(bgRgb[2]);
    const cov = new Float32Array(N);
    const owner = new Int32Array(N).fill(-1);
    const blend = (cells: number[], ink: Ink, a: number, idx: number) => {
      for (const k of cells) {
        r[k] = r[k] * (1 - a) + ink.rgb[0] * a;
        g[k] = g[k] * (1 - a) + ink.rgb[1] * a;
        b[k] = b[k] * (1 - a) + ink.rgb[2] * a;
        cov[k] = cov[k] + (1 - cov[k]) * a;
        if (a >= 0.5) owner[k] = idx;
      }
    };
    for (const { lf, fill, stroke } of masks) {
      if (lf.fill) blend(fill, lf.fill, clamp(lf.fill.alpha * lf.opacity, 0, 1), lf.idx);
      if (lf.stroke) blend(stroke, lf.stroke, clamp(lf.stroke.alpha * lf.opacity, 0, 1), lf.idx);
    }
    return { r, g, b, cov, owner };
  };

  const labCache = new Map<number, [number, number, number]>();
  const labAt = (c: { r: Float32Array; g: Float32Array; b: Float32Array }, k: number) => {
    const key = (Math.round(c.r[k]) << 16) | (Math.round(c.g[k]) << 8) | Math.round(c.b[k]);
    let lab = labCache.get(key);
    if (!lab) {
      lab = rgbToLab([Math.round(c.r[k]), Math.round(c.g[k]), Math.round(c.b[k])]);
      labCache.set(key, lab);
    }
    return { key, lab };
  };

  // Transparent artboards read as a light page — unless the artwork itself is light (made for dark).
  const parsedBg = background ? parseColor(background) : null;
  const transparent = !parsedBg;
  let bgRgb: RGB = parsedBg ? parsedBg.rgb : [255, 255, 255];
  let c = compose(bgRgb);
  if (transparent) {
    let ink = 0, light = 0;
    const white = rgbToLab([255, 255, 255]);
    for (let k = 0; k < N; k++)
      if (c.cov[k] >= 0.5) {
        ink++;
        if (deltaE(labAt(c, k).lab, white) < 10) light++;
      }
    if (ink > 0 && light / ink > 0.6) {
      bgRgb = [11, 12, 14];
      c = compose(bgRgb);
    }
  }
  const bgLab = rgbToLab(bgRgb);

  // Regions: cluster the composited colours (ΔE < 12); near-background colours are background.
  const label = new Int16Array(N);
  const L = new Float32Array(N);
  const keyOf = new Int32Array(N).fill(-1);
  const counts = new Map<number, { lab: [number, number, number]; n: number }>();
  for (let k = 0; k < N; k++) {
    const { key, lab } = labAt(c, k);
    L[k] = lab[0];
    if (c.cov[k] < 0.5 || deltaE(lab, bgLab) < 10) continue;
    keyOf[k] = key;
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { lab, n: 1 });
  }
  const centres: { lab: [number, number, number]; n: number }[] = [];
  const assign = new Map<number, number>();
  for (const [key, e] of [...counts.entries()].sort((a, b) => b[1].n - a[1].n)) {
    let best = -1, bd = 12;
    centres.forEach((ct, i) => {
      const dd = deltaE(ct.lab, e.lab);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    if (best < 0) {
      if (centres.length >= 12) {
        // Too many distinct colours: fold the rest into the nearest region.
        best = centres.reduce((bi, ct, i) => (deltaE(ct.lab, e.lab) < deltaE(centres[bi].lab, e.lab) ? i : bi), 0);
      } else {
        centres.push({ lab: e.lab, n: 0 });
        best = centres.length - 1;
      }
    }
    centres[best].n += e.n;
    assign.set(key, best + 1);
  }
  let inkCells = 0;
  for (let k = 0; k < N; k++)
    if (keyOf[k] >= 0) {
      label[k] = assign.get(keyOf[k])!;
      inkCells++;
    }

  // Distance to the nearest other region, per region (cropped to its bounds + 1 cell).
  const dist = new Float32Array(N);
  const K = centres.length + 1;
  const bbox = Array.from({ length: K }, () => ({ i0: nx, j0: ny, i1: -1, j1: -1 }));
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const bb = bbox[label[j * nx + i]];
      if (i < bb.i0) bb.i0 = i;
      if (i > bb.i1) bb.i1 = i;
      if (j < bb.j0) bb.j0 = j;
      if (j > bb.j1) bb.j1 = j;
    }
  for (let lab = 0; lab < K; lab++) {
    const bb = bbox[lab];
    if (bb.i1 < 0) continue;
    const i0 = Math.max(0, bb.i0 - 1), i1 = Math.min(nx - 1, bb.i1 + 1);
    const j0 = Math.max(0, bb.j0 - 1), j1 = Math.min(ny - 1, bb.j1 + 1);
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const mask = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) mask[j * w + i] = label[(j + j0) * nx + i + i0] === lab ? 1 : 0;
    const dd = edt(mask, w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) dist[(j + j0) * nx + i + i0] = dd[j * w + i];
  }

  const colors = [
    { lab: bgLab, hex: rgbToHex(bgRgb), cells: N - inkCells },
    ...centres.map((ct) => {
      // Representative colour: the most common composited colour of the region.
      let bestKey = -1, bestN = -1;
      for (const [key, e] of counts) if (assign.get(key) === centres.indexOf(ct) + 1 && e.n > bestN) {
        bestN = e.n;
        bestKey = key;
      }
      const hex = "#" + bestKey.toString(16).padStart(6, "0");
      return { lab: ct.lab, hex, cells: ct.n };
    }),
  ];
  return {
    R,
    cell,
    nx,
    ny,
    ox,
    oy,
    label,
    owner: c.owner,
    L,
    colors,
    dist,
    bg: { hex: rgbToHex(bgRgb), lab: bgLab, transparent, dark: bgLab[0] < 50 },
    inkCells,
  };
}

const cellCentre = (r: Raster, k: number): P => [r.ox + ((k % r.nx) + 0.5) * r.cell, r.oy + (Math.floor(k / r.nx) + 0.5) * r.cell];

/** Connected components of the cells `on` accepts (8-connected), same region label. */
function components(r: Raster, on: (k: number) => boolean, eight = true): number[][] {
  const seen = new Uint8Array(r.nx * r.ny);
  const out: number[][] = [];
  const nb = eight ? [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, 1, -1, 1, 1, -1] : [-1, 0, 1, 0, 0, -1, 0, 1];
  for (let k0 = 0; k0 < seen.length; k0++) {
    if (seen[k0] || !on(k0)) continue;
    const comp: number[] = [];
    const stack = [k0];
    seen[k0] = 1;
    const lab = r.label[k0];
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const i = k % r.nx, j = Math.floor(k / r.nx);
      for (let q = 0; q < nb.length; q += 2) {
        const ii = i + nb[q], jj = j + nb[q + 1];
        if (ii < 0 || jj < 0 || ii >= r.nx || jj >= r.ny) continue;
        const kk = jj * r.nx + ii;
        if (seen[kk] || r.label[kk] !== lab || !on(kk)) continue;
        seen[kk] = 1;
        stack.push(kk);
      }
    }
    out.push(comp);
  }
  return out;
}

function compBox(r: Raster, comp: number[], grow = 0): Bounds {
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const k of comp) {
    const i = k % r.nx, j = Math.floor(k / r.nx);
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
  }
  return {
    x0: r.ox + i0 * r.cell - grow,
    y0: r.oy + j0 * r.cell - grow,
    x1: r.ox + (i1 + 1) * r.cell + grow,
    y1: r.oy + (j1 + 1) * r.cell + grow,
    flat: [false, false, false, false],
  };
}

/** The component cell nearest to its centroid (a point that is on the feature). */
function compAnchor(r: Raster, comp: number[]): P {
  let sx = 0, sy = 0;
  for (const k of comp) {
    const [x, y] = cellCentre(r, k);
    sx += x;
    sy += y;
  }
  const c: P = [sx / comp.length, sy / comp.length];
  let best = comp[0], bd = Infinity;
  for (const k of comp) {
    const [x, y] = cellCentre(r, k);
    const d = (x - c[0]) ** 2 + (y - c[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return cellCentre(r, best);
}

function topOwners(counts: Map<number, number>): number[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

// ---------------------------------------------------------------- context

interface Ctx {
  pdoc: DocT;
  W: number;
  H: number;
  long: number;
  leaves: Leaf[];
  raster: Raster | null;
  exactType: boolean;
  /** Content bounds (all visible ink, estimates included). */
  content: Bounds | null;
  findings: Omit<CritiqueFinding, "id">[];
}

type Draft = Omit<CritiqueFinding, "id" | "category">;

interface CheckResult {
  score: number | null;
  verdict: string;
  drafts: Draft[];
  metrics: CritiqueCategory["metrics"];
}

function finding(leaf: Leaf | null, severity: CritiqueSeverity, title: string, detail: string, fix: string, at: P, box: Bounds | CritiqueBox | null): Draft {
  return {
    severity,
    title,
    detail,
    fix,
    nodeId: leaf?.id ?? null,
    nodeName: leaf?.name ?? "the artwork",
    x: at[0],
    y: at[1],
    box: box ? ("x0" in box ? toBox(box) : box) : null,
  };
}

const sortDrafts = (ds: Draft[]) => ds.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

function verdictFrom(ds: Draft[], ok: string): string {
  if (!ds.length) return ok;
  const s = sortDrafts([...ds]);
  return s.length > 1 ? `${s[0].title} (+${s.length - 1} more).` : `${s[0].title}.`;
}

// ---------------------------------------------------------------- 1. legibility at small sizes

function checkLegibility(ctx: Ctx): CheckResult {
  const r = ctx.raster;
  const drafts: Draft[] = [];
  const at16 = (cells: number) => (cells * 16) / (r?.R ?? 1);
  const at24 = (cells: number) => (cells * 24) / (r?.R ?? 1);
  let thinnest: number | null = null;
  let tightest: number | null = null;
  let strokeContrast: number | null = null;
  // The small-size-cut note sums up the hairline findings: kept apart so they never crowd it out.
  const cut: Draft[] = [];
  if (r && r.inkCells) {
    const { nx, ny, label, dist } = r;
    const partMax = (0.95 * r.R) / 16;
    const gapMax = (1.3 * r.R) / 16;
    const cand = new Uint8Array(nx * ny);
    const width = (k: number) => Math.max(0.6, 2 * dist[k] - 0.5);
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const d = dist[k];
        if (d <= 0) continue;
        const lab = label[k];
        const w = width(k);
        if (w >= (lab === 0 ? gapMax : partMax)) continue;
        let ridge = true;
        for (let dj = -1; dj <= 1 && ridge; dj++)
          for (let di = -1; di <= 1; di++) {
            const kk = k + dj * nx + di;
            if (kk !== k && label[kk] === lab && dist[kk] > d + 1e-6) {
              ridge = false;
              break;
            }
          }
        if (ridge) cand[k] = 1;
      }
    // Background ridges count only between ink (not in the open space around the artwork).
    type Cluster = { comp: number[]; gap: boolean; w: number; p25: number; p75: number; len: number; owners: number[] };
    const clusters: Cluster[] = [];
    for (const comp of components(r, (k) => cand[k] === 1)) {
      const gap = label[comp[0]] === 0;
      const ws = comp.map(width).sort((a, b) => a - b);
      const bb = compBox(r, comp);
      const len = Math.max((bb.x1 - bb.x0) / r.cell, (bb.y1 - bb.y0) / r.cell, comp.length * 0.5);
      if (at16(len) < 1.2) continue;
      const tally = new Map<number, number>();
      if (!gap) for (const k of comp) r.owner[k] >= 0 && tally.set(r.owner[k], (tally.get(r.owner[k]) ?? 0) + 1);
      else {
        const step = Math.max(1, Math.floor(comp.length / 24));
        for (let q = 0; q < comp.length; q += step) {
          const k = comp[q];
          const rr = Math.ceil(dist[k]) + 2;
          const i = k % nx, j = Math.floor(k / nx);
          for (let dj = -rr; dj <= rr; dj++)
            for (let di = -rr; di <= rr; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
              const kk = jj * nx + ii;
              if (label[kk] !== 0 && r.owner[kk] >= 0) tally.set(r.owner[kk], (tally.get(r.owner[kk]) ?? 0) + 1);
            }
        }
        if (!tally.size) continue;
      }
      clusters.push({ comp, gap, w: quantile(ws, 0.5), p25: quantile(ws, 0.25), p75: quantile(ws, 0.75), len, owners: topOwners(tally) });
    }
    const long = ctx.long;
    const toUnits = (cells: number) => cells * r.cell;
    // Fine tips and notches (tapered ridges) are merged per layer: one note, not one per point.
    const tips = new Map<string, { n: number; c: Cluster }>();
    for (const c of clusters) {
      const w16 = at16(c.w);
      const lf = c.owners.length ? ctx.leaves[c.owners[0]] : null;
      const other = c.owners.length > 1 ? ctx.leaves[c.owners[1]] : null;
      if (c.gap) tightest = tightest === null ? w16 : Math.min(tightest, w16);
      else thinnest = thinnest === null ? w16 : Math.min(thinnest, w16);
      const tapered = c.p25 / Math.max(1e-6, c.p75) < 0.55;
      if (tapered) {
        if (at16(c.len) < 2) continue;
        const key = `${c.gap ? "g" : "p"}:${lf?.id ?? ""}`;
        const t = tips.get(key);
        if (t) t.n++;
        else tips.set(key, { n: 1, c });
        continue;
      }
      let sev: CritiqueSeverity = c.gap ? (w16 < 0.6 ? "high" : w16 < 1 ? "medium" : "low") : w16 < 0.5 ? "high" : w16 < 0.8 ? "medium" : "low";
      if (at16(c.len) < 2.5 && sev !== "low") sev = downgrade(sev)!;
      const box = compBox(r, c.comp, toUnits(c.w) / 2 + r.cell);
      const at = compAnchor(r, c.comp);
      // Explicit strokes report their exact width (the raster rounds to whole cells).
      const units = !c.gap && lf && lf.sw > 0 && Math.abs(toUnits(c.w) - lf.sw) < 2.5 * r.cell ? lf.sw : toUnits(c.w);
      if (!c.gap) {
        const verb = sev === "high" ? "disappears" : sev === "medium" ? "fades" : "turns soft";
        drafts.push(
          finding(
            lf,
            sev,
            `"${lf?.name ?? "A thin part"}" ${verb} at 16 px`,
            `It is ${u(units)} units wide — ${px((units * 16) / long)} px at 16 px and ${px((units * 24) / long)} px at 24 px${w16 < 0.5 ? ", under the half pixel a screen can show" : ", which renders as a faint grey line"}.`,
            `Thicken it to at least ${u(long / 16)} units (1 px at 16 px), or leave it out of the small-size version.`,
            at,
            box,
          ),
        );
      } else {
        const where = other && other.id !== lf?.id ? `between "${lf?.name}" and "${other.name}"` : `in "${lf?.name ?? "the mark"}"`;
        const verb = sev === "high" ? "closes" : sev === "medium" ? "fills in" : "gets tight";
        drafts.push(
          finding(
            lf,
            sev,
            `Gap ${where} ${verb} at 16 px`,
            `The opening is ${u(units)} units — ${px(w16)} px at 16 px and ${px(at24(c.w))} px at 24 px, so the shapes ${sev === "low" ? "start to touch" : "merge into one"}.`,
            `Open it to at least ${u((1.25 * long) / 16)} units, or simplify the small-size version.`,
            at,
            box,
          ),
        );
      }
    }
    for (const { n, c } of tips.values()) {
      const lf = c.owners.length ? ctx.leaves[c.owners[0]] : null;
      const what = c.gap ? `${n === 1 ? "A narrow notch" : `${n} narrow notches`} in "${lf?.name ?? "the mark"}" ${n === 1 ? "fills" : "fill"} in` : `${n === 1 ? "A fine point" : `${n} fine points`} of "${lf?.name ?? "the mark"}" ${n === 1 ? "rounds" : "round"} off`;
      drafts.push(
        finding(
          lf,
          "low",
          `${what} at 16 px`,
          `${c.gap ? "The wedge" : "The tip"} narrows below ${px(at16(c.p25))} px over ${px(at16(c.len))} px of its length.`,
          c.gap ? "Fine as a detail — or widen the notch so the shapes stay apart at small sizes." : "Fine as an accent — or blunt the tip so it survives small sizes.",
          compAnchor(r, c.comp),
          compBox(r, c.comp, r.cell * 3),
        ),
      );
    }
    // Stroke contrast over the whole mark: the ink's ridge widths, thin (p10) ÷ thick (p90). High
    // contrast drops its thin strokes at small sizes while the thick ones stay, so the mark changes
    // character, not just size: type designers answer with a small-size cut (an optical size).
    // Backgrounds, badges and containers are masses, not strokes: layers that cover most of the artboard are left out.
    const mass = new Set(ctx.leaves.filter((l) => l.bounds && (l.bounds.x1 - l.bounds.x0) * (l.bounds.y1 - l.bounds.y0) > 0.4 * ctx.W * ctx.H).map((l) => l.idx));
    const ridges: number[] = [];
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const lab = label[k];
        if (lab === 0 || dist[k] <= 0 || mass.has(r.owner[k])) continue;
        let top = true;
        for (let dj = -1; dj <= 1 && top; dj++)
          for (let di = -1; di <= 1; di++) {
            const kk = k + dj * nx + di;
            if (label[kk] === lab && dist[kk] > dist[k] + 1e-6) {
              top = false;
              break;
            }
          }
        if (top) ridges.push(width(k));
      }
    if (ridges.length >= 24) {
      ridges.sort((a, b) => a - b);
      const thin = quantile(ridges, 0.1), thick = quantile(ridges, 0.9);
      strokeContrast = thin / Math.max(1e-6, thick);
      if (strokeContrast < 0.3 && at16(thin) < 1 && at16(thick) >= 1.5) {
        cut.push(
          finding(
            null,
            "low",
            `High stroke contrast (1:${r1(1 / strokeContrast)}) needs a small-size cut`,
            `The thin strokes run ${px(at16(thin))} px at 16 px and the thick ones ${px(at16(thick))} px: shrunk, the thin ones drop out and the mark turns into its heavy parts.`,
            `Keep this version for large sizes; for icons and favicons duplicate_frame and thicken only the thin parts to about ${u(ctx.long / 16)} units (refine bolder on those layers).`,
            [ctx.W / 2, ctx.H / 2],
            null,
          ),
        );
      }
    }
  }
  // Type needs ~5 px of cap height to be read.
  const units = new Map<string, Leaf[]>();
  for (const lf of ctx.leaves) if (lf.typeLike && !lf.effect) (units.get(lf.unit) ?? units.set(lf.unit, []).get(lf.unit)!).push(lf);
  const typeDrafts: Draft[] = [];
  for (const [unitId, ls] of units) {
    const t = ls.find((l) => l.text)?.text;
    const cap = t ? t.fontSize * 0.7 * ls[0].scale : median(ls.map((l) => (l.bounds ? l.bounds.y1 - l.bounds.y0 : 0)).filter((h) => h > 0));
    if (!(cap > 0)) continue;
    const needed = (5 * ctx.long) / cap;
    if (needed <= 64) continue;
    const b = unionBounds(ls.map((l) => l.bounds).filter((x): x is Bounds => !!x));
    const unitNode = ctx.pdoc.nodes[unitId];
    const name = unitNode?.type === "text" ? unitNode.text : nodeLabel(unitNode);
    const lead = ls.find((l) => l.id === unitId) ?? null;
    const leaf: Leaf | null = lead ?? (unitNode ? ({ ...ls[0], id: unitId, name: nodeLabel(unitNode) } as Leaf) : null);
    typeDrafts.push(
      finding(
        leaf,
        needed > 256 ? "medium" : "low",
        `"${name.length > 24 ? `${name.slice(0, 22)}…` : name}" only reads from about ${Math.round(needed / 8) * 8} px`,
        `Its cap height is ${u(cap)} units — ${px((cap * 16) / ctx.long)} px at 16 px; type needs about 5 px of cap height to be read.`,
        "Plan an icon-only version for small sizes (favicon, app icon, social avatar) instead of shrinking the full logo.",
        b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [ctx.W / 2, ctx.H / 2],
        b,
      ),
    );
  }
  typeDrafts.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  sortDrafts(drafts);
  const kept = [...drafts.slice(0, 6), ...cut, ...typeDrafts.slice(0, 2)];
  // Text that can't be read at 16 px is expected of a full lockup: it costs little.
  const score = scoreFrom(100, kept.map((d) => (typeDrafts.includes(d) ? { severity: "low" as const } : d)));
  const ok = r && r.inkCells ? "Holds up down to 16 px: no hairlines or closing gaps." : "Nothing drawn to check.";
  return {
    score: r && r.inkCells ? score : null,
    verdict: verdictFrom(kept, ok),
    drafts: kept,
    metrics: { thinnestPx16: thinnest === null ? null : r2(thinnest), tightestGapPx16: tightest === null ? null : r2(tightest), strokeContrast: strokeContrast === null ? null : r2(strokeContrast) },
  };
}

// ---------------------------------------------------------------- 2. balance

function checkBalance(ctx: Ctx): CheckResult {
  const drafts: Draft[] = [];
  const r = ctx.raster;
  const b = ctx.content;
  const { W, H } = ctx;
  if (!b || !r) return { score: null, verdict: "Nothing drawn to check.", drafts, metrics: {} };
  // Ink mass weighted by contrast with the background (knockouts weigh nothing), plus estimated text.
  let wsum = 0, wx = 0, wy = 0;
  // The mark alone (no type): its own lean is judged apart from the lockup.
  let msum = 0, mx = 0, my = 0;
  for (let k = 0; k < r.L.length; k++) {
    if (r.label[k] === 0 && r.owner[k] < 0) continue;
    const w = Math.abs(r.L[k] - r.bg.lab[0]) / 100;
    if (w <= 0) continue;
    const [x, y] = cellCentre(r, k);
    wsum += w;
    wx += w * x;
    wy += w * y;
    const o = r.owner[k] >= 0 ? ctx.leaves[r.owner[k]] : null;
    if (o && !o.typeLike) {
      msum += w;
      mx += w * x;
      my += w * y;
    }
  }
  const cellArea = r.cell * r.cell;
  wsum *= cellArea;
  wx *= cellArea;
  wy *= cellArea;
  for (const lf of ctx.leaves)
    if (lf.estimated && lf.bounds && lf.fill) {
      const w = (0.4 * lf.area * Math.abs(lf.fill.lab[0] - r.bg.lab[0])) / 100;
      wsum += w;
      wx += w * (lf.bounds.x0 + lf.bounds.x1) / 2;
      wy += w * (lf.bounds.y0 + lf.bounds.y1) / 2;
    }
  const bc: P = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const mass: P = wsum > 0 ? [wx / wsum, wy / wsum] : bc;
  // Visual centre: the box centre pulled halfway toward the ink mass.
  const vc: P = [bc[0] + 0.5 * (mass[0] - bc[0]), bc[1] + 0.5 * (mass[1] - bc[1])];
  const dx = vc[0] - W / 2;
  const dy = vc[1] - H / 2;
  // Optical centre: sitting up to 3% high reads as centred; low never does.
  const ey = dy > 0 ? dy : dy < -0.03 * H ? dy + 0.03 * H : 0;
  const e = Math.hypot(dx / W, ey / H);
  const content = toBox(b);
  if (e > 0.012) {
    const sev: CritiqueSeverity = e > 0.1 ? "high" : e > 0.05 ? "medium" : "low";
    const parts: string[] = [];
    if (Math.abs(dx) / W > 0.006) parts.push(`${u(Math.abs(dx))} units ${dx > 0 ? "right" : "left"}`);
    if (Math.abs(ey) / H > 0.006) parts.push(`${u(Math.abs(ey))} units ${ey > 0 ? "low" : "high"}`);
    const moves: string[] = [];
    if (Math.abs(dx) / W > 0.006) moves.push(`${u(Math.abs(dx))} units ${dx > 0 ? "left" : "right"}`);
    if (Math.abs(ey) / H > 0.006) moves.push(`${u(Math.abs(ey))} units ${ey > 0 ? "up" : "down"}`);
    const boxCentred = Math.abs(bc[0] - W / 2) < 0.006 * W && Math.abs(bc[1] - H / 2) < 0.006 * H;
    drafts.push(
      finding(
        null,
        sev,
        `Sits off-centre: visual weight is ${parts.join(" and ") || "off"}`,
        boxCentred
          ? `Its box is centred, but the ink is heavier on one side, so the eye reads it ${pct(e)} off.`
          : `The visual centre (ink-weighted) is ${pct(e)} of the artboard away from where the eye expects it.`,
        `Move the artwork ${moves.join(" and ")} — centre it optically, not by its box.`,
        vc,
        content,
      ),
    );
  }
  // Lean of the mark itself (type excluded): a top-heavy or sideways-heavy mass feels unstable.
  const bw = Math.max(1e-6, b.x1 - b.x0), bh = Math.max(1e-6, b.y1 - b.y0);
  const mb = unionBounds(ctx.leaves.filter((l) => !l.typeLike && l.bounds).map((l) => l.bounds!));
  if (mb && msum > 0) {
    const mm: P = [mx / msum, my / msum];
    const mc: P = [(mb.x0 + mb.x1) / 2, (mb.y0 + mb.y1) / 2];
    const mxr = (mm[0] - mc[0]) / Math.max(1e-6, mb.x1 - mb.x0);
    const myr = (mm[1] - mc[1]) / Math.max(1e-6, mb.y1 - mb.y0);
    const markBox = toBox(mb);
    if (myr < -0.09)
      drafts.push(
        finding(null, "low", "Top-heavy: most of the mark's ink sits in its upper half", `The ink mass is ${pct(-myr)} of the mark's height above its centre, so it can look like it might tip over.`, "Give the base more weight (or let it be, if the lift is the idea).", mm, markBox),
      );
    if (Math.abs(mxr) > 0.11)
      drafts.push(
        finding(null, "low", `Leans ${mxr > 0 ? "right" : "left"}: the mark's ink gathers on one side`, `The ink mass is ${pct(Math.abs(mxr))} of the mark's width ${mxr > 0 ? "right" : "left"} of its centre.`, "Counter it with weight on the other side, or make the lean deliberate (motion, direction).", mm, markBox),
      );
  }
  // Margins.
  const margins = { left: b.x0, right: W - b.x1, top: b.y0, bottom: H - b.y1 };
  const minM = Math.min(margins.left, margins.right, margins.top, margins.bottom);
  if (minM < -0.5) {
    const side = (Object.entries(margins) as [string, number][]).sort((a, c) => a[1] - c[1])[0][0];
    drafts.push(finding(null, "high", `Cut off by the artboard (${side} edge)`, `The ink runs ${u(-minM)} units past the ${side} edge, so exports clip it.`, "Scale the artwork down or enlarge the artboard so everything sits inside with clear space.", [side === "left" ? 0 : side === "right" ? W : (b.x0 + b.x1) / 2, side === "top" ? 0 : side === "bottom" ? H : (b.y0 + b.y1) / 2], content));
  } else if (minM < 0.03 * ctx.long) {
    const side = (Object.entries(margins) as [string, number][]).sort((a, c) => a[1] - c[1])[0][0];
    drafts.push(finding(null, "low", `Crowds the ${side} edge of the artboard`, `Only ${u(Math.max(0, minM))} units (${pct(Math.max(0, minM) / ctx.long)}) of space on the ${side}; exports and app icons will feel cramped.`, `Leave at least ${u(0.06 * ctx.long)} units of clear space on every side.`, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], content));
  }
  const fill = Math.max(bw / W, bh / H);
  if (fill < 0.35)
    drafts.push(finding(null, "low", `Small on its artboard (fills ${pct(fill)})`, "Most of every export will be empty space, and the mark renders smaller than it should.", `Scale the artwork up to fill about 70–85% of the artboard.`, bc, content));
  const base = 100 - clamp(e * 600, 0, 60);
  const score = scoreFrom(base, drafts.filter((d) => !d.title.startsWith("Sits off-centre")));
  return {
    score,
    verdict: verdictFrom(drafts, e < 0.005 ? "Optically centred, with comfortable margins." : `Optically centred (visual centre within ${pct(e)} of the artboard centre).`),
    drafts,
    metrics: { offsetX: r1(dx), offsetY: r1(dy), offset: r2(e), visualCentreX: r1(vc[0]), visualCentreY: r1(vc[1]) },
  };
}

// ---------------------------------------------------------------- 3. contrast

/** Nearest colour (same hue and chroma) that reaches `target`:1 against `bg`. */
function towardContrast(hex: string, bg: string, target: number): string | null {
  const o = hexToOklch(hex);
  const darker = hexToOklch(bg).l > 0.55;
  let lo = darker ? 0 : o.l, hi = darker ? o.l : 1;
  const ok = (l: number) => contrastRatio(oklchToHex({ ...o, l }), bg) >= target;
  if (!ok(darker ? 0 : 1)) return null;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid) === darker) lo = mid;
    else hi = mid;
  }
  return oklchToHex({ ...o, l: darker ? lo : hi });
}

const ratioScore = (r: number) => {
  const pts: [number, number][] = [[1, 5], [1.5, 30], [2, 50], [3, 78], [4.5, 92], [7, 100]];
  if (r >= 7) return 100;
  for (let i = 1; i < pts.length; i++)
    if (r <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((r - x0) / (x1 - x0)) * (y1 - y0);
    }
  return 100;
};

function checkContrast(ctx: Ctx): CheckResult {
  const drafts: Draft[] = [];
  const r = ctx.raster;
  if (!r || !ctx.content || !r.inkCells) return { score: null, verdict: "Nothing drawn to check.", drafts, metrics: {} };
  const bg = r.bg.hex;
  const where = r.bg.transparent ? (r.bg.dark ? "dark" : "white") : "its background";
  const { nx, ny, label } = r;
  const K = r.colors.length;
  // What every colour region is actually seen against: boundary length with each neighbour
  // (background and knockouts count as the background colour).
  const border = Array.from({ length: K }, () => new Map<number, { n: number; ks: number[] }>());
  const owners = Array.from({ length: K }, () => new Map<number, number>());
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const a = label[k];
      if (a && r.owner[k] >= 0) owners[a].set(r.owner[k], (owners[a].get(r.owner[k]) ?? 0) + 1);
      for (const kk of [k + 1, k + nx]) {
        const b = label[kk];
        if (b === a) continue;
        for (const [x, y, at] of [[a, b, k], [b, a, kk]] as const) {
          const e = border[x].get(y) ?? border[x].set(y, { n: 0, ks: [] }).get(y)!;
          e.n++;
          if (e.ks.length < 400) e.ks.push(at);
        }
      }
    }
  const leafOf = (lab: number) => ctx.leaves[topOwners(owners[lab])[0]] ?? null;
  // Small type is judged by the stricter text rule below, not twice.
  const smallText = (lf: Leaf | null) => !!lf?.text && lf.text.fontSize * 0.7 * lf.scale < 0.06 * ctx.long;
  const centreOf = (b: Bounds): P => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  let wsum = 0, ssum = 0, minRatio = Infinity;
  const counted = r.colors.slice(1).reduce((a, c) => a + c.cells, 0) || 1;
  for (let lab = 1; lab < K; lab++) {
    const c = r.colors[lab];
    const share = c.cells / counted;
    if (share < 0.01) continue;
    const total = [...border[lab].values()].reduce((a, e) => a + e.n, 0) || 1;
    // Seen against: the neighbour with the longest shared edge.
    const [mainLab] = [...border[lab].entries()].sort((x, y) => y[1].n - x[1].n)[0] ?? [0];
    const ratio = contrastRatio(c.hex, r.colors[mainLab].hex);
    minRatio = Math.min(minRatio, ratio);
    wsum += share;
    ssum += share * ratioScore(ratio);
    // Against the background (an outline that melts into the page).
    const onBg = border[lab].get(0);
    if (!onBg || onBg.n / total < 0.2) continue;
    const vsBg = contrastRatio(c.hex, bg);
    if (vsBg >= 3) continue;
    let sev: CritiqueSeverity = vsBg < 1.5 ? "high" : vsBg < 2.2 ? "medium" : "low";
    if (share < 0.05) sev = downgrade(sev) ?? "low";
    const lf = leafOf(lab);
    if (smallText(lf)) continue;
    const fix = towardContrast(c.hex, bg, 3.2);
    const b = lf?.bounds ?? ctx.content;
    const name = describeColor(c.hex);
    drafts.push(
      finding(
        lf,
        sev,
        `${name[0].toUpperCase()}${name.slice(1)} ${c.hex.toUpperCase()} is faint on ${where} (${r2(vsBg)}:1)`,
        `It covers ${pct(share)} of the ink and ${pct(onBg.n / total)} of its edge meets the ${r.bg.transparent ? "page" : "background"}. Graphics need 3:1 (WCAG 1.4.11) to hold up on screens, in sunlight and in print.`,
        fix ? `Use ${fix.toUpperCase()} (${r2(contrastRatio(fix, bg))}:1, same hue) or give it a darker outline.` : "Change its lightness, or add an outline in a contrasting colour.",
        centreOf(b),
        b,
      ),
    );
  }
  // Neighbouring colours separated only by hue merge in grayscale, one-colour print and for colour-blind viewers.
  for (let a = 1; a < K; a++)
    for (const [b, e] of border[a]) {
      if (b <= a || e.n < Math.max(8, r.R * 0.04)) continue;
      const ca = r.colors[a], cb = r.colors[b];
      const cr = contrastRatio(ca.hex, cb.hex);
      if (cr >= 1.35 || deltaE(ca.lab, cb.lab) < 15) continue;
      const tally = new Map<number, number>();
      for (const k of e.ks) r.owner[k] >= 0 && tally.set(r.owner[k], (tally.get(r.owner[k]) ?? 0) + 1);
      const lf = ctx.leaves[topOwners(tally)[0]] ?? null;
      drafts.push(
        finding(
          lf,
          e.n > r.R * 0.4 ? "medium" : "low",
          `Only hue separates ${ca.hex.toUpperCase()} and ${cb.hex.toUpperCase()} (${r2(cr)}:1)`,
          "These neighbouring colours have almost the same lightness: in grayscale, one-colour print or for colour-blind viewers the parts merge.",
          "Push one of them lighter or darker so they differ in value, not just in hue.",
          compAnchor(r, e.ks),
          compBox(r, e.ks, r.cell * 2),
        ),
      );
    }
  // Small type needs body-text contrast against what is behind it.
  for (const lf of ctx.leaves) {
    if (!lf.text || !lf.fill || !lf.bounds) continue;
    const cap = lf.text.fontSize * 0.7 * lf.scale;
    if (cap >= 0.06 * ctx.long) continue;
    const behind = backdropOf(r, lf);
    const ratio = contrastRatio(lf.fill.hex, behind);
    if (ratio >= 4.5) continue;
    const fix = towardContrast(lf.fill.hex, behind, 4.6);
    drafts.push(
      finding(lf, ratio < 3 ? "high" : "medium", `Small text "${lf.name}" needs 4.5:1 (has ${r2(ratio)}:1)`, `At ${u(cap)} units of cap height this is small type, which needs body-text contrast (WCAG 1.4.3) against ${behind.toUpperCase()}.`, fix ? `Use ${fix.toUpperCase()} (${r2(contrastRatio(fix, behind))}:1).` : "Increase its contrast.", centreOf(lf.bounds), lf.bounds),
    );
  }
  // Transparent artwork: does the main colour survive on dark?
  if (r.bg.transparent && !r.bg.dark) {
    const main = r.colors.slice(1).sort((x, y) => y.cells - x.cells)[0];
    if (main && contrastRatio(main.hex, "#0b0c0e") < 3)
      drafts.push(
        finding(null, "low", "Disappears on dark backgrounds", `The main colour ${main.hex.toUpperCase()} has ${r2(contrastRatio(main.hex, "#0b0c0e"))}:1 on near-black.`, "Plan a reversed (light) version for dark backgrounds; keep this one for light ones.", [ctx.content.x1, ctx.content.y1], ctx.content),
      );
  }
  const base = wsum > 0 ? ssum / wsum : 100;
  const score = scoreFrom(base, drafts.filter((d) => !d.title.includes(" is faint on ")));
  return {
    score,
    verdict: verdictFrom(drafts, `Every colour stands clear of what surrounds it${Number.isFinite(minRatio) ? ` (lowest ${r2(minRatio)}:1)` : ""}.`),
    drafts,
    metrics: { reference: bg, minRatio: Number.isFinite(minRatio) ? r2(minRatio) : null },
  };
}

/** The colour behind a layer: the most common region inside its bounds that it does not paint. */
function backdropOf(r: Raster, lf: Leaf): string {
  const b = lf.bounds!;
  const i0 = Math.max(0, Math.floor((b.x0 - r.ox) / r.cell)), i1 = Math.min(r.nx - 1, Math.ceil((b.x1 - r.ox) / r.cell));
  const j0 = Math.max(0, Math.floor((b.y0 - r.oy) / r.cell)), j1 = Math.min(r.ny - 1, Math.ceil((b.y1 - r.oy) / r.cell));
  const tally = new Map<number, number>();
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const k = j * r.nx + i;
      if (r.owner[k] === lf.idx) continue;
      tally.set(r.label[k], (tally.get(r.label[k]) ?? 0) + 1);
    }
  const top = topOwners(tally)[0];
  return r.colors[top ?? 0].hex;
}

// ---------------------------------------------------------------- 4. complexity

function checkComplexity(ctx: Ctx, paletteCount: number): CheckResult {
  const drafts: Draft[] = [];
  const r = ctx.raster;
  const drawn = ctx.leaves.filter((l) => !l.typeLike);
  const nodes = drawn.reduce((a, l) => a + l.anchors, 0);
  if (!ctx.leaves.length) return { score: null, verdict: "Nothing drawn to check.", drafts, metrics: {} };
  for (const l of drawn) {
    if (l.anchors <= 90) continue;
    const b = l.bounds;
    drafts.push(
      finding(
        l,
        l.anchors > 220 ? "medium" : "low",
        `"${l.name}" has ${l.anchors} nodes`,
        "That many points usually means a trace or a boolean leftover: curves wobble and the file is heavy.",
        "Redraw it with the fewest points that hold the shape — most logo shapes need fewer than 30.",
        b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [ctx.W / 2, ctx.H / 2],
        b,
      ),
    );
  }
  if (paletteCount >= 5)
    drafts.push(
      finding(null, paletteCount >= 6 ? "medium" : "low", `${paletteCount} colours`, "Most marks work in one to three; every extra colour makes one-colour print, embroidery and small sizes harder.", "Merge near-duplicates and keep the colours that carry meaning.", ctx.content ? [(ctx.content.x0 + ctx.content.x1) / 2, (ctx.content.y0 + ctx.content.y1) / 2] : [ctx.W / 2, ctx.H / 2], ctx.content),
    );
  const grad = ctx.leaves.find((l) => l.gradient);
  if (grad) {
    const b = grad.bounds;
    drafts.push(finding(grad, "low", "Gradients need a flat fallback", "Gradients drop out in one-colour print, embroidery, engraving and favicons.", "Make sure the mark still works in flat colour (keep a flat version alongside).", b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [ctx.W / 2, ctx.H / 2], b));
  }
  let tiny = 0;
  if (r && r.inkCells) {
    const comps = components(r, (k) => r.label[k] !== 0, false);
    const small: { comp: number[]; owner: number; size: number }[] = [];
    for (const comp of comps) {
      const bb = compBox(r, comp);
      const size = (Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / r.cell) * (32 / r.R);
      if (size >= 1.5) continue;
      const tally = new Map<number, number>();
      for (const k of comp) r.owner[k] >= 0 && tally.set(r.owner[k], (tally.get(r.owner[k]) ?? 0) + 1);
      const owner = topOwners(tally)[0] ?? -1;
      if (owner < 0 || ctx.leaves[owner].typeLike) continue;
      small.push({ comp, owner, size });
    }
    tiny = small.length;
    if (small.length && small.length <= 3) {
      for (const s of small) {
        const lf = ctx.leaves[s.owner];
        drafts.push(finding(lf, "low", `Tiny detail in "${lf.name}" is lost below 64 px`, `It is ${px(s.size)} px across at 32 px — smaller than the pixels that would show it.`, "Enlarge it, merge it into a bigger shape, or drop it.", compAnchor(r, s.comp), compBox(r, s.comp, r.cell * 4)));
      }
    } else if (small.length > 3) {
      const all = small.flatMap((s) => s.comp);
      const lf = ctx.leaves[small[0].owner];
      drafts.push(finding(lf, small.length > 8 ? "medium" : "low", `${small.length} tiny details are lost below 64 px`, `Specks and dots under 1.5 px at 32 px turn into noise at small sizes.`, "Remove them or merge them into bigger shapes.", compAnchor(r, small[0].comp), compBox(r, all, r.cell * 4)));
    }
  }
  if (drawn.length > 40)
    drafts.push(finding(null, "low", `${drawn.length} separate parts`, "Lots of parts make the mark harder to remember and to reproduce.", "Combine parts that always move together; drop the ones that don't carry the idea.", ctx.content ? [(ctx.content.x0 + ctx.content.x1) / 2, (ctx.content.y0 + ctx.content.y1) / 2] : [ctx.W / 2, ctx.H / 2], ctx.content));
  const base = 100 * (1 - clamp((nodes - 120) / 1500, 0, 0.35));
  const level = nodes <= 40 && drawn.length <= 4 ? "Minimal" : nodes <= 140 ? "Simple" : nodes <= 420 ? "Moderate" : "Detailed";
  const ok = `${level} and economical — ${plural(drawn.length, "part")}, ${plural(nodes, "node")}, ${plural(paletteCount, "colour")}.`;
  return {
    score: scoreFrom(base, drafts),
    verdict: verdictFrom(drafts, ok),
    drafts,
    metrics: { parts: drawn.length, nodes, colors: paletteCount, tinyDetails: tiny, gradients: ctx.leaves.filter((l) => l.gradient).length },
  };
}

// ---------------------------------------------------------------- 5. consistency

interface Measure {
  leaf: Leaf;
  v: number;
  weight: number;
}

/** Values that almost match (same family, not equal): the minority ones, each with the value to use. */
function nearMisses(ms: Measure[], ratio: number, tol: (v: number) => number): { m: Measure; target: number; family: Measure[] }[] {
  const sorted = [...ms].sort((a, b) => a.v - b.v);
  const out: { m: Measure; target: number; family: Measure[] }[] = [];
  let fam: Measure[] = [];
  const flush = () => {
    if (fam.length >= 2) {
      // Groups of equal values; the target is the heaviest one.
      const groups: Measure[][] = [];
      for (const m of fam) {
        const g = groups.find((x) => Math.abs(x[0].v - m.v) <= tol(x[0].v));
        if (g) g.push(m);
        else groups.push([m]);
      }
      if (groups.length >= 2) {
        const w = (g: Measure[]) => g.reduce((a, m) => a + m.weight, 0);
        groups.sort((a, b) => w(b) - w(a));
        const target = groups[0][0].v;
        for (const g of groups.slice(1)) for (const m of g) out.push({ m, target, family: fam });
      }
    }
    fam = [];
  };
  for (const m of sorted) {
    if (fam.length && m.v / fam[fam.length - 1].v > 1 / ratio) flush();
    fam.push(m);
  }
  flush();
  return out;
}

function checkConsistency(ctx: Ctx): CheckResult {
  const drafts: Draft[] = [];
  const r = ctx.raster;
  const drawn = ctx.leaves.filter((l) => !l.typeLike && !l.effect);
  const centre = (l: Leaf): P => (l.bounds ? [(l.bounds.x0 + l.bounds.x1) / 2, (l.bounds.y0 + l.bounds.y1) / 2] : [ctx.W / 2, ctx.H / 2]);
  // Line weights: explicit strokes, plus the stem width of filled monoline shapes.
  const strokes: Measure[] = drawn.filter((l) => l.stroke && l.sw > 0).map((l) => ({ leaf: l, v: l.sw, weight: l.perimeter }));
  const stems: Measure[] = [];
  if (r && r.inkCells) {
    const per = new Map<number, number[]>();
    const { nx, ny, label, dist, owner } = r;
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!label[k] || owner[k] < 0) continue;
        const d = dist[k];
        let ridge = true;
        for (let dj = -1; dj <= 1 && ridge; dj++)
          for (let di = -1; di <= 1; di++) {
            const kk = k + dj * nx + di;
            if (kk !== k && label[kk] === label[k] && dist[kk] > d + 1e-6) {
              ridge = false;
              break;
            }
          }
        if (ridge) (per.get(owner[k]) ?? per.set(owner[k], []).get(owner[k])!).push(2 * d - 0.5);
      }
    for (const l of drawn) {
      if (l.stroke && l.sw > 0) continue;
      const ws = (per.get(l.idx) ?? []).sort((a, b) => a - b);
      if (ws.length < 30 || !l.bounds) continue;
      const p25 = quantile(ws, 0.25), p50 = quantile(ws, 0.5), p75 = quantile(ws, 0.75);
      const stem = p50 * r.cell;
      const minSide = Math.min(l.bounds.x1 - l.bounds.x0, l.bounds.y1 - l.bounds.y0);
      if (p25 / p75 < 0.75 || stem > 0.3 * minSide || p50 < 3) continue;
      stems.push({ leaf: l, v: stem, weight: ws.length * r.cell });
    }
  }
  const weightTol = (v: number) => Math.max(0.25, v * 0.02);
  for (const { m, target } of nearMisses(strokes, 0.8, weightTol).slice(0, 4))
    drafts.push(finding(m.leaf, "medium", `Stroke weights ${u(m.v)} and ${u(target)} almost match`, `"${m.leaf.name}" is ${u(m.v)} units while the main strokes are ${u(target)}: near-equal weights read as a mistake, not a choice.`, `Set its stroke to ${u(target)}.`, centre(m.leaf), m.leaf.bounds));
  const stemTol = (v: number) => Math.max(1.5 * (r?.cell ?? 1), v * 0.04);
  for (const { m, target } of nearMisses(stems, 0.8, stemTol).slice(0, 3))
    drafts.push(finding(m.leaf, "low", `"${m.leaf.name}" is drawn ${u(Math.abs(m.v - target))} units ${m.v < target ? "lighter" : "heavier"} than its siblings`, `Its line weight is about ${u(m.v)} units where the rest of the mark uses ${u(target)}.`, `Match the weight (${u(target)} units) so the lines read as one system.`, centre(m.leaf), m.leaf.bounds));
  // Corner radii.
  const radii: Measure[] = [];
  for (const l of drawn) {
    if (!l.radii.length) continue;
    for (const v of new Set(l.radii.map((x) => r1(x)))) radii.push({ leaf: l, v, weight: 1 });
  }
  const seen = new Set<string>();
  for (const { m, target } of nearMisses(radii, 0.75, (v) => Math.max(0.5, v * 0.06))) {
    if (seen.has(m.leaf.id) || drafts.length > 8) continue;
    seen.add(m.leaf.id);
    drafts.push(finding(m.leaf, "low", `Corner radii ${u(m.v)} and ${u(target)} almost match`, `"${m.leaf.name}" rounds its corners at ${u(m.v)} units; the others use ${u(target)}.`, `Use one radius (${u(target)} units) everywhere — or make the difference obvious.`, centre(m.leaf), m.leaf.bounds));
  }
  // Mixed corner treatment on primitives.
  const boxy = drawn.filter((l) => l.node.type === "shape" && (l.node.shape === "rect" || l.node.shape === "polygon") && l.bounds && (l.bounds.x1 - l.bounds.x0) * (l.bounds.y1 - l.bounds.y0) < 0.8 * ctx.W * ctx.H);
  const sharp = boxy.filter((l) => !l.radii.length);
  const round = boxy.filter((l) => l.radii.length);
  if (sharp.length && round.length) {
    const lf = sharp.length <= round.length ? sharp[0] : round[0];
    drafts.push(finding(lf, "low", "Sharp and rounded corners are mixed", `${plural(round.length, "shape")} ${round.length === 1 ? "has" : "have"} rounded corners and ${plural(sharp.length, "shape")} ${sharp.length === 1 ? "is" : "are"} sharp.`, "Pick one corner language, or keep the contrast for a reason.", centre(lf), lf.bounds));
  }
  // Caps on open strokes.
  const capped = drawn.filter((l) => l.stroke && l.sw > 0 && l.open);
  const caps = new Set(capped.map((l) => l.node.style.strokeLinecap));
  if (caps.size > 1) {
    const counts = [...caps].map((c) => ({ c, n: capped.filter((l) => l.node.style.strokeLinecap === c).length })).sort((a, b) => b.n - a.n);
    const lf = capped.find((l) => l.node.style.strokeLinecap === counts[counts.length - 1].c)!;
    drafts.push(finding(lf, "low", `Mixed stroke ends (${counts.map((x) => x.c).join(" and ")})`, `"${lf.name}" ends ${counts[counts.length - 1].c} while most strokes end ${counts[0].c}.`, `Use ${counts[0].c} caps throughout.`, centre(lf), lf.bounds));
  }
  const measured = strokes.length + stems.length + radii.length + boxy.length;
  if (measured < 2 && !drafts.length) return { score: null, verdict: "Nothing to compare: no repeated strokes, stems or corners.", drafts, metrics: {} };
  const weights = [...new Set([...strokes, ...stems].map((m) => u(m.v)))];
  return {
    score: scoreFrom(100, drafts, { high: 0.8, medium: 0.86, low: 0.93 }),
    verdict: verdictFrom(drafts, `Consistent${weights.length ? ` — line weights ${weights.slice(0, 4).join(" / ")}` : ""}${radii.length ? `${weights.length ? "," : " —"} corner radii ${[...new Set(radii.map((m) => u(m.v)))].slice(0, 4).join(" / ")}` : ""}.`),
    drafts,
    metrics: { strokes: strokes.length, stems: stems.length, radii: radii.length },
  };
}

// ---------------------------------------------------------------- 6. alignment

interface Part {
  id: string;
  name: string;
  leaf: Leaf;
  b: Bounds;
  chain: Set<string>;
  size: number;
}

const ALIGN_KINDS = [
  { key: "left", axis: "x", side: 0, label: "left edge" },
  { key: "right", axis: "x", side: 2, label: "right edge" },
  { key: "cx", axis: "x", side: -1, label: "centre line" },
  { key: "top", axis: "y", side: 1, label: "top edge" },
  { key: "bottom", axis: "y", side: 3, label: "bottom edge" },
  { key: "cy", axis: "y", side: -1, label: "middle" },
] as const;

function checkAlignment(ctx: Ctx): CheckResult {
  const drafts: Draft[] = [];
  const { long, W, H } = ctx;
  const lo = Math.max(0.05, long * 0.0003);
  const hi = long * 0.0035;
  // Parts: drawn layers, whole wordmarks (type), and groups.
  const parts: Part[] = [];
  const typeUnits = new Map<string, Leaf[]>();
  const groups = new Map<string, Leaf[]>();
  for (const l of ctx.leaves) {
    if (l.effect || l.estimated || !l.bounds) continue;
    if (l.typeLike && l.unit !== l.id) (typeUnits.get(l.unit) ?? typeUnits.set(l.unit, []).get(l.unit)!).push(l);
    else parts.push({ id: l.id, name: l.name, leaf: l, b: l.bounds, chain: new Set(l.chain), size: 0 });
    for (const g of l.chain) if (!l.typeLike || l.unit !== g) (groups.get(g) ?? groups.set(g, []).get(g)!).push(l);
  }
  for (const [id, ls] of typeUnits) {
    const b = unionBounds(ls.map((l) => l.bounds!));
    const n = ctx.pdoc.nodes[id];
    if (b && n) parts.push({ id, name: nodeLabel(n), leaf: { ...ls[0], id, name: nodeLabel(n) }, b, chain: new Set(ls[0].chain.slice(0, ls[0].chain.indexOf(id))), size: 0 });
  }
  for (const [id, ls] of groups) {
    const n = ctx.pdoc.nodes[id];
    if (!n || n.type !== "group" || typeUnits.has(id) || n.children.length < 2) continue;
    const b = unionBounds(ls.map((l) => l.bounds!));
    if (b) parts.push({ id, name: nodeLabel(n), leaf: { ...ls[0], id, name: nodeLabel(n) }, b, chain: new Set(ls[0].chain.slice(0, ls[0].chain.indexOf(id))), size: 0 });
  }
  const usable = parts.filter((p) => {
    p.size = Math.max(p.b.x1 - p.b.x0, p.b.y1 - p.b.y0);
    const area = (Math.min(p.b.x1, W) - Math.max(p.b.x0, 0)) * (Math.min(p.b.y1, H) - Math.max(p.b.y0, 0));
    return p.size >= 0.015 * long && area < 0.9 * W * H;
  });
  if (usable.length < 2) return { score: null, verdict: "Nothing to align: fewer than two parts.", drafts, metrics: { parts: usable.length } };
  const related = (a: Part, b: Part) => a.chain.has(b.id) || b.chain.has(a.id) || a.id === b.id;
  const flagged = new Set<string>();
  for (const kind of ALIGN_KINDS) {
    const vals = usable.map((p) => {
      const v = kind.key === "left" ? p.b.x0 : kind.key === "right" ? p.b.x1 : kind.key === "top" ? p.b.y0 : kind.key === "bottom" ? p.b.y1 : kind.key === "cx" ? (p.b.x0 + p.b.x1) / 2 : (p.b.y0 + p.b.y1) / 2;
      return { p, v, flat: kind.side >= 0 ? p.b.flat[kind.side as 0 | 1 | 2 | 3] : true };
    });
    vals.sort((a, b) => a.v - b.v);
    // Families of values within the near-miss tolerance, split into groups of (almost) equal values.
    let fam: typeof vals = [];
    const flush = () => {
      if (fam.length >= 2 && fam[fam.length - 1].v - fam[0].v > lo) {
        const groups: (typeof vals)[] = [];
        for (const x of fam) {
          const g = groups.find((gg) => Math.abs(gg[0].v - x.v) <= lo);
          if (g) g.push(x);
          else groups.push([x]);
        }
        // The target is the biggest group; ties go to flat edges, then to the biggest part.
        const flatN = (g: typeof vals) => g.filter((x) => x.flat).length;
        groups.sort((a, b) => b.length - a.length || flatN(b) - flatN(a) || Math.max(...b.map((x) => x.p.size)) - Math.max(...a.map((x) => x.p.size)));
        const target = groups[0];
        const tv = target[0].v;
        for (const g of groups.slice(1))
          for (const x of g) {
            const partners = target.filter((t) => !related(t.p, x.p));
            if (!partners.length) continue;
            const off = tv - x.v;
            if (Math.abs(off) > hi) continue;
            // A round edge never lines up with a flat one by its tangent point: it overshoots on purpose
            // (or should), so only flat–flat and round–round edges are compared.
            if (kind.side >= 0 && !partners.some((t) => t.flat === x.flat)) continue;
            const key = `${x.p.id}:${kind.axis}`;
            if (flagged.has(key)) continue;
            flagged.add(key);
            const other = partners.filter((t) => kind.side < 0 || t.flat === x.flat).sort((a, b) => b.p.size - a.p.size)[0].p;
            const dir = kind.axis === "x" ? (off > 0 ? "right" : "left") : off > 0 ? "down" : "up";
            const b = x.p.b;
            const at: P =
              kind.key === "left" ? [b.x0, (b.y0 + b.y1) / 2] : kind.key === "right" ? [b.x1, (b.y0 + b.y1) / 2] : kind.key === "top" ? [(b.x0 + b.x1) / 2, b.y0] : kind.key === "bottom" ? [(b.x0 + b.x1) / 2, b.y1] : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
            drafts.push(
              finding(
                x.p.leaf,
                Math.abs(off) >= long * 0.0015 && x.p.size >= 0.1 * long ? "medium" : "low",
                `"${x.p.name}" misses the ${kind.label} of "${other.name}" by ${u(Math.abs(off))}`,
                `${kind.axis === "x" ? "x" : "y"} = ${r2(x.v)} vs ${r2(tv)}. A near-miss this small reads as a mistake rather than a choice.`,
                `Move it ${u(Math.abs(off))} units ${dir} to align exactly.`,
                at,
                b,
              ),
            );
          }
      }
      fam = [];
    };
    for (const x of vals) {
      if (fam.length && x.v - fam[fam.length - 1].v > hi) flush();
      fam.push(x);
    }
    flush();
  }
  sortDrafts(drafts);
  const kept = drafts.slice(0, 8);
  return {
    score: scoreFrom(100, drafts, { high: 0.8, medium: 0.87, low: 0.93 }),
    verdict: verdictFrom(kept, `Clean: no near-misses between ${plural(usable.length, "part")}.`),
    drafts: kept,
    metrics: { parts: usable.length, nearMisses: drafts.length },
  };
}

// ---------------------------------------------------------------- 7. wordmark spacing

interface Letter {
  ch: string;
  polys: Poly[];
  b: Bounds;
  nodeId: string;
  name: string;
}

interface Word {
  text: string;
  letters: Letter[];
  em: number;
  leaf: Leaf;
  /** Text node: fixes are kerning values. */
  kern: boolean;
}

function wordsOf(ctx: Ctx): Word[] {
  const words: Word[] = [];
  const angle = (m: Mat) => (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const push = (letters: Letter[], em: number, leaf: Leaf, kern: boolean) => {
    if (letters.length >= 3) words.push({ text: letters.map((l) => l.ch).join(""), letters, em, leaf, kern });
  };
  for (const l of ctx.leaves) {
    if (!l.glyphs || l.effect || Math.abs(angle(l.m)) > 3) continue;
    const em = l.text!.fontSize * l.scale;
    let cur: Letter[] = [];
    for (const g of l.glyphs) {
      if (!g.polys.length || !g.ch.trim()) {
        push(cur, em, l, true);
        cur = [];
        continue;
      }
      cur.push({ ch: g.ch, polys: g.polys, b: g.box, nodeId: l.id, name: l.name });
    }
    push(cur, em, l, true);
  }
  // Lettering groups: one path per letter, in reading order.
  const units = new Map<string, Leaf[]>();
  for (const l of ctx.leaves) if (l.typeLike && !l.text && !l.effect && l.unit !== l.id) (units.get(l.unit) ?? units.set(l.unit, []).get(l.unit)!).push(l);
  for (const [id, ls] of units) {
    if (ls.some((l) => Math.abs(angle(l.m)) > 3) || ls.length < 3) continue;
    const g = ctx.pdoc.nodes[id];
    const letters = ls
      .filter((l) => l.bounds)
      .map((l) => ({ ch: l.node.name.trim() || "?", polys: l.polys, b: l.bounds!, nodeId: l.id, name: l.name }))
      .sort((a, b) => a.b.x0 + a.b.x1 - (b.b.x0 + b.b.x1));
    const bottoms = letters.map((x) => x.b.y1).sort((a, b) => a - b);
    const heights = letters.map((x) => x.b.y1 - x.b.y0);
    const em = g?.type === "group" && g.lettering ? g.lettering.fontSize * ls[0].scale : median(heights) / 0.7;
    // Waves and staggers move letters off one baseline: spacing is not measured on a line then.
    if (quantile(bottoms, 0.75) - quantile(bottoms, 0.25) > 0.12 * em) continue;
    push(letters, em, { ...ls[0], id, name: nodeLabel(g) }, false);
  }
  return words;
}

function checkSpacing(ctx: Ctx): CheckResult {
  const drafts: Draft[] = [];
  const words = wordsOf(ctx);
  if (!words.length) return { score: null, verdict: ctx.leaves.some((l) => l.estimated) ? "Open the studio to measure the wordmark on its real glyphs." : "No wordmark to space.", drafts, metrics: {} };
  const rels: number[] = [];
  let tightness: number[] = [];
  for (const w of words) {
    const tops = w.letters.map((l) => l.b.y0).sort((a, b) => a - b);
    const bots = w.letters.map((l) => l.b.y1).sort((a, b) => a - b);
    const top = quantile(tops, 0.5), bot = quantile(bots, 0.5);
    if (bot - top < 0.2 * w.em) continue;
    const cap = 0.25 * w.em;
    const NB = 16;
    const gaps = w.letters.slice(1).map((B, i) => {
      const A = w.letters[i];
      let acc = 0;
      let x0 = Infinity, x1 = -Infinity;
      for (let k = 0; k < NB; k++) {
        const y = top + ((k + 0.5) * (bot - top)) / NB;
        const sa = spanAt(A.polys, y), sb = spanAt(B.polys, y);
        if (!sa || !sb) {
          acc += cap;
          continue;
        }
        acc += Math.min(cap, sb[0] - sa[1]);
        x0 = Math.min(x0, sa[1]);
        x1 = Math.max(x1, sb[0]);
      }
      if (!Number.isFinite(x0)) {
        x0 = A.b.x1;
        x1 = B.b.x0;
      }
      return { A, B, g: acc / NB, x0: Math.min(x0, x1), x1: Math.max(x0, x1) };
    });
    const M = median(gaps.map((g) => g.g));
    tightness.push(M / w.em);
    const ref = Math.max(M, 0.04 * w.em);
    for (const p of gaps) {
      const dev = p.g - M;
      const rel = dev / ref;
      rels.push(rel);
      if (Math.abs(dev) <= 0.02 * w.em || Math.abs(rel) <= 0.3) continue;
      const sev: CritiqueSeverity = Math.abs(rel) > 0.6 && Math.abs(dev) > 0.04 * w.em ? "medium" : "low";
      const kern = Math.round((-dev / w.em) * 1000);
      const pair = `${p.A.ch}${p.B.ch}`;
      const nodeLeaf = w.kern ? w.leaf : ({ ...w.leaf, id: p.B.nodeId, name: p.B.name } as Leaf);
      drafts.push(
        finding(
          nodeLeaf,
          sev,
          `"${pair}" in "${w.text}" is ${pct(Math.abs(rel))} ${dev > 0 ? "looser" : "tighter"} than the rest`,
          `The optical gap between ${p.A.ch} and ${p.B.ch} is ${u(p.g)} units where the word averages ${u(M)}: uneven gaps make a wordmark look unfinished.`,
          w.kern ? `Kern ${pair} by ${kern > 0 ? "+" : ""}${kern}/1000 em (≈ ${u(Math.abs(dev))} units ${dev > 0 ? "tighter" : "looser"}).` : `Move "${p.B.ch}" and the letters after it ${u(Math.abs(dev))} units ${dev > 0 ? "left" : "right"}.`,
          [(p.x0 + p.x1) / 2, (top + bot) / 2],
          { x0: p.x0 - 0.06 * w.em, y0: top, x1: p.x1 + 0.06 * w.em, y1: bot, flat: [false, false, false, false] },
        ),
      );
    }
  }
  if (!rels.length) return { score: null, verdict: "No wordmark to space.", drafts, metrics: {} };
  tightness = tightness.sort((a, b) => a - b);
  const t = tightness[0];
  const w0 = words[0];
  const wb = unionBounds(w0.letters.map((l) => l.b));
  if (t < 0.02 && wb)
    drafts.push(finding(w0.leaf, "low", `"${w0.text}" is set very tight`, `Letters sit ${pct(t)} of an em apart on average — they will touch and clog at small sizes.`, "Open the tracking slightly (+10 to +30/1000 em).", [(wb.x0 + wb.x1) / 2, (wb.y0 + wb.y1) / 2], wb));
  else if (tightness[tightness.length - 1] > 0.3 && wb)
    drafts.push(finding(w0.leaf, "low", `"${w0.text}" is set very loose`, `Letters sit ${pct(tightness[tightness.length - 1])} of an em apart — the word starts to fall apart into letters.`, "Tighten the tracking unless the airy look is the point.", [(wb.x0 + wb.x1) / 2, (wb.y0 + wb.y1) / 2], wb));
  const cv = Math.sqrt(rels.reduce((a, x) => a + x * x, 0) / rels.length);
  const base = 100 * (1 - clamp((cv - 0.12) * 1.2, 0, 0.55));
  sortDrafts(drafts);
  const kept = drafts.slice(0, 6);
  return {
    score: scoreFrom(base, kept, { high: 0.85, medium: 0.9, low: 0.96 }),
    verdict: verdictFrom(kept, `Even rhythm across ${plural(rels.length, "letter pair")} (variation ${pct(cv)}).`),
    drafts: kept,
    metrics: { pairs: rels.length, variation: r2(cv), words: words.map((w) => w.text).join(" · ") },
  };
}

// ---------------------------------------------------------------- report

/** Review one version. Pass a projected frame document (see frameDoc). */
export function critique(pdoc: DocT, o: CritiqueOptions = {}): CritiqueReport {
  const W = pdoc.artboard.width;
  const H = pdoc.artboard.height;
  const long = Math.max(W, H);
  const leaves = collectLeaves(pdoc, o);
  const frame = { name: o.name ?? pdoc.name, width: W, height: H, background: pdoc.artboard.background };
  const texts = leaves.filter((l) => l.text);
  const exactType = texts.every((l) => !l.estimated);
  if (!leaves.length) {
    return {
      frame,
      overall: null,
      verdict: "Nothing to review yet — draw something first.",
      categories: CRITIQUE_CATEGORIES.map((id) => ({ id, label: CRITIQUE_LABELS[id], score: null, verdict: "Nothing drawn yet.", findings: [], metrics: {} })),
      findings: [],
      exactType,
      empty: true,
    };
  }
  const raster = rasterize(leaves, W, H, pdoc.artboard.background, clamp(Math.round(o.resolution ?? 320), 96, 640));
  const ctx: Ctx = {
    pdoc,
    W,
    H,
    long,
    leaves,
    raster,
    exactType,
    content: unionBounds(leaves.map((l) => l.bounds).filter((b): b is Bounds => !!b)),
    findings: [],
  };
  const glyphD = new Map<string, string>();
  for (const l of leaves) if (l.glyphs) glyphD.set(l.id, (o.textGlyphs?.(l.text!) ?? []).map((g) => g.d).join(""));
  const textToPath = (n: TextNodeT) => glyphD.get(n.id) ?? null;
  const contrast = checkContrast(ctx);
  const results: Record<CritiqueCategoryId, CheckResult> = {
    legibility: checkLegibility(ctx),
    balance: checkBalance(ctx),
    contrast,
    complexity: checkComplexity(ctx, styleProfile(pdoc, { textToPath }).palette.filter((c) => c.share >= 0.005).length),
    consistency: checkConsistency(ctx),
    alignment: checkAlignment(ctx),
    spacing: checkSpacing(ctx),
  };
  const categories: CritiqueCategory[] = CRITIQUE_CATEGORIES.map((id) => {
    const res = results[id];
    const findings = sortDrafts(res.drafts).map((d, i) => ({ ...d, id: `${id}-${i + 1}`, category: id }));
    return { id, label: CRITIQUE_LABELS[id], score: res.score, verdict: res.verdict, findings, metrics: res.metrics };
  });
  const scored = categories.filter((c) => c.score !== null);
  const wsum = scored.reduce((a, c) => a + CRITIQUE_WEIGHTS[c.id], 0);
  const weighted = wsum ? scored.reduce((a, c) => a + CRITIQUE_WEIGHTS[c.id] * c.score!, 0) / wsum : 100;
  const lowest = scored.reduce<CritiqueCategory | null>((a, c) => (!a || c.score! < a.score! ? c : a), null);
  // One failing category caps the whole: a great layout doesn't save a mark that vanishes at 16 px.
  const overall = Math.round(lowest ? Math.min(weighted, lowest.score! + 35) : weighted);
  let verdict =
    // The checks measure craft, not the idea: a top score must never read as "the logo is good".
    overall >= 90
      ? "Craft checks pass: nothing measurable is broken. They can't tell whether the idea is any good."
      : overall >= 78
        ? "Craft is strong: a few precise fixes left."
        : overall >= 62
          ? "Craft needs work before it ships."
          : "Craft isn't there yet: start with the high-priority issues.";
  if (lowest && lowest.score! < 80) verdict += ` Biggest lever: ${lowest.label.toLowerCase()}.`;
  const findings = categories
    .flatMap((c) => c.findings)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || CRITIQUE_WEIGHTS[b.category] - CRITIQUE_WEIGHTS[a.category]);
  return { frame, overall, verdict, categories, findings, exactType, empty: false };
}

// ---------------------------------------------------------------- text, notes, prompts

/** Marker positions (screen/output px) nudged sideways so findings on the same spot stay readable. */
export function spreadMarkers(points: [number, number][], gap: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [x0, y] of points) {
    let x = x0;
    for (let k = 0; k < 12 && out.some(([px, py]) => Math.hypot(px - x, py - y) < gap); k++) x += gap;
    out.push([x, y]);
  }
  return out;
}

const at = (f: CritiqueFinding) => `${f.nodeId ? `"${f.nodeName}" (${f.nodeId}) ` : ""}at (${Math.round(f.x)}, ${Math.round(f.y)})`;

/** The report as plain text (for the agent, or to copy). */
export function critiqueText(r: CritiqueReport): string {
  if (r.empty) return `Critique of "${r.frame.name}": ${r.verdict}`;
  const lines = [
    `Craft checks for "${r.frame.name}" — ${r.overall}/100 (legibility, balance, contrast, complexity, consistency, alignment, spacing; not concept or originality). ${r.verdict}`,
    "",
  ];
  for (const c of r.categories) lines.push(`- ${c.label}: ${c.score === null ? "n/a" : c.score} — ${c.verdict}`);
  if (r.findings.length) {
    lines.push("", "Findings (most important first):");
    r.findings.forEach((f, i) => lines.push(`${i + 1}. [${f.severity} · ${CRITIQUE_LABELS[f.category]}] ${f.title} — ${f.detail} Fix: ${f.fix} (${at(f)}; id ${f.id})`));
  } else lines.push("", "No findings from the checks.");
  if (!r.exactType) lines.push("", "(Text was estimated from the font size — open the studio for exact glyph outlines.)");
  return lines.join("\n");
}

/** Note text for one finding (what the user reads on the canvas pin). */
export const critiqueNote = (f: CritiqueFinding) => `Critique · ${CRITIQUE_LABELS[f.category]}: ${f.title}. ${f.fix}`;

/** Annotate ops pinning findings as canvas notes (one undo step). Skips notes that are already pinned and pending. */
export function critiqueNoteOps(frameId: string, findings: CritiqueFinding[], doc?: DocT): OpT[] {
  const existing = new Set(doc ? Object.values(doc.annotations).filter((a) => a.frameId === frameId && a.status === "pending").map((a) => a.note) : []);
  return findings
    .filter((f) => !existing.has(critiqueNote(f)))
    .map((f) => ({
      op: "annotate" as const,
      annotation: { frameId, nodeId: f.nodeId && doc && !doc.nodes[f.nodeId] ? null : f.nodeId, x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, note: critiqueNote(f) },
    }));
}

/** A request for the user's AI to fix findings, one by one. */
export function critiqueFixPrompt(r: CritiqueReport, findings: CritiqueFinding[]): string {
  return [
    `Fix these design-critique findings on version "${r.frame.name}" (currently ${r.overall}/100), one at a time. Keep everything else as it is, and respect parts locked for the AI:`,
    ...findings.map((f, i) => `${i + 1}. ${f.title} — ${f.fix} (${at(f)})`),
    "",
    "Check your work with render_preview, then run critique again and tell me the new score.",
  ].join("\n");
}
