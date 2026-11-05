import { apply, IDENTITY, multiply, shapeToPath, transformMatrix, type Mat } from "./geometry";
import { parsePath, type P } from "./pathmodel";
import type { DocT, NodeT, PaintT, TextNodeT } from "./schema";
import type { OpT } from "./ops";
import { frameDoc } from "./frames";

/**
 * Style profile of one version (a projected frame document): palette, strokes,
 * curve character, symmetry, type, complexity and layout — so a series of
 * pieces (icon sets, horizontal/isotype variants) can match it.
 */

// ---------------------------------------------------------------- colors

export type RGB = [number, number, number];

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", navy: "#000080", teal: "#008080",
  gold: "#ffd700", silver: "#c0c0c0", maroon: "#800000", olive: "#808000", lime: "#00ff00", aqua: "#00ffff",
  cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", pink: "#ffc0cb", brown: "#a52a2a", crimson: "#dc143c",
  coral: "#ff7f50", salmon: "#fa8072", tomato: "#ff6347", indigo: "#4b0082", violet: "#ee82ee", beige: "#f5f5dc",
  ivory: "#fffff0", tan: "#d2b48c", khaki: "#f0e68c", turquoise: "#40e0d0", chocolate: "#d2691e", sienna: "#a0522d",
};

/** Parse a CSS color (hex, rgb[a], hsl[a], common names). Null for none/transparent/unknown. */
export function parseColor(input: string): { rgb: RGB; alpha: number } | null {
  let c = input.trim().toLowerCase();
  if (!c || c === "none" || c === "transparent") return null;
  c = NAMED[c] ?? c;
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
    return { rgb, alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
    const ch = (s: string) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    const rgb = parts.slice(0, 3).map(ch) as RGB;
    if (rgb.length < 3 || rgb.some((v) => !Number.isFinite(v))) return null;
    const a = parts[3] ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { rgb: rgb.map((v) => Math.max(0, Math.min(255, v))) as RGB, alpha: Number.isFinite(a) ? a : 1 };
  }
  m = /^hsla?\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
    const h = parseFloat(parts[0] ?? "0");
    const s = parseFloat(parts[1] ?? "0") / 100;
    const l = parseFloat(parts[2] ?? "0") / 100;
    if (![h, s, l].every(Number.isFinite)) return null;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
    const al = parts[3] ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { rgb: [f(0), f(8), f(4)], alpha: Number.isFinite(al) ? al : 1 };
  }
  return null;
}

export const rgbToHex = (rgb: RGB) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Normalized #rrggbb for a CSS color, or null. */
export function normalizeColor(c: string): string | null {
  const p = parseColor(c);
  return p ? rgbToHex(p.rgb) : null;
}

/** CIE L*a*b* (D65). */
export function rgbToLab(rgb: RGB): [number, number, number] {
  const lin = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin as RGB;
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const lch = (lab: [number, number, number]) => {
  const C = Math.hypot(lab[1], lab[2]);
  const h = ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360;
  return { L: lab[0], C, h };
};

const deltaE = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A readable color name for summaries ("deep navy", "warm orange"…). */
export function describeColor(hex: string): string {
  const p = parseColor(hex);
  if (!p) return hex;
  const { L, C, h } = lch(rgbToLab(p.rgb));
  if (C < 8) {
    if (L > 97 && C < 2) return "white";
    if (L > 90) return "off-white";
    if (L < 12) return "black";
    return L > 70 ? "light gray" : L > 40 ? "gray" : "charcoal";
  }
  const hues: [number, string][] = [
    [20, "red"], [45, "orange-red"], [70, "orange"], [95, "gold"], [110, "yellow"], [135, "olive"], [165, "green"],
    [200, "teal"], [240, "cyan"], [275, "blue"], [305, "indigo"], [330, "purple"], [355, "magenta"], [360, "red"],
  ];
  let name = hues.find(([lim]) => h <= lim)![1];
  if (name === "orange" && L < 50) name = "brown";
  if (name === "gold" && C < 35) name = L < 55 ? "olive brown" : "sand";
  const tone = L < 30 ? "deep " : L > 80 ? "pale " : C < 25 ? "muted " : "";
  return tone + name;
}

// ---------------------------------------------------------------- geometry sampling

interface Poly {
  pts: P[];
  closed: boolean;
}

interface SegStat {
  curved: number;
  straight: number;
  sharp: number;
  smooth: number;
  anchors: number;
  /** Every anchor (for complexity), including path ends. */
  nodes: number;
  radii: number[];
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (v: P) => Math.hypot(v[0], v[1]);
const angleBetween = (u: P, v: P) => {
  const l = len(u) * len(v);
  if (l < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / l)));
};

const distToLine = (q: P, a: P, b: P) => {
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-9) return len(sub(q, a));
  return Math.abs(d[0] * (a[1] - q[1]) - d[1] * (a[0] - q[0])) / L;
};

function cubicAt(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Outline polygons (world coordinates) plus curve statistics (local units scaled to world). */
function sampleD(d: string, m: Mat, stats: SegStat | null): Poly[] {
  let subs;
  try {
    subs = parsePath(d);
  } catch {
    return [];
  }
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const out: Poly[] = [];
  for (const s of subs) {
    const a = s.anchors;
    const n = a.length;
    const segs = s.closed ? n : n - 1;
    if (stats) stats.nodes += n;
    const pts: P[] = [apply(m, a[0]!.p[0], a[0]!.p[1])];
    const kinds: ("line" | "curve")[] = [];
    const lens: number[] = [];
    for (let i = 0; i < segs; i++) {
      const A = a[i]!;
      const B = a[(i + 1) % n]!;
      const p0 = A.p, p1 = A.cout ?? A.p, p2 = B.cin ?? B.p, p3 = B.p;
      const chord = len(sub(p3, p0));
      const bulge = Math.max(distToLine(p1, p0, p3), distToLine(p2, p0, p3));
      const curved = (A.cout || B.cin) && bulge > Math.max(0.5, chord * 0.02);
      if (curved) {
        for (let k = 1; k <= 10; k++) {
          const q = cubicAt(p0, p1, p2, p3, k / 10);
          pts.push(apply(m, q[0], q[1]));
        }
      } else pts.push(apply(m, p3[0], p3[1]));
      const L = ((chord + len(sub(p1, p0)) + len(sub(p2, p1)) + len(sub(p3, p2))) / 2) * scale;
      kinds.push(curved ? "curve" : "line");
      lens.push(L);
      if (stats) {
        if (curved) stats.curved += L;
        else stats.straight += L;
      }
    }
    if (stats) {
      // Corners: angle between the incoming and outgoing tangent at each anchor.
      for (let i = 0; i < n; i++) {
        const hasIn = s.closed || i > 0;
        const hasOut = s.closed || i < n - 1;
        if (!hasIn || !hasOut) continue;
        const A = a[i]!;
        const prev = a[(i - 1 + n) % n]!;
        const next = a[(i + 1) % n]!;
        const tin = sub(A.p, A.cin && len(sub(A.p, A.cin)) > 1e-6 ? A.cin : prev.cout && len(sub(A.p, prev.cout)) > 1e-6 ? prev.cout : prev.p);
        const tout = sub(A.cout && len(sub(A.cout, A.p)) > 1e-6 ? A.cout : next.cin && len(sub(next.cin, A.p)) > 1e-6 ? next.cin : next.p, A.p);
        stats.anchors++;
        if (angleBetween(tin, tout) > (25 * Math.PI) / 180) stats.sharp++;
        else stats.smooth++;
      }
      // Rounded corners: a short curve between two straight segments that turns the outline.
      for (let i = 0; i < segs; i++) {
        if (kinds[i] !== "curve") continue;
        const pi = s.closed ? (i - 1 + segs) % segs : i - 1;
        const ni = s.closed ? (i + 1) % segs : i + 1;
        if (pi < 0 || ni >= segs || kinds[pi] !== "line" || kinds[ni] !== "line") continue;
        const A = a[i]!, B = a[(i + 1) % n]!;
        const prevA = a[pi]!;
        const nextB = a[(ni + 1) % n]!;
        const din = sub(A.p, prevA.p);
        const dout = sub(nextB.p, B.p);
        const turn = angleBetween(din, dout);
        if (turn < Math.PI / 6 || turn > (5 * Math.PI) / 6) continue;
        const chord = len(sub(B.p, A.p)) * scale;
        if (chord > 1.5 * Math.min(lens[pi]!, lens[ni]!)) continue;
        stats.radii.push(chord / (2 * Math.sin(turn / 2)));
      }
    }
    if (pts.length > 1) out.push({ pts, closed: s.closed });
  }
  return out;
}

function signedArea(pts: P[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function inside(q: P, pts: P[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) c = !c;
  }
  return c;
}

/** Filled area of outlines: subpaths nested inside an odd number of others count as holes. */
function fillArea(polys: Poly[]): number {
  let total = 0;
  polys.forEach((p, i) => {
    const depth = polys.filter((o, j) => j !== i && inside(p.pts[0]!, o.pts)).length;
    total += (depth % 2 ? -1 : 1) * Math.abs(signedArea(p.pts));
  });
  return Math.max(0, total);
}

const perimeter = (polys: Poly[]) =>
  polys.reduce((acc, p) => {
    let L = 0;
    for (let i = 1; i < p.pts.length; i++) L += len(sub(p.pts[i]!, p.pts[i - 1]!));
    if (p.closed) L += len(sub(p.pts[0]!, p.pts[p.pts.length - 1]!));
    return acc + L;
  }, 0);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxOf = (pts: P[]): Box | null => {
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

/** Approximate text box (local coords, baseline at y=0) when no outlines are available. */
function approxTextPolys(n: TextNodeT, m: Mat): Poly[] {
  const w = Array.from(n.text).length * n.fontSize * 0.56 + Math.max(0, n.text.length - 1) * n.letterSpacing;
  const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
  const top = -n.fontSize * 0.72;
  const pts: P[] = [[x, top], [x + w, top], [x + w, 0], [x, 0]].map((q) => apply(m, q[0]!, q[1]!));
  return [{ pts, closed: true }];
}

// ---------------------------------------------------------------- profile

export interface PaletteColor {
  /** Normalized #rrggbb. */
  hex: string;
  /** Share of the painted area (0–1, approximate). */
  share: number;
  roles: ("fill" | "stroke" | "gradient")[];
  /** Raw normalized colors merged into this one (near-identical shades). */
  members: string[];
  /** CIE lightness 0–100. */
  lightness: number;
  name: string;
}

export interface StyleProfile {
  frame: { name: string; width: number; height: number; background: string | null };
  palette: PaletteColor[];
  gradients: number;
  strokes: { widths: { width: number; share: number }[]; dominant: number | null; relative: number | null; caps: string[]; joins: string[] };
  curves: {
    /** Share of outline length that is curved (0–1). */
    curvedShare: number;
    /** Share of anchors that are sharp corners (0–1). */
    sharpShare: number;
    anchors: number;
    /** Typical corner radius in artboard units, and relative to the mark's smaller side. */
    cornerRadius: number | null;
    cornerRadiusRelative: number | null;
    character: string;
  };
  symmetry: { vertical: number; horizontal: number; rotational: number; label: string };
  type: { family: string; weight: number; size: number; tracking: number; text: string; uppercase: boolean }[];
  complexity: { layers: number; groups: number; anchors: number; level: "minimal" | "simple" | "moderate" | "detailed" };
  layout: {
    bounds: Box | null;
    /** Margins as fractions of the artboard (negative = overflow). */
    margins: { left: number; right: number; top: number; bottom: number } | null;
    /** Content box area / artboard area. */
    coverage: number;
    centered: boolean;
  };
  contrast: "dark-on-light" | "light-on-dark" | "mixed";
  summary: string;
}

export interface StyleOptions {
  /** Exact outlines for text nodes (the studio passes its font outliner); otherwise a box estimate is used. */
  textToPath?: (n: TextNodeT) => string | null;
  /** Version name for the summary (default: the projected document's name). */
  name?: string;
}

interface Leaf {
  node: NodeT;
  polys: Poly[];
  fillArea: number;
  strokeArea: number;
  strokeWidth: number;
  opacity: number;
}

function leaves(doc: DocT, o: StyleOptions, stats: SegStat): { leaves: Leaf[]; groups: number } {
  const out: Leaf[] = [];
  let groups = 0;
  const walk = (id: string, m: Mat, opacity: number) => {
    const n = doc.nodes[id];
    if (!n || !n.visible) return;
    if (n.type === "sketch" || n.type === "reference") return;
    const mm = multiply(m, transformMatrix(n.transform));
    if (n.type === "group" || n.type === "frame") {
      if (n.type === "group") groups++;
      n.children.forEach((c) => walk(c, mm, opacity * (n.type === "group" ? n.style.opacity : 1)));
      return;
    }
    let polys: Poly[] = [];
    let textInk = 1;
    if (n.type === "path") polys = sampleD(n.d, mm, stats);
    else if (n.type === "shape") {
      polys = sampleD(shapeToPath(n), mm, null);
      // Shapes are clean primitives: rect/polygon corners count as sharp unless rounded; ellipses are pure curve.
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
      const per = perimeter(polys);
      if (n.shape === "ellipse") {
        stats.curved += per;
        stats.nodes += 4;
        stats.anchors += 4;
        stats.smooth += 4;
      } else {
        const corners = n.shape === "rect" ? 4 : n.shape === "star" ? n.sides * 2 : n.sides;
        const r = n.shape === "rect" ? Math.min(n.radius, n.width / 2, n.height / 2) : n.radius;
        const arc = r > 0 ? corners * r * (Math.PI / 2) * scale : 0;
        stats.curved += Math.min(per, arc);
        stats.straight += Math.max(0, per - arc);
        stats.anchors += corners;
        stats.nodes += corners;
        if (r > 0) {
          stats.smooth += corners;
          stats.radii.push(r * scale);
        } else stats.sharp += corners;
      }
    } else if (n.type === "text") {
      const d = o.textToPath?.(n);
      polys = d ? sampleD(d, mm, null) : approxTextPolys(n, mm);
      // A box estimate covers far more than the glyphs' ink.
      if (!d) textInk = 0.4;
    }
    if (!polys.length) return;
    const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
    const s = n.style;
    const hasStroke = s.stroke !== null && s.strokeWidth > 0;
    out.push({
      node: n,
      polys,
      fillArea: s.fill !== null ? fillArea(polys) * textInk : 0,
      strokeArea: hasStroke ? perimeter(polys) * s.strokeWidth * scale : 0,
      strokeWidth: hasStroke ? s.strokeWidth * scale : 0,
      opacity: opacity * s.opacity,
    });
  };
  doc.root.forEach((id) => walk(id, IDENTITY, 1));
  return { leaves: out, groups };
}

interface Ink {
  hex: string;
  rgb: RGB;
  weight: number;
  roles: Set<"fill" | "stroke" | "gradient">;
}

function addPaint(map: Map<string, Ink>, p: PaintT, area: number, role: "fill" | "stroke"): number {
  if (p === null) return 0;
  const add = (c: string, w: number, r: "fill" | "stroke" | "gradient") => {
    const parsed = parseColor(c);
    if (!parsed) return;
    const hex = rgbToHex(parsed.rgb);
    const cur = map.get(hex) ?? { hex, rgb: parsed.rgb, weight: 0, roles: new Set() };
    cur.weight += w * parsed.alpha;
    cur.roles.add(r);
    map.set(hex, cur);
  };
  if (typeof p === "string") add(p, area, role);
  else {
    // Each stop owns the band around it.
    const stops = [...p.stops].sort((a, b) => a.offset - b.offset);
    stops.forEach((s, i) => {
      const lo = i === 0 ? 0 : (stops[i - 1]!.offset + s.offset) / 2;
      const hi = i === stops.length - 1 ? 1 : (stops[i + 1]!.offset + s.offset) / 2;
      add(s.color, area * Math.max(0.05, hi - lo), "gradient");
    });
    return 1;
  }
  return 0;
}

/** Merge near-identical shades (ΔE < 6) into the heavier one. */
function cluster(inks: Ink[]): PaletteColor[] {
  const sorted = [...inks].sort((a, b) => b.weight - a.weight);
  const groups: { lead: Ink; lab: [number, number, number]; members: Ink[] }[] = [];
  for (const ink of sorted) {
    const lab = rgbToLab(ink.rgb);
    const g = groups.find((x) => deltaE(x.lab, lab) < 6);
    if (g) g.members.push(ink);
    else groups.push({ lead: ink, lab, members: [ink] });
  }
  const total = sorted.reduce((a, b) => a + b.weight, 0) || 1;
  return groups.map((g) => {
    const roles = new Set(g.members.flatMap((m) => [...m.roles]));
    return {
      hex: g.lead.hex,
      share: g.members.reduce((a, m) => a + m.weight, 0) / total,
      roles: (["fill", "stroke", "gradient"] as const).filter((r) => roles.has(r)),
      members: g.members.map((m) => m.hex),
      lightness: g.lab[0],
      name: describeColor(g.lead.hex),
    };
  });
}

/** Resample outlines to evenly spaced points (so dense curves don't dominate the symmetry test). */
function resample(polys: Poly[], step: number): P[] {
  const out: P[] = [];
  for (const p of polys) {
    const pts = p.closed ? [...p.pts, p.pts[0]!] : p.pts;
    let carry = 0;
    out.push(pts[0]!);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const L = len(sub(b, a));
      let t = step - carry;
      while (t <= L) {
        out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]);
        t += step;
      }
      carry = L - (t - step);
    }
  }
  return out;
}

function symmetryScore(pts: P[], map: (q: P) => P, tol: number): number {
  if (pts.length < 4) return 0;
  // Uniform grid for nearest-neighbour lookups.
  const cell = tol;
  const grid = new Map<string, P[]>();
  const k = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const q of pts) {
    const key = k(q[0], q[1]);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(q);
  }
  let acc = 0;
  for (const q of pts) {
    const r = map(q);
    const cx = Math.floor(r[0] / cell), cy = Math.floor(r[1] / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const c of grid.get(`${cx + dx},${cy + dy}`) ?? []) best = Math.min(best, Math.hypot(c[0] - r[0], c[1] - r[1]));
    acc += Math.max(0, 1 - Math.min(best, tol) / tol);
  }
  return acc / pts.length;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Extract the style of one version. Pass a projected frame document (see frameDoc). */
export function styleProfile(doc: DocT, o: StyleOptions = {}): StyleProfile {
  const stats: SegStat = { curved: 0, straight: 0, sharp: 0, smooth: 0, anchors: 0, nodes: 0, radii: [] };
  const { leaves: ls, groups } = leaves(doc, o, stats);
  const W = doc.artboard.width;
  const H = doc.artboard.height;

  // Palette, weighted by painted area.
  const inks = new Map<string, Ink>();
  let gradients = 0;
  for (const l of ls) {
    gradients += addPaint(inks, l.node.style.fill, l.fillArea * l.opacity, "fill");
    gradients += addPaint(inks, l.node.style.stroke, l.strokeArea * l.opacity, "stroke");
  }
  const palette = cluster([...inks.values()]).sort((a, b) => b.share - a.share);

  // Strokes.
  const sw = new Map<number, number>();
  const caps = new Set<string>();
  const joins = new Set<string>();
  for (const l of ls)
    if (l.strokeWidth > 0) {
      const w = r1(l.strokeWidth);
      sw.set(w, (sw.get(w) ?? 0) + l.strokeArea);
      caps.add(l.node.style.strokeLinecap);
      joins.add(l.node.style.strokeLinejoin);
    }
  const swTotal = [...sw.values()].reduce((a, b) => a + b, 0) || 1;
  const widths = [...sw.entries()].map(([width, a]) => ({ width, share: a / swTotal })).sort((a, b) => b.share - a.share);

  // Layout.
  const allPts = ls.flatMap((l) => l.polys.flatMap((p) => p.pts));
  const bounds = boxOf(allPts);
  const margins = bounds
    ? { left: bounds.x / W, right: (W - bounds.x - bounds.w) / W, top: bounds.y / H, bottom: (H - bounds.y - bounds.h) / H }
    : null;
  const centered = !!margins && Math.abs(margins.left - margins.right) < 0.03 && Math.abs(margins.top - margins.bottom) < 0.03;
  const markMin = bounds ? Math.max(1, Math.min(bounds.w, bounds.h)) : 1;
  const markH = bounds ? Math.max(1, bounds.h) : 1;

  // Curves and corners.
  const totalLen = stats.curved + stats.straight;
  const curvedShare = totalLen ? stats.curved / totalLen : 0;
  const sharpShare = stats.anchors ? stats.sharp / stats.anchors : 0;
  const radii = [...stats.radii].sort((a, b) => a - b);
  const cornerRadius = radii.length ? radii[Math.floor(radii.length / 2)]! : null;
  const geometric = ls.some((l) => l.node.type !== "text");
  let character = "no drawn shapes (type only)";
  if (geometric) {
    if (curvedShare >= 0.85) character = sharpShare <= 0.15 ? "soft, flowing curves" : "curves with pointed tips";
    else if (curvedShare >= 0.6) character = sharpShare > 0.3 ? "mostly curves, meeting crisp corners" : "mostly curves";
    else if (curvedShare >= 0.35) character = "balanced mix of curves and straight edges";
    else if (cornerRadius !== null && cornerRadius / markMin > 0.01) character = "straight edges with rounded corners";
    else if (curvedShare < 0.15) character = "sharp, straight-edged geometry";
    else character = "mostly straight with some curves";
  }

  // Symmetry about the content center.
  let symmetry = { vertical: 0, horizontal: 0, rotational: 0, label: "n/a" };
  if (bounds) {
    const diag = Math.hypot(bounds.w, bounds.h) || 1;
    let pts = resample(ls.flatMap((l) => l.polys), diag / 160);
    if (pts.length > 1600) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 1600) === 0);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const tol = diag * 0.025;
    const v = symmetryScore(pts, (q) => [2 * cx - q[0], q[1]], tol);
    const h = symmetryScore(pts, (q) => [q[0], 2 * cy - q[1]], tol);
    const rot = symmetryScore(pts, (q) => [2 * cx - q[0], 2 * cy - q[1]], tol);
    let label = "asymmetric";
    if (v >= 0.9 && h >= 0.9) label = "symmetric on both axes";
    else if (v >= 0.9) label = "mirror-symmetric left/right";
    else if (h >= 0.9) label = "mirror-symmetric top/bottom";
    else if (rot >= 0.9) label = "rotationally symmetric (180°)";
    else if (Math.max(v, h) >= 0.75) label = v >= h ? "nearly symmetric left/right" : "nearly symmetric top/bottom";
    const r2 = (x: number) => Math.round(x * 100) / 100;
    symmetry = { vertical: r2(v), horizontal: r2(h), rotational: r2(rot), label };
  }

  // Type.
  const type = ls
    .filter((l): l is Leaf & { node: TextNodeT } => l.node.type === "text")
    .map(({ node: t }) => ({
      family: t.fontFamily,
      weight: t.fontWeight,
      size: t.fontSize,
      tracking: Math.round((t.letterSpacing / t.fontSize) * 1000) / 1000,
      text: t.text,
      uppercase: t.text === t.text.toUpperCase() && t.text !== t.text.toLowerCase(),
    }));

  const anchors = stats.nodes;
  const level = anchors <= 40 && ls.length <= 4 ? "minimal" : anchors <= 140 ? "simple" : anchors <= 420 ? "moderate" : "detailed";

  // Contrast against the background (transparent reads as a light page).
  const bgL = doc.artboard.background ? (parseColor(doc.artboard.background) ? rgbToLab(parseColor(doc.artboard.background)!.rgb)[0] : 100) : 100;
  const inkL = palette.length ? palette.reduce((a, c) => a + c.lightness * c.share, 0) : 0;
  const contrast = Math.abs(bgL - inkL) < 25 ? "mixed" : bgL > inkL ? "dark-on-light" : "light-on-dark";

  const profile: StyleProfile = {
    frame: { name: o.name ?? doc.name, width: W, height: H, background: doc.artboard.background },
    palette,
    gradients,
    strokes: {
      widths,
      dominant: widths[0]?.width ?? null,
      relative: widths[0] ? widths[0].width / markH : null,
      caps: [...caps],
      joins: [...joins],
    },
    curves: {
      curvedShare,
      sharpShare,
      anchors,
      cornerRadius: cornerRadius !== null ? r1(cornerRadius) : null,
      cornerRadiusRelative: cornerRadius !== null ? cornerRadius / markMin : null,
      character,
    },
    symmetry,
    type,
    complexity: { layers: ls.length, groups, anchors, level },
    layout: { bounds, margins, coverage: bounds ? (bounds.w * bounds.h) / (W * H) : 0, centered },
    contrast,
    summary: "",
  };
  profile.summary = summarize(profile);
  return profile;
}

function summarize(p: StyleProfile): string {
  const lines: string[] = [];
  lines.push(`Style of "${p.frame.name}" — ${p.frame.width}×${p.frame.height}, background ${p.frame.background ?? "transparent"}.`);
  if (!p.complexity.layers) return lines.concat("- Empty: nothing drawn yet.").join("\n");
  const pal = p.palette.slice(0, 6).map((c) => `${c.hex.toUpperCase()} ${c.name} ${pct(c.share)}${c.roles.includes("stroke") && !c.roles.includes("fill") ? " (stroke)" : ""}`);
  lines.push(`- Palette (${p.palette.length} color${p.palette.length === 1 ? "" : "s"}, ${p.contrast}${p.gradients ? `, ${p.gradients} gradient${p.gradients === 1 ? "" : "s"}` : ", flat"}): ${pal.join(", ")}${p.palette.length > 6 ? ", …" : ""}.`);
  const c = p.curves;
  if (c.anchors) {
    const corner = c.cornerRadius !== null ? `; corner radius ≈ ${c.cornerRadius} (${pct(c.cornerRadiusRelative!)} of the mark)` : c.sharpShare > 0.2 ? "; corners are sharp" : "";
    lines.push(`- Shapes: ${c.character} — ${pct(c.curvedShare)} of the outline is curved${corner}.`);
  }
  if (p.strokes.dominant !== null) {
    const extra = p.strokes.widths.length > 1 ? ` (also ${p.strokes.widths.slice(1, 4).map((w) => w.width).join(", ")})` : "";
    lines.push(`- Strokes: ${p.strokes.dominant} units${extra} = ${r1(p.strokes.relative! * 100)}% of the mark height, ${p.strokes.caps.join("/")} caps, ${p.strokes.joins.join("/")} joins.`);
  } else lines.push("- Strokes: none — filled shapes only.");
  lines.push(`- Symmetry: ${p.symmetry.label} (L/R ${pct(p.symmetry.vertical)}, T/B ${pct(p.symmetry.horizontal)}).`);
  if (p.type.length) {
    const t = p.type.map((t) => `${t.family} ${t.weight}, ${r1(t.size)}px, tracking ${t.tracking >= 0 ? "+" : ""}${t.tracking}em${t.uppercase ? ", all caps" : ""} ("${t.text}")`);
    lines.push(`- Type: ${t.join("; ")}.`);
  } else lines.push("- Type: none (symbol only).");
  lines.push(`- Detail: ${p.complexity.level} — ${p.complexity.layers} part${p.complexity.layers === 1 ? "" : "s"}, ${p.complexity.anchors} nodes.`);
  const b = p.layout.bounds;
  const m = p.layout.margins;
  if (b && m) {
    lines.push(
      `- Layout: mark ${Math.round(b.w)}×${Math.round(b.h)} (${pct(b.w / p.frame.width)} × ${pct(b.h / p.frame.height)} of the artboard), margins L ${pct(m.left)} R ${pct(m.right)} T ${pct(m.top)} B ${pct(m.bottom)}${p.layout.centered ? ", centered" : ", off-center"}.`,
    );
  }
  return lines.join("\n");
}

/** A ready-to-paste prompt describing the style, for the user's AI. */
export function styleBrief(p: StyleProfile): string {
  const lines = [
    `Create a new piece in the exact visual style of my logo version "${p.frame.name}" in Brusshy, so they read as one family (icon set / horizontal and stacked variants).`,
    "",
    "Match these rules:",
  ];
  if (p.palette.length)
    lines.push(`- Palette — use only these colors, in similar proportions: ${p.palette.slice(0, 6).map((c) => `${c.hex.toUpperCase()} (${c.name}, ~${pct(c.share)})`).join(", ")}. ${p.gradients ? "Gradients are part of the look." : "Keep it flat: no gradients."} Background: ${p.frame.background ?? "transparent"}.`);
  if (p.curves.anchors) lines.push(`- Shape language: ${p.curves.character}; about ${pct(p.curves.curvedShare)} of outlines are curved.`);
  if (p.curves.cornerRadius !== null) lines.push(`- Corner radius: ${p.curves.cornerRadius} units at this size (${pct(p.curves.cornerRadiusRelative!)} of the mark's smaller side) — scale it with the piece.`);
  if (p.strokes.dominant !== null)
    lines.push(`- Stroke weight: ${p.strokes.dominant} units (${r1(p.strokes.relative! * 100)}% of the mark height), ${p.strokes.caps.join("/")} caps, ${p.strokes.joins.join("/")} joins. Keep the same optical weight on every piece.`);
  else lines.push("- Construction: filled shapes, no outlined strokes.");
  lines.push(`- Symmetry: ${p.symmetry.label}.`);
  if (p.type.length) lines.push(`- Type: ${p.type.map((t) => `${t.family} ${t.weight}, tracking ${t.tracking >= 0 ? "+" : ""}${t.tracking}em${t.uppercase ? ", all caps" : ""}`).join("; ")}.`);
  lines.push(`- Detail level: ${p.complexity.level} (${p.complexity.layers} parts, ~${p.complexity.anchors} nodes) — don't add more detail than this.`);
  if (p.layout.margins) lines.push(`- Clear space: about ${pct(Math.min(p.layout.margins.left, p.layout.margins.right, p.layout.margins.top, p.layout.margins.bottom))} margin around the mark${p.layout.centered ? ", centered" : ""}.`);
  lines.push("", "Correct optically, not just numerically: round shapes overshoot slightly, small sizes get slightly heavier strokes. Check it next to the original with render_preview.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- palette matching

export interface PaletteMapping {
  from: string;
  to: string;
}

/**
 * Pair target colors with source colors, preserving lightness order (dark stays darker
 * than light, so contrast and knockouts survive). Heavier colors prefer heavier colors.
 * Pure white/black knockouts stay when the source has nothing near their lightness.
 */
export function assignPalette(source: PaletteColor[], target: PaletteColor[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!source.length || !target.length) return map;
  const info = (c: PaletteColor) => {
    const l = lch(rgbToLab(parseColor(c.hex)!.rgb));
    return { c, L: l.L, C: l.C, h: l.h };
  };
  const S = source.map(info).sort((a, b) => a.L - b.L || a.h - b.h);
  let T = target.map(info);
  for (const t of T) {
    const extreme = t.C < 6 && (t.L > 94 || t.L < 8);
    if (extreme && !S.some((s) => Math.abs(s.L - t.L) <= 30)) map.set(t.c.hex, t.c.hex);
  }
  T = T.filter((t) => !map.has(t.c.hex)).sort((a, b) => a.L - b.L || a.h - b.h);
  const n = T.length;
  const m = S.length;
  if (!n) return map;
  const maxS = Math.max(...S.map((s) => s.c.share)) || 1;
  const maxT = Math.max(...T.map((t) => t.c.share)) || 1;
  const cost = (t: (typeof T)[number], s: (typeof S)[number]) => Math.abs(t.L - s.L) / 100 - 0.5 * Math.sqrt((t.c.share / maxT) * (s.c.share / maxS));
  if (m >= n) {
    // Order-preserving choice of n distinct source colors with minimal total cost.
    const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    const take: boolean[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(false));
    for (let j = 0; j <= m; j++) dp[0]![j] = 0;
    for (let i = 1; i <= n; i++)
      for (let j = i; j <= m; j++) {
        const skip = dp[i]![j - 1]!;
        const use = dp[i - 1]![j - 1]! + cost(T[i - 1]!, S[j - 1]!);
        if (use <= skip) {
          dp[i]![j] = use;
          take[i]![j] = true;
        } else dp[i]![j] = skip;
      }
    for (let i = n, j = m; i > 0; j--) {
      if (take[i]![j]) {
        map.set(T[i - 1]!.c.hex, S[j - 1]!.c.hex);
        i--;
      }
    }
  } else {
    // Fewer source colors: spread the target's lightness ranks over the source's.
    T.forEach((t, i) => map.set(t.c.hex, S[n === 1 ? m - 1 : Math.round((i * (m - 1)) / (n - 1))]!.c.hex));
  }
  return map;
}

function remapColor(c: string, member: Map<string, string>): string | null {
  const p = parseColor(c);
  if (!p) return null;
  const to = member.get(rgbToHex(p.rgb));
  if (!to || to === rgbToHex(p.rgb)) return null;
  if (p.alpha >= 1) return to;
  const q = parseColor(to)!.rgb;
  return `rgba(${q.map(Math.round).join(", ")}, ${Math.round(p.alpha * 1000) / 1000})`;
}

/** Remap a paint through a raw-color → new-color map (alpha and gradient stops kept). Undefined = unchanged. */
export function remapPaint(p: PaintT, member: Map<string, string>): PaintT | undefined {
  if (p === null) return undefined;
  if (typeof p === "string") return remapColor(p, member) ?? undefined;
  let changed = false;
  const stops = p.stops.map((s) => {
    const to = remapColor(s.color, member);
    if (to) changed = true;
    return to ? { ...s, color: to } : s;
  });
  return changed ? { ...p, stops } : undefined;
}

/**
 * Recolor the target version with the source version's palette (one batch of update ops →
 * one undo step). `skip` leaves nodes untouched (e.g. parts locked for the AI).
 */
export function matchPaletteOps(
  doc: DocT,
  sourceFrameId: string,
  targetFrameId: string,
  o: StyleOptions & { skip?: (n: NodeT) => boolean } = {},
): { ops: OpT[]; mapping: PaletteMapping[]; skipped: string[]; background: string | null } {
  const src = styleProfile(frameDoc(doc, sourceFrameId), { ...o, name: undefined });
  const tgtDoc = frameDoc(doc, targetFrameId);
  const tgt = styleProfile(tgtDoc, { ...o, name: undefined });
  const pairs = assignPalette(src.palette, tgt.palette);
  const member = new Map<string, string>();
  for (const c of tgt.palette) {
    const to = pairs.get(c.hex);
    if (to) for (const mem of c.members) member.set(mem, to);
  }
  const ops: OpT[] = [];
  const skipped: string[] = [];
  for (const n of Object.values(tgtDoc.nodes)) {
    if (n.type !== "path" && n.type !== "shape" && n.type !== "text") continue;
    const fill = remapPaint(n.style.fill, member);
    const stroke = remapPaint(n.style.stroke, member);
    if (fill === undefined && stroke === undefined) continue;
    if (o.skip?.(n)) {
      skipped.push(n.id);
      continue;
    }
    const style: Record<string, unknown> = {};
    if (fill !== undefined) style.fill = fill;
    if (stroke !== undefined) style.stroke = stroke;
    ops.push({ op: "update", id: n.id, set: { style } });
  }
  const sf = doc.nodes[sourceFrameId];
  const tf = doc.nodes[targetFrameId];
  let background: string | null = null;
  if (sf?.type === "frame" && tf?.type === "frame" && sf.background && tf.background && normalizeColor(sf.background) !== normalizeColor(tf.background)) {
    background = sf.background;
    ops.push({ op: "update", id: targetFrameId, set: { background } });
  }
  const mapping = tgt.palette.filter((c) => pairs.has(c.hex)).map((c) => ({ from: c.hex, to: pairs.get(c.hex)! }));
  return { ops, mapping, skipped, background };
}
