import { apply, IDENTITY, invert, multiply, shapeToPath, transformMatrix, worldMatrix, type Mat } from "./geometry";
import { parsePath, type P } from "./pathmodel";
import { pathDataBounds } from "./lettering";
import { parseColor, rgbToLab } from "./style";
import { applyOps, type OpT } from "./ops";
import { cloneSubtreeOps, frameDoc, nextFramePosition } from "./frames";
import { newId } from "./ids";
import type { DocT, FrameNodeT, NodeT, PaintT, TextNodeT } from "./schema";

/**
 * Lockups: how the mark (symbol) and the wordmark sit together — horizontal, stacked,
 * mark right, wordmark only, icon only — balanced by numbers the way brand designers
 * talk about them: mark height in cap heights, gap in cap heights (or mark strokes),
 * vertical alignment (optical / cap-height centre / baseline), optical centring on the
 * artboard (contrast-weighted visual centre, not just the bounding box), clear space
 * and minimum size.
 *
 * Everything here is pure: measure → plan → ops. The studio passes real glyph metrics
 * (cap height and x-height measured on the font's own "H" and "x", plus exact outlines);
 * without them, type metrics are estimated from the font size and the result says so.
 */

export const LOCKUP_ARRANGEMENTS = ["horizontal", "stacked", "mark-right", "wordmark-only", "icon-only"] as const;
export type LockupArrangement = (typeof LOCKUP_ARRANGEMENTS)[number];

export const LOCKUP_LABELS: Record<LockupArrangement, string> = {
  horizontal: "Horizontal",
  stacked: "Stacked",
  "mark-right": "Mark right",
  "wordmark-only": "Wordmark",
  "icon-only": "Icon",
};

export const LOCKUP_ALIGNS = ["optical", "cap", "baseline"] as const;
/** Vertical alignment of the mark in horizontal lockups. */
export type LockupAlign = (typeof LOCKUP_ALIGNS)[number];

export const LOCKUP_CENTRES = ["optical", "bbox", "none"] as const;
export type LockupCentre = (typeof LOCKUP_CENTRES)[number];

export const CLEAR_SPACE_UNITS = ["cap", "x", "mark"] as const;
/** Clear space unit: cap height, x-height, or the mark's height. */
export type ClearSpaceUnit = (typeof CLEAR_SPACE_UNITS)[number];

export const CLEAR_SPACE_LABELS: Record<ClearSpaceUnit, string> = { cap: "cap height", x: "x-height", mark: "mark height" };

/** Default clear space per unit (1 cap height, 1 x-height, ¼ of the mark). */
export const CLEAR_SPACE_DEFAULT: Record<ClearSpaceUnit, number> = { cap: 1, x: 1, mark: 0.25 };

export type LockupGapUnit = "cap" | "stroke";

/** Comfortable ranges (mark height ÷ cap height, gap in cap heights) per arrangement. */
export const LOCKUP_RANGES = {
  horizontal: { ratio: { min: 1.2, max: 2.6, default: 1.8 }, gap: { min: 0.35, max: 1.6, default: 0.75 } },
  stacked: { ratio: { min: 2, max: 5, default: 3.2 }, gap: { min: 0.4, max: 1.8, default: 0.9 } },
} as const;

/** Legibility floors for the minimum-size suggestion. */
export const MIN_SIZE_RULES = { capPx: 6, capMm: 1.5, strokePx: 1, strokeMm: 0.15, iconPx: 16 } as const;

/** How far the visual centre follows the ink mass (0 = bounding box, 1 = centroid). */
export const OPTICAL_WEIGHT = { mark: 0.5, lockupX: 0.25, lockupY: 0.5 } as const;

export interface LockupBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Type metrics of a text node in its local units (at its font size). */
export interface TypeMetrics {
  capHeight: number;
  xHeight: number;
  /** Exact outline of the text (local coordinates, baseline at y=0, anchor applied). */
  d?: string | null;
}
/** Real glyph metrics (the studio's fonts); null = not available, estimate from the font size. */
export type TypeMetricsFn = (n: TextNodeT) => TypeMetrics | null;

export interface LockupParts {
  /** Mark (symbol) layer ids — move and scale together. */
  mark: string[];
  /** Wordmark layer ids (name, optional tagline) — move and scale together. */
  wordmark: string[];
  /** How they were found. */
  source: "selection" | "names" | "auto";
}

export interface PartGeom {
  ids: string[];
  /** Ink bounds in artboard coordinates (strokes included). */
  box: LockupBox;
  /** Contrast-weighted centre of the ink (knockouts and holes count as empty). */
  mass: P;
  /** Contrast-weighted ink area. */
  ink: number;
  /** Stroke weight: the dominant stroke width, or an estimate of stem width for filled shapes. */
  stroke: number | null;
  strokeExplicit: boolean;
}

export interface TypeGeom extends PartGeom {
  /** The text (or lettering group) whose metrics define the type size. */
  primary: string;
  capHeight: number;
  xHeight: number;
  /** Baseline y of the primary line, artboard coordinates. */
  baseline: number;
  /** All-lowercase word: optical alignment uses the x-height band. */
  lowercase: boolean;
  /** Number of type lines/parts (name + tagline = 2). */
  lines: number;
  /** "glyphs" = measured on the real font; others are estimates. */
  source: "glyphs" | "letters" | "font-size" | "bounds";
}

export interface LockupMetrics {
  frame: { id: string; name: string; width: number; height: number };
  parts: LockupParts;
  mark: PartGeom | null;
  type: TypeGeom | null;
  markVisible: boolean;
  typeVisible: boolean;
  arrangement: LockupArrangement | "custom" | "none";
  /** Mark height ÷ cap height. */
  ratio: number | null;
  /** Ink-to-ink gap between mark and wordmark (artboard units), and in cap heights / mark strokes. */
  gap: number | null;
  gapCap: number | null;
  gapStroke: number | null;
  /** Horizontal lockups: offset of the mark (in cap heights, + = mark low) from each alignment, and the closest one. */
  align: { optical: number; cap: number; baseline: number; closest: LockupAlign } | null;
  /** Stacked lockups: horizontal offset of the mark's optical centre from the wordmark centre (in cap heights). */
  stackOffset: number | null;
  /** Ink bounds of the visible lockup. */
  bounds: LockupBox | null;
  /** Visual centre of the visible lockup and its offset from the artboard centre (artboard units). */
  visualCentre: P | null;
  centreOffset: { optical: P; bbox: P } | null;
  clearSpace: {
    unit: ClearSpaceUnit;
    amount: number;
    /** Clear space in artboard units. */
    value: number;
    /** Actual space from the ink to each artboard edge. */
    margins: { left: number; right: number; top: number; bottom: number };
    /** Every margin is at least the clear space. */
    ok: boolean;
  } | null;
  minSize: { px: number; mm: number; limitedBy: "cap height" | "stroke" | "icon" } | null;
  /** Type metrics come from the real font. */
  exact: boolean;
  notes: string[];
}

export interface LockupOptions {
  arrangement: LockupArrangement;
  /** Mark height ÷ cap height (default: current, clamped to the arrangement's range). */
  ratio?: number;
  /** Gap between mark and wordmark ink, in `gapUnit`s (default: current or the arrangement's default). */
  gap?: number;
  gapUnit?: LockupGapUnit;
  align?: LockupAlign;
  centre?: LockupCentre;
  /** shrink = scale the lockup down if it would break the artboard's clear space; artboard = resize the artboard to the clear space. */
  fit?: "none" | "shrink" | "artboard";
  clearSpace?: { unit: ClearSpaceUnit; amount?: number };
  /** This part keeps its exact size and place (e.g. locked for the AI): the other is laid out around it. */
  fixed?: "mark" | "wordmark" | null;
  /** This part keeps its size (default the wordmark: the mark is scaled to reach the ratio). */
  keepSize?: "mark" | "wordmark";
  /** How the dropped part of wordmark-only / icon-only is taken out. */
  drop?: "hide" | "remove";
}

export interface LockupPlan {
  ops: OpT[];
  /** Full-value node patches (transform, fontSize, style, visible) — usable as live previews. */
  patches: Record<string, Partial<NodeT>>;
  /** New artboard size when fitted to the clear space. */
  frameSize: { width: number; height: number } | null;
  arrangement: LockupArrangement;
  ratio: number | null;
  /** Gap in cap heights. */
  gap: number | null;
  /** Gap in the requested unit (cap heights or mark strokes). */
  gapValue: number | null;
  align: LockupAlign;
  notes: string[];
}

// ---------------------------------------------------------------- small helpers

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const unionBox = (boxes: LockupBox[]): LockupBox | null => {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const boxOfPts = (pts: P[]): LockupBox | null => {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const centreOf = (b: LockupBox): P => [b.x + b.w / 2, b.y + b.h / 2];

/** Visual centre: the box centre pulled toward the ink mass. */
export function visualCentreOf(g: Pick<PartGeom, "box" | "mass">, kx: number = OPTICAL_WEIGHT.mark, ky: number = OPTICAL_WEIGHT.mark): P {
  const c = centreOf(g.box);
  return [c[0] + kx * (g.mass[0] - c[0]), c[1] + ky * (g.mass[1] - c[1])];
}

function lightnessOf(p: PaintT): { L: number; alpha: number } | null {
  if (p === null) return null;
  if (typeof p === "string") {
    const c = parseColor(p);
    return c ? { L: rgbToLab(c.rgb)[0], alpha: c.alpha } : null;
  }
  const ls = p.stops.map((s) => parseColor(s.color)).filter((c): c is NonNullable<typeof c> => !!c);
  if (!ls.length) return null;
  return { L: ls.reduce((a, c) => a + rgbToLab(c.rgb)[0], 0) / ls.length, alpha: ls.reduce((a, c) => a + c.alpha, 0) / ls.length };
}

const parentMatrixOf = (doc: DocT, n: NodeT): Mat => (n.parent && doc.nodes[n.parent] ? worldMatrix(doc, n.parent) : IDENTITY);

/** Visible itself and through every ancestor (inside the projected frame doc). */
function visibleChain(doc: DocT, id: string): boolean {
  for (let n: NodeT | undefined = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (!n.visible) return false;
  return true;
}

// ---------------------------------------------------------------- outlines

interface Poly {
  pts: P[];
  closed: boolean;
}

function flatten(d: string, m: Mat): Poly[] {
  let subs;
  try {
    subs = parsePath(d);
  } catch {
    return [];
  }
  const out: Poly[] = [];
  for (const s of subs) {
    const a = s.anchors;
    if (!a.length) continue;
    const segs = s.closed ? a.length : a.length - 1;
    const pts: P[] = [apply(m, a[0]!.p[0], a[0]!.p[1])];
    for (let i = 0; i < segs; i++) {
      const A = a[i]!, B = a[(i + 1) % a.length]!;
      if (!A.cout && !B.cin) {
        pts.push(apply(m, B.p[0], B.p[1]));
        continue;
      }
      const p0 = A.p, p1 = A.cout ?? A.p, p2 = B.cin ?? B.p, p3 = B.p;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, u = 1 - t;
        const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
        const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
        pts.push(apply(m, x, y));
      }
    }
    if (pts.length > 1) out.push({ pts, closed: s.closed });
  }
  return out;
}

/** Box estimate of a text node's ink when no outlines are available (local coords, baseline y=0). */
function approxTextD(n: TextNodeT, capHeight: number): string {
  const chars = Array.from(n.text);
  const w = chars.length * n.fontSize * 0.56 + Math.max(0, chars.length - 1) * n.letterSpacing;
  const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
  return `M${x} ${-capHeight}H${x + w}V0H${x}Z`;
}

interface Leaf {
  polys: Poly[];
  fill: { L: number; alpha: number } | null;
  stroke: { L: number; alpha: number } | null;
  sw: number;
  rule: "nonzero" | "evenodd";
  /** Ink density of a box estimate (text without outlines covers ~40% of its box). */
  density: number;
}

function collectLeaves(doc: DocT, rootId: string, tm: TypeMetricsFn | undefined, onEstimate: () => void): Leaf[] {
  const out: Leaf[] = [];
  const root = doc.nodes[rootId];
  if (!root) return out;
  const walk = (id: string, m: Mat, opacity: number, isRoot: boolean) => {
    const n = doc.nodes[id];
    if (!n || (!n.visible && !isRoot)) return;
    if (n.type === "sketch" || n.type === "reference" || n.type === "frame") return;
    const mm = multiply(m, transformMatrix(n.transform));
    if (n.type === "group") {
      n.children.forEach((c) => walk(c, mm, opacity * n.style.opacity, false));
      return;
    }
    let d: string | null = null;
    let density = 1;
    if (n.type === "path") d = n.d;
    else if (n.type === "shape") d = shapeToPath(n);
    else if (n.type === "text") {
      const t = tm?.(n);
      if (t?.d) d = t.d;
      else {
        d = approxTextD(n, t?.capHeight ?? n.fontSize * 0.7);
        density = 0.4;
        onEstimate();
      }
    }
    if (!d) return;
    const polys = flatten(d, mm);
    if (!polys.length) return;
    const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
    const s = n.style;
    const fill = lightnessOf(s.fill);
    const stroke = s.strokeWidth > 0 ? lightnessOf(s.stroke) : null;
    const a = opacity * s.opacity;
    out.push({
      polys,
      fill: fill && { L: fill.L, alpha: fill.alpha * a },
      stroke: stroke && { L: stroke.L, alpha: stroke.alpha * a },
      sw: stroke ? s.strokeWidth * scale : 0,
      rule: s.fillRule,
      density,
    });
  };
  walk(rootId, parentMatrixOf(doc, root), 1, true);
  return out;
}

const polyPerimeter = (p: Poly) => {
  let L = 0;
  for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i]![0] - p.pts[i - 1]![0], p.pts[i]![1] - p.pts[i - 1]![1]);
  if (p.closed) L += Math.hypot(p.pts[0]![0] - p.pts[p.pts.length - 1]![0], p.pts[0]![1] - p.pts[p.pts.length - 1]![1]);
  return L;
};

// ---------------------------------------------------------------- raster mass

/**
 * Paint the part's leaves (painter's order, fill rules, strokes, opacity) on a small
 * lightness grid over its box and weight every cell by its contrast with the background.
 * Knockouts (a white star on a dark disc) and holes therefore weigh nothing — the mass
 * is what the eye actually sees.
 */
function rasterMass(leaves: Leaf[], box: LockupBox, bgL: number): { mass: P; ink: number } {
  const N = 160;
  const cell = Math.max(box.w, box.h, 1e-6) / N;
  const nx = Math.max(1, Math.ceil(box.w / cell));
  const ny = Math.max(1, Math.ceil(box.h / cell));
  const grid = new Float32Array(nx * ny).fill(bgL);
  const cov = new Float32Array(nx * ny);
  const mask = new Uint8Array(nx * ny);
  const cx = (i: number) => box.x + (i + 0.5) * cell;
  const cy = (j: number) => box.y + (j + 0.5) * cell;

  const fillMask = (polys: Poly[], rule: "nonzero" | "evenodd") => {
    mask.fill(0);
    const xs: { x: number; w: number }[] = [];
    for (let j = 0; j < ny; j++) {
      const y = cy(j);
      xs.length = 0;
      for (const p of polys) {
        const n = p.pts.length;
        for (let k = 0; k < n; k++) {
          const a = p.pts[k]!, b = p.pts[(k + 1) % n]!;
          if (a[1] <= y !== b[1] <= y) xs.push({ x: a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), w: b[1] > a[1] ? 1 : -1 });
        }
      }
      if (xs.length < 2) continue;
      xs.sort((u, v) => u.x - v.x);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind = rule === "evenodd" ? wind ^ 1 : wind + xs[k]!.w;
        if (!wind) continue;
        const i0 = Math.max(0, Math.ceil((xs[k]!.x - box.x) / cell - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1]!.x - box.x) / cell - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
      }
    }
  };
  const strokeMask = (polys: Poly[], hw: number) => {
    mask.fill(0);
    const seg = (a: P, b: P) => {
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - hw - box.x) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + hw - box.x) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - hw - box.y) / cell));
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1]) + hw - box.y) / cell));
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1e-12;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const px = cx(i), py = cy(j);
          const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1);
          if (Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy) <= hw) mask[j * nx + i] = 1;
        }
    };
    for (const p of polys) {
      for (let k = 1; k < p.pts.length; k++) seg(p.pts[k - 1]!, p.pts[k]!);
      if (p.closed) seg(p.pts[p.pts.length - 1]!, p.pts[0]!);
    }
  };
  const blend = (paint: { L: number; alpha: number }, density: number) => {
    const L = bgL + (paint.L - bgL) * density;
    const a = clamp(paint.alpha, 0, 1);
    for (let k = 0; k < mask.length; k++)
      if (mask[k]) {
        grid[k] = grid[k]! * (1 - a) + L * a;
        cov[k] = cov[k]! * (1 - a) + density * a;
      }
  };
  for (const lf of leaves) {
    if (lf.fill && lf.fill.alpha > 0) {
      fillMask(lf.polys, lf.rule);
      blend(lf.fill, lf.density);
    }
    if (lf.stroke && lf.stroke.alpha > 0 && lf.sw > 0) {
      strokeMask(lf.polys, lf.sw / 2);
      blend(lf.stroke, 1);
    }
  }
  let wc = 0, wx = 0, wy = 0, cc = 0, cxs = 0, cys = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const w = Math.abs(grid[k]! - bgL) / 100;
      wc += w;
      wx += w * cx(i);
      wy += w * cy(j);
      const c = cov[k]!;
      cc += c;
      cxs += c * cx(i);
      cys += c * cy(j);
    }
  const area = cell * cell;
  // Ink that barely contrasts with the background (white mark on a transparent artboard): use coverage instead.
  if (wc > 0.05 * cc && wc > 0) return { mass: [wx / wc, wy / wc], ink: wc * area };
  if (cc > 0) return { mass: [cxs / cc, cys / cc], ink: cc * area };
  return { mass: centreOf(box), ink: 0 };
}

function measurePart(doc: DocT, ids: string[], bgL: number, tm: TypeMetricsFn | undefined, onEstimate: () => void): PartGeom | null {
  const leaves = ids.flatMap((id) => collectLeaves(doc, id, tm, onEstimate));
  const boxes: LockupBox[] = [];
  for (const lf of leaves) {
    const b = boxOfPts(lf.polys.flatMap((p) => p.pts));
    if (!b) continue;
    const o = lf.sw / 2;
    boxes.push({ x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o });
  }
  const box = unionBox(boxes);
  if (!box || (box.w <= 0 && box.h <= 0)) return null;
  const { mass, ink } = rasterMass(leaves, box, bgL);
  // Stroke weight: explicit strokes when they carry the drawing, else stem width ≈ 2·area / perimeter.
  let strokeLen = 0, strokeW = 0, fillPer = 0;
  for (const lf of leaves) {
    const per = lf.polys.reduce((a, p) => a + polyPerimeter(p), 0);
    if (lf.stroke && lf.sw > 0) {
      strokeLen += per;
      strokeW += per * lf.sw;
    }
    if (lf.fill) fillPer += per;
  }
  let stroke: number | null = null;
  let strokeExplicit = false;
  if (strokeLen > 0 && (fillPer === 0 || strokeW > 0.3 * ink)) {
    stroke = strokeW / strokeLen;
    strokeExplicit = true;
  } else if (fillPer > 0 && ink > 0) stroke = (2 * ink) / fillPer;
  return { ids, box, mass, ink, stroke, strokeExplicit };
}

// ---------------------------------------------------------------- parts

/** Letters of a lettering group are paths named by their character. */
function isLetteringGroup(doc: DocT, n: NodeT): boolean {
  if (n.type !== "group") return false;
  const kids = n.children.map((c) => doc.nodes[c]).filter((c): c is NodeT => !!c && (c.type === "path" || c.type === "shape"));
  if (kids.length < 2) return false;
  const named = kids.filter((k) => /^\S{1,2}$/u.test(k.name.trim()));
  return named.length >= Math.max(2, kids.length * 0.6);
}

/** A text layer, a lettering group, or a group holding only type. */
export function isTypeNode(doc: DocT, id: string): boolean {
  const n = doc.nodes[id];
  if (!n) return false;
  if (n.type === "text") return true;
  if (n.type !== "group") return false;
  if (isLetteringGroup(doc, n)) return true;
  const kids = n.children.map((c) => doc.nodes[c]).filter((c): c is NodeT => !!c && c.type !== "sketch" && c.type !== "reference");
  return kids.length > 0 && kids.every((k) => isTypeNode(doc, k.id));
}

const MARK_NAME = /^(icon|mark|logo-?mark|symbol|isotype|emblem|monogram|glyph|badge|pictogram|logo-?symbol)\b/i;
const TYPE_NAME = /^(word-?mark|logotype|word|text|name|brand-?name|type|lettering|title|tagline|slogan)\b/i;

/** Background-like layer: covers (almost) the whole artboard. */
function isBackdrop(doc: DocT, id: string): boolean {
  const n = doc.nodes[id];
  if (!n || (n.type !== "shape" && n.type !== "path")) return false;
  const leaves = collectLeaves(doc, id, undefined, () => {});
  const b = boxOfPts(leaves.flatMap((l) => l.polys.flatMap((p) => p.pts)));
  if (!b) return false;
  const W = doc.artboard.width, H = doc.artboard.height;
  const ix = Math.max(0, Math.min(b.x + b.w, W) - Math.max(b.x, 0));
  const iy = Math.max(0, Math.min(b.y + b.h, H) - Math.max(b.y, 0));
  return (ix * iy) / (W * H) >= 0.9;
}

/**
 * Find the mark and the wordmark of a version. With a selection (mark + text selected),
 * type layers become the wordmark and the rest the mark. Otherwise layers named
 * icon/mark/symbol… and wordmark/logotype/text… win, then type vs non-type. A single
 * wrapper group (e.g. "logo") is looked into. Backdrops, sketches and references are ignored.
 */
export function detectLockupParts(doc: DocT, frameId: string, selection?: string[]): LockupParts {
  const pdoc = frameDoc(doc, frameId);
  const usable = (id: string) => {
    const n = pdoc.nodes[id];
    return !!n && n.type !== "sketch" && n.type !== "reference" && n.type !== "frame" && !isBackdrop(pdoc, id);
  };
  const sel = (selection ?? []).filter((id) => pdoc.nodes[id] && usable(id));
  // Keep only top-most selected layers.
  const topSel = sel.filter((id) => {
    for (let p = pdoc.nodes[id]!.parent; p; p = pdoc.nodes[p]?.parent ?? null) if (sel.includes(p)) return false;
    return true;
  });
  if (topSel.length >= 2) {
    const wordmark = topSel.filter((id) => isTypeNode(pdoc, id));
    const mark = topSel.filter((id) => !isTypeNode(pdoc, id));
    if (wordmark.length && mark.length) return { mark, wordmark, source: "selection" };
  }
  const one = topSel.length === 1 ? pdoc.nodes[topSel[0]!] : undefined;
  if (one?.type === "group" && !isTypeNode(pdoc, one.id)) {
    // A selected logo group: use it only if both parts are inside.
    const inner = detectIn(pdoc, [...one.children], usable);
    if (inner.mark.length && inner.wordmark.length) return inner;
  }
  return detectIn(pdoc, [...pdoc.root], usable);
}

function detectIn(pdoc: DocT, start: string[], usable: (id: string) => boolean): LockupParts {
  let level = start;
  const pick = (visibleOnly: boolean) => level.filter((id) => usable(id) && (!visibleOnly || pdoc.nodes[id]!.visible));
  let cands = pick(true);
  for (let guard = 0; guard < 6 && cands.length === 1; guard++) {
    const only = pdoc.nodes[cands[0]!]!;
    if (only.type !== "group" || isTypeNode(pdoc, only.id) || MARK_NAME.test(only.name)) break;
    level = [...only.children];
    cands = pick(true);
  }
  const split = (ids: string[]) => {
    const named = { mark: ids.filter((id) => MARK_NAME.test(pdoc.nodes[id]!.name.trim())), word: ids.filter((id) => TYPE_NAME.test(pdoc.nodes[id]!.name.trim()) && !MARK_NAME.test(pdoc.nodes[id]!.name.trim())) };
    const rest = ids.filter((id) => !named.mark.includes(id) && !named.word.includes(id));
    return {
      mark: [...named.mark, ...rest.filter((id) => !isTypeNode(pdoc, id))],
      wordmark: [...named.word, ...rest.filter((id) => isTypeNode(pdoc, id))],
      named: named.mark.length > 0 || named.word.length > 0,
    };
  };
  const vis = split(cands);
  // A part hidden by a wordmark-only / icon-only lockup still belongs to the logo.
  if (!vis.mark.length || !vis.wordmark.length) {
    const hidden = split(pick(false).filter((id) => !cands.includes(id)));
    if (!vis.mark.length) vis.mark = hidden.mark;
    if (!vis.wordmark.length) vis.wordmark = hidden.wordmark;
  }
  return { mark: vis.mark, wordmark: vis.wordmark, source: vis.named ? "names" : "auto" };
}

// ---------------------------------------------------------------- type metrics

interface TypeLine {
  id: string;
  capHeight: number;
  xHeight: number;
  baseline: number;
  lowercase: boolean;
  source: TypeGeom["source"];
}

const FLAT_TOP = new Set("BDEFHIKLMNPRTUVWXYZ".split(""));
const FLAT_BASE = new Set("BDEFHIKLMNPRTXZhiklmnrxz".split(""));
const X_TOP = ["xzvwuy", "mnr"];
const DESCENDERS = new Set("gjpqy".split(""));
const ASCENDERS = new Set("bdhkl".split(""));

function caseOf(s: string) {
  return { upper: /\p{Lu}/u.test(s), lower: /\p{Ll}/u.test(s) };
}

function textLine(doc: DocT, n: TextNodeT, tm: TypeMetricsFn | undefined): TypeLine {
  const m = worldMatrix(doc, n.id);
  const t = tm?.(n) ?? null;
  const vs = Math.hypot(m[2], m[3]) || 1;
  const c = caseOf(n.text);
  return {
    id: n.id,
    capHeight: (t?.capHeight ?? n.fontSize * 0.7) * vs,
    xHeight: (t?.xHeight ?? n.fontSize * 0.5) * vs,
    baseline: apply(m, 0, 0)[1],
    lowercase: c.lower && !c.upper,
    source: t ? "glyphs" : "font-size",
  };
}

function letteringLine(doc: DocT, g: Extract<NodeT, { type: "group" }>): TypeLine | null {
  const letters: { ch: string; top: number; bottom: number }[] = [];
  for (const cid of g.children) {
    const c = doc.nodes[cid];
    if (!c || !c.visible || (c.type !== "path" && c.type !== "shape")) continue;
    const b = pathDataBounds(c.type === "path" ? c.d : shapeToPath(c));
    if (!b) continue;
    const m = worldMatrix(doc, cid);
    const wb = boxOfPts([apply(m, b.x0, b.y0), apply(m, b.x1, b.y0), apply(m, b.x1, b.y1), apply(m, b.x0, b.y1)])!;
    letters.push({ ch: c.name.trim(), top: wb.y, bottom: wb.y + wb.h });
  }
  if (letters.length < 2) return null;
  const flatBase = letters.filter((l) => FLAT_BASE.has(l.ch));
  const noDesc = letters.filter((l) => !DESCENDERS.has(l.ch));
  const baseline = median((flatBase.length ? flatBase : noDesc.length ? noDesc : letters).map((l) => l.bottom));
  const caps = letters.filter((l) => FLAT_TOP.has(l.ch));
  let xHeight = NaN;
  for (const set of X_TOP) {
    const xs = letters.filter((l) => set.includes(l.ch));
    if (xs.length) {
      xHeight = baseline - median(xs.map((l) => l.top));
      break;
    }
  }
  let capHeight = caps.length ? baseline - median(caps.map((l) => l.top)) : NaN;
  if (!Number.isFinite(capHeight)) {
    const asc = letters.filter((l) => ASCENDERS.has(l.ch));
    capHeight = asc.length ? (baseline - median(asc.map((l) => l.top))) * 0.96 : Number.isFinite(xHeight) ? xHeight / 0.7 : baseline - median(letters.map((l) => l.top));
  }
  if (!Number.isFinite(xHeight)) xHeight = capHeight * 0.7;
  const c = caseOf(letters.map((l) => l.ch).join(""));
  return { id: g.id, capHeight, xHeight, baseline, lowercase: c.lower && !c.upper, source: "letters" };
}

function typeLines(doc: DocT, id: string, tm: TypeMetricsFn | undefined): TypeLine[] {
  const n = doc.nodes[id];
  if (!n || n.type === "sketch" || n.type === "reference") return [];
  if (n.type === "text") return n.text.trim() ? [textLine(doc, n, tm)] : [];
  if (n.type !== "group") return [];
  if (isLetteringGroup(doc, n)) {
    const l = letteringLine(doc, n);
    return l ? [l] : [];
  }
  return n.children.flatMap((c) => (doc.nodes[c]?.visible ? typeLines(doc, c, tm) : []));
}

function measureType(doc: DocT, ids: string[], bgL: number, tm: TypeMetricsFn | undefined, onEstimate: () => void): TypeGeom | null {
  const g = measurePart(doc, ids, bgL, tm, onEstimate);
  if (!g) return null;
  const lines = ids.flatMap((id) => typeLines(doc, id, tm));
  const primary = lines.reduce<TypeLine | null>((a, l) => (!a || l.capHeight > a.capHeight ? l : a), null);
  if (!primary) {
    // Outlined wordmark without letter names: treat the ink height as the cap height.
    return { ...g, primary: ids[0]!, capHeight: g.box.h, xHeight: g.box.h * 0.7, baseline: g.box.y + g.box.h, lowercase: false, lines: 1, source: "bounds" };
  }
  return { ...g, primary: primary.id, capHeight: primary.capHeight, xHeight: primary.xHeight, baseline: primary.baseline, lowercase: primary.lowercase, lines: Math.max(1, lines.length), source: primary.source };
}

// ---------------------------------------------------------------- measure

interface Measured {
  pdoc: DocT;
  frame: FrameNodeT;
  parts: LockupParts;
  mark: PartGeom | null;
  type: TypeGeom | null;
  markVisible: boolean;
  typeVisible: boolean;
  exact: boolean;
  notes: string[];
}

function measure(doc: DocT, frameId: string, parts: LockupParts, tm: TypeMetricsFn | undefined): Measured {
  const frame = doc.nodes[frameId];
  if (!frame || frame.type !== "frame") throw new Error(`${frameId} is not a version (frame)`);
  const pdoc = frameDoc(doc, frameId);
  const bg = frame.background ? lightnessOf(frame.background) : null;
  const bgL = bg ? bg.L : 100;
  let estimated = false;
  const onEstimate = () => (estimated = true);
  const live = (ids: string[]) => ids.filter((id) => pdoc.nodes[id]);
  const p: LockupParts = { ...parts, mark: live(parts.mark), wordmark: live(parts.wordmark) };
  const mark = p.mark.length ? measurePart(pdoc, p.mark, bgL, tm, onEstimate) : null;
  const type = p.wordmark.length ? measureType(pdoc, p.wordmark, bgL, tm, onEstimate) : null;
  const notes: string[] = [];
  const exact = !!type && type.source === "glyphs" && !estimated;
  if (type && type.source === "font-size") notes.push("Type metrics are estimated from the font size (cap height ≈ 0.7 em) — open the studio for exact glyph metrics.");
  else if (type && type.source === "letters") notes.push("Type metrics are measured on the lettering's letters.");
  else if (type && type.source === "bounds") notes.push("The wordmark has no live text or named letters: its ink height is used as the cap height.");
  else if (estimated) notes.push("Some text has no outlines yet: its ink is estimated from the font size.");
  return {
    pdoc,
    frame,
    parts: p,
    mark,
    type,
    markVisible: p.mark.some((id) => visibleChain(pdoc, id)),
    typeVisible: p.wordmark.some((id) => visibleChain(pdoc, id)),
    exact,
    notes,
  };
}

function detectArrangement(m: PartGeom | null, t: TypeGeom | null, mv: boolean, tv: boolean): LockupMetrics["arrangement"] {
  const M = mv ? m : null;
  const T = tv ? t : null;
  if (M && !T) return "icon-only";
  if (T && !M) return "wordmark-only";
  if (!M || !T) return "none";
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  const oy = ov(M.box.y, M.box.y + M.box.h, T.box.y, T.box.y + T.box.h);
  const ox = ov(M.box.x, M.box.x + M.box.w, T.box.x, T.box.x + T.box.w);
  if (ox <= 0 && oy > 0.3 * Math.min(M.box.h, T.box.h)) return M.box.x < T.box.x ? "horizontal" : "mark-right";
  if (oy <= 0 && ox > 0.3 * Math.min(M.box.w, T.box.w) && M.box.y < T.box.y) return "stacked";
  return "custom";
}

function clearUnitValue(unit: ClearSpaceUnit, mark: { box: LockupBox } | null, type: { capHeight: number; xHeight: number } | null): { unit: ClearSpaceUnit; value: number } | null {
  if (unit === "mark" && mark) return { unit, value: mark.box.h };
  if (unit === "x" && type) return { unit, value: type.xHeight };
  if (unit === "cap" && type) return { unit, value: type.capHeight };
  if (type) return { unit: "cap", value: type.capHeight };
  if (mark) return { unit: "mark", value: mark.box.h };
  return null;
}

/** Numbers to balance a lockup by: ratio, gap, alignment, centring, clear space and minimum size. */
export function lockupMetrics(
  doc: DocT,
  frameId: string,
  o: { parts?: LockupParts; selection?: string[]; typeMetrics?: TypeMetricsFn; clearSpace?: { unit: ClearSpaceUnit; amount?: number } } = {},
): LockupMetrics {
  const parts = o.parts ?? detectLockupParts(doc, frameId, o.selection);
  const m = measure(doc, frameId, parts, o.typeMetrics);
  const { mark, type, frame } = m;
  const arrangement = detectArrangement(mark, type, m.markVisible, m.typeVisible);
  const both = mark && type;
  const ratio = both ? mark.box.h / type.capHeight : null;
  let gap: number | null = null;
  let align: LockupMetrics["align"] = null;
  let stackOffset: number | null = null;
  if (both && (arrangement === "horizontal" || arrangement === "mark-right")) {
    gap = arrangement === "horizontal" ? type.box.x - (mark.box.x + mark.box.w) : mark.box.x - (type.box.x + type.box.w);
    const cap = type.capHeight;
    const opt = visualCentreOf(mark)[1];
    const band = type.lines > 1 ? type.box.y + type.box.h / 2 : type.baseline - (type.lowercase ? type.xHeight : cap) / 2;
    const a = {
      optical: (opt - band) / cap,
      cap: (mark.box.y + mark.box.h / 2 - (type.baseline - cap / 2)) / cap,
      baseline: (mark.box.y + mark.box.h - type.baseline) / cap,
    };
    const closest = (Object.keys(a) as LockupAlign[]).reduce((x, k) => (Math.abs(a[k]) < Math.abs(a[x]) ? k : x), "optical" as LockupAlign);
    align = { optical: r3(a.optical), cap: r3(a.cap), baseline: r3(a.baseline), closest };
  } else if (both && arrangement === "stacked") {
    gap = type.box.y - (mark.box.y + mark.box.h);
    stackOffset = r3((visualCentreOf(mark)[0] - (type.box.x + type.box.w / 2)) / type.capHeight);
  }
  const visible: PartGeom[] = [];
  if (mark && m.markVisible) visible.push(mark);
  if (type && m.typeVisible) visible.push(type);
  const bounds = unionBox(visible.map((g) => g.box));
  const W = frame.width, H = frame.height;
  let visualCentre: P | null = null;
  let centreOffset: LockupMetrics["centreOffset"] = null;
  if (bounds) {
    visualCentre = lockupVisualCentre(visible);
    const bc = centreOf(bounds);
    centreOffset = { optical: [r2(visualCentre[0] - W / 2), r2(visualCentre[1] - H / 2)], bbox: [r2(bc[0] - W / 2), r2(bc[1] - H / 2)] };
  }
  let clearSpace: LockupMetrics["clearSpace"] = null;
  const want = o.clearSpace?.unit ?? (type ? "cap" : "mark");
  const cu = clearUnitValue(want, mark, type);
  if (cu && bounds) {
    const amount = o.clearSpace?.amount ?? CLEAR_SPACE_DEFAULT[cu.unit];
    const value = cu.value * amount;
    const margins = { left: bounds.x, right: W - (bounds.x + bounds.w), top: bounds.y, bottom: H - (bounds.y + bounds.h) };
    clearSpace = {
      unit: cu.unit,
      amount,
      value: r2(value),
      margins: { left: r2(margins.left), right: r2(margins.right), top: r2(margins.top), bottom: r2(margins.bottom) },
      ok: Math.min(margins.left, margins.right, margins.top, margins.bottom) >= value - 0.5,
    };
  }
  let minSize: LockupMetrics["minSize"] = null;
  if (bounds && bounds.w > 0) {
    const cands: { px: number; mm: number; limitedBy: "cap height" | "stroke" | "icon" }[] = [];
    if (type && m.typeVisible) cands.push({ px: (bounds.w * MIN_SIZE_RULES.capPx) / type.capHeight, mm: (bounds.w * MIN_SIZE_RULES.capMm) / type.capHeight, limitedBy: "cap height" });
    if (mark && m.markVisible && mark.stroke && mark.stroke > 0)
      cands.push({ px: (bounds.w * MIN_SIZE_RULES.strokePx) / mark.stroke, mm: (bounds.w * MIN_SIZE_RULES.strokeMm) / mark.stroke, limitedBy: "stroke" });
    if (mark && m.markVisible && !(type && m.typeVisible)) cands.push({ px: (bounds.w * MIN_SIZE_RULES.iconPx) / Math.max(bounds.w, bounds.h), mm: 0, limitedBy: "icon" });
    const best = cands.reduce<(typeof cands)[number] | null>((a, c) => (!a || c.px > a.px ? c : a), null);
    if (best) minSize = { px: Math.ceil(best.px), mm: Math.round(Math.max(...cands.map((c) => c.mm)) * 10) / 10, limitedBy: best.limitedBy };
  }
  const notes = [...m.notes];
  if (!mark) notes.push("No mark found — name the symbol layer \"icon\" (or select the mark and the text together).");
  if (!type) notes.push("No wordmark found — add a text layer (or select the mark and the text together).");
  return {
    frame: { id: frame.id, name: frame.name, width: W, height: H },
    parts: m.parts,
    mark,
    type,
    markVisible: m.markVisible,
    typeVisible: m.typeVisible,
    arrangement,
    ratio: ratio === null ? null : r3(ratio),
    gap: gap === null ? null : r2(gap),
    gapCap: gap === null || !type ? null : r3(gap / type.capHeight),
    gapStroke: gap === null || !mark?.stroke ? null : r3(gap / mark.stroke),
    align,
    stackOffset,
    bounds,
    visualCentre,
    centreOffset,
    clearSpace,
    minSize,
    exact: m.exact,
    notes,
  };
}

/** Visual centre of several parts together: box centre pulled toward their combined ink mass (damped). */
function lockupVisualCentre(parts: Pick<PartGeom, "box" | "mass" | "ink">[]): P {
  const b = unionBox(parts.map((p) => p.box))!;
  const ink = parts.reduce((a, p) => a + p.ink, 0);
  const mass: P = ink > 0 ? [parts.reduce((a, p) => a + p.mass[0] * p.ink, 0) / ink, parts.reduce((a, p) => a + p.mass[1] * p.ink, 0) / ink] : centreOf(b);
  return visualCentreOf({ box: b, mass }, OPTICAL_WEIGHT.lockupX, OPTICAL_WEIGHT.lockupY);
}

// ---------------------------------------------------------------- plan

/** A part after a uniform scale s about the origin and a translation t. */
interface Placed {
  s: number;
  t: P;
}
const scaleBox = (b: LockupBox, s: number, t: P = [0, 0]): LockupBox => ({ x: b.x * s + t[0], y: b.y * s + t[1], w: b.w * s, h: b.h * s });
const scaleP = (p: P, s: number, t: P = [0, 0]): P => [p[0] * s + t[0], p[1] * s + t[1]];

/** Default ratio / gap for an arrangement: keep the current value when it is in a sensible range. */
function defaults(arr: LockupArrangement, cur: LockupMetrics) {
  const R = arr === "stacked" ? LOCKUP_RANGES.stacked : LOCKUP_RANGES.horizontal;
  // Horizontal and stacked want different proportions: switching family starts from that family's default.
  const family = (a: string) => (a === "stacked" ? "stacked" : a === "horizontal" || a === "mark-right" ? "row" : "other");
  const sameFamily = family(cur.arrangement) === family(arr);
  const ratio = cur.ratio !== null && sameFamily ? clamp(cur.ratio, R.ratio.min, R.ratio.max) : R.ratio.default;
  const same = cur.arrangement === arr;
  const gap = same && cur.gapCap !== null && cur.gapCap > 0.05 && cur.gapCap < 4 ? cur.gapCap : R.gap.default;
  return { ratio, gap };
}

/**
 * Plan a lockup for one version: the mark is scaled to `ratio` × cap height, placed at `gap`
 * from the wordmark, aligned, and the whole lockup is centred on the artboard (optically by
 * default). Returns update ops (one undo step when dispatched together) and full patches
 * for live previews.
 */
export function planLockup(doc: DocT, frameId: string, parts: LockupParts, opts: LockupOptions, tm?: TypeMetricsFn): LockupPlan {
  const cur = lockupMetrics(doc, frameId, { parts, typeMetrics: tm, clearSpace: opts.clearSpace });
  const { mark, type } = cur;
  const arr = opts.arrangement;
  const pdoc = frameDoc(doc, frameId);
  const W = cur.frame.width, H = cur.frame.height;
  const notes: string[] = [];
  const needMark = arr !== "wordmark-only";
  const needType = arr !== "icon-only";
  if (needMark && !mark) throw new Error("No mark found in this version — name the symbol layer \"icon\", or select the mark and the text together.");
  if (needType && !type) throw new Error("No wordmark found in this version — add a text layer, or select the mark and the text together.");
  const fixed = opts.fixed ?? null;
  if ((fixed === "mark" && !needMark) || (fixed === "wordmark" && !needType))
    throw new Error(`The ${fixed} is locked, so it can't be hidden for a ${LOCKUP_LABELS[arr].toLowerCase()} lockup.`);
  const keepSize = fixed ?? opts.keepSize ?? "wordmark";
  const align = opts.align ?? "optical";
  const centre = opts.centre ?? "optical";
  const gapUnit = opts.gapUnit ?? "cap";
  let fit = opts.fit ?? "shrink";
  if (fixed && fit !== "none") {
    notes.push(`The ${fixed} is locked, so the lockup is built around it (not re-centred or resized).`);
    fit = "none";
  }
  const two = needMark && needType;
  const d = two ? defaults(arr, cur) : { ratio: 0, gap: 0 };
  const ratio = two ? Math.max(0.05, opts.ratio ?? d.ratio) : null;
  let gapIn = two ? Math.max(0, opts.gap ?? (gapUnit === "stroke" && mark?.stroke && type ? (d.gap * type.capHeight) / mark.stroke : d.gap)) : 0;
  if (two && gapUnit === "stroke" && !mark!.stroke) {
    notes.push("The mark has no measurable stroke: the gap uses cap heights.");
    gapIn = opts.gap ?? d.gap;
  }

  // Base scales from the ratio.
  let sM = 1, sT = 1;
  if (two) {
    const want = ratio! * type!.capHeight;
    if (keepSize === "mark") sT = mark!.box.h / want;
    else sM = want / mark!.box.h;
  }

  const layout = (k: number) => {
    const sm = sM * k, st = sT * k;
    const pm: Placed = { s: sm, t: [0, 0] };
    const pt: Placed = { s: st, t: [0, 0] };
    if (two) {
      const M = scaleBox(mark!.box, sm);
      const T = scaleBox(type!.box, st);
      const cap = type!.capHeight * st;
      const xh = type!.xHeight * st;
      const base = type!.baseline * st;
      const stroke = (mark!.stroke ?? 0) * sm;
      const gap = gapIn * (gapUnit === "stroke" && mark!.stroke ? stroke : cap);
      const opt = scaleP(visualCentreOf(mark!), sm);
      if (arr === "horizontal" || arr === "mark-right") {
        pt.t = [0, -base];
        const Tb = scaleBox(type!.box, st, pt.t);
        const markLeft = arr === "horizontal" ? 0 : T.w + gap;
        const typeLeft = arr === "horizontal" ? M.w + gap : 0;
        pt.t[0] = typeLeft - T.x;
        const band = type!.lines > 1 ? Tb.y + Tb.h / 2 : -(type!.lowercase ? xh : cap) / 2;
        const ty = align === "cap" ? -cap / 2 - (M.y + M.h / 2) : align === "baseline" ? -(M.y + M.h) : band - opt[1];
        pm.t = [markLeft - M.x, ty];
      } else {
        // Stacked: mark on top, optically centred over the wordmark.
        pm.t = [-opt[0], -M.y];
        pt.t = [-(T.x + T.w / 2), M.h + gap - T.y];
      }
    }
    return { pm, pt };
  };

  const geomAfter = (p: { pm: Placed; pt: Placed }) => {
    const out: Pick<PartGeom, "box" | "mass" | "ink">[] = [];
    if (needMark) out.push({ box: scaleBox(mark!.box, p.pm.s, p.pm.t), mass: scaleP(mark!.mass, p.pm.s, p.pm.t), ink: mark!.ink * p.pm.s * p.pm.s });
    if (needType) out.push({ box: scaleBox(type!.box, p.pt.s, p.pt.t), mass: scaleP(type!.mass, p.pt.s, p.pt.t), ink: type!.ink * p.pt.s * p.pt.s });
    return out;
  };
  const clearOf = (p: { pm: Placed; pt: Placed }) => {
    const unit = opts.clearSpace?.unit ?? (needType ? "cap" : "mark");
    const cu = clearUnitValue(unit, mark ? { box: scaleBox(mark.box, p.pm.s) } : null, type ? { capHeight: type.capHeight * p.pt.s, xHeight: type.xHeight * p.pt.s } : null);
    return cu ? cu.value * (opts.clearSpace?.amount ?? CLEAR_SPACE_DEFAULT[cu.unit]) : 0;
  };

  let placed = layout(1);
  if (fit === "shrink") {
    const b = unionBox(geomAfter(placed).map((g) => g.box))!;
    const cs = clearOf(placed);
    const k = Math.min(1, W / (b.w + 2 * cs), H / (b.h + 2 * cs));
    if (k < 0.999) {
      placed = layout(k);
      notes.push(`Scaled the lockup to ${Math.round(k * 100)}% so it keeps its clear space inside the ${W}×${H} artboard.`);
    }
  }

  // Global placement on the artboard.
  const after = geomAfter(placed);
  const bounds = unionBox(after.map((g) => g.box))!;
  let G: P = [0, 0];
  let frameSize: LockupPlan["frameSize"] = null;
  const keepPart = (which: "mark" | "wordmark"): P => {
    const g = which === "mark" ? mark! : type!;
    const p = which === "mark" ? placed.pm : placed.pt;
    return [g.box.x - (g.box.x * p.s + p.t[0]), g.box.y - (g.box.y * p.s + p.t[1])];
  };
  if (fixed) G = keepPart(fixed);
  else if (fit === "artboard") {
    const cs = clearOf(placed);
    const w = Math.max(16, Math.round(bounds.w + 2 * cs));
    const h = Math.max(16, Math.round(bounds.h + 2 * cs));
    frameSize = { width: w, height: h };
    G = [w / 2 - (bounds.x + bounds.w / 2), h / 2 - (bounds.y + bounds.h / 2)];
  } else if (centre === "optical") {
    const v = lockupVisualCentre(after);
    G = [W / 2 - v[0], H / 2 - v[1]];
  } else if (centre === "bbox") G = [W / 2 - (bounds.x + bounds.w / 2), H / 2 - (bounds.y + bounds.h / 2)];
  else G = keepPart(needType ? "wordmark" : "mark");
  if (!fixed && fit === "shrink" && centre !== "none") {
    // Optical centring never pushes the ink into the clear space.
    const cs = clearOf(placed);
    const keepIn = (pos: number, size: number, room: number) => (size + 2 * cs <= room + 1e-6 ? clamp(pos, cs, room - cs - size) : pos);
    G = [keepIn(bounds.x + G[0], bounds.w, W) - bounds.x, keepIn(bounds.y + G[1], bounds.h, H) - bounds.y];
  }

  // Patches and ops.
  const patches: Record<string, Partial<NodeT>> = {};
  const ops: OpT[] = [];
  const moveIds = (ids: string[], p: Placed) => {
    const s = p.s;
    const tx = p.t[0] + G[0], ty = p.t[1] + G[1];
    if (Math.abs(s - 1) < 1e-6 && Math.abs(tx) < 1e-4 && Math.abs(ty) < 1e-4) return;
    const A: Mat = [s, 0, 0, s, tx, ty];
    for (const id of ids) {
      const n = pdoc.nodes[id];
      if (!n) continue;
      const Pm = parentMatrixOf(pdoc, n);
      const Q = multiply(invert(Pm), multiply(A, Pm));
      const [x, y] = apply(Q, n.transform.x, n.transform.y);
      const patch: Record<string, unknown> = {};
      if (n.type === "text") {
        patch.transform = { ...n.transform, x: r3(x), y: r3(y) };
        if (Math.abs(s - 1) > 1e-6) {
          patch.fontSize = r3(n.fontSize * s);
          if (n.letterSpacing) patch.letterSpacing = r3(n.letterSpacing * s);
          if (n.style.strokeWidth) patch.style = { ...n.style, strokeWidth: r3(n.style.strokeWidth * s) };
        }
      } else {
        patch.transform = { ...n.transform, x: r3(x), y: r3(y), scaleX: r6(n.transform.scaleX * s), scaleY: r6(n.transform.scaleY * s) };
      }
      patches[id] = { ...(patches[id] ?? {}), ...patch } as Partial<NodeT>;
    }
  };
  if (needMark) moveIds(cur.parts.mark, placed.pm);
  if (needType) moveIds(cur.parts.wordmark, placed.pt);
  const show = (ids: string[]) => ids.forEach((id) => pdoc.nodes[id] && !pdoc.nodes[id]!.visible && (patches[id] = { ...(patches[id] ?? {}), visible: true } as Partial<NodeT>));
  const drop = (ids: string[]) => {
    for (const id of ids) {
      if (!pdoc.nodes[id]) continue;
      if (opts.drop === "remove") ops.push({ op: "remove", id });
      else if (pdoc.nodes[id]!.visible) patches[id] = { ...(patches[id] ?? {}), visible: false } as Partial<NodeT>;
    }
  };
  if (needMark) show(cur.parts.mark);
  else drop(cur.parts.mark);
  if (needType) show(cur.parts.wordmark);
  else drop(cur.parts.wordmark);
  const updates: OpT[] = Object.entries(patches).map(([id, set]) => ({ op: "update", id, set: set as Record<string, unknown> }));
  ops.unshift(...updates);
  if (frameSize) {
    ops.push({ op: "update", id: frameId, set: frameSize });
    // Backdrop rectangles follow the artboard.
    for (const id of pdoc.root) {
      const n = pdoc.nodes[id];
      if (n?.type === "shape" && n.shape === "rect" && !n.transform.rotation && isBackdrop(pdoc, id))
        ops.push({ op: "update", id, set: { transform: { ...n.transform, x: 0, y: 0, scaleX: 1, scaleY: 1 }, width: frameSize.width, height: frameSize.height } });
    }
  }
  if (cur.notes.length) notes.push(...cur.notes.filter((n) => n.startsWith("Type metrics are estimated")));
  return {
    ops,
    patches,
    frameSize,
    arrangement: arr,
    ratio: ratio === null ? null : r3(ratio),
    gap: two ? r3(gapUnit === "stroke" && mark!.stroke ? (gapIn * mark!.stroke * placed.pm.s) / (type!.capHeight * placed.pt.s) : gapIn) : null,
    gapValue: two ? r3(gapIn) : null,
    align,
    notes,
  };
}

// ---------------------------------------------------------------- versions

/** Unique version name: "V3 Horizontal", then "V3 Horizontal 2"… */
function uniqueName(doc: DocT, base: string): string {
  const used = new Set(Object.values(doc.nodes).filter((n) => n.type === "frame").map((n) => n.name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/**
 * Lay out several arrangements as new versions side by side (copies of the frame, named
 * "V3 Horizontal", "V3 Stacked"…), each fitted to its clear space. One batch of ops.
 */
export function lockupVersionsOps(
  doc: DocT,
  frameId: string,
  parts: LockupParts,
  arrangements: LockupArrangement[],
  opts: Omit<LockupOptions, "arrangement"> & { perArrangement?: Partial<Record<LockupArrangement, Partial<LockupOptions>>> } = {},
  tm?: TypeMetricsFn,
): { ops: OpT[]; frames: { id: string; name: string; arrangement: LockupArrangement }[]; notes: string[] } {
  const src = doc.nodes[frameId];
  if (!src || src.type !== "frame") throw new Error(`${frameId} is not a version (frame)`);
  let work = doc;
  const ops: OpT[] = [];
  const frames: { id: string; name: string; arrangement: LockupArrangement }[] = [];
  const notes = new Set<string>();
  const { perArrangement, ...base } = opts;
  for (const arr of arrangements) {
    // Fitted artboards are narrow: leave room for their name labels.
    const pos = nextFramePosition(work, 260);
    const map = new Map<string, string>();
    const name = uniqueName(work, `${src.name} ${LOCKUP_LABELS[arr]}`);
    const clone = cloneSubtreeOps(doc, frameId, {
      parent: null,
      patchRoot: { name, transform: { ...src.transform, x: pos.x, y: pos.y }, batch: null },
      idFor: (old) => {
        const id = newId(doc.nodes[old]!.type === "frame" ? "f" : "n");
        map.set(old, id);
        return id;
      },
    });
    work = applyOps(work, clone.ops).doc;
    ops.push(...clone.ops);
    const cp: LockupParts = { mark: parts.mark.map((id) => map.get(id)!).filter(Boolean), wordmark: parts.wordmark.map((id) => map.get(id)!).filter(Boolean), source: parts.source };
    const plan = planLockup(work, clone.rootId, cp, { fit: "artboard", drop: "remove", ...base, ...(perArrangement?.[arr] ?? {}), arrangement: arr }, tm);
    work = applyOps(work, plan.ops).doc;
    ops.push(...plan.ops);
    plan.notes.forEach((n) => notes.add(n));
    frames.push({ id: clone.rootId, name, arrangement: arr });
  }
  return { ops, frames, notes: [...notes] };
}

/** Resize a version's artboard to the lockup's clear space (content centred in it). */
export function fitArtboardToClearSpaceOps(doc: DocT, frameId: string, parts: LockupParts, clearSpace: { unit: ClearSpaceUnit; amount?: number }, tm?: TypeMetricsFn): OpT[] {
  const m = lockupMetrics(doc, frameId, { parts, typeMetrics: tm, clearSpace });
  if (!m.bounds || !m.clearSpace) throw new Error("Nothing to fit — this version has no mark or wordmark.");
  const cs = m.clearSpace.value;
  const w = Math.max(16, Math.round(m.bounds.w + 2 * cs));
  const h = Math.max(16, Math.round(m.bounds.h + 2 * cs));
  const dx = w / 2 - (m.bounds.x + m.bounds.w / 2);
  const dy = h / 2 - (m.bounds.y + m.bounds.h / 2);
  const pdoc = frameDoc(doc, frameId);
  const ops: OpT[] = [];
  for (const id of pdoc.root) {
    const n = pdoc.nodes[id]!;
    if (n.type === "shape" && n.shape === "rect" && !n.transform.rotation && isBackdrop(pdoc, id)) {
      ops.push({ op: "update", id, set: { transform: { ...n.transform, x: 0, y: 0, scaleX: 1, scaleY: 1 }, width: w, height: h } });
      continue;
    }
    ops.push({ op: "update", id, set: { transform: { ...n.transform, x: r3(n.transform.x + dx), y: r3(n.transform.y + dy) } } });
  }
  ops.push({ op: "update", id: frameId, set: { width: w, height: h } });
  return ops;
}

/** Short human summary of lockup metrics (for tool results and tooltips). */
export function lockupSummary(m: LockupMetrics): string {
  const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : String(Math.round(v * 10 ** d) / 10 ** d));
  const lines: string[] = [];
  const arrName = m.arrangement === "custom" ? "custom (parts overlap or are diagonal)" : m.arrangement === "none" ? "none" : LOCKUP_LABELS[m.arrangement].toLowerCase();
  lines.push(`Arrangement: ${arrName}.`);
  if (m.type) lines.push(`Type: cap height ${f(m.type.capHeight, 1)}, x-height ${f(m.type.xHeight, 1)}${m.type.lowercase ? " (lowercase word)" : ""}${m.exact ? " — measured on the font" : " — estimated"}.`);
  if (m.mark) lines.push(`Mark: ${f(m.mark.box.w, 1)}×${f(m.mark.box.h, 1)}${m.mark.stroke ? `, stroke ${f(m.mark.stroke, 1)}${m.mark.strokeExplicit ? "" : " (stem estimate)"}` : ""}.`);
  if (m.ratio !== null) lines.push(`Ratio: mark = ${f(m.ratio)} × cap height.`);
  if (m.gap !== null) lines.push(`Gap: ${f(m.gap, 1)} = ${f(m.gapCap)} × cap height${m.gapStroke !== null ? ` = ${f(m.gapStroke, 1)} × mark stroke` : ""}.`);
  if (m.align) lines.push(`Vertical alignment: closest to ${m.align.closest} (offsets in cap heights — optical ${f(m.align.optical, 3)}, cap-centre ${f(m.align.cap, 3)}, baseline ${f(m.align.baseline, 3)}; + = mark sits lower).`);
  if (m.stackOffset !== null) lines.push(`Stacked: mark's optical centre is ${f(m.stackOffset, 3)} cap heights ${m.stackOffset >= 0 ? "right" : "left"} of the wordmark centre.`);
  if (m.centreOffset) lines.push(`Centring: visual centre is ${f(m.centreOffset.optical[0], 1)}, ${f(m.centreOffset.optical[1], 1)} from the artboard centre (bbox ${f(m.centreOffset.bbox[0], 1)}, ${f(m.centreOffset.bbox[1], 1)}).`);
  if (m.clearSpace) {
    const c = m.clearSpace;
    lines.push(`Clear space: ${f(c.amount)} × ${CLEAR_SPACE_LABELS[c.unit]} = ${f(c.value, 1)}; margins L ${f(c.margins.left, 0)} R ${f(c.margins.right, 0)} T ${f(c.margins.top, 0)} B ${f(c.margins.bottom, 0)} — ${c.ok ? "respected" : "NOT respected (the artboard is tighter than the clear space)"}.`);
  }
  if (m.minSize) lines.push(`Minimum size: ${m.minSize.px} px wide on screen${m.minSize.mm ? `, ${m.minSize.mm} mm in print` : ""} (limited by ${m.minSize.limitedBy}).`);
  return lines.join("\n");
}

/** Advice by numbers (for agents): what is out of the usual range. */
export function lockupAdvice(m: LockupMetrics): string[] {
  const out: string[] = [];
  const R = m.arrangement === "stacked" ? LOCKUP_RANGES.stacked : LOCKUP_RANGES.horizontal;
  if (m.ratio !== null && (m.arrangement === "horizontal" || m.arrangement === "mark-right" || m.arrangement === "stacked")) {
    if (m.ratio < R.ratio.min) out.push(`The mark is small for a ${m.arrangement} lockup (${m.ratio} × cap; usual ${R.ratio.min}–${R.ratio.max}).`);
    if (m.ratio > R.ratio.max) out.push(`The mark is large for a ${m.arrangement} lockup (${m.ratio} × cap; usual ${R.ratio.min}–${R.ratio.max}).`);
  }
  if (m.gapCap !== null) {
    if (m.gapCap < R.gap.min) out.push(`The gap is tight (${m.gapCap} × cap; usual ${R.gap.min}–${R.gap.max}).`);
    if (m.gapCap > R.gap.max) out.push(`The gap is loose (${m.gapCap} × cap; usual ${R.gap.min}–${R.gap.max}).`);
  }
  if (m.align && Math.min(Math.abs(m.align.optical), Math.abs(m.align.cap), Math.abs(m.align.baseline)) > 0.06)
    out.push(`The mark is not aligned to the type (nearest: ${m.align.closest}, off by ${Math.abs(m.align[m.align.closest])} cap).`);
  if (m.stackOffset !== null && Math.abs(m.stackOffset) > 0.05) out.push(`The mark is off-centre over the wordmark by ${m.stackOffset} cap.`);
  const off = (p: P) => Math.abs(p[0]) > m.frame.width * 0.01 || Math.abs(p[1]) > m.frame.height * 0.01;
  // A box-centred lockup (e.g. an artboard fitted to its clear space) is a deliberate choice too.
  if (m.centreOffset && m.frame.width && off(m.centreOffset.optical) && off(m.centreOffset.bbox))
    out.push("The lockup is centred neither optically nor by its box on the artboard.");
  if (m.clearSpace && !m.clearSpace.ok) out.push("The artboard cuts into the clear space.");
  return out;
}
