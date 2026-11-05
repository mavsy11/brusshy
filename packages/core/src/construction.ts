import { Construction, type ConstructionT, type GuideCircleT, type GuideT } from "./construction-schema";
import { differenceD, FillRule, type PathsD } from "@countertype/clipper2-ts";
import { classifyCubic, cubicAt, nodeOutline, regionToExactPath, shapeLeaves, windingAt, type Seg } from "./boolean";
import { facesAt, frameArrangement, layerRegion, mergeFaces, type Arrangement } from "./arrangement";
import { apply, invert, multiply, worldMatrix } from "./geometry";
import { parsePath, serializePath, type P } from "./pathmodel";
import type { OpT } from "./ops";
import type { DocT, FrameNodeT, NodeT } from "./schema";

/**
 * Construction grids: templates (circle grid on a ratio, square/diagonal grid, keylines,
 * radial), snapping points (centres, intersections, tangents), automatic derivation from a
 * finished mark (circles fitted to its curves) and the ops that edit a frame's construction.
 */

export const PHI = (1 + Math.sqrt(5)) / 2;

export const CONSTRUCTION_KINDS = ["circle-grid", "square-grid", "keylines", "radial", "circles", "lines", "polygon"] as const;
export type ConstructionKind = (typeof CONSTRUCTION_KINDS)[number];

let seq = 0;
const gid = () => `g${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));

/** "golden 1 : 1.618", "1 : 2", "2 : 3"… */
export function ratioLabel(ratio: number): string {
  if (Math.abs(ratio - PHI) < 1e-3) return "golden 1 : 1.618";
  if (Math.abs(ratio - 1.5) < 1e-6) return "2 : 3";
  if (Math.abs(ratio - Math.SQRT2) < 1e-3) return "1 : √2";
  return `1 : ${num(ratio)}`;
}

export interface TemplateParams {
  /** Centre (default: artboard centre). */
  cx?: number;
  cy?: number;
  /** Overall size in artboard units (default ≈ 72% of the artboard's shorter side). */
  size?: number;
  /** circle-grid: radius ratio between levels (default golden 1.618; 2 = 1:2, 1.5 = 2:3). */
  ratio?: number;
  /** circle-grid: number of radius levels (2–4, default 3). */
  levels?: number;
  /** square-grid: cells per side (default 8). */
  divisions?: number;
  /** square-grid: add 45° diagonals. */
  diagonals?: boolean;
  /** radial: number of sectors (default 8). */
  sectors?: number;
  /** radial: add one petal circle per sector (flower-of-life style), default true. */
  petals?: boolean;
  /** radial: petal circle radius as a share of the outer radius (default 0.5: petals meet at the centre). */
  petalRatio?: number;
  /** circles / lines / polygon: explicit guides. */
  circles?: { cx: number; cy: number; r: number; label?: string }[];
  lines?: { x1: number; y1: number; x2: number; y2: number; label?: string }[];
  points?: [number, number][];
}

/** Snap a size to the 8-unit grid the craft guide recommends. */
const grid8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);

/** Guides for a template on a frame of this size. */
export function constructionTemplate(kind: ConstructionKind, frame: { width: number; height: number }, p: TemplateParams = {}): ConstructionT {
  const cx = p.cx ?? frame.width / 2;
  const cy = p.cy ?? frame.height / 2;
  const size = p.size ?? grid8(Math.min(frame.width, frame.height) * 0.72);
  const R = size / 2;
  const guides: GuideT[] = [];
  const circle = (x: number, y: number, r: number, role: GuideT["role"] = "key", label?: string) =>
    guides.push({ id: gid(), kind: "circle", cx: r2(x), cy: r2(y), r: r2(r), role, ...(label ? { label } : {}) });
  const line = (x1: number, y1: number, x2: number, y2: number, role: GuideT["role"] = "grid", label?: string) =>
    guides.push({ id: gid(), kind: "line", x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), role, ...(label ? { label } : {}) });
  const poly = (pts: P[], role: GuideT["role"] = "grid", label?: string) =>
    guides.push({ id: gid(), kind: "polygon", points: pts.map((q) => [r2(q[0]), r2(q[1])] as [number, number]), role, ...(label ? { label } : {}) });
  const square = (s: number, role: GuideT["role"] = "grid", label?: string) => poly([[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2]], role, label);
  const cross = (s: number) => {
    line(cx - s / 2, cy, cx + s / 2, cy);
    line(cx, cy - s / 2, cx, cy + s / 2);
  };

  switch (kind) {
    case "circle-grid": {
      const ratio = p.ratio ?? PHI;
      const levels = Math.max(2, Math.min(4, Math.round(p.levels ?? 3)));
      const radii = Array.from({ length: levels }, (_, k) => R / ratio ** k);
      const unit = radii[levels - 1]!;
      square(size);
      cross(size);
      line(cx - R, cy - R, cx + R, cy + R);
      line(cx + R, cy - R, cx - R, cy + R);
      radii.forEach((r, k) => circle(cx, cy, r, "key", `r = ${num(r / unit)}`));
      // Smaller circles internally tangent to the outer one at the four extremes.
      for (const r of radii.slice(1)) {
        const o = R - r;
        circle(cx, cy - o, r, "key");
        circle(cx + o, cy, r, "key");
        circle(cx, cy + o, r, "key");
        circle(cx - o, cy, r, "key");
      }
      return { guides, title: `Circle grid · ${ratioLabel(ratio)}`, ratio, unit: r2(unit) };
    }
    case "square-grid": {
      const div = Math.max(2, Math.min(32, Math.round(p.divisions ?? 8)));
      const u = size / div;
      const x0 = cx - R, y0 = cy - R;
      square(size, "grid", `${num(size)} × ${num(size)}`);
      for (let i = 1; i < div; i++) {
        line(x0 + i * u, y0, x0 + i * u, y0 + size);
        line(x0, y0 + i * u, x0 + size, y0 + i * u);
      }
      if (p.diagonals) {
        // 45° lattice through the grid nodes, clipped to the square.
        for (let k = -div + 1; k < div; k++) {
          const a: P = k >= 0 ? [x0 + k * u, y0] : [x0, y0 - k * u];
          const b: P = k >= 0 ? [x0 + size, y0 + size - k * u] : [x0 + size + k * u, y0 + size];
          line(a[0], a[1], b[0], b[1]);
          const c: P = k >= 0 ? [x0 + size - k * u, y0] : [x0 + size, y0 - k * u];
          const d: P = k >= 0 ? [x0, y0 + size - k * u] : [x0 - k * u, y0 + size];
          line(c[0], c[1], d[0], d[1]);
        }
      }
      return { guides, title: `${p.diagonals ? "Diagonal" : "Square"} grid · ${div} × ${div}`, unit: r2(u) };
    }
    case "keylines": {
      // Shapes of equal *visual* size: the circle and diamond reach further than the square.
      const s = size / 1.263;
      square(size, "grid", "live area");
      cross(size);
      line(cx - R, cy - R, cx + R, cy + R);
      line(cx + R, cy - R, cx - R, cy + R);
      square(s, "keyline", `square ${num(r2(s))}`);
      circle(cx, cy, (s * 1.158) / 2, "keyline", `circle ⌀ ${num(r2(s * 1.158))}`);
      const dh = (s * 1.3) / 2;
      poly([[cx, cy - dh], [cx + dh, cy], [cx, cy + dh], [cx - dh, cy]], "keyline", `diamond ${num(r2(s * 1.3))}`);
      return { guides, title: "Keylines · square, circle and diamond of equal visual size", unit: r2(s) };
    }
    case "radial": {
      const n = Math.max(3, Math.min(48, Math.round(p.sectors ?? 8)));
      circle(cx, cy, R, "radial", `${n} × ${num(360 / n)}°`);
      circle(cx, cy, R / 2, "radial");
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
        line(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, "radial");
      }
      if (p.petals !== false) {
        const pr = R * (p.petalRatio ?? 0.5);
        const off = R - pr;
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
          circle(cx + Math.cos(a) * off, cy + Math.sin(a) * off, pr, "key", i === 0 ? `r = ${num(pr / R)} R` : undefined);
        }
      }
      return { guides, title: `Radial grid · ${n} sectors`, ratio: p.petalRatio ? 1 / p.petalRatio : 2 };
    }
    case "circles":
      for (const c of p.circles ?? []) circle(c.cx, c.cy, c.r, "key", c.label);
      return { guides };
    case "lines":
      for (const l of p.lines ?? []) line(l.x1, l.y1, l.x2, l.y2, "key", l.label);
      return { guides };
    case "polygon":
      if ((p.points?.length ?? 0) >= 3) poly(p.points as P[], "key");
      return { guides };
  }
}

/** Merge new guides into a construction (titles/ratios from the newer one win). */
export function mergeConstruction(base: ConstructionT | null | undefined, add: ConstructionT): ConstructionT {
  return Construction.parse({
    ...(base ?? {}),
    ...Object.fromEntries(Object.entries(add).filter(([k, v]) => k !== "guides" && v !== undefined)),
    guides: [...(base?.guides ?? []), ...add.guides],
  });
}

/** Ops that set a frame's construction (null clears it). One undo step. */
export function setConstructionOps(frameId: string, construction: ConstructionT | null): OpT[] {
  return [{ op: "update", id: frameId, set: { construction: construction && construction.guides.length ? construction : null }, replace: true }];
}

// ───────────────────────── snapping ─────────────────────────

export type SnapKind = "centre" | "intersection" | "tangent" | "end";
export interface SnapPoint {
  p: P;
  kind: SnapKind;
}

type Ln = { a: P; b: P };
const guideLines = (g: GuideT): Ln[] =>
  g.kind === "line" ? [{ a: [g.x1, g.y1], b: [g.x2, g.y2] }] : g.kind === "polygon" ? g.points.map((q, i) => ({ a: q as P, b: g.points[(i + 1) % g.points.length] as P })) : [];

function segSeg(l: Ln, m: Ln): P | null {
  const r: P = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
  const s: P = [m.b[0] - m.a[0], m.b[1] - m.a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const qp: P = [m.a[0] - l.a[0], m.a[1] - l.a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [l.a[0] + t * r[0], l.a[1] + t * r[1]];
}

function circleCircle(a: GuideCircleT, b: GuideCircleT): P[] {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return [];
  const tolT = 1e-6 * (a.r + b.r);
  if (d > a.r + b.r + tolT || d < Math.abs(a.r - b.r) - tolT) return [];
  const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const mx = a.cx + (dx * x) / d, my = a.cy + (dy * x) / d;
  if (h < 1e-9) return [[mx, my]];
  return [
    [mx - (dy * h) / d, my + (dx * h) / d],
    [mx + (dy * h) / d, my - (dx * h) / d],
  ];
}

function lineCircleSeg(l: Ln, c: GuideCircleT): P[] {
  const d: P = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
  const f: P = [l.a[0] - c.cx, l.a[1] - c.cy];
  const A = d[0] * d[0] + d[1] * d[1];
  const B = 2 * (f[0] * d[0] + f[1] * d[1]);
  const C = f[0] * f[0] + f[1] * f[1] - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-12 || disc < -1e-9 * A * c.r * c.r) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t, i, arr) => t >= -1e-9 && t <= 1 + 1e-9 && (i === 0 || Math.abs(t - arr[0]!) > 1e-9)).map((t) => [l.a[0] + t * d[0], l.a[1] + t * d[1]] as P);
}

/** Special points of a construction: centres, intersections, tangent points (circle extremes), ends. */
export function constructionSnapPoints(c: ConstructionT | null | undefined): SnapPoint[] {
  if (!c) return [];
  const out: SnapPoint[] = [];
  const circles = c.guides.filter((g): g is GuideCircleT => g.kind === "circle");
  const lines = c.guides.flatMap(guideLines);
  for (const g of circles) {
    out.push({ p: [g.cx, g.cy], kind: "centre" });
    out.push({ p: [g.cx, g.cy - g.r], kind: "tangent" }, { p: [g.cx + g.r, g.cy], kind: "tangent" }, { p: [g.cx, g.cy + g.r], kind: "tangent" }, { p: [g.cx - g.r, g.cy], kind: "tangent" });
  }
  for (const l of lines) out.push({ p: l.a, kind: "end" }, { p: l.b, kind: "end" });
  for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) for (const p of circleCircle(circles[i]!, circles[j]!)) out.push({ p, kind: "intersection" });
  for (const l of lines) for (const g of circles) for (const p of lineCircleSeg(l, g)) out.push({ p, kind: "intersection" });
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const p = segSeg(lines[i]!, lines[j]!);
      if (p) out.push({ p, kind: "intersection" });
    }
  // Deduplicate (keep the most specific kind).
  const rank: Record<SnapKind, number> = { centre: 0, intersection: 1, tangent: 2, end: 3 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const kept: SnapPoint[] = [];
  for (const s of out) if (!kept.some((k) => Math.abs(k.p[0] - s.p[0]) < 1e-6 && Math.abs(k.p[1] - s.p[1]) < 1e-6)) kept.push(s);
  return kept;
}

/** Axis lines for box snapping: centres, circle tangent lines (extremes), intersections. */
export function constructionSnapAxes(c: ConstructionT | null | undefined): { xs: number[]; ys: number[] } {
  const pts = constructionSnapPoints(c);
  return { xs: pts.map((s) => s.p[0]), ys: pts.map((s) => s.p[1]) };
}

/**
 * Snap a point to the construction: special points first, then the nearest point on a guide
 * (on-curve). `threshold` is in the same units as the points.
 */
export function snapToConstruction(c: ConstructionT | null | undefined, q: P, threshold: number, pts = constructionSnapPoints(c)): { p: P; kind: SnapKind | "on" } | null {
  let best: { p: P; kind: SnapKind | "on"; d: number } | null = null;
  for (const s of pts) {
    const d = Math.hypot(s.p[0] - q[0], s.p[1] - q[1]);
    if (d <= threshold && (!best || d < best.d)) best = { p: s.p, kind: s.kind, d };
  }
  if (best) return { p: best.p, kind: best.kind };
  for (const g of c?.guides ?? []) {
    if (g.kind === "circle") {
      const d = Math.hypot(q[0] - g.cx, q[1] - g.cy);
      if (d > 1e-9 && Math.abs(d - g.r) <= threshold * 0.6 && (!best || Math.abs(d - g.r) < best.d)) best = { p: [g.cx + ((q[0] - g.cx) / d) * g.r, g.cy + ((q[1] - g.cy) / d) * g.r], kind: "on", d: Math.abs(d - g.r) };
    }
    for (const l of guideLines(g)) {
      const ab: P = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
      const L2 = ab[0] * ab[0] + ab[1] * ab[1];
      if (L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((q[0] - l.a[0]) * ab[0] + (q[1] - l.a[1]) * ab[1]) / L2));
      const f: P = [l.a[0] + ab[0] * t, l.a[1] + ab[1] * t];
      const d = Math.hypot(f[0] - q[0], f[1] - q[1]);
      if (d <= threshold * 0.6 && (!best || d < best.d)) best = { p: f, kind: "on", d };
    }
  }
  return best ? { p: best.p, kind: best.kind } : null;
}

/**
 * Snap a circle radius (centre fixed): through a special point, or tangent to another circle
 * (|d ± R|). Returns the snapped radius or null.
 */
export function snapRadius(c: ConstructionT | null | undefined, centre: P, r: number, threshold: number, pts = constructionSnapPoints(c)): { r: number; kind: "through" | "tangent" } | null {
  let best: { r: number; kind: "through" | "tangent"; d: number } | null = null;
  for (const s of pts) {
    const rr = Math.hypot(s.p[0] - centre[0], s.p[1] - centre[1]);
    if (rr > 1e-6 && Math.abs(rr - r) <= threshold && (!best || Math.abs(rr - r) < best.d)) best = { r: rr, kind: "through", d: Math.abs(rr - r) };
  }
  for (const g of c?.guides ?? []) {
    if (g.kind !== "circle") continue;
    const d = Math.hypot(g.cx - centre[0], g.cy - centre[1]);
    // Tangency is exact (points are rounded): it wins over a "through" snap a hair closer.
    for (const rr of [d + g.r, Math.abs(d - g.r)]) if (rr > 1e-6 && Math.abs(rr - r) <= threshold && (!best || Math.abs(rr - r) < best.d + (best.kind === "through" ? Math.max(0.05, rr * 2e-4) : 0) - 1e-9)) best = { r: rr, kind: "tangent", d: Math.abs(rr - r) };
  }
  return best ? { r: best.r, kind: best.kind } : null;
}

/** Nearest guide to a point (for selecting guides on the canvas). */
export function guideAt(c: ConstructionT | null | undefined, q: P, threshold: number): GuideT | null {
  let best: { g: GuideT; d: number } | null = null;
  for (const g of c?.guides ?? []) {
    let d = Infinity;
    if (g.kind === "circle") d = Math.abs(Math.hypot(q[0] - g.cx, q[1] - g.cy) - g.r);
    for (const l of guideLines(g)) {
      const ab: P = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
      const L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - l.a[0]) * ab[0] + (q[1] - l.a[1]) * ab[1]) / L2));
      d = Math.min(d, Math.hypot(l.a[0] + ab[0] * t - q[0], l.a[1] + ab[1] * t - q[1]));
    }
    if (d <= threshold && (!best || d < best.d)) best = { g, d };
  }
  return best?.g ?? null;
}

/** Move a guide by (dx, dy). */
export function moveGuide(g: GuideT, dx: number, dy: number): GuideT {
  if (g.kind === "circle") return { ...g, cx: r2(g.cx + dx), cy: r2(g.cy + dy) };
  if (g.kind === "line") return { ...g, x1: r2(g.x1 + dx), y1: r2(g.y1 + dy), x2: r2(g.x2 + dx), y2: r2(g.y2 + dy) };
  return { ...g, points: g.points.map((q) => [r2(q[0] + dx), r2(q[1] + dy)] as [number, number]) };
}

// ───────────────────────── region fill ─────────────────────────

/** Brand primary (palette role "primary", else the first brand color), else ink. */
export function primaryColor(doc: DocT): string {
  const pal = doc.palette as { colors?: { hex?: string; role?: string; roles?: string[] }[] } | undefined;
  const cols = pal?.colors ?? [];
  const prim = cols.find((c) => c.role === "primary" || c.roles?.includes("primary")) ?? cols[0];
  return prim?.hex ?? "#0b0c0e";
}

export interface FillPlan {
  ops: OpT[];
  ids: string[];
  /** Points that hit no closed region. */
  missed: P[];
  error?: string;
}

/**
 * Fill the faces under points (frame coordinates) as new paths, in one undo step. merge = one
 * path for all faces (adjacent faces fuse), else one path per face.
 */
export function fillRegionOps(
  doc: DocT,
  frameId: string,
  points: P[],
  o: { color?: string; merge?: boolean; name?: string; textOutlines?: Record<string, string>; arrangement?: Arrangement; newId?: () => string } = {},
): FillPlan {
  const f = doc.nodes[frameId];
  if (f?.type !== "frame") return { ops: [], ids: [], missed: points, error: `Frame ${frameId} not found` };
  const arr = o.arrangement ?? frameArrangement(doc, frameId, { textOutlines: o.textOutlines });
  const missed: P[] = [];
  const faces = facesAt(arr, points);
  for (const q of points) if (!faces.some((fc) => fc.paths.length && windingHit(fc.paths, q))) missed.push(q);
  if (!faces.length) return { ops: [], ids: [], missed, error: "No closed region there: a point picks the region around it, so it must sit inside a region bounded by guides or shapes — not on a guide line (centre lines and diagonals included) and not outside everything." };
  const mk = o.newId ?? (() => `n${Math.random().toString(36).slice(2, 10)}`);
  const color = o.color ?? primaryColor(doc);
  const ds = o.merge ? [facePathOf(arr, mergeFaces(arr, faces))] : faces.map((fc) => facePathOf(arr, fc.paths));
  const ids: string[] = [];
  const ops: OpT[] = [];
  ds.filter(Boolean).forEach((d, i) => {
    const id = mk();
    ids.push(id);
    ops.push({ op: "add", node: { id, type: "path", name: o.name ?? (ds.length > 1 ? `Region ${i + 1}` : "Region"), d, style: { fill: color, stroke: null, strokeWidth: 0 } }, parent: frameId });
  });
  return { ops, ids, missed };
}

const facePathOf = (arr: Arrangement, region: PathsD) => regionToExactPath(region, arr.prims);
const windingHit = (paths: PathsD, q: P) => windingAt(paths, q) !== 0;

/**
 * Subtract the face under a point from a filled layer (the given one, else the top-most filled
 * layer under the point). The layer becomes a path; one undo step.
 */
export function subtractRegionOps(
  doc: DocT,
  frameId: string,
  point: P,
  o: { targetId?: string; textOutlines?: Record<string, string>; arrangement?: Arrangement; newId?: () => string } = {},
): FillPlan {
  const f = doc.nodes[frameId] as FrameNodeT | undefined;
  if (f?.type !== "frame") return { ops: [], ids: [], missed: [point], error: `Frame ${frameId} not found` };
  const arr = o.arrangement ?? frameArrangement(doc, frameId, { textOutlines: o.textOutlines });
  const face = facesAt(arr, [point])[0];
  if (!face) return { ops: [], ids: [], missed: [point], error: "No closed region there." };
  const tol = arr.tol;
  let target = o.targetId ? doc.nodes[o.targetId] : undefined;
  if (!target) {
    // Top-most filled layer (frame child) under the point.
    for (let i = f.children.length - 1; i >= 0 && !target; i--) {
      const n = doc.nodes[f.children[i]!];
      if (!n || !n.visible || n.locked || (n.type !== "path" && n.type !== "shape" && n.type !== "group")) continue;
      const reg = layerRegion(doc, frameId, n.id, tol, o.textOutlines);
      if (reg.length && windingAt(reg, point) !== 0) target = n;
    }
  }
  if (!target || (target.type !== "path" && target.type !== "shape")) return { ops: [], ids: [], missed: [], error: "Nothing filled there to subtract from (pick a path or shape)." };
  const reg = layerRegion(doc, frameId, target.id, tol, o.textOutlines);
  const cut = differenceD(reg, face.paths, FillRule.NonZero, 4);
  const frameSpace = worldMatrix(doc, frameId);
  // Primitives: arrangement + the target's own outline.
  for (const l of shapeLeaves(doc, target.id, frameSpace)) {
    const ol = nodeOutline(l.node, l.M);
    if (ol) arr.prims.addContours(ol.contours);
  }
  const dFrame = regionToExactPath(cut, arr.prims);
  const ops: OpT[] = [];
  const mk = o.newId ?? (() => `n${Math.random().toString(36).slice(2, 10)}`);
  const id = mk();
  const siblings = target.parent ? ((doc.nodes[target.parent] as { children?: string[] }).children ?? []) : doc.root;
  // The new path lives in the target's parent; frame → parent mapping (identity for frame children).
  const local = mapPathToParent(doc, frameId, target.parent, dFrame);
  ops.push({ op: "add", node: { id, type: "path", name: target.name, d: local, style: target.style, ...(target.extrude ? { extrude: target.extrude } : {}) }, parent: target.parent, index: siblings.indexOf(target.id) });
  ops.push({ op: "remove", id: target.id });
  return { ops, ids: [id], missed: [] };
}

function mapPathToParent(doc: DocT, frameId: string, parent: string | null, d: string): string {
  if (!parent || parent === frameId) return d;
  const M = multiply(invert(worldMatrix(doc, parent)), worldMatrix(doc, frameId));
  const subs = parsePath(d).map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => ({ p: apply(M, a.p[0], a.p[1]), cin: a.cin ? apply(M, a.cin[0], a.cin[1]) : null, cout: a.cout ? apply(M, a.cout[0], a.cout[1]) : null })),
  }));
  return serializePath(subs);
}

// ───────────────────────── derived construction ─────────────────────────

interface FitCircle {
  c: P;
  r: number;
  /** Arc length explained by this circle. */
  weight: number;
}

/** Least-squares circle (Kåsa) through points. */
function fitCircle(pts: P[]): { c: P; r: number; rms: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const q of pts) {
    mx += q[0];
    my += q[1];
  }
  mx /= n;
  my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const q of pts) {
    const u = q[0] - mx, v = q[1] - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const c: P = [uc + mx, vc + my];
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let e = 0;
  for (const q of pts) e += (Math.hypot(q[0] - c[0], q[1] - c[1]) - r) ** 2;
  return { c, r, rms: Math.sqrt(e / n) };
}

/**
 * A helpful construction for a mark drawn without one: bounding keylines, centre lines and
 * the circles that best fit its curves (true arcs, and circles fitted to curve segments).
 * Coordinates are the frame doc's (artboard) space.
 */
export function deriveConstruction(fdoc: DocT, o: { textOutlines?: Record<string, string>; maxCircles?: number } = {}): ConstructionT {
  const segs: Seg[] = [];
  for (const id of fdoc.root) {
    const n = fdoc.nodes[id];
    if (!n || !n.visible || n.type === "sketch" || n.type === "reference") continue;
    for (const l of shapeLeaves(fdoc, id, [1, 0, 0, 1, 0, 0])) {
      const ol = nodeOutline(l.node as NodeT, l.M, o.textOutlines?.[l.node.id]);
      if (ol) for (const c of ol.contours) segs.push(...c.segs);
    }
  }
  const guides: GuideT[] = [];
  if (!segs.length) return { guides, title: "Derived construction" };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) {
    const pts: P[] = s.k === "cubic" ? [0, 0.25, 0.5, 0.75, 1].map((t) => cubicAt(s.p, t)) : s.k === "arc" ? Array.from({ length: 9 }, (_, i) => [s.c[0] + Math.cos(s.a0 + (s.sweep * i) / 8) * s.r, s.c[1] + Math.sin(s.a0 + (s.sweep * i) / 8) * s.r] as P) : [s.a, s.b];
    for (const q of pts) {
      x0 = Math.min(x0, q[0]);
      y0 = Math.min(y0, q[1]);
      x1 = Math.max(x1, q[0]);
      y1 = Math.max(y1, q[1]);
    }
  }
  const W = x1 - x0, H = y1 - y0;
  const size = Math.max(W, H, 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  guides.push({ id: gid(), kind: "polygon", points: [[r2(x0), r2(y0)], [r2(x1), r2(y0)], [r2(x1), r2(y1)], [r2(x0), r2(y1)]], role: "keyline", label: `${num(r2(W))} × ${num(r2(H))}` });
  guides.push({ id: gid(), kind: "line", x1: r2(cx), y1: r2(y0 - size * 0.06), x2: r2(cx), y2: r2(y1 + size * 0.06), role: "grid" });
  guides.push({ id: gid(), kind: "line", x1: r2(x0 - size * 0.06), y1: r2(cy), x2: r2(x1 + size * 0.06), y2: r2(cy), role: "grid" });
  // Circles: exact arcs, plus circles fitted to curve segments that are nearly circular.
  const found: FitCircle[] = [];
  const addFit = (c: P, r: number, w: number) => {
    if (r < size * 0.02 || r > size * 2.5) return;
    const same = found.find((f) => Math.hypot(f.c[0] - c[0], f.c[1] - c[1]) < size * 0.012 && Math.abs(f.r - r) < size * 0.012);
    if (same) {
      const k = same.weight / (same.weight + w);
      same.c = [same.c[0] * k + c[0] * (1 - k), same.c[1] * k + c[1] * (1 - k)];
      same.r = same.r * k + r * (1 - k);
      same.weight += w;
    } else found.push({ c, r, weight: w });
  };
  // Neighbouring cubics on the same circle are fitted together (a circle drawn as 4 cubics).
  for (const s of segs) {
    if (s.k === "arc") {
      if (Math.abs(s.sweep) >= 0.15) addFit(s.c, s.r, Math.abs(s.sweep) * s.r);
    } else if (s.k === "cubic") {
      const cls = classifyCubic(s.p);
      if (cls.k === "arc") {
        if (Math.abs(cls.sweep) >= 0.15) addFit(cls.c, cls.r, Math.abs(cls.sweep) * cls.r);
        continue;
      }
      const pts = Array.from({ length: 13 }, (_, i) => cubicAt(s.p, i / 12));
      const fc = fitCircle(pts);
      if (!fc) continue;
      let sw = 0;
      for (let i = 1; i < pts.length; i++) {
        let d = Math.atan2(pts[i]![1] - fc.c[1], pts[i]![0] - fc.c[0]) - Math.atan2(pts[i - 1]![1] - fc.c[1], pts[i - 1]![0] - fc.c[0]);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        sw += d;
      }
      if (fc.rms < fc.r * 0.012 && Math.abs(sw) >= 0.5) addFit(fc.c, fc.r, Math.abs(sw) * fc.r);
    }
  }
  found.sort((a, b) => b.weight - a.weight);
  const keep = found.slice(0, o.maxCircles ?? 10);
  const unit = keep.length ? Math.min(...keep.map((k) => k.r)) : 0;
  // Label each distinct radius once (relative to the smallest).
  const labelled: number[] = [];
  keep.forEach((f) => {
    const fresh = unit > 0 && labelled.length < 4 && !labelled.some((r) => Math.abs(r - f.r) < f.r * 0.01);
    if (fresh) labelled.push(f.r);
    guides.push({ id: gid(), kind: "circle", cx: r2(f.c[0]), cy: r2(f.c[1]), r: r2(f.r), role: "derived", ...(fresh ? { label: `r = ${num(r2(f.r / unit))}` } : {}) });
  });
  return { guides, title: "Derived construction" };
}

/** Short text summary for agents. */
export function constructionSummary(c: ConstructionT | null | undefined): string {
  if (!c || !c.guides.length) return "No construction.";
  const n = (k: GuideT["kind"]) => c.guides.filter((g) => g.kind === k).length;
  const circles = c.guides.filter((g): g is GuideCircleT => g.kind === "circle");
  const radii = [...new Set(circles.map((g) => g.r))].sort((a, b) => b - a).slice(0, 6);
  return `${c.title ? c.title + " — " : ""}${n("circle")} circle(s)${radii.length ? ` (r ${radii.map(num).join(", ")})` : ""}, ${n("line")} line(s), ${n("polygon")} polygon(s)${c.unit ? `, unit ${num(c.unit)}` : ""}.`;
}
