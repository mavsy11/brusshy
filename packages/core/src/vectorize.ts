import type { DocT } from "./schema";
import type { OpT } from "./ops";
import { newId } from "./ids";

/**
 * Offline vectorizer: raster pixels → clean vector paths. Pure TypeScript, deterministic
 * and DOM-free, so the studio (live preview in a worker) and the MCP server (pixels decoded
 * locally) produce the same result. Nothing leaves the machine.
 *
 * Pipeline
 *   resample → masks (threshold on "ink" or k-means color layers) → despeckle →
 *   shapes: boundary tracing → corner-aware smoothing → least-squares cubic fitting
 *   lines:  thinning → stroke graph (spur pruning, straight-through joins) → cubic fitting
 */

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: ArrayLike<number>;
}

export type VectorizeMode = "shapes" | "lines";

export interface VectorizeOptions {
  /** "shapes" = filled regions (logos, silhouettes); "lines" = centerline strokes (pencil sketches). */
  mode?: VectorizeMode;
  /** Number of colors to separate (1–6, posterized). */
  colors?: number;
  /** 0–1 cut-off on "ink" (distance from the paper); lower picks up fainter marks. null = automatic. */
  threshold?: number | null;
  /** 0–1: higher = rounder, calmer curves and fewer corners. */
  smoothing?: number;
  /** 0–1: higher = more nodes, follows the image more closely. */
  detail?: number;
  /** 0–1: ignore specks (and fill pinholes) up to this size. */
  specks?: number;
  /** Flatten uneven lighting (photos of paper). Default: on for lines, off for shapes. */
  evenLighting?: boolean;
  /** Output coordinate size (e.g. the reference node's width × height). Default: image pixels. */
  target?: { width: number; height: number };
}

export interface VectorPart {
  d: string;
  nodes: number;
}

export interface VectorLayer {
  color: string;
  kind: "fill" | "stroke";
  /** Stroke width in output units (0 for fills). */
  strokeWidth: number;
  parts: VectorPart[];
}

export interface VectorizeResult {
  /** Output coordinate space. */
  width: number;
  height: number;
  /** Bottom to top. */
  layers: VectorLayer[];
  /** Threshold actually used (auto or given), when the mode thresholds. */
  threshold: number | null;
  /** Detected paper / background color. */
  background: string;
  stats: { parts: number; nodes: number; workWidth: number; workHeight: number; ms: number };
}

export const VECTORIZE_DEFAULTS = {
  mode: "shapes" as VectorizeMode,
  colors: 1,
  threshold: null as number | null,
  smoothing: 0.5,
  detail: 0.5,
  specks: 0.25,
};

type Resolved = Required<Omit<VectorizeOptions, "target" | "threshold">> & { threshold: number | null };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function resolveVectorizeOptions(o: VectorizeOptions = {}): Resolved {
  const mode: VectorizeMode = o.mode === "lines" ? "lines" : "shapes";
  return {
    mode,
    colors: Math.max(1, Math.min(6, Math.round(num(o.colors, 1)))),
    threshold: o.threshold === null || o.threshold === undefined ? null : clamp01(o.threshold),
    smoothing: clamp01(num(o.smoothing, VECTORIZE_DEFAULTS.smoothing)),
    detail: clamp01(num(o.detail, VECTORIZE_DEFAULTS.detail)),
    specks: clamp01(num(o.specks, VECTORIZE_DEFAULTS.specks)),
    evenLighting: o.evenLighting ?? mode === "lines",
  };
}

/** Longest side the tracer works at for a detail level (inputs are box-filtered down to it). */
export const vectorizeWorkingSide = (detail: number) => Math.round(500 + clamp01(detail) * 1500);

/* ------------------------------------------------------------------------------------------ */
/* entry point                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export function vectorize(img: RasterImage, options: VectorizeOptions = {}): VectorizeResult {
  const t0 = Date.now();
  const o = resolveVectorizeOptions(options);
  const { w, h, px } = resample(img, vectorizeWorkingSide(o.detail));
  const N = w * h;
  const tw = options.target?.width ?? img.width;
  const th = options.target?.height ?? img.height;
  const sx = tw / w;
  const sy = th / h;

  // Composite over white; alpha kept separately.
  const R = new Float32Array(N);
  const G = new Float32Array(N);
  const B = new Float32Array(N);
  const A = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const a = px[p * 4 + 3]! / 255;
    A[p] = a;
    R[p] = px[p * 4]! * a + 255 * (1 - a);
    G[p] = px[p * 4 + 1]! * a + 255 * (1 - a);
    B[p] = px[p * 4 + 2]! * a + 255 * (1 - a);
  }
  const bg = detectBackground(R, G, B, A, w, h);
  const minArea = Math.max(2, Math.round(o.specks * o.specks * 0.002 * N));

  const masks: { mask: Uint8Array; color: string; field?: { v: Float32Array; t: number } }[] = [];
  let usedThreshold: number | null = null;

  if (o.colors === 1) {
    const v = inkMap(R, G, B, A, w, h, bg, o);
    const blurR = o.smoothing >= 0.67 ? 2 : o.smoothing >= 0.2 ? 1 : 0;
    if (blurR) boxBlur(v, w, h, blurR);
    const t = o.threshold ?? clamp(otsu(v), 0.1, 0.8);
    usedThreshold = t;
    const mask = new Uint8Array(N);
    let cr = 0;
    let cg = 0;
    let cb = 0;
    let cw = 0;
    for (let p = 0; p < N; p++) {
      if (v[p]! >= t) {
        mask[p] = 1;
        const wgt = v[p]! ** 4;
        cr += R[p]! * wgt;
        cg += G[p]! * wgt;
        cb += B[p]! * wgt;
        cw += wgt;
      }
    }
    let color = cw ? niceColor(cr / cw, cg / cw, cb / cw) : "#0b0c0e";
    if (o.mode === "lines" && cw && chroma(cr / cw, cg / cw, cb / cw) < 0.05) color = "#0b0c0e";
    if (bg.transparent && cw === 0) color = "#0b0c0e";
    // Edges sit where coverage is 50%: halfway between paper (0) and the typical ink level.
    const hist = new Uint32Array(256);
    let count = 0;
    for (let q = 0; q < N; q++) if (mask[q]) hist[Math.min(255, (v[q]! * 255) | 0)]++, count++;
    let acc = 0;
    let med = 255;
    for (let i = 0; i < 256; i++) if ((acc += hist[i]!) >= count / 2) {
      med = i;
      break;
    }
    masks.push({ mask, color, field: { v, t: Math.max(0.05, (med + 0.5) / 255 / 2) } });
  } else {
    const layers = colorLayers(R, G, B, A, w, h, bg, o.colors, o.mode === "shapes");
    masks.push(...layers);
  }

  const layers: VectorLayer[] = [];
  const fitTol = lerp(0.8, 0.15, o.detail);
  const params: FitParams = {
    sigma: 0.8 + o.smoothing * 3,
    k: 4 + Math.round(o.smoothing * 3),
    cornerCos: Math.cos(((170 - 45 * o.smoothing) * Math.PI) / 180),
    err: fitTol * fitTol,
    farCorners: true,
    sx,
    sy,
  };
  // Skeleton points are noisier than sub-pixel edges: smooth more, fit looser, only sharp corners.
  const lineTol = lerp(1.6, 0.4, o.detail);
  const lineParams: FitParams = {
    ...params,
    sigma: 1.5 + o.smoothing * 3.5,
    cornerCos: Math.cos(((150 - 40 * o.smoothing) * Math.PI) / 180),
    err: lineTol * lineTol,
    farCorners: false,
  };

  for (const { mask, color, field } of masks) {
    despeckle(mask, w, h, minArea);
    if (o.mode === "shapes") {
      // Sub-pixel edges: the (anti-aliased) ink field, or a softened mask for color layers.
      let f = field;
      if (!f) {
        const v = new Float32Array(N);
        for (let q = 0; q < N; q++) v[q] = mask[q]!;
        boxBlur(v, w, h, 1);
        f = { v, t: 0.5 };
      }
      const parts = traceShapes(mask, w, h, params, minArea, f);
      if (parts.length) layers.push({ color, kind: "fill", strokeWidth: 0, parts });
    } else {
      const { parts, width } = traceLines(mask, w, h, lineParams);
      if (parts.length) layers.push({ color, kind: "stroke", strokeWidth: round2(Math.max(0.5, width * ((sx + sy) / 2))), parts });
    }
  }

  const parts = layers.reduce((s, l) => s + l.parts.length, 0);
  const nodes = layers.reduce((s, l) => s + l.parts.reduce((a, p) => a + p.nodes, 0), 0);
  return {
    width: tw,
    height: th,
    layers,
    threshold: usedThreshold,
    background: bg.transparent ? "transparent" : hex(bg.r, bg.g, bg.b),
    stats: { parts, nodes, workWidth: w, workHeight: h, ms: Date.now() - t0 },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* pixels                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Box-filter (area average, alpha-weighted) down to maxSide. */
function resample(img: RasterImage, maxSide: number): { w: number; h: number; px: Uint8ClampedArray } {
  const W = img.width;
  const H = img.height;
  const src = img.data;
  const k = Math.min(1, maxSide / Math.max(W, H));
  if (k >= 1) {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < px.length; i++) px[i] = src[i]!;
    return { w: W, h: H, px };
  }
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const acc = new Float64Array(w * h * 5);
  for (let y = 0; y < H; y++) {
    const oy = Math.min(h - 1, Math.floor((y * h) / H));
    for (let x = 0; x < W; x++) {
      const ox = Math.min(w - 1, Math.floor((x * w) / W));
      const i = (y * W + x) * 4;
      const o = (oy * w + ox) * 5;
      const a = src[i + 3]!;
      acc[o] += src[i]! * a;
      acc[o + 1] += src[i + 1]! * a;
      acc[o + 2] += src[i + 2]! * a;
      acc[o + 3] += a;
      acc[o + 4] += 1;
    }
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const o = p * 5;
    const a = acc[o + 3]!;
    if (a > 0) {
      px[p * 4] = acc[o]! / a;
      px[p * 4 + 1] = acc[o + 1]! / a;
      px[p * 4 + 2] = acc[o + 2]! / a;
    }
    px[p * 4 + 3] = acc[o + 4] ? a / acc[o + 4]! : 0;
  }
  return { w, h, px };
}

interface Background {
  r: number;
  g: number;
  b: number;
  transparent: boolean;
}

/** Paper color = per-channel median of the border ring; transparent when most of the border is. */
function detectBackground(R: Float32Array, G: Float32Array, B: Float32Array, A: Float32Array, w: number, h: number): Background {
  const idx: number[] = [];
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.01));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) {
        x = w - ring - 1;
        continue;
      }
      idx.push(y * w + x);
    }
  }
  const clear = idx.filter((p) => A[p]! < 0.5).length;
  if (clear > idx.length * 0.5) return { r: 255, g: 255, b: 255, transparent: true };
  const med = (arr: Float32Array) => {
    const v = idx.map((p) => arr[p]!).sort((a, b) => a - b);
    return v[v.length >> 1] ?? 255;
  };
  return { r: med(R), g: med(G), b: med(B), transparent: false };
}

const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lin = (c: number) => LIN[c < 0 ? 0 : c > 255 ? 255 : c | 0]!;

function oklab(r: number, g: number, b: number, out: Float32Array | number[], o = 0) {
  const lr = lin(r);
  const lg = lin(g);
  const lb = lin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function chroma(r: number, g: number, b: number): number {
  const v = [0, 0, 0];
  oklab(r, g, b, v);
  return Math.hypot(v[1]!, v[2]!);
}

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("");

/** Snap near-black / near-white to the pure value (anti-aliasing pulls averages slightly in). */
function niceColor(r: number, g: number, b: number): string {
  const v = [0, 0, 0];
  oklab(r, g, b, v);
  const c = Math.hypot(v[1]!, v[2]!);
  if (c < 0.02 && v[0]! < 0.2) return "#000000";
  if (c < 0.02 && v[0]! > 0.97) return "#ffffff";
  return hex(r, g, b);
}

/** Per-pixel "ink" (0–1): how far a pixel is from the paper. */
function inkMap(R: Float32Array, G: Float32Array, B: Float32Array, A: Float32Array, w: number, h: number, bg: Background, o: Resolved): Float32Array {
  const N = w * h;
  const v = new Float32Array(N);
  if (bg.transparent) {
    for (let p = 0; p < N; p++) v[p] = A[p]!;
    return v;
  }
  if (o.evenLighting) {
    const Y = new Float32Array(N);
    for (let p = 0; p < N; p++) Y[p] = (0.299 * R[p]! + 0.587 * G[p]! + 0.114 * B[p]!) / 255;
    const bgY = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
    const dark = bgY < 0.45;
    const local = paperEstimate(Y, w, h, dark);
    for (let p = 0; p < N; p++) {
      const L = local[p]!;
      v[p] = dark ? clamp01((Y[p]! - L) / Math.max(0.05, 1 - L)) : clamp01((L - Y[p]!) / Math.max(0.05, L));
    }
    return v;
  }
  const bl = [0, 0, 0];
  oklab(bg.r, bg.g, bg.b, bl);
  const c = [0, 0, 0];
  for (let p = 0; p < N; p++) {
    oklab(R[p]!, G[p]!, B[p]!, c);
    v[p] = Math.min(1, Math.hypot(c[0]! - bl[0]!, c[1]! - bl[1]!, c[2]! - bl[2]!) * 1.15);
  }
  return v;
}

/**
 * Local paper brightness (for photos with shadows / vignetting): block max (or min on dark
 * paper) on a coarse grid, dilated and blurred, then sampled bilinearly.
 */
function paperEstimate(Y: Float32Array, w: number, h: number, dark: boolean): Float32Array {
  const b = Math.max(4, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / b);
  const gh = Math.ceil(h / b);
  let grid = new Float32Array(gw * gh).fill(dark ? 1 : 0);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / b);
    for (let x = 0; x < w; x++) {
      const gi = gy * gw + Math.floor(x / b);
      const val = Y[y * w + x]!;
      if (dark ? val < grid[gi]! : val > grid[gi]!) grid[gi] = val;
    }
  }
  // Dilate by 1 cell (ink blobs bigger than a cell are bridged), then blur.
  const dil = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let m = dark ? 1 : 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = clamp(x + dx, 0, gw - 1);
          const yy = clamp(y + dy, 0, gh - 1);
          const v = grid[yy * gw + xx]!;
          if (dark ? v < m : v > m) m = v;
        }
      dil[y * gw + x] = m;
    }
  grid = dil;
  boxBlur(grid, gw, gh, 2);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = clamp((y + 0.5) / b - 0.5, 0, gh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = clamp((x + 0.5) / b - 0.5, 0, gw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const a = grid[y0 * gw + x0]! * (1 - tx) + grid[y0 * gw + x1]! * tx;
      const c = grid[y1 * gw + x0]! * (1 - tx) + grid[y1 * gw + x1]! * tx;
      out[y * w + x] = a * (1 - ty) + c * ty;
    }
  }
  return out;
}

/** In-place separable box blur (clamped edges). */
function boxBlur(v: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) return;
  const tmp = new Float32Array(Math.max(w, h));
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let i = -r; i <= r; i++) s += v[row + clamp(i, 0, w - 1)]!;
    for (let x = 0; x < w; x++) {
      tmp[x] = s / n;
      s += v[row + clamp(x + r + 1, 0, w - 1)]! - v[row + clamp(x - r, 0, w - 1)]!;
    }
    for (let x = 0; x < w; x++) v[row + x] = tmp[x]!;
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += v[clamp(i, 0, h - 1) * w + x]!;
    for (let y = 0; y < h; y++) {
      tmp[y] = s / n;
      s += v[clamp(y + r + 1, 0, h - 1) * w + x]! - v[clamp(y - r, 0, h - 1) * w + x]!;
    }
    for (let y = 0; y < h; y++) v[y * w + x] = tmp[y]!;
  }
}

/** Otsu's threshold on a 0–1 field. */
function otsu(v: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < v.length; i++) hist[Math.min(255, (v[i]! * 255) | 0)]++;
  const total = v.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let at = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      at = t;
    }
  }
  return (at + 0.5) / 255;
}

/** Deterministic PRNG (same result in the browser and in Node). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Posterize into `k` color layers (k-means in OKLab, the paper as its own cluster).
 * Shapes are stacked bottom-to-top by area; each layer's mask also covers the layers
 * above it, so stacked fills never leave hairline gaps.
 */
function colorLayers(
  R: Float32Array,
  G: Float32Array,
  B: Float32Array,
  A: Float32Array,
  w: number,
  h: number,
  bg: Background,
  k: number,
  stack: boolean,
): { mask: Uint8Array; color: string }[] {
  const N = w * h;
  const lab = new Float32Array(N * 3);
  for (let p = 0; p < N; p++) oklab(R[p]!, G[p]!, B[p]!, lab, p * 3);
  const opaque = (p: number) => !bg.transparent || A[p]! >= 0.5;

  const K = bg.transparent ? k : k + 1;
  const step = Math.max(1, Math.floor(N / 60000));
  const samples: number[] = [];
  for (let p = 0; p < N; p += step) if (opaque(p)) samples.push(p);
  const S = samples.length;
  const cent = new Float32Array(K * 3);
  const rng = mulberry32(0x5eed);
  const d2 = (p: number, c: number) => {
    const a = lab[p * 3]! - cent[c * 3]!;
    const b = lab[p * 3 + 1]! - cent[c * 3 + 1]!;
    const d = lab[p * 3 + 2]! - cent[c * 3 + 2]!;
    return a * a + b * b + d * d;
  };
  let start = 0;
  if (!bg.transparent) {
    oklab(bg.r, bg.g, bg.b, cent, 0);
    start = 1;
  } else if (S) {
    const p = samples[Math.floor(rng() * S)]!;
    cent.set(lab.subarray(p * 3, p * 3 + 3), 0);
    start = 1;
  }
  // k-means++ seeding.
  const dist = new Float64Array(S).fill(Infinity);
  for (let c = start; c < K; c++) {
    let total = 0;
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < c; j++) dist[i] = Math.min(dist[i]!, d2(samples[i]!, j));
      total += dist[i]!;
    }
    let r = rng() * total;
    let pick = S - 1;
    for (let i = 0; i < S; i++) {
      r -= dist[i]!;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    const p = samples[pick] ?? 0;
    cent.set(lab.subarray(p * 3, p * 3 + 3), c * 3);
  }
  const nearest = (p: number) => {
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < K; c++) {
      const d = d2(p, c);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  const sums = new Float64Array(K * 4);
  for (let it = 0; it < 16; it++) {
    sums.fill(0);
    for (const p of samples) {
      const c = nearest(p);
      sums[c * 4] += lab[p * 3]!;
      sums[c * 4 + 1] += lab[p * 3 + 1]!;
      sums[c * 4 + 2] += lab[p * 3 + 2]!;
      sums[c * 4 + 3]++;
    }
    let moved = 0;
    for (let c = 0; c < K; c++) {
      const n = sums[c * 4 + 3]!;
      if (!n) continue;
      for (let j = 0; j < 3; j++) {
        const nv = sums[c * 4 + j]! / n;
        moved += Math.abs(nv - cent[c * 3 + j]!);
        cent[c * 3 + j] = nv;
      }
    }
    if (moved < 1e-4) break;
  }

  // Label every pixel; -1 = paper.
  let label = new Int8Array(N);
  const bgC = bg.transparent ? -1 : 0;
  for (let p = 0; p < N; p++) label[p] = opaque(p) ? nearest(p) : -1;
  if (bgC === 0) for (let p = 0; p < N; p++) if (label[p] === 0) label[p] = -1;

  // One majority pass removes anti-aliasing fringes.
  const counts = new Int32Array(K + 1);
  const next = new Int8Array(label);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) counts[label[p + dy * w + dx]! + 1]++;
      let best = -2;
      let bc = 0;
      for (let c = 0; c <= K; c++)
        if (counts[c]! > bc) {
          bc = counts[c]!;
          best = c - 1;
        }
      if (bc >= 5 && best !== label[p]) next[p] = best;
    }
  label = next;

  const area = new Float64Array(K);
  const rgb = new Float64Array(K * 3);
  for (let p = 0; p < N; p++) {
    const c = label[p]!;
    if (c < 0) continue;
    area[c]++;
    rgb[c * 3] += R[p]!;
    rgb[c * 3 + 1] += G[p]!;
    rgb[c * 3 + 2] += B[p]!;
  }
  const order = [...Array(K).keys()].filter((c) => c !== bgC && area[c]! > 0).sort((a, b) => area[b]! - area[a]!);
  const rank = new Int8Array(K).fill(-1);
  order.forEach((c, i) => (rank[c] = i));
  return order.map((c, i) => {
    const mask = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      const l = label[p]!;
      if (l < 0) continue;
      if (stack ? rank[l]! >= i : l === c) mask[p] = 1;
    }
    // A stacked layer only extends under the layers above where it actually surrounds or
    // touches them — never a hidden copy of an unrelated shape.
    if (stack && i < order.length - 1) keepComponentsWith(mask, w, h, (p) => label[p] === c);
    const n = area[c]!;
    return { mask, color: niceColor(rgb[c * 3]! / n, rgb[c * 3 + 1]! / n, rgb[c * 3 + 2]! / n) };
  });
}

/** Keep only the 8-connected components of `mask` with enough pixels for which `own` holds. */
function keepComponentsWith(mask: Uint8Array, w: number, h: number, own: (p: number) => boolean) {
  const N = w * h;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const comp: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    comp.length = 0;
    let mine = 0;
    while (sp) {
      const p = stack[--sp]!;
      comp.push(p);
      if (own(p)) mine++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    if (mine < Math.max(12, comp.length * 0.03)) for (const p of comp) mask[p] = 0;
  }
}

/** Remove 8-connected islands smaller than minArea and fill 4-connected pinholes below it. */
function despeckle(mask: Uint8Array, w: number, h: number, minArea: number) {
  const N = w * h;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const comp: number[] = [];
  const flood = (start: number, val: 0 | 1, eight: boolean) => {
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    comp.length = 0;
    let touches = false;
    while (sp) {
      const p = stack[--sp]!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!eight && dx && dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (!seen[q] && mask[q] === val) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    return touches;
  };
  for (let p = 0; p < N; p++) {
    if (seen[p] || !mask[p]) continue;
    flood(p, 1, true);
    if (comp.length < minArea) for (const q of comp) mask[q] = 0;
  }
  seen.fill(0);
  for (let p = 0; p < N; p++) {
    if (seen[p] || mask[p]) continue;
    const border = flood(p, 0, false);
    if (!border && comp.length < minArea) for (const q of comp) mask[q] = 1;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* geometry                                                                                    */
/* ------------------------------------------------------------------------------------------ */

type Pt = [number, number];

interface FitParams {
  /** Gaussian smoothing (px). */
  sigma: number;
  /** Chord reach for corner angles (points). */
  k: number;
  /** cos of the corner angle limit (sharper than this = corner). */
  cornerCos: number;
  /** Also look for anti-aliased (rounded) obtuse corners — for clean edges, not skeletons. */
  farCorners: boolean;
  /** Max squared fitting error (px²). */
  err: number;
  sx: number;
  sy: number;
  /** Output offset added after scaling (cropped traces). */
  ox?: number;
  oy?: number;
}

/** A cubic segment (a straight line when the handles sit on the chord). */
interface Seg {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const norm = (a: Pt): Pt => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0];
};

function gaussKernel(sigma: number): number[] {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k: number[] = [];
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    s += v;
  }
  return k.map((v) => v / s);
}

function smoothClosed(pts: Pt[], sigma: number): Pt[] {
  const n = pts.length;
  if (sigma < 0.3 || n < 5) return pts.map((p) => [p[0], p[1]]);
  let k = gaussKernel(sigma);
  let r = (k.length - 1) / 2;
  if (2 * r + 1 > n) {
    r = Math.floor((n - 1) / 2);
    k = gaussKernel(r / 2.5);
    r = (k.length - 1) / 2;
  }
  const out: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let j = -r; j <= r; j++) {
      const p = pts[(((i + j) % n) + n) % n]!;
      x += p[0] * k[j + r]!;
      y += p[1] * k[j + r]!;
    }
    out[i] = [x, y];
  }
  return out;
}

/** Gaussian smoothing with fixed endpoints (odd reflection keeps ends straight). */
function smoothOpen(pts: Pt[], sigma: number): Pt[] {
  const n = pts.length;
  if (sigma < 0.3 || n < 4) return pts.map((p) => [p[0], p[1]]);
  const k = gaussKernel(sigma);
  const r = (k.length - 1) / 2;
  const first = pts[0]!;
  const last = pts[n - 1]!;
  const at = (i: number): Pt => {
    if (i < 0) {
      const q = pts[Math.min(n - 1, -i)]!;
      return [2 * first[0] - q[0], 2 * first[1] - q[1]];
    }
    if (i >= n) {
      const q = pts[Math.max(0, 2 * (n - 1) - i)]!;
      return [2 * last[0] - q[0], 2 * last[1] - q[1]];
    }
    return pts[i]!;
  };
  const out: Pt[] = new Array(n);
  out[0] = [first[0], first[1]];
  out[n - 1] = [last[0], last[1]];
  for (let i = 1; i < n - 1; i++) {
    let x = 0;
    let y = 0;
    for (let j = -r; j <= r; j++) {
      const p = at(i + j);
      x += p[0] * k[j + r]!;
      y += p[1] * k[j + r]!;
    }
    out[i] = [x, y];
  }
  return out;
}

/** Max distance of pts[a..b] (by index, wrapped) from the chord pts[a]→pts[b]. */
function chordDeviation(pts: Pt[], at: (i: number) => Pt, a: number, b: number): number {
  const p0 = at(a);
  const p1 = at(b);
  const c = sub(p1, p0);
  const cl = len(c);
  if (cl < 1e-6) return Infinity;
  let max = 0;
  for (let i = a + 1; i < b; i++) {
    const v = sub(at(i), p0);
    max = Math.max(max, Math.abs(v[0] * c[1] - v[1] * c[0]) / cl);
  }
  return max;
}

/**
 * Corners: points where the outline turns sharper than the limit. Two tests:
 * the near angle (chords ±k — sharp tips), or the far angle between the straight runs
 * on either side (k…3k away), which sees obtuse corners that anti-aliasing has rounded.
 * Local maxima of sharpness win.
 */
function findCorners(pts: Pt[], closed: boolean, k: number, cornerCos: number, farCorners = true): number[] {
  const n = pts.length;
  if (n < 2 * k + 3) return [];
  const cos = new Float64Array(n).fill(-1);
  const hit = new Uint8Array(n);
  const at = (i: number) => pts[closed ? (((i % n) + n) % n) : clamp(i, 0, n - 1)]!;
  const far = 3 * k;
  const lo = closed ? 0 : k;
  const hi = closed ? n : n - k;
  const cosOf = (a: Pt, b: Pt) => {
    const la = len(a);
    const lb = len(b);
    return la < 1e-6 || lb < 1e-6 ? -1 : dot(a, b) / (la * lb);
  };
  for (let i = lo; i < hi; i++) {
    const p = pts[i]!;
    cos[i] = cosOf(sub(at(i - k), p), sub(at(i + k), p));
    if (cos[i]! > cornerCos) {
      hit[i] = 1;
      continue;
    }
    if (!farCorners || n < 2 * far + 3 || (!closed && (i < far || i > n - 1 - far))) continue;
    const c = cosOf(sub(at(i - far), at(i - k)), sub(at(i + far), at(i + k)));
    if (c <= cornerCos) continue;
    // On an arc the near chords turn ~¼ as much as the far ones; at a (rounded) corner most
    // of the turn happens near the point.
    if (Math.PI - Math.acos(Math.max(-1, Math.min(1, cos[i]!))) < 0.5 * (Math.PI - Math.acos(Math.max(-1, Math.min(1, c))))) continue;
    if (chordDeviation(pts, at, i - far, i - k) < 0.35 && chordDeviation(pts, at, i + k, i + far) < 0.35) hit[i] = 1;
  }
  const out: number[] = [];
  for (let i = lo; i < hi; i++) {
    if (!hit[i]) continue;
    const c = cos[i]!;
    let isMax = true;
    for (let j = -k; j <= k && isMax; j++) {
      if (!j) continue;
      const q = closed ? (((i + j) % n) + n) % n : i + j;
      if (q < 0 || q >= n || !hit[q]) continue;
      if (cos[q]! > c || (cos[q]! === c && j < 0)) isMax = false;
    }
    if (isMax) out.push(i);
  }
  return out;
}

/** Sharpen a corner: intersect the straight runs arriving and leaving it (falls back to the point). */
function refineCorner(raw: Pt[], i: number, closed: boolean, k: number): Pt {
  const n = raw.length;
  const at = (j: number) => raw[closed ? (((j % n) + n) % n) : clamp(j, 0, n - 1)]!;
  const p = at(i);
  const a0 = at(i - 3 * k);
  const a1 = at(i - k);
  const b0 = at(i + k);
  const b1 = at(i + 3 * k);
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-6) return p;
  const t = ((b0[0] - a0[0]) * d2[1] - (b0[1] - a0[1]) * d2[0]) / den;
  const x = add(a0, mul(d1, t));
  return len(sub(x, p)) <= Math.max(2.5, k * 0.8) ? x : p;
}

/* ---- least-squares cubic fitting (after Schneider, "An Algorithm for Automatically Fitting Digitized Curves") ---- */

function bez(s: Seg, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * s.p0[0] + b * s.c1[0] + c * s.c2[0] + d * s.p3[0], a * s.p0[1] + b * s.c1[1] + c * s.c2[1] + d * s.p3[1]];
}

function chordParams(d: Pt[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1]! + len(sub(d[i]!, d[i - 1]!)));
  const total = u[u.length - 1]! || 1;
  return u.map((v) => v / total);
}

function generateBezier(d: Pt[], first: number, last: number, u: number[], t1: Pt, t2: Pt): Seg {
  const p0 = d[first]!;
  const p3 = d[last]!;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i]!;
    const v = 1 - t;
    const b0 = v * v * v;
    const b1 = 3 * t * v * v;
    const b2 = 3 * t * t * v;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(d[first + i]!, add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const segLen = len(sub(p3, p0));
  let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  const eps = 1e-6 * segLen;
  if (det === 0 || al < eps || ar < eps || !Number.isFinite(al) || !Number.isFinite(ar)) {
    al = ar = segLen / 3;
  }
  // Handles longer than the chord make loops; clamp them.
  al = Math.min(al, segLen);
  ar = Math.min(ar, segLen);
  return { p0, c1: add(p0, mul(t1, al)), c2: add(p3, mul(t2, ar)), p3 };
}

function maxError(d: Pt[], first: number, last: number, s: Seg, u: number[]): [number, number] {
  let max = 0;
  let split = Math.floor((last - first + 1) / 2) + first;
  for (let i = first + 1; i < last; i++) {
    const p = bez(s, u[i - first]!);
    const e = (p[0] - d[i]![0]) ** 2 + (p[1] - d[i]![1]) ** 2;
    if (e >= max) {
      max = e;
      split = i;
    }
  }
  return [max, split];
}

function newton(s: Seg, p: Pt, t: number): number {
  const q = bez(s, t);
  const u = 1 - t;
  const d1: Pt = [
    3 * (u * u * (s.c1[0] - s.p0[0]) + 2 * u * t * (s.c2[0] - s.c1[0]) + t * t * (s.p3[0] - s.c2[0])),
    3 * (u * u * (s.c1[1] - s.p0[1]) + 2 * u * t * (s.c2[1] - s.c1[1]) + t * t * (s.p3[1] - s.c2[1])),
  ];
  const d2: Pt = [
    6 * (u * (s.c2[0] - 2 * s.c1[0] + s.p0[0]) + t * (s.p3[0] - 2 * s.c2[0] + s.c1[0])),
    6 * (u * (s.c2[1] - 2 * s.c1[1] + s.p0[1]) + t * (s.p3[1] - 2 * s.c2[1] + s.c1[1])),
  ];
  const diff = sub(q, p);
  const den = dot(d1, d1) + dot(diff, d2);
  if (Math.abs(den) < 1e-12) return t;
  return clamp01(t - dot(diff, d1) / den);
}

function fitCubic(d: Pt[], first: number, last: number, t1: Pt, t2: Pt, err: number, out: Seg[], depth = 0) {
  const p0 = d[first]!;
  const p3 = d[last]!;
  if (last - first < 2 || depth > 24) {
    const dist = len(sub(p3, p0)) / 3;
    out.push({ p0, c1: add(p0, mul(t1, dist)), c2: add(p3, mul(t2, dist)), p3 });
    return;
  }
  let u = chordParams(d, first, last);
  let s = generateBezier(d, first, last, u, t1, t2);
  let [e, split] = maxError(d, first, last, s, u);
  if (e < err) {
    out.push(s);
    return;
  }
  if (e < err * 36) {
    for (let it = 0; it < 8; it++) {
      u = u.map((t, i) => newton(s, d[first + i]!, t));
      s = generateBezier(d, first, last, u, t1, t2);
      [e, split] = maxError(d, first, last, s, u);
      if (e < err) {
        out.push(s);
        return;
      }
    }
  }
  split = clamp(split, first + 1, last - 1);
  const a = d[Math.max(first, split - 2)]!;
  const b = d[Math.min(last, split + 2)]!;
  const center = norm(sub(a, b));
  fitCubic(d, first, split, t1, center, err, out, depth + 1);
  fitCubic(d, split, last, mul(center, -1), t2, err, out, depth + 1);
}

function endTangent(d: Pt[], fromStart: boolean, want = 4): Pt {
  const n = d.length;
  const reach = Math.min(n - 1, want);
  return fromStart ? norm(sub(d[reach]!, d[0]!)) : norm(sub(d[n - 1 - reach]!, d[n - 1]!));
}

/** Fit a run of points (corner to corner, or a whole open stroke). */
function fitRun(pts: Pt[], err: number, out: Seg[], reach = 4) {
  if (pts.length < 2) return;
  const n = pts.length;
  // Straight run: one line, no matter how many points.
  const lineTol = Math.min(0.9, Math.sqrt(err) * 0.55);
  if (n === 2 || chordDeviation(pts, (i) => pts[i]!, 0, n - 1) <= lineTol) {
    out.push({ p0: pts[0]!, c1: pts[0]!, c2: pts[n - 1]!, p3: pts[n - 1]! });
    return;
  }
  fitCubic(pts, 0, pts.length - 1, endTangent(pts, true, reach), endTangent(pts, false, reach), err, out);
}

/** Closed point loop → segments (corners kept sharp, the rest smooth). */
function fitLoop(raw: Pt[], p: FitParams): Seg[] {
  const n = raw.length;
  if (n < 3) return [];
  if (n < 8) {
    return raw.map((a, i) => {
      const b = raw[(i + 1) % n]!;
      return { p0: a, c1: a, c2: b, p3: b };
    });
  }
  const light = smoothClosed(raw, 0.9);
  const corners = findCorners(light, true, p.k, p.cornerCos, p.farCorners);
  const out: Seg[] = [];
  if (!corners.length) {
    const s = smoothClosed(raw, p.sigma);
    // Start the loop where it is flattest so the seam is invisible.
    let start = 0;
    let best = -Infinity;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 64))) {
      const a = norm(sub(s[(i + n - 3) % n]!, s[i]!));
      const b = norm(sub(s[(i + 3) % n]!, s[i]!));
      const flat = -dot(a, b);
      if (flat > best) {
        best = flat;
        start = i;
      }
    }
    const rot = [...s.slice(start), ...s.slice(0, start)];
    const loop = [...rot, rot[0]!];
    const r = Math.min(Math.floor(n / 4), Math.max(2, Math.round(p.sigma * 2) + 1));
    const t = norm(sub(rot[r]!, rot[n - r]!));
    fitCubic(loop, 0, loop.length - 1, t, mul(t, -1), p.err, out);
    return out;
  }
  const at = corners.map((i) => refineCorner(raw, i, true, p.k));
  for (let j = 0; j < corners.length; j++) {
    const a = corners[j]!;
    const b = j + 1 < corners.length ? corners[j + 1]! : corners[0]! + n;
    const A = at[j]!;
    const Bc = at[(j + 1) % corners.length]!;
    // Points right at a corner carry its anti-aliased rounding: skip them so corners stay crisp.
    const ra = Math.max(1.5 + 2 * len(sub(A, raw[a % n]!)), p.k * 0.8);
    const rb = Math.max(1.5 + 2 * len(sub(Bc, raw[b % n]!)), p.k * 0.8);
    const run: Pt[] = [A];
    for (let i = a + 1; i < b; i++) {
      const q = raw[i % n]!;
      if (len(sub(q, A)) < ra || len(sub(q, Bc)) < rb) continue;
      run.push(q);
    }
    run.push(Bc);
    fitRun(smoothOpen(run, p.sigma), p.err, out, Math.max(3, Math.round(p.sigma * 2) + 2));
  }
  return out;
}

/** Open polyline → segments. */
function fitOpen(raw: Pt[], p: FitParams): Seg[] {
  if (raw.length < 2) return [];
  const light = smoothOpen(raw, 0.9);
  const corners = findCorners(light, false, p.k, p.cornerCos, p.farCorners);
  const cuts = [0, ...corners, raw.length - 1];
  const out: Seg[] = [];
  const pts = raw.map((q) => [q[0], q[1]] as Pt);
  for (const c of corners) pts[c] = refineCorner(raw, c, false, p.k);
  for (let j = 0; j + 1 < cuts.length; j++) {
    const run = pts.slice(cuts[j]!, cuts[j + 1]! + 1);
    fitRun(smoothOpen(run, p.sigma), p.err, out, Math.max(3, Math.round(p.sigma * 2) + 2));
  }
  return out;
}

/** Path data in output units. Straight segments become L. */
function segsToD(input: Seg[], p: FitParams, close: boolean): string {
  if (!input.length) return "";
  const isLine = (s: Seg) => s.c1[0] === s.p0[0] && s.c1[1] === s.p0[1] && s.c2[0] === s.p3[0] && s.c2[1] === s.p3[1];
  // Merge consecutive collinear lines.
  const segs: Seg[] = [];
  for (const s of input) {
    const prev = segs[segs.length - 1];
    if (prev && isLine(prev) && isLine(s)) {
      const c = sub(s.p3, prev.p0);
      const cl = len(c);
      const v = sub(prev.p3, prev.p0);
      if (cl > 1e-9 && Math.abs(v[0] * c[1] - v[1] * c[0]) / cl < 0.3 && dot(v, c) > 0) {
        segs[segs.length - 1] = { p0: prev.p0, c1: prev.p0, c2: s.p3, p3: s.p3 };
        continue;
      }
    }
    segs.push(s);
  }
  const f = (v: number) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? "0" : String(r);
  };
  const X = (q: Pt) => `${f(q[0] * p.sx + (p.ox ?? 0))} ${f(q[1] * p.sy + (p.oy ?? 0))}`;
  let d = `M${X(segs[0]!.p0)}`;
  for (const s of segs) {
    const chord = sub(s.p3, s.p0);
    const cl = len(chord);
    const off = (q: Pt) => {
      if (cl < 1e-9) return len(sub(q, s.p0));
      const v = sub(q, s.p0);
      const t = dot(v, chord) / (cl * cl);
      if (t < -0.02 || t > 1.02) return Infinity;
      return Math.abs(v[0] * chord[1] - v[1] * chord[0]) / cl;
    };
    if (off(s.c1) < 0.06 && off(s.c2) < 0.06) d += `L${X(s.p3)}`;
    else d += `C${X(s.c1)} ${X(s.c2)} ${X(s.p3)}`;
  }
  // The closing segment ends on the start point: Z draws it.
  if (close) d = d.replace(/L[^LCMZ]*$/, "") + "Z";
  return d;
}

/* ------------------------------------------------------------------------------------------ */
/* shapes: boundary tracing                                                                    */
/* ------------------------------------------------------------------------------------------ */

interface Contour {
  /** Lattice points (pixel corners), x,y pairs. */
  pts: Int32Array;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Follow every boundary between ink and paper along pixel edges (ink on the right).
 * Diagonal ink pixels connect (8-connectivity), matching the despeckle pass.
 * Outer boundaries come out with positive area, holes negative.
 */
function traceContours(mask: Uint8Array, w: number, h: number): Contour[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const seen = new Uint8Array((w + 1) * (h + 1));
  const out: Contour[] = [];
  const buf: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x] || at(x, y - 1) || seen[y * (w + 1) + x]) continue;
      buf.length = 0;
      let px = x;
      let py = y;
      let dx = 1;
      let dy = 0;
      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let guard = 0;
      do {
        if (dx === 1 && dy === 0) seen[py * (w + 1) + px] = 1;
        buf.push(px, py);
        const nx = px + dx;
        const ny = py + dy;
        area += px * ny - nx * py;
        px = nx;
        py = ny;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const lx = dy;
        const ly = -dx;
        const AL = at(px + ((dx + lx - 1) >> 1), py + ((dy + ly - 1) >> 1));
        const AR = at(px + ((dx - lx - 1) >> 1), py + ((dy - ly - 1) >> 1));
        if (AL) {
          // Wall ahead or a diagonal ink neighbor: turn left.
          const t = dx;
          dx = dy;
          dy = -t;
        } else if (!AR) {
          const t = dx;
          dx = -dy;
          dy = t;
        }
        if (++guard > 8 * (w + 1) * (h + 1)) break;
      } while (!(px === x && py === y && dx === 1 && dy === 0));
      out.push({ pts: Int32Array.from(buf), area: area / 2, minX, minY, maxX, maxY });
    }
  }
  return out;
}

function inside(c: Contour, x: number, y: number): boolean {
  if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) return false;
  const p = c.pts;
  const n = p.length / 2;
  let ins = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2]!;
    const yi = p[i * 2 + 1]!;
    const xj = p[j * 2]!;
    const yj = p[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/**
 * One point per pixel edge: where the ink field crosses the threshold between the ink pixel
 * and the paper pixel it borders (marching-squares style), so anti-aliased edges give
 * sub-pixel positions instead of a staircase.
 */
function edgePoints(c: Contour, w: number, h: number, f: { v: Float32Array; t: number }): Pt[] {
  const p = c.pts;
  const n = p.length / 2;
  const out: Pt[] = new Array(n);
  const val = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : f.v[y * w + x]!);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = p[i * 2]!;
    const y0 = p[i * 2 + 1]!;
    const dx = p[j * 2]! - x0;
    const dy = p[j * 2 + 1]! - y0;
    const mx = x0 + dx / 2;
    const my = y0 + dy / 2;
    // Ink is on the right of the direction of travel.
    const rx = -dy;
    const ry = dx;
    const vf = val(Math.floor(mx + rx * 0.5), Math.floor(my + ry * 0.5));
    const vb = val(Math.floor(mx - rx * 0.5), Math.floor(my - ry * 0.5));
    const s = vf - vb > 1e-6 ? clamp((vf - f.t) / (vf - vb), 0, 1) : 0.5;
    out[i] = [mx + rx * (0.5 - s), my + ry * (0.5 - s)];
  }
  return out;
}

/** One path per outer boundary, with its holes (even-odd). */
function traceShapes(mask: Uint8Array, w: number, h: number, p: FitParams, minArea: number, field: { v: Float32Array; t: number }): VectorPart[] {
  const contours = traceContours(mask, w, h).filter((c) => Math.abs(c.area) >= Math.min(minArea, 4));
  const outers = contours.filter((c) => c.area > 0).sort((a, b) => a.area - b.area);
  const holes = contours.filter((c) => c.area < 0);
  const groups = new Map<Contour, Contour[]>(outers.map((o) => [o, []]));
  for (const hole of holes) {
    const x = hole.pts[0]! + 0.5;
    const y = hole.pts[1]! + 0.01;
    const owner = outers.find((o) => o.area > -hole.area && inside(o, x, y));
    if (owner) groups.get(owner)!.push(hole);
  }
  // Paint order: bigger shapes first (reading order within similar sizes).
  const ordered = [...outers].sort((a, b) => b.area - a.area);
  const parts: VectorPart[] = [];
  for (const o of ordered) {
    let d = "";
    let nodes = 0;
    for (const c of [o, ...groups.get(o)!]) {
      const segs = fitLoop(edgePoints(c, w, h, field), p);
      if (!segs.length) continue;
      d += segsToD(segs, p, true);
      nodes += segs.length;
    }
    if (d) parts.push({ d, nodes });
  }
  return parts;
}

/* ------------------------------------------------------------------------------------------ */
/* lines: centerlines                                                                          */
/* ------------------------------------------------------------------------------------------ */

/** Zhang–Suen thinning to a 1-px skeleton. */
function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(mask);
  for (let x = 0; x < w; x++) img[x] = img[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) img[y * w] = img[y * w + w - 1] = 0;
  let live: number[] = [];
  for (let p = 0; p < img.length; p++) if (img[p]) live.push(p);
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (const p of live) {
        if (!img[p]) continue;
        const n = img[p - w]!;
        const ne = img[p - w + 1]!;
        const e = img[p + 1]!;
        const se = img[p + w + 1]!;
        const s = img[p + w]!;
        const sw = img[p + w - 1]!;
        const wv = img[p - 1]!;
        const nw = img[p - w - 1]!;
        const b = n + ne + e + se + s + sw + wv + nw;
        if (b < 2 || b > 6) continue;
        const a = +(!n && ne) + +(!ne && e) + +(!e && se) + +(!se && s) + +(!s && sw) + +(!sw && wv) + +(!wv && nw) + +(!nw && n);
        if (a !== 1) continue;
        if (step === 0 ? n * e * s !== 0 || e * s * wv !== 0 : n * e * wv !== 0 || n * s * wv !== 0) continue;
        del.push(p);
      }
      for (const p of del) img[p] = 0;
      if (del.length) changed = true;
    }
    live = live.filter((p) => img[p]);
  }
  // Remove staircase corners (a pixel whose only two neighbors touch diagonally) so every
  // regular skeleton pixel has exactly two neighbors.
  for (const p of live) {
    if (!img[p]) continue;
    const n = img[p - w]!;
    const e = img[p + 1]!;
    const s = img[p + w]!;
    const wv = img[p - 1]!;
    const count = n + e + s + wv + img[p - w + 1]! + img[p + w + 1]! + img[p + w - 1]! + img[p - w - 1]!;
    if (count !== 2) continue;
    if ((n && e) || (e && s) || (s && wv) || (wv && n)) img[p] = 0;
  }
  return img;
}

/** Chamfer distance to the paper (≈ half the stroke width at the centerline). */
function distanceToPaper(mask: Uint8Array, w: number, h: number): Float32Array {
  const D = new Float32Array(w * h);
  const BIG = 1e9;
  const R2 = Math.SQRT2;
  for (let p = 0; p < D.length; p++) D[p] = mask[p] ? BIG : 0;
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : D[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!D[p]) continue;
      D[p] = Math.min(D[p]!, get(x - 1, y) + 1, get(x, y - 1) + 1, get(x - 1, y - 1) + R2, get(x + 1, y - 1) + R2);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!D[p]) continue;
      D[p] = Math.min(D[p]!, get(x + 1, y) + 1, get(x, y + 1) + 1, get(x + 1, y + 1) + R2, get(x - 1, y + 1) + R2);
    }
  return D;
}

interface Edge {
  pts: Pt[];
  /** Node ids at each end (-1 = none / loop). */
  a: number;
  b: number;
  closed: boolean;
  dead?: boolean;
}

function traceLines(mask: Uint8Array, w: number, h: number, p: FitParams): { parts: VectorPart[]; width: number } {
  const sk = thin(mask, w, h);
  const dist = distanceToPaper(mask, w, h);
  const N = w * h;
  const OFF = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  const deg = new Uint8Array(N);
  const widths: number[] = [];
  for (let q = 0; q < N; q++) {
    if (!sk[q]) continue;
    let c = 0;
    for (const o of OFF) if (sk[q + o]) c++;
    deg[q] = c;
    widths.push(Math.max(1, 2 * dist[q]! - 1));
  }
  if (!widths.length) return { parts: [], width: 1 };
  widths.sort((a, b) => a - b);
  const width = widths[widths.length >> 1]!;

  // Nodes: endpoints (1 neighbor) and junction clusters (3+), merged when touching.
  const nodeOf = new Int32Array(N).fill(-1);
  const nodePos: Pt[] = [];
  const isNode = (q: number) => sk[q] && deg[q] !== 2;
  for (let q = 0; q < N; q++) {
    if (!isNode(q) || nodeOf[q] >= 0) continue;
    const id = nodePos.length;
    const stack = [q];
    nodeOf[q] = id;
    let sx = 0;
    let sy = 0;
    let n = 0;
    while (stack.length) {
      const c = stack.pop()!;
      sx += (c % w) + 0.5;
      sy += Math.floor(c / w) + 0.5;
      n++;
      if (deg[c]! < 3) continue;
      for (const o of OFF) {
        const r = c + o;
        if (isNode(r) && deg[r]! >= 3 && nodeOf[r] < 0) {
          nodeOf[r] = id;
          stack.push(r);
        }
      }
    }
    nodePos.push([sx / n, sy / n]);
  }
  const P = (q: number): Pt => [(q % w) + 0.5, Math.floor(q / w) + 0.5];

  const visited = new Uint8Array(N);
  const edges: Edge[] = [];
  for (let q = 0; q < N; q++) {
    if (nodeOf[q] < 0) continue;
    for (const o of OFF) {
      let cur = q + o;
      if (!sk[cur] || visited[cur] || nodeOf[cur] >= 0) continue;
      const start = nodeOf[q]!;
      const pts: Pt[] = [nodePos[start]!, P(cur)];
      visited[cur] = 1;
      let prev = q;
      let end = -1;
      for (;;) {
        let next = -1;
        for (const o2 of OFF) {
          const r = cur + o2;
          if (!sk[r] || r === prev) continue;
          if (nodeOf[r] >= 0) {
            if (nodeOf[r] === start && pts.length < 3) continue;
            end = nodeOf[r]!;
            next = -2;
            break;
          }
          if (!visited[r]) {
            next = r;
            break;
          }
        }
        if (next === -2) {
          pts.push(nodePos[end]!);
          break;
        }
        if (next < 0) break;
        visited[next] = 1;
        pts.push(P(next));
        prev = cur;
        cur = next;
      }
      edges.push({ pts, a: start, b: end, closed: false });
    }
  }
  // Loops without any node.
  for (let q = 0; q < N; q++) {
    if (!sk[q] || visited[q] || nodeOf[q] >= 0) continue;
    const pts: Pt[] = [P(q)];
    visited[q] = 1;
    let prev = -1;
    let cur = q;
    for (;;) {
      let next = -1;
      for (const o of OFF) {
        const r = cur + o;
        if (sk[r] && r !== prev && !visited[r] && nodeOf[r] < 0) {
          next = r;
          break;
        }
      }
      if (next < 0) break;
      visited[next] = 1;
      pts.push(P(next));
      prev = cur;
      cur = next;
    }
    if (pts.length >= 8) edges.push({ pts, a: -1, b: -1, closed: true });
  }

  // Prune spurs: short branches from a junction to a free end (skeleton artifacts).
  const spur = Math.max(4, width * 1.6);
  const degree = () => {
    const d = new Int32Array(nodePos.length);
    for (const e of edges) {
      if (e.dead || e.closed) continue;
      if (e.a >= 0) d[e.a]++;
      if (e.b >= 0) d[e.b]++;
    }
    return d;
  };
  for (let pass = 0; pass < 2; pass++) {
    const d = degree();
    for (const e of edges) {
      if (e.dead || e.closed) continue;
      const da = e.a >= 0 ? d[e.a]! : 1;
      const db = e.b >= 0 ? d[e.b]! : 1;
      const l = polyLen(e.pts);
      if ((da === 1 && db >= 3) || (db === 1 && da >= 3)) {
        if (l < spur) e.dead = true;
      } else if (da <= 1 && db <= 1 && l < spur) e.dead = true;
    }
  }
  const live = edges.filter((e) => !e.dead);

  // Join edge ends that continue straight through a junction (and always through degree-2 nodes).
  type End = { e: number; atStart: boolean };
  const ends = new Map<number, End[]>();
  live.forEach((e, i) => {
    if (e.closed) return;
    if (e.a >= 0) (ends.get(e.a) ?? ends.set(e.a, []).get(e.a)!).push({ e: i, atStart: true });
    if (e.b >= 0) (ends.get(e.b) ?? ends.set(e.b, []).get(e.b)!).push({ e: i, atStart: false });
  });
  const link = new Map<string, End>();
  const key = (x: End) => `${x.e}:${x.atStart ? 0 : 1}`;
  const reach = Math.max(5, width * 2);
  const outDir = (x: End): Pt => {
    const pts = live[x.e]!.pts;
    const seq = x.atStart ? pts : [...pts].reverse();
    let acc = 0;
    let i = 1;
    for (; i < seq.length - 1 && acc < reach; i++) acc += len(sub(seq[i]!, seq[i - 1]!));
    return norm(sub(seq[i]!, seq[0]!));
  };
  for (const [, list] of ends) {
    if (list.length < 2) continue;
    const dirs = list.map(outDir);
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (list[i]!.e === list[j]!.e) continue;
        pairs.push([dot(dirs[i]!, dirs[j]!), i, j]);
      }
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set<number>();
    for (const [c, i, j] of pairs) {
      if (used.has(i) || used.has(j)) continue;
      if (list.length > 2 && c > -0.72) continue;
      used.add(i);
      used.add(j);
      link.set(key(list[i]!), list[j]!);
      link.set(key(list[j]!), list[i]!);
    }
  }

  // Chain linked edges into strokes.
  const done = new Uint8Array(live.length);
  const strokes: { pts: Pt[]; closed: boolean }[] = [];
  const walk = (startEdge: number, fromStart: boolean) => {
    const pts: Pt[] = [];
    let e = startEdge;
    let forward = fromStart;
    for (;;) {
      done[e] = 1;
      const seg = forward ? live[e]!.pts : [...live[e]!.pts].reverse();
      pts.push(...(pts.length ? seg.slice(1) : seg));
      const nxt = link.get(key({ e, atStart: !forward }));
      if (!nxt || done[nxt.e]) return { pts, closed: !!nxt && nxt.e === startEdge };
      e = nxt.e;
      forward = nxt.atStart;
    }
  };
  live.forEach((e, i) => {
    if (done[i]) return;
    if (e.closed) {
      done[i] = 1;
      strokes.push({ pts: e.pts, closed: true });
      return;
    }
    // Start from a free end so the chain is complete.
    if (link.has(key({ e: i, atStart: true })) && link.has(key({ e: i, atStart: false }))) return;
    strokes.push(walk(i, !link.has(key({ e: i, atStart: true }))));
  });
  live.forEach((_, i) => {
    if (!done[i]) strokes.push(walk(i, true));
  });

  const parts: VectorPart[] = [];
  const order = strokes.filter((s) => polyLen(s.pts) >= Math.max(3, width)).sort((a, b) => polyLen(b.pts) - polyLen(a.pts));
  for (const s of order) {
    const segs = s.closed ? fitLoop(dedupe(s.pts), p) : fitOpen(dedupe(s.pts), p);
    const d = segsToD(segs, p, s.closed);
    if (d) parts.push({ d, nodes: segs.length + (s.closed ? 0 : 1) });
  }
  return { parts, width };
}

function polyLen(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += len(sub(pts[i]!, pts[i - 1]!));
  return l;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - q[0]) > 1e-6 || Math.abs(last[1] - q[1]) > 1e-6) out.push(q);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* output helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The result as standalone SVG markup (previews; optional image underneath). */
export function vectorizeSvg(
  r: VectorizeResult,
  o: { background?: string | null; image?: string; imageOpacity?: number; outline?: string } = {},
): string {
  const body = r.layers
    .map((l) => {
      const style =
        o.outline !== undefined
          ? `fill="none" stroke="${escAttr(o.outline)}" stroke-width="${round2(Math.max(r.width, r.height) / 600)}"`
          : l.kind === "fill"
            ? `fill="${escAttr(l.color)}" fill-rule="evenodd"`
            : `fill="none" stroke="${escAttr(l.color)}" stroke-width="${l.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
      return `<g ${style}>${l.parts.map((p) => `<path d="${p.d}"/>`).join("")}</g>`;
    })
    .join("");
  const bg = o.background ? `<rect width="${r.width}" height="${r.height}" fill="${escAttr(o.background)}"/>` : "";
  const img = o.image
    ? `<image href="${escAttr(o.image)}" width="${r.width}" height="${r.height}" preserveAspectRatio="none" opacity="${o.imageOpacity ?? 0.35}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}" width="${r.width}" height="${r.height}">${bg}${img}${body}</svg>`;
}

/**
 * Ops that place the result as one named group exactly over a reference image
 * (same parent and transform, right above it). Apply them as one undo step.
 */
export function vectorizeOps(doc: DocT, refId: string, r: VectorizeResult, o: { name?: string } = {}): { ops: OpT[]; groupId: string } {
  const ref = doc.nodes[refId];
  if (!ref || ref.type !== "reference") throw new Error(`Node ${refId} is not a reference image`);
  const parentNode = ref.parent ? doc.nodes[ref.parent] : null;
  const siblings = parentNode && "children" in parentNode ? parentNode.children : doc.root;
  const index = Math.max(0, siblings.indexOf(refId) + 1);
  const groupId = newId("n");
  const noPaint = { fill: null, stroke: null, strokeWidth: 0 };
  const ops: OpT[] = [
    {
      op: "add",
      node: {
        id: groupId,
        type: "group",
        name: o.name ?? `Vectorized ${ref.name || "image"}`.trim(),
        transform: { ...ref.transform },
        style: noPaint,
      },
      parent: ref.parent,
      index,
    },
  ];
  const multi = r.layers.length > 1;
  let shapeN = 0;
  let strokeN = 0;
  r.layers.forEach((l, li) => {
    let parent = groupId;
    if (multi) {
      parent = newId("n");
      ops.push({ op: "add", node: { id: parent, type: "group", name: `Color ${li + 1} ${l.color}`, style: noPaint }, parent: groupId });
    }
    for (const part of l.parts) {
      const stroke = l.kind === "stroke";
      ops.push({
        op: "add",
        node: {
          id: newId("n"),
          type: "path",
          name: stroke ? `Stroke ${++strokeN}` : `Shape ${++shapeN}`,
          d: part.d,
          style: stroke
            ? { fill: null, stroke: l.color, strokeWidth: l.strokeWidth, strokeLinecap: "round", strokeLinejoin: "round" }
            : { fill: l.color, stroke: null, strokeWidth: 0, fillRule: "evenodd" },
        },
        parent,
      });
    }
  });
  return { ops, groupId };
}

/* ------------------------------------------------------------------------------------------ */
/* building blocks for the photo / object mode (vectorize-photo.ts)                            */
/* ------------------------------------------------------------------------------------------ */

/** Curve-fitting parameters shared by the tracers (working-pixel units; sx/sy/ox/oy map to output). */
export type VectorizeFitParams = FitParams;

/** Internal building blocks, shared with the photo / object mode. Not a stable API. */
export const vectorizeInternals = {
  resample,
  boxBlur,
  otsu,
  oklab,
  hex,
  niceColor,
  despeckle,
  keepComponentsWith,
  traceShapes,
  traceLines,
  distanceToPaper,
  mulberry32,
};
