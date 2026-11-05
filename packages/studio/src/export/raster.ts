import { fmt } from "@brusshy/core";

/** Largest side we rasterize (browsers cap canvases around 16k; 8k keeps memory sane). */
export const MAX_SIDE = 8192;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Set (or replace) attributes on the root <svg> tag without reparsing the whole document. */
export function setRootAttrs(svg: string, attrs: Record<string, string | number>): string {
  const m = svg.match(/<svg\b[^>]*>/);
  if (!m) return svg;
  let tag = m[0];
  for (const [k, v] of Object.entries(attrs)) {
    const val = typeof v === "number" ? fmt(v) : esc(v);
    const re = new RegExp(`\\s${k}="[^"]*"`);
    tag = re.test(tag) ? tag.replace(re, ` ${k}="${val}"`) : tag.replace(/\s*\/?>$/, (end) => ` ${k}="${val}"${end}`);
  }
  return svg.slice(0, m.index) + tag + svg.slice(m.index! + m[0].length);
}

/** Read the root viewBox (falls back to width/height). */
export function svgViewBox(svg: string): Box {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
  const vb = tag.match(/viewBox="([^"]+)"/)?.[1]?.split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) return { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]! };
  const w = Number(tag.match(/\swidth="([\d.]+)/)?.[1] ?? 1024);
  const h = Number(tag.match(/\sheight="([\d.]+)/)?.[1] ?? 1024);
  return { x: 0, y: 0, width: w, height: h };
}

/** Crop/extend the SVG to a new viewBox (the output size follows the box). */
export function withViewBox(svg: string, box: Box): string {
  return setRootAttrs(svg, {
    viewBox: `${fmt(box.x)} ${fmt(box.y)} ${fmt(box.width)} ${fmt(box.height)}`,
    width: box.width,
    height: box.height,
  });
}

/** Insert a background rect covering the whole viewBox (bottom of the paint order). */
export function withBackground(svg: string, color: string | null | undefined): string {
  if (!color) return svg;
  const box = svgViewBox(svg);
  const m = svg.match(/<svg\b[^>]*>/);
  if (!m) return svg;
  const at = m.index! + m[0].length;
  const rect = `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.width)}" height="${fmt(box.height)}" fill="${esc(color)}"/>`;
  const nl = svg.slice(at, at + 1) === "\n" ? "\n  " : "";
  return svg.slice(0, at) + nl + rect + svg.slice(at);
}

/** Output pixel size for a target width, preserving aspect and capped at MAX_SIDE. */
export function pixelSize(box: Box, width: number, height?: number): { w: number; h: number } {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height ?? (w * box.height) / box.width));
  const k = Math.min(1, MAX_SIDE / w, MAX_SIDE / h);
  if (k < 1) {
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  return { w, h };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not rasterize the SVG"));
    img.src = src;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas is too large to encode"))), type, quality),
  );
}

export interface RasterOptions {
  /** Explicit height; defaults to the SVG's aspect. */
  height?: number;
  /** Opaque fill behind the artwork (null/undefined = transparent). */
  background?: string | null;
  /** Draw extra things on top after the artwork (pins, marks…), in output pixels. */
  overlay?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** Rasterize an SVG string to a canvas. The browser renders the vector at the target size (no bitmap upscaling). */
export async function svgToCanvas(svg: string, width: number, o: RasterOptions = {}): Promise<HTMLCanvasElement> {
  const box = svgViewBox(svg);
  const { w, h } = pixelSize(box, width, o.height);
  // Size the SVG to the output so the rasterizer works at full resolution.
  const sized = setRootAttrs(svg, { width: w, height: h, preserveAspectRatio: "xMidYMid meet" });
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    o.overlay?.(ctx, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SVG string → PNG blob at `width` px (height by aspect unless given), capped at 8192 px per side. */
export async function svgToPng(svg: string, width: number, o: RasterOptions = {}): Promise<Blob> {
  const canvas = await svgToCanvas(svg, width, o);
  const blob = await canvasToBlob(canvas);
  canvas.width = canvas.height = 0; // free GPU/backing memory right away (Safari)
  return blob;
}

const GEOMETRY = "path,rect,circle,ellipse,line,polyline,polygon,text,image,use";

/**
 * Bounds of the visible artwork in viewBox units, including stroke widths.
 * Renders the SVG into a hidden DOM node and measures each element with getBBox().
 */
export function measureContent(svg: string): Box | null {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:strict;width:1px;height:1px;overflow:hidden";
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    const root = host.querySelector("svg");
    if (!root) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const el of Array.from(root.querySelectorAll<SVGGraphicsElement>(GEOMETRY))) {
      if (el.closest("defs,clipPath,mask,pattern,symbol")) continue;
      const cs = getComputedStyle(el);
      // (visibility is inherited from the hidden host, so only display is meaningful here)
      if (cs.display === "none") continue;
      const hasStroke = cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0;
      const hasFill = cs.fill !== "none" || el.tagName === "image" || el.tagName === "use";
      if (!hasStroke && !hasFill) continue;
      let bb: DOMRect;
      try {
        bb = el.getBBox();
      } catch {
        continue;
      }
      if (bb.width === 0 && bb.height === 0) continue;
      let pad = 0;
      if (hasStroke) {
        const sw = parseFloat(cs.strokeWidth);
        const join = cs.strokeLinejoin;
        const cap = cs.strokeLinecap;
        pad = (sw / 2) * (join === "miter" || join === "miter-clip" ? 2 : cap === "square" ? Math.SQRT2 : 1);
      }
      const m = el.getCTM();
      if (!m) continue;
      const corners: [number, number][] = [
        [bb.x - pad, bb.y - pad],
        [bb.x + bb.width + pad, bb.y - pad],
        [bb.x - pad, bb.y + bb.height + pad],
        [bb.x + bb.width + pad, bb.y + bb.height + pad],
      ];
      for (const [x, y] of corners) {
        const px = m.a * x + m.c * y + m.e;
        const py = m.b * x + m.d * y + m.f;
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px);
        y1 = Math.max(y1, py);
      }
    }
    if (!Number.isFinite(x0) || x1 - x0 <= 0 || y1 - y0 <= 0) return null;
    // getCTM maps to the root viewport; convert back to viewBox units.
    const vb = svgViewBox(svg);
    const rw = root.width.baseVal.value || vb.width;
    const rh = root.height.baseVal.value || vb.height;
    const sx = vb.width / rw;
    const sy = vb.height / rh;
    return { x: vb.x + x0 * sx, y: vb.y + y0 * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy };
  } finally {
    host.remove();
  }
}

/** Grow a box by `ratio` of its longest side on every edge; optionally make it square (centered). */
export function padBox(b: Box, ratio: number, square = false): Box {
  let { x, y, width, height } = b;
  if (square) {
    const s = Math.max(width, height);
    x -= (s - width) / 2;
    y -= (s - height) / 2;
    width = height = s;
  }
  const p = Math.max(width, height) * ratio;
  return { x: x - p, y: y - p, width: width + 2 * p, height: height + 2 * p };
}

/** Round a box outward to tidy numbers (keeps viewBoxes readable). */
export function tidyBox(b: Box, step = 0.5): Box {
  const x = Math.floor(b.x / step) * step;
  const y = Math.floor(b.y / step) * step;
  return { x, y, width: Math.ceil((b.x + b.width - x) / step) * step, height: Math.ceil((b.y + b.height - y) / step) * step };
}
