import { vectorizeInternals as V, type RasterImage, type VectorizeFitParams, type VectorizeResult, type VectorLayer, type VectorPart } from "./vectorize";

/**
 * Photo / object mode of the offline vectorizer: a photo of a real thing (a mug, a pet, a
 * hand-painted sign, a product) → logo raw material. Pure TypeScript, deterministic, no ML.
 *
 * Pipeline
 *   crop → resample → exposure / contrast / denoise →
 *   subject isolation: background model from the image border (a smooth color surface fitted
 *     to the border ring + color clusters of the ring) → per-pixel background distance
 *     (with a shadow test) → flood fill from the border with a tolerance → enclosed
 *     background pockets → morphological open/close → keep the N largest subjects → holes →
 *   style: silhouette (one shape) | posterized (stacked tonal layers) |
 *     line art (edges → centerline strokes) | stencil (2–3 tones with bridges)
 *   → the shared tracer + curve fitter from vectorize.ts.
 *
 * Better isolation can be plugged in without bundling anything: pass `subjectMask` (from any
 * local segmentation tool), or use an image that already has a transparent background.
 */

export type PhotoStyle = "silhouette" | "posterized" | "lineart" | "stencil";
export type PhotoSubject = "auto" | "darker" | "lighter";
export const PHOTO_STYLES: PhotoStyle[] = ["silhouette", "posterized", "lineart", "stencil"];

/** A crop rectangle in fractions (0–1) of the image. */
export interface PhotoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoVectorizeOptions {
  /** What to draw from the isolated subject. Default "silhouette". */
  style?: PhotoStyle;
  /** Only look at this part of the image (fractions 0–1). Default: everything. */
  crop?: PhotoCrop | null;
  /** Separate the subject from its background (default true). Off = the whole crop is the subject. */
  isolate?: boolean;
  /** Hint: the subject is darker / lighter than the background ("auto" = any difference). */
  subject?: PhotoSubject;
  /** 0–1: how different from the background a pixel must be to count as subject. null = automatic. */
  tolerance?: number | null;
  /** 0–1: treat cast shadows on the background as background (0 = off). */
  shadows?: number;
  /** Keep the N largest subjects (1–6). */
  keep?: number;
  /** Fill holes inside the subject (e.g. a mug handle loop). */
  fillHoles?: boolean;
  /** 0–1: morphological clean-up of the subject mask (removes whiskers, closes nicks). */
  cleanup?: number;
  /** -1…1 brightness (stops-like, in linear light). */
  exposure?: number;
  /** -1…1 contrast. */
  contrast?: number;
  /** 0–1 blur before everything (sensor noise, textures). */
  denoise?: number;
  /** 0–1: higher = more nodes / finer working resolution. */
  detail?: number;
  /** 0–1: rounder, calmer curves. */
  smoothing?: number;
  /** 0–1: higher keeps more sharp corners. */
  corners?: number;
  /** 0–1: minimum region size (drop specks, fill pinholes). */
  specks?: number;
  /** Tonal layers: posterized 2–6, stencil 2–3. */
  tones?: number;
  /** Posterized colors: the photo's own colors or a gray ramp. */
  palette?: "color" | "mono";
  /** 0–1 stencil bridge width. */
  bridges?: number;
  /** 0–1 line-art stroke weight. */
  weight?: number;
  /** Fill / stroke color for silhouette and line art (default near-black ink). */
  color?: string;
  /** External subject mask (any size; alpha, or luminance when opaque; white/opaque = subject). */
  subjectMask?: RasterImage | null;
  /** Output coordinate size (the reference node's width × height). Default: image pixels. */
  target?: { width: number; height: number };
  /** Override the working resolution (long side, px) — small thumbnails. */
  workSide?: number;
}

export interface PhotoVectorizeResult extends VectorizeResult {
  style: PhotoStyle;
  /** Crop actually used (fractions). */
  crop: PhotoCrop;
  /** Subject mask at working resolution, covering the crop (1 = subject). */
  mask: { width: number; height: number; data: Uint8Array };
  subject: {
    /** The subject outline (silhouette) in output units. */
    parts: VectorPart[];
    /** Share of the crop covered by the subject (0–1). */
    coverage: number;
    /** Where the mask came from. */
    source: "border" | "alpha" | "mask" | "all";
  };
  /** Tolerance actually used (0–1 slider units), when the background was estimated. */
  tolerance: number | null;
  /** Stencil bridges added. */
  bridges: number;
}

export const PHOTO_DEFAULTS = {
  style: "silhouette" as PhotoStyle,
  isolate: true,
  subject: "auto" as PhotoSubject,
  tolerance: null as number | null,
  shadows: 0.6,
  keep: 1,
  fillHoles: false,
  cleanup: 0.35,
  exposure: 0,
  contrast: 0,
  denoise: 0.3,
  detail: 0.5,
  smoothing: 0.6,
  corners: 0.5,
  specks: 0.3,
  tones: 3,
  palette: "color" as "color" | "mono",
  bridges: 0.4,
  weight: 0.4,
  color: "#0b0c0e",
};

type Resolved = Omit<Required<PhotoVectorizeOptions>, "target" | "subjectMask" | "workSide" | "crop" | "tolerance"> & {
  crop: PhotoCrop;
  tolerance: number | null;
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolvePhotoOptions(o: PhotoVectorizeOptions = {}): Resolved {
  const D = PHOTO_DEFAULTS;
  const style: PhotoStyle = PHOTO_STYLES.includes(o.style as PhotoStyle) ? (o.style as PhotoStyle) : D.style;
  const c = o.crop;
  let crop: PhotoCrop = { x: 0, y: 0, width: 1, height: 1 };
  if (c && [c.x, c.y, c.width, c.height].every((v) => Number.isFinite(v))) {
    const x = clamp01(c.x);
    const y = clamp01(c.y);
    crop = { x, y, width: clamp(c.width, 0.02, 1 - x), height: clamp(c.height, 0.02, 1 - y) };
    if (crop.width < 0.02 || crop.height < 0.02) crop = { x: 0, y: 0, width: 1, height: 1 };
  }
  const tonesMax = style === "stencil" ? 3 : 6;
  return {
    style,
    crop,
    isolate: o.isolate ?? D.isolate,
    subject: o.subject === "darker" || o.subject === "lighter" ? o.subject : "auto",
    tolerance: o.tolerance === null || o.tolerance === undefined ? null : clamp01(o.tolerance),
    shadows: clamp01(num(o.shadows, D.shadows)),
    keep: clamp(Math.round(num(o.keep, D.keep)), 1, 6),
    fillHoles: o.fillHoles ?? D.fillHoles,
    cleanup: clamp01(num(o.cleanup, D.cleanup)),
    exposure: clamp(num(o.exposure, D.exposure), -1, 1),
    contrast: clamp(num(o.contrast, D.contrast), -1, 1),
    denoise: clamp01(num(o.denoise, D.denoise)),
    detail: clamp01(num(o.detail, D.detail)),
    smoothing: clamp01(num(o.smoothing, D.smoothing)),
    corners: clamp01(num(o.corners, D.corners)),
    specks: clamp01(num(o.specks, D.specks)),
    tones: clamp(Math.round(num(o.tones, D.tones)), 2, tonesMax),
    palette: o.palette === "mono" || style === "stencil" ? "mono" : "color",
    bridges: clamp01(num(o.bridges, D.bridges)),
    weight: clamp01(num(o.weight, D.weight)),
    color: typeof o.color === "string" && /^#[0-9a-f]{3,8}$/i.test(o.color) ? o.color : D.color,
  };
}

/** Long side the photo tracer works at for a detail level. */
export const photoWorkingSide = (detail: number) => Math.round(360 + clamp01(detail) * 840);

/* ------------------------------------------------------------------------------------------ */
/* entry point                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export function vectorizePhoto(img: RasterImage, options: PhotoVectorizeOptions = {}): PhotoVectorizeResult {
  const t0 = Date.now();
  const o = resolvePhotoOptions(options);
  const W = img.width;
  const H = img.height;
  // Crop in source pixels (whole pixels, so output offsets are exact).
  const cx0 = Math.min(W - 1, Math.floor(o.crop.x * W));
  const cy0 = Math.min(H - 1, Math.floor(o.crop.y * H));
  const cx1 = Math.max(cx0 + 1, Math.min(W, Math.ceil((o.crop.x + o.crop.width) * W)));
  const cy1 = Math.max(cy0 + 1, Math.min(H, Math.ceil((o.crop.y + o.crop.height) * H)));
  const crop: PhotoCrop = { x: cx0 / W, y: cy0 / H, width: (cx1 - cx0) / W, height: (cy1 - cy0) / H };
  const sub = cropImage(img, cx0, cy0, cx1 - cx0, cy1 - cy0);
  const side = Math.max(48, Math.round(options.workSide ?? photoWorkingSide(o.detail)));
  const { w, h, px } = V.resample(sub, side);
  const N = w * h;
  const tw = options.target?.width ?? W;
  const th = options.target?.height ?? H;
  const sx = (crop.width * tw) / w;
  const sy = (crop.height * th) / h;
  const ox = crop.x * tw;
  const oy = crop.y * th;
  const scale = Math.max(w, h) / 750; // knobs below are tuned at 750 px

  /* ---- pixels: composite over white, exposure / contrast, denoise ---- */
  const R = new Float32Array(N);
  const G = new Float32Array(N);
  const B = new Float32Array(N);
  const A = new Float32Array(N);
  const lut = toneLut(o.exposure, o.contrast);
  for (let p = 0; p < N; p++) {
    const a = px[p * 4 + 3]! / 255;
    A[p] = a;
    R[p] = lut[Math.round(px[p * 4]! * a + 255 * (1 - a))]!;
    G[p] = lut[Math.round(px[p * 4 + 1]! * a + 255 * (1 - a))]!;
    B[p] = lut[Math.round(px[p * 4 + 2]! * a + 255 * (1 - a))]!;
  }
  const dr = Math.round(o.denoise * 4 * scale);
  if (dr > 0) for (const ch of [R, G, B]) blur2(ch, w, h, dr);
  const lab = new Float32Array(N * 3);
  for (let p = 0; p < N; p++) V.oklab(R[p]!, G[p]!, B[p]!, lab, p * 3);

  /* ---- subject mask ---- */
  const minArea = Math.max(4, Math.round(o.specks * o.specks * 0.002 * N));
  let mask: Uint8Array;
  let source: PhotoVectorizeResult["subject"]["source"];
  let tolerance: number | null = null;
  let bgHex = "#ffffff";
  const ext = options.subjectMask ? externalMask(options.subjectMask, crop, w, h) : null;
  if (ext) {
    mask = ext;
    source = "mask";
  } else if (!o.isolate) {
    mask = new Uint8Array(N).fill(1);
    source = "all";
  } else if (mostlyClearBorder(A, w, h)) {
    mask = new Uint8Array(N);
    for (let p = 0; p < N; p++) mask[p] = A[p]! >= 0.5 ? 1 : 0;
    source = "alpha";
  } else {
    const iso = isolateSubject(lab, w, h, o, minArea, scale);
    mask = iso.mask;
    tolerance = iso.tolerance;
    bgHex = iso.background;
    source = "border";
  }
  if (source !== "all") refineMask(mask, w, h, o, minArea, scale);

  /* ---- fitting parameters ---- */
  const cornerAngle = lerp(118, 172, o.corners) - 12 * o.smoothing;
  const fitTol = lerp(0.95, 0.2, o.detail);
  const params: VectorizeFitParams = {
    sigma: 1 + o.smoothing * 3.5,
    k: 4 + Math.round(o.smoothing * 3),
    cornerCos: Math.cos((cornerAngle * Math.PI) / 180),
    err: fitTol * fitTol,
    farCorners: true,
    sx,
    sy,
    ox,
    oy,
  };
  const lineTol = lerp(1.7, 0.45, o.detail);
  const lineParams: VectorizeFitParams = {
    ...params,
    sigma: 1.6 + o.smoothing * 3.5,
    cornerCos: Math.cos(((cornerAngle - 15) * Math.PI) / 180),
    err: lineTol * lineTol,
    farCorners: false,
  };
  const softField = (m: Uint8Array, r: number) => {
    const v = new Float32Array(N);
    for (let p = 0; p < N; p++) v[p] = m[p]!;
    blur2(v, w, h, r);
    return { v, t: 0.5 };
  };
  const shapeR = o.smoothing >= 0.66 ? 2 : 1;
  const subjectParts = V.traceShapes(mask, w, h, params, minArea, softField(mask, shapeR));

  /* ---- style ---- */
  const layers: VectorLayer[] = [];
  let bridges = 0;
  const L = new Float32Array(N);
  for (let p = 0; p < N; p++) L[p] = lab[p * 3]!;

  if (o.style === "silhouette") {
    if (subjectParts.length) layers.push({ color: o.color, kind: "fill", strokeWidth: 0, parts: subjectParts });
  } else if (o.style === "posterized" || o.style === "stencil") {
    const Ls = new Float32Array(L);
    blur2(Ls, w, h, Math.round((0.5 + o.smoothing * 2) * scale));
    const classes = toneClasses(Ls, lab, mask, w, h, o.tones, o.style === "stencil" || o.palette === "mono" ? "mono" : "color");
    const K = classes.count;
    // Lightest at the bottom; each layer also covers the darker layers above it (no gaps).
    const ramp = (j: number) => grayHex(lerp(0.17, 0.86, K > 1 ? j / (K - 1) : 0));
    const first = o.style === "stencil" ? K - 2 : K - 1;
    for (let j = first; j >= 0; j--) {
      const m = new Uint8Array(N);
      let own = 0;
      for (let p = 0; p < N; p++)
        if (mask[p] && classes.rank[p]! <= j) {
          m[p] = 1;
          if (classes.rank[p] === j) own++;
        }
      if (!own) continue;
      if (j < K - 1) V.keepComponentsWith(m, w, h, (p) => classes.rank[p] === j);
      V.despeckle(m, w, h, minArea);
      if (o.style === "stencil") {
        bridges += bridgeIslands(m, w, h, Math.max(1, lerp(0.8, 4.5, o.bridges) * scale));
        V.despeckle(m, w, h, minArea);
      }
      const parts = V.traceShapes(m, w, h, params, minArea, softField(m, 1));
      if (!parts.length) continue;
      const color =
        o.style === "stencil"
          ? j === 0
            ? o.color
            : grayHex(0.62)
          : classes.mono
            ? j === 0 && o.color !== PHOTO_DEFAULTS.color
              ? o.color
              : ramp(j)
            : classes.colors[j]!;
      layers.push({ color, kind: "fill", strokeWidth: 0, parts });
    }
  } else {
    // Line art: edges of the subject's interior + its outline, as centerline strokes.
    const edges = edgeMap(L, mask, w, h, o, scale);
    V.despeckle(edges, w, h, Math.max(minArea, Math.round(lerp(70, 14, o.detail) * scale)));
    const { parts } = V.traceLines(edges, w, h, lineParams);
    const sw = lerp(1, 5.5, o.weight) * scale * ((sx + sy) / 2);
    if (parts.length) layers.push({ color: o.color, kind: "stroke", strokeWidth: round2(Math.max(0.5, sw)), parts });
  }

  let cover = 0;
  for (let p = 0; p < N; p++) cover += mask[p]!;
  const parts = layers.reduce((s, l) => s + l.parts.length, 0);
  const nodes = layers.reduce((s, l) => s + l.parts.reduce((a, q) => a + q.nodes, 0), 0);
  return {
    width: tw,
    height: th,
    layers,
    threshold: null,
    background: source === "alpha" ? "transparent" : bgHex,
    stats: { parts, nodes, workWidth: w, workHeight: h, ms: Date.now() - t0 },
    style: o.style,
    crop,
    mask: { width: w, height: h, data: mask },
    subject: { parts: subjectParts, coverage: cover / N, source },
    tolerance,
    bridges,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* pixels                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function cropImage(img: RasterImage, x0: number, y0: number, cw: number, ch: number): RasterImage {
  if (x0 === 0 && y0 === 0 && cw === img.width && ch === img.height) return img;
  const data = new Uint8ClampedArray(cw * ch * 4);
  const src = img.data;
  for (let y = 0; y < ch; y++) {
    const s = ((y0 + y) * img.width + x0) * 4;
    for (let i = 0; i < cw * 4; i++) data[y * cw * 4 + i] = src[s + i]!;
  }
  return { width: cw, height: ch, data };
}

/** sRGB 0–255 → adjusted 0–255: exposure as gain in linear light, contrast as an S-curve. */
function toneLut(exposure: number, contrast: number): Float32Array {
  const lut = new Float32Array(256);
  const gain = 2 ** (exposure * 1.6);
  const k = contrast >= 0 ? 1 + contrast * 2.2 : 1 + contrast * 0.75;
  for (let i = 0; i < 256; i++) {
    let c = i / 255;
    let l = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    l = Math.min(1, l * gain);
    c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    // Contrast around mid-gray, softened at the ends (logistic blend).
    if (k !== 1) {
      const x = c - 0.5;
      c = k > 1 ? 0.5 + 0.5 * Math.tanh(x * 2 * k) / Math.tanh(k) : 0.5 + x * k;
    }
    lut[i] = clamp(c * 255, 0, 255);
  }
  return lut;
}

/** Two box-blur passes ≈ a gaussian. */
function blur2(v: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) return;
  const a = Math.max(1, Math.round(r * 0.6));
  V.boxBlur(v, w, h, a);
  V.boxBlur(v, w, h, Math.max(1, r - a));
}

const grayHex = (L: number) => {
  // OKLab lightness → sRGB gray.
  const l = L * L * L;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return V.hex(c * 255, c * 255, c * 255);
};

function borderIndices(w: number, h: number, ring: number, max = 8000): number[] {
  const idx: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) {
        x = w - ring - 1;
        continue;
      }
      idx.push(y * w + x);
    }
  if (idx.length <= max) return idx;
  const step = idx.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(idx[Math.floor(i * step)]!);
  return out;
}

function mostlyClearBorder(A: Float32Array, w: number, h: number): boolean {
  const idx = borderIndices(w, h, 1);
  let clear = 0;
  for (const p of idx) if (A[p]! < 0.5) clear++;
  return clear > idx.length * 0.5;
}

/** Resample an external mask over the crop to the working grid. */
function externalMask(m: RasterImage, crop: PhotoCrop, w: number, h: number): Uint8Array | null {
  if (!m.width || !m.height || m.data.length < m.width * m.height * 4) return null;
  let hasAlpha = false;
  for (let i = 3; i < m.data.length; i += 4 * 7)
    if (m.data[i]! < 250) {
      hasAlpha = true;
      break;
    }
  const out = new Uint8Array(w * h);
  // Area-average over each working pixel's footprint in the mask.
  for (let y = 0; y < h; y++) {
    const fy0 = (crop.y + (y / h) * crop.height) * m.height;
    const fy1 = (crop.y + ((y + 1) / h) * crop.height) * m.height;
    for (let x = 0; x < w; x++) {
      const fx0 = (crop.x + (x / w) * crop.width) * m.width;
      const fx1 = (crop.x + ((x + 1) / w) * crop.width) * m.width;
      let s = 0;
      let n = 0;
      for (let yy = Math.floor(fy0); yy < Math.max(Math.floor(fy0) + 1, Math.ceil(fy1)); yy++)
        for (let xx = Math.floor(fx0); xx < Math.max(Math.floor(fx0) + 1, Math.ceil(fx1)); xx++) {
          const q = (clamp(yy, 0, m.height - 1) * m.width + clamp(xx, 0, m.width - 1)) * 4;
          s += hasAlpha ? m.data[q + 3]! : 0.299 * m.data[q]! + 0.587 * m.data[q + 1]! + 0.114 * m.data[q + 2]!;
          n++;
        }
      out[y * w + x] = s / n >= 127.5 ? 1 : 0;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* subject isolation                                                                           */
/* ------------------------------------------------------------------------------------------ */

/** Solve a small dense linear system (Gaussian elimination with partial pivoting). */
function solve(M: number[][], b: number[]): number[] | null {
  const n = b.length;
  const a = M.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    if (Math.abs(a[piv]![c]!) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k <= n; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

const basis = (x: number, y: number) => [1, x, y, x * x, x * y, y * y];

/**
 * Background model: a quadratic color surface (OKLab) fitted to the border ring, robustly
 * (samples far from the fit — the subject touching the edge — are dropped and the fit
 * repeated), plus up to three color clusters of the ring for two-tone backdrops.
 */
function backgroundModel(lab: Float32Array, w: number, h: number) {
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const idx = borderIndices(w, h, ring);
  const nx = (p: number) => ((p % w) / Math.max(1, w - 1)) * 2 - 1;
  const ny = (p: number) => (Math.floor(p / w) / Math.max(1, h - 1)) * 2 - 1;
  let use = idx;
  let coef: number[][] = [
    [0.5, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ];
  const evalAt = (c: number[], x: number, y: number) => {
    const b = basis(x, y);
    let s = 0;
    for (let i = 0; i < 6; i++) s += c[i]! * b[i]!;
    return s;
  };
  const resid = (p: number) =>
    Math.hypot(lab[p * 3]! - evalAt(coef[0]!, nx(p), ny(p)), lab[p * 3 + 1]! - evalAt(coef[1]!, nx(p), ny(p)), lab[p * 3 + 2]! - evalAt(coef[2]!, nx(p), ny(p)));
  for (let it = 0; it < 3; it++) {
    const M = Array.from({ length: 6 }, () => new Array(6).fill(0) as number[]);
    const rhs = [0, 1, 2].map(() => new Array(6).fill(0) as number[]);
    for (const p of use) {
      const b = basis(nx(p), ny(p));
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) M[i]![j]! += b[i]! * b[j]!;
        for (let c = 0; c < 3; c++) rhs[c]![i]! += b[i]! * lab[p * 3 + c]!;
      }
    }
    // A little ridge keeps the fit sane when the ring is sparse.
    for (let i = 1; i < 6; i++) M[i]![i]! += use.length * 1e-3;
    const next = rhs.map((r) => solve(M, r));
    if (next.some((c) => !c)) break;
    coef = next as number[][];
    const rs = idx.map(resid).sort((a, b) => a - b);
    const med = rs[rs.length >> 1] ?? 0;
    const cut = Math.max(0.03, med * 3);
    use = idx.filter((p) => resid(p) <= cut);
    if (use.length < 24) break;
  }
  // Color clusters of the ring (k-means, deterministic seeds by luminance quantiles).
  const K = 3;
  const sorted = [...idx].sort((a, b) => lab[a * 3]! - lab[b * 3]!);
  const cent = new Float64Array(K * 3);
  for (let c = 0; c < K; c++) {
    const p = sorted[Math.floor(((c + 0.5) / K) * sorted.length)]!;
    for (let j = 0; j < 3; j++) cent[c * 3 + j] = lab[p * 3 + j]!;
  }
  const assign = new Int8Array(idx.length);
  const cnt = new Float64Array(K);
  for (let it = 0; it < 10; it++) {
    const sums = new Float64Array(K * 3);
    cnt.fill(0);
    idx.forEach((p, i) => {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < K; c++) {
        const d = (lab[p * 3]! - cent[c * 3]!) ** 2 + (lab[p * 3 + 1]! - cent[c * 3 + 1]!) ** 2 + (lab[p * 3 + 2]! - cent[c * 3 + 2]!) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      assign[i] = best;
      cnt[best]++;
      for (let j = 0; j < 3; j++) sums[best * 3 + j] += lab[p * 3 + j]!;
    });
    for (let c = 0; c < K; c++) if (cnt[c]) for (let j = 0; j < 3; j++) cent[c * 3 + j] = sums[c * 3 + j]! / cnt[c]!;
  }
  // Keep clusters that hold a real share of the ring and are tight.
  const clusters: [number, number, number][] = [];
  for (let c = 0; c < K; c++) {
    if (cnt[c]! < idx.length * 0.15) continue;
    const ds: number[] = [];
    idx.forEach((p, i) => {
      if (assign[i] === c) ds.push(Math.hypot(lab[p * 3]! - cent[c * 3]!, lab[p * 3 + 1]! - cent[c * 3 + 1]!, lab[p * 3 + 2]! - cent[c * 3 + 2]!));
    });
    ds.sort((a, b) => a - b);
    if ((ds[Math.floor(ds.length * 0.75)] ?? 1) < 0.08) clusters.push([cent[c * 3]!, cent[c * 3 + 1]!, cent[c * 3 + 2]!]);
  }
  const surface = (p: number, out: number[]) => {
    const x = nx(p);
    const y = ny(p);
    out[0] = evalAt(coef[0]!, x, y);
    out[1] = evalAt(coef[1]!, x, y);
    out[2] = evalAt(coef[2]!, x, y);
  };
  return { surface, clusters, ring: idx };
}

/** Per-pixel distance from the background (OKLab ΔE-like, 0 = background). */
function backgroundDistance(lab: Float32Array, w: number, h: number, o: Resolved) {
  const N = w * h;
  const model = backgroundModel(lab, w, h);
  const d = new Float32Array(N);
  const bgc = [0, 0, 0];
  const kmin = 1 - 0.5 * o.shadows;
  for (let p = 0; p < N; p++) {
    const Lp = lab[p * 3]!;
    const ap = lab[p * 3 + 1]!;
    const bp = lab[p * 3 + 2]!;
    model.surface(p, bgc);
    let best: number;
    if (o.subject === "auto") {
      best = Math.hypot(Lp - bgc[0]!, ap - bgc[1]!, bp - bgc[2]!);
      for (const c of model.clusters) best = Math.min(best, Math.hypot(Lp - c[0], ap - c[1], bp - c[2]));
    } else {
      const sign = o.subject === "darker" ? -1 : 1;
      best = Math.max(0, sign * (Lp - bgc[0]!));
      for (const c of model.clusters) best = Math.min(best, Math.max(0, sign * (Lp - c[0])));
      // A strong color change still counts a little (a colored object of similar lightness).
      best = Math.max(best, Math.hypot(ap - bgc[1]!, bp - bgc[2]!) * 0.5);
    }
    // Cast shadow: darker background with the same hue. In OKLab, dimming a color in linear
    // light scales L, a and b by the same factor.
    if (o.shadows > 0 && o.subject !== "lighter") {
      const shadowOf = (L0: number, a0: number, b0: number) => {
        if (L0 <= 0.05) return;
        const k = Lp / L0;
        if (k >= kmin && k < 1) best = Math.min(best, Math.hypot(ap - a0 * k, bp - b0 * k) * 1.4);
      };
      shadowOf(bgc[0]!, bgc[1]!, bgc[2]!);
      for (const c of model.clusters) shadowOf(c[0], c[1], c[2]);
    }
    d[p] = best;
  }
  return { d, model };
}

function isolateSubject(lab: Float32Array, w: number, h: number, o: Resolved, minArea: number, scale: number) {
  const N = w * h;
  // A little extra blur for the distance field only: texture and grain stay background.
  const L2 = new Float32Array(lab);
  const chans = [0, 1, 2].map((c) => {
    const v = new Float32Array(N);
    for (let p = 0; p < N; p++) v[p] = L2[p * 3 + c]!;
    blur2(v, w, h, Math.max(1, Math.round(1.5 * scale)));
    return v;
  });
  for (let p = 0; p < N; p++) for (let c = 0; c < 3; c++) L2[p * 3 + c] = chans[c]![p]!;
  const { d, model } = backgroundDistance(L2, w, h, o);

  // Noise level of the background: how far the ring itself strays from the model.
  const ringD = model.ring.map((p) => d[p]!).sort((a, b) => a - b);
  const noise = ringD[Math.floor(ringD.length * 0.8)] ?? 0.02;
  // Above the background noise, and not far below the split between background and subject.
  const dc = new Float32Array(d.length);
  for (let p = 0; p < d.length; p++) dc[p] = Math.min(1, d[p]!);
  const noiseT = noise * 2.4 + 0.035;
  const autoT = clamp(Math.max(noiseT, V.otsu(dc) * 0.45), 0.04, 0.32);
  const t = o.tolerance === null ? autoT : lerp(0.01, 0.4, o.tolerance);
  const tolerance = o.tolerance ?? clamp01((autoT - 0.01) / 0.39);

  // Flood the background from the border (4-connected) through pixels close to the model.
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (p: number) => {
    if (!bg[p] && d[p]! < t) {
      bg[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (sp) {
    const p = stack[--sp]!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < N - w) push(p + w);
  }
  // Enclosed pockets of clear background (a mug handle loop, the gap between legs).
  if (!o.fillHoles) {
    const seen = new Uint8Array(N);
    const comp: number[] = [];
    // Pockets must look like clean background (the noise level, not the raised split).
    const tight = Math.min(t, noiseT) * 0.8;
    const minPocket = Math.max(minArea * 3, Math.round(N * 0.0008));
    for (let s = 0; s < N; s++) {
      if (bg[s] || seen[s] || d[s]! >= tight) continue;
      comp.length = 0;
      sp = 0;
      stack[sp++] = s;
      seen[s] = 1;
      while (sp) {
        const p = stack[--sp]!;
        comp.push(p);
        const x = p % w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (q < 0 || q >= N || seen[q] || bg[q] || d[q]! >= tight) continue;
          seen[q] = 1;
          stack[sp++] = q;
        }
      }
      if (comp.length >= minPocket) for (const p of comp) bg[p] = 1;
    }
  }
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = bg[p] ? 0 : 1;

  // Typical background color (for the result's `background`).
  const c = [0, 0, 0];
  model.surface(Math.floor(h / 2) * w + Math.floor(w / 2), c);
  const background = oklabToHex(c[0]!, c[1]!, c[2]!);
  return { mask, tolerance, background };
}

function oklabToHex(L: number, a: number, b: number): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (v: number) => {
    v = clamp01(v);
    return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
  };
  return V.hex(enc(r), enc(g), enc(bl));
}

/** Morphological erosion / dilation by a (chamfer-)round radius. */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const D = V.distanceToPaper(mask, w, h);
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) out[p] = D[p]! > r ? 1 : 0;
  return out;
}
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) inv[p] = mask[p] ? 0 : 1;
  const D = V.distanceToPaper(inv, w, h);
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) out[p] = mask[p] || D[p]! <= r ? 1 : 0;
  return out;
}

/** Open + close, keep the N largest subjects, deal with holes. In place. */
function refineMask(mask: Uint8Array, w: number, h: number, o: Resolved, minArea: number, scale: number) {
  const N = w * h;
  const r = o.cleanup * 6 * scale;
  if (r >= 0.75) {
    let m = dilate(erode(mask, w, h, r), w, h, r);
    m = erode(dilate(m, w, h, r), w, h, r);
    mask.set(m);
  }
  // Components (8-connected), largest first.
  const label = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let sp = 0;
    let n = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const p = stack[--sp]!;
      n++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && label[q] < 0) {
            label[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    sizes.push(n);
  }
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]! - sizes[a]!);
  const keep = new Uint8Array(sizes.length);
  const biggest = sizes[order[0] ?? 0] ?? 0;
  order.slice(0, o.keep).forEach((i) => {
    if (sizes[i]! >= minArea && (i === order[0] || sizes[i]! >= biggest * 0.02)) keep[i] = 1;
  });
  for (let p = 0; p < N; p++) if (mask[p] && !keep[label[p]!]) mask[p] = 0;
  // Pinholes always; every hole when asked.
  V.despeckle(mask, w, h, minArea);
  if (o.fillHoles) fillAllHoles(mask, w, h);
}

/** Fill every 0-region that does not reach the image border (4-connected). */
function fillAllHoles(mask: Uint8Array, w: number, h: number) {
  const N = w * h;
  const out = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (p: number) => {
    if (!mask[p] && !out[p]) {
      out[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (sp) {
    const p = stack[--sp]!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < N - w) push(p + w);
  }
  for (let p = 0; p < N; p++) if (!out[p]) mask[p] = 1;
}

/* ------------------------------------------------------------------------------------------ */
/* tones                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * Split the subject into K tonal classes, rank 0 = darkest. "mono": 1-D k-means on lightness;
 * "color": k-means in OKLab with lightness weighted up (tones first, hues second).
 */
function toneClasses(L: Float32Array, lab: Float32Array, mask: Uint8Array, w: number, h: number, K: number, mode: "mono" | "color") {
  const N = w * h;
  const rank = new Int8Array(N).fill(-1);
  const inside: number[] = [];
  for (let p = 0; p < N; p++) if (mask[p]) inside.push(p);
  if (!inside.length) return { rank, colors: [] as string[], count: 0, mono: mode === "mono" };
  const step = Math.max(1, Math.floor(inside.length / 50000));
  const samples: number[] = [];
  for (let i = 0; i < inside.length; i += step) samples.push(inside[i]!);
  const sortedL = samples.map((p) => L[p]!).sort((a, b) => a - b);
  const wL = mode === "mono" ? 1 : 2;
  const wC = mode === "mono" ? 0 : 1;
  const dim = 3;
  const cent = new Float64Array(K * dim);
  for (let c = 0; c < K; c++) {
    const q = sortedL[Math.min(sortedL.length - 1, Math.floor(((c + 0.5) / K) * sortedL.length))]!;
    cent[c * dim] = q;
    cent[c * dim + 1] = 0;
    cent[c * dim + 2] = 0;
  }
  const vec = (p: number, out: number[]) => {
    out[0] = L[p]!;
    out[1] = lab[p * 3 + 1]!;
    out[2] = lab[p * 3 + 2]!;
  };
  if (wC) {
    // Seed chroma with the mean of each lightness band.
    const sums = new Float64Array(K * 3);
    for (const p of samples) {
      let c = 0;
      while (c < K - 1 && L[p]! > (cent[c * dim]! + cent[(c + 1) * dim]!) / 2) c++;
      sums[c * 3] += lab[p * 3 + 1]!;
      sums[c * 3 + 1] += lab[p * 3 + 2]!;
      sums[c * 3 + 2]++;
    }
    for (let c = 0; c < K; c++) if (sums[c * 3 + 2]) (cent[c * dim + 1] = sums[c * 3]! / sums[c * 3 + 2]!), (cent[c * dim + 2] = sums[c * 3 + 1]! / sums[c * 3 + 2]!);
  }
  const v = [0, 0, 0];
  const nearest = (p: number) => {
    vec(p, v);
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < K; c++) {
      const d = wL * wL * (v[0]! - cent[c * dim]!) ** 2 + wC * ((v[1]! - cent[c * dim + 1]!) ** 2 + (v[2]! - cent[c * dim + 2]!) ** 2);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  for (let it = 0; it < 14; it++) {
    const sums = new Float64Array(K * 4);
    for (const p of samples) {
      const c = nearest(p);
      vec(p, v);
      sums[c * 4] += v[0]!;
      sums[c * 4 + 1] += v[1]!;
      sums[c * 4 + 2] += v[2]!;
      sums[c * 4 + 3]++;
    }
    let moved = 0;
    for (let c = 0; c < K; c++) {
      const n = sums[c * 4 + 3]!;
      if (!n) continue;
      for (let j = 0; j < 3; j++) {
        const nv = sums[c * 4 + j]! / n;
        moved += Math.abs(nv - cent[c * dim + j]!);
        cent[c * dim + j] = nv;
      }
    }
    if (moved < 1e-5) break;
  }
  // Rank clusters by lightness (0 = darkest); drop empty ones.
  const label = new Int8Array(N).fill(-1);
  const area = new Float64Array(K);
  for (const p of inside) {
    const c = nearest(p);
    label[p] = c;
    area[c]++;
  }
  const order = [...Array(K).keys()].filter((c) => area[c]! > 0).sort((a, b) => cent[a * dim]! - cent[b * dim]!);
  const rk = new Int8Array(K).fill(-1);
  order.forEach((c, i) => (rk[c] = i));
  const rgb = new Float64Array(order.length * 4);
  for (const p of inside) {
    const r = rk[label[p]!]!;
    rank[p] = r;
  }
  // Mean color per class (from lab via the inverse transform, averaged in OKLab).
  for (const p of inside) {
    const r = rank[p]!;
    rgb[r * 4] += lab[p * 3]!;
    rgb[r * 4 + 1] += lab[p * 3 + 1]!;
    rgb[r * 4 + 2] += lab[p * 3 + 2]!;
    rgb[r * 4 + 3]++;
  }
  const colors = order.map((_, i) => {
    const n = rgb[i * 4 + 3]! || 1;
    return oklabToHex(rgb[i * 4]! / n, rgb[i * 4 + 1]! / n, rgb[i * 4 + 2]! / n);
  });
  return { rank, colors, count: order.length, mono: mode === "mono" };
}

/* ------------------------------------------------------------------------------------------ */
/* stencil bridges                                                                             */
/* ------------------------------------------------------------------------------------------ */

/**
 * Make a cut layer stencil-safe: every enclosed island of sheet (0 inside 1, 4-connected —
 * the pieces that would fall out when cut) is tied to the outside with a bridge of width
 * ~2·radius along the shortest path through the cut region. Returns the bridges added.
 */
export function bridgeIslands(mask: Uint8Array, w: number, h: number, radius: number): number {
  const N = w * h;
  // Sheet components (4-connected 0-regions); those touching the border are "outside".
  const comp = new Int32Array(N).fill(-1);
  const outside: boolean[] = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (mask[s] || comp[s] >= 0) continue;
    const id = outside.length;
    let sp = 0;
    let border = false;
    stack[sp++] = s;
    comp[s] = id;
    while (sp) {
      const p = stack[--sp]!;
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || mask[q] || comp[q] >= 0) continue;
        comp[q] = id;
        stack[sp++] = q;
      }
    }
    outside.push(border);
  }
  if (!outside.some((b) => !b)) return 0;
  const anyOutside = outside.some((b) => b);
  const joined = outside.slice();
  const members = new Map<number, number[]>();
  for (let p = 0; p < N; p++) {
    const c = comp[p]!;
    if (c >= 0 && !outside[c]) (members.get(c) ?? members.set(c, []).get(c)!).push(p);
  }
  // BFS from the outside sheet (or the image frame when there is none), through the cut region.
  const parent = new Int32Array(N).fill(-2); // -2 unvisited, -1 source
  const queue = new Int32Array(N * 2);
  let qh = 0;
  let qt = 0;
  for (let p = 0; p < N; p++) {
    const x = p % w;
    const y = (p - x) / w;
    const source = anyOutside ? !mask[p] && joined[comp[p]!] : x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (source) {
      parent[p] = -1;
      queue[qt++] = p;
    }
  }
  const r2 = radius * radius;
  const ri = Math.ceil(radius);
  const carve = (p: number) => {
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -ri; dy <= ri; dy++)
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r2 + 0.25) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        mask[yy * w + xx] = 0;
      }
  };
  let bridges = 0;
  while (qh < qt) {
    const p = queue[qh++]!;
    const x = p % w;
    const y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || parent[q] !== -2) continue;
      const c = comp[q]!;
      if (c >= 0 && !joined[c]) {
        // Reached an island: carve the path back to the outside, then the island joins it.
        bridges++;
        joined[c] = true;
        let a = p;
        while (a >= 0) {
          carve(a);
          const nx = parent[a]!;
          parent[a] = -1;
          a = nx;
        }
        for (const s of members.get(c) ?? [])
          if (parent[s] === -2) {
            parent[s] = -1;
            if (qt < queue.length) queue[qt++] = s;
          }
        continue;
      }
      parent[q] = p;
      if (qt < queue.length) queue[qt++] = q;
    }
  }
  return bridges;
}

/* ------------------------------------------------------------------------------------------ */
/* line art                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * Canny-like edges inside the subject (Sobel → non-maximum suppression → hysteresis), plus
 * the subject's own outline; a 1-px dilation bridges small gaps (the tracer thins it back).
 */
function edgeMap(L: Float32Array, mask: Uint8Array, w: number, h: number, o: Resolved, scale: number): Uint8Array {
  const N = w * h;
  const Y = new Float32Array(L);
  blur2(Y, w, h, Math.max(1, Math.round((1 + o.smoothing * 2.5) * scale)));
  const mag = new Float32Array(N);
  const dir = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = Y[p - w + 1]! + 2 * Y[p + 1]! + Y[p + w + 1]! - Y[p - w - 1]! - 2 * Y[p - 1]! - Y[p + w - 1]!;
      const gy = Y[p + w - 1]! + 2 * Y[p + w]! + Y[p + w + 1]! - Y[p - w - 1]! - 2 * Y[p - w]! - Y[p - w + 1]!;
      mag[p] = Math.hypot(gx, gy);
      const a = (Math.atan2(gy, gx) * 180) / Math.PI;
      const t = (a + 180) % 180;
      dir[p] = t < 22.5 || t >= 157.5 ? 0 : t < 67.5 ? 1 : t < 112.5 ? 2 : 3;
    }
  // Interior: the subject eroded away from its outline (the outline is drawn from the mask).
  const inner = erode(mask, w, h, Math.max(2, 3 * scale));
  const vals: number[] = [];
  for (let p = 0; p < N; p += 3) if (inner[p] && mag[p]! > 0) vals.push(mag[p]!);
  vals.sort((a, b) => a - b);
  const ref = Math.max(0.02, vals[Math.floor(vals.length * 0.98)] ?? 0.1);
  const hi = ref * lerp(0.5, 0.14, o.detail);
  const lo = hi * 0.45;
  const nms = new Uint8Array(N); // 2 strong, 1 weak
  const OFF = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!inner[p]) continue;
      const m = mag[p]!;
      if (m < lo) continue;
      const [dx, dy] = OFF[dir[p]!]!;
      if (m < mag[p + dy! * w + dx!]! || m < mag[p - dy! * w - dx!]!) continue;
      nms[p] = m >= hi ? 2 : 1;
    }
  const edges = new Uint8Array(N);
  const stack: number[] = [];
  for (let p = 0; p < N; p++) if (nms[p] === 2 && !edges[p]) {
    edges[p] = 1;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w;
      const y = (q - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const r = yy * w + xx;
          if (nms[r] && !edges[r]) {
            edges[r] = 1;
            stack.push(r);
          }
        }
    }
  }
  // Outline: the subject's boundary band (unless the subject is the whole crop).
  let full = true;
  for (let p = 0; p < N && full; p++) if (!mask[p]) full = false;
  if (!full) {
    const er = erode(mask, w, h, 1);
    for (let p = 0; p < N; p++) if (mask[p] && !er[p]) edges[p] = 1;
  }
  return dilate(edges, w, h, 1);
}

/* ------------------------------------------------------------------------------------------ */
/* helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * How photo-like an image is (0–1): neighboring pixels that differ a little (grain, soft
 * gradients — flat artwork has runs of identical pixels) and plenty of mid-tones (a sketch on
 * paper is mostly paper). The studio uses it to open the right tab.
 */
export function photoLikelihood(img: RasterImage): number {
  const { width: W, height: H, data } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((W * H) / 40000)));
  let n = 0;
  let noisy = 0;
  let mid = 0;
  for (let y = 0; y < H; y += step)
    for (let x = 0; x + 1 < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3]! < 128 || data[i + 7]! < 128) continue;
      n++;
      const diff = Math.abs(data[i]! - data[i + 4]!) + Math.abs(data[i + 1]! - data[i + 5]!) + Math.abs(data[i + 2]! - data[i + 6]!);
      if (diff > 0 && diff < 30) noisy++;
      const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      if (l > 25 && l < 215) mid++;
    }
  if (!n) return 0;
  return clamp01(((noisy / n) * 1.6) ** 0.8) * clamp01(mid / n / 0.35);
}

/** Small SVG of the subject mask (for previews): subject outline over a dimmed crop. */
export function photoMaskOutline(r: PhotoVectorizeResult): string {
  return r.subject.parts.map((p) => p.d).join("");
}
