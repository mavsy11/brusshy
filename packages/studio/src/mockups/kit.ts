import { colorwayInks, fmt, type DocT } from "@brusshy/core";
import { ensureFont, textToPath, textWidth as measureText } from "../lib/fonts";
import { svgToPng, svgViewBox, type Box } from "../export/raster";
import { buildSvg, prepareFonts } from "../export/svg";
import { extractPalette, luminance, parseColor, slug, type PaletteColor } from "../export/util";
import { iconMark, readableOn } from "../export/variants";

/**
 * Everything a mockup scene needs about the logo: trimmed artwork (full and icon mark,
 * color and one-color), palette, a typesetter, and the light/dark decision.
 * Scenes are drawn as SVG (1600 × 1200 units) and rasterized by the browser.
 */

export const SW = 1600;
export const SH = 1200;

export interface Art {
  /** Standalone SVG (cropped to the artwork). */
  svg: string;
  vb: Box;
  aspect: number;
}

export interface LogoKit {
  /** Brand name for labels (document name without the version suffix). */
  brand: string;
  domain: string;
  handle: string;
  full: Art;
  mark: Art;
  /** One-color versions. */
  /**
   * One-color version. With `surface`, parts in the dominant color print in `color` and every
   * other part is knocked out to the surface color (how a one-color print reads); without it,
   * the export's luminance-based monochrome.
   */
  mono: (color: string, which?: "full" | "mark" | "lockup", surface?: string) => Art;
  /**
   * Full-color art for a surface: parts sitting on the surface that would vanish there (a dark
   * wordmark on a dark page) take the readable ink; everything else keeps its color.
   */
  on: (surface: string, which?: "full" | "mark" | "lockup") => Art;
  /** Colors of the logo's plates (a badge carrying the mark): they hold the mark's contrast. */
  plates: Set<string>;
  /** Horizontal lockup (mark beside the wordmark) for wide spaces; the full logo when it is already wide. */
  lockup: Art;
  colors: PaletteColor[];
  /** Main brand color (most used non-neutral color, else the most used color). */
  primary: string;
  /** Whether the logo has real color (not just black/white/gray). */
  colorful: boolean;
  /** Weighted luminance of the logo's paint (0 dark – 1 light). */
  lum: number;
  dark: boolean;
  /** Icon tile: background + the art to put on it. */
  tile: { bg: string; art: Art; border: boolean };
  /** Small rasters of the mark for honest pixel checks (data URLs). */
  px: (size: number) => Promise<string>;
  /** Outlined text as a <path> (Geist). Empty when the font could not load. */
  text: (s: string, o: TextOpts) => string;
  textWidth: (s: string, o: Pick<TextOpts, "size" | "weight" | "tracking">) => number;
}

export interface TextOpts {
  x: number;
  y: number;
  size: number;
  weight?: 400 | 500 | 600 | 700;
  fill: string;
  anchor?: "start" | "middle" | "end";
  /** Letter spacing in em. */
  tracking?: number;
  opacity?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const f = (n: number) => fmt(Math.round(n * 100) / 100);

/** WCAG contrast ratio of two CSS colors. */
export function contrast(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 1;
  const la = luminance(x.r, x.g, x.b);
  const lb = luminance(y.r, y.g, y.b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function saturation(hex: string): number {
  const c = parseColor(hex);
  if (!c) return 0;
  const mx = Math.max(c.r, c.g, c.b) / 255;
  const mn = Math.min(c.r, c.g, c.b) / 255;
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** Mix two colors (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a) ?? { r: 0, g: 0, b: 0 };
  const y = parseColor(b) ?? { r: 0, g: 0, b: 0 };
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(x.r + (y.r - x.r) * t)}${h(x.g + (y.g - x.g) * t)}${h(x.b + (y.b - x.b) * t)}`;
}

let uid = 0;

/**
 * Test hook (test/mockup-contrast): sees every logo a scene places, by order, and may rewrite its
 * inner SVG. Decorative embeds (watermarks) are passed with `decor` set so checks can skip them.
 */
export type EmbedProbe = (inner: string, index: number, decor: boolean) => string;
let probe: EmbedProbe | null = null;
let probeIndex = 0;
export function setEmbedProbe(fn: EmbedProbe | null): void {
  probe = fn;
  probeIndex = 0;
}

/** Nest an Art inside a scene, fitted (meet) into the box. Ids are prefixed so embeds never clash. */
export function place(a: Art, x: number, y: number, w: number, h: number, extra = ""): string {
  return embed(a, x, y, w, h, extra, true);
}

function embed(a: Art, x: number, y: number, w: number, h: number, extra: string, scene: boolean): string {
  const p = `l${++uid}_`;
  const m = a.svg.match(/<svg\b[^>]*>/);
  if (!m) return "";
  const inner = a.svg
    .slice(m.index! + m[0].length, a.svg.lastIndexOf("</svg>"))
    .replace(/\bid="/g, `id="${p}`)
    .replace(/url\(#/g, `url(#${p}`)
    .replace(/href="#/g, `href="#${p}`);
  const body = scene && probe ? probe(inner, probeIndex++, extra.includes("data-decor")) : inner;
  const { vb } = a;
  return `<svg x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" viewBox="${f(vb.x)} ${f(vb.y)} ${f(vb.width)} ${f(vb.height)}" preserveAspectRatio="xMidYMid meet" overflow="visible"${extra}>${body}</svg>`;
}

/** Size of an Art fitted into w × h. */
export function fit(a: Art, w: number, h: number): { w: number; h: number } {
  return w / h > a.aspect ? { w: h * a.aspect, h } : { w, h: w / a.aspect };
}

/** iOS-style continuous-corner squircle (superellipse) path, centered box. */
export function squircle(x: number, y: number, size: number, n = 5): string {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  const pts: string[] = [];
  const N = 96;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const px = cx + r * Math.sign(c) * Math.abs(c) ** (2 / n);
    const py = cy + r * Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${f(px)} ${f(py)}`);
  }
  return `M${pts.join("L")}Z`;
}

export function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

/** Shared filters: layered soft shadows, paper grain, fabric weave. */
export function baseDefs(): string {
  const shadow = (id: string, near: number, far: number, farBlur: number, farDy: number, strength = 1) => `
    <filter id="${id}" x="-40%" y="-40%" width="180%" height="190%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${near}" result="n0"/><feOffset in="n0" dy="${near * 0.8}" result="n1"/>
      <feComponentTransfer in="n1" result="n2"><feFuncA type="linear" slope="${0.24 * strength}"/></feComponentTransfer>
      <feGaussianBlur in="SourceAlpha" stdDeviation="${farBlur}" result="f0"/><feOffset in="f0" dy="${farDy}" result="f1"/>
      <feComponentTransfer in="f1" result="f2"><feFuncA type="linear" slope="${far * strength}"/></feComponentTransfer>
      <feMerge><feMergeNode in="f2"/><feMergeNode in="n2"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
  return `
    ${shadow("sh-lg", 2.2, 0.22, 34, 34)}
    ${shadow("sh-md", 1.6, 0.2, 18, 18)}
    ${shadow("sh-sm", 1, 0.18, 8, 7)}
    ${shadow("sh-dark", 2.2, 0.55, 34, 30, 1.6)}
    <filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.7 0 0 0 -0.62"/>
    </filter>
    <filter id="grain-light" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.7 0 0 0 -0.66"/>
    </filter>
    <filter id="mottle" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="3" seed="3"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.2 0 0 0 -0.45"/>
    </filter>`;
}

/** Full-bleed grain overlay. */
export const grain = (x: number, y: number, w: number, h: number, opacity: number, light = false, clip = "") =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" filter="url(#${light ? "grain-light" : "grain"})" opacity="${opacity}"${clip}/>`;

export const wrapScene = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}"><defs>${baseDefs()}${defs}</defs>${body}</svg>`;

const art = (svg: string): Art => {
  const vb = svgViewBox(svg);
  return { svg, vb, aspect: vb.width / Math.max(1e-6, vb.height) };
};

const NEUTRAL_SAT = 0.14;

export async function prepareLogo(doc: DocT, brandName: string, theme: "auto" | "light" | "dark"): Promise<LogoKit> {
  await Promise.all([prepareFonts(doc), ensureFont("Geist", 400), ensureFont("Geist", 500), ensureFont("Geist", 600)]);
  const markDoc = iconMark(doc);
  const build = (d: DocT, monochrome?: string, square = false) => art(buildSvg(d, { trim: { pad: 0, square }, background: null, monochrome }));
  const full = build(doc);
  const mark = build(markDoc);
  const { colors } = extractPalette(doc);
  const dominant = colors[0];

  // Horizontal lockup: mark + wordmark side by side (stacked logos read small in wide spaces).
  const words = doc.root.filter((id) => {
    const n = doc.nodes[id];
    return n && n.visible && n.type === "text";
  });
  const wordDoc: DocT | null = words.length && markDoc.root.length && !markDoc.root.some((id) => words.includes(id)) ? { ...doc, root: words } : null;
  const makeLockup = (m: Art, w: Art): Art => {
    const H = 100;
    const mw = H * m.aspect;
    const wh = H * 0.42;
    const ww = wh * w.aspect;
    const gap = H * 0.3;
    const W = mw + gap + ww;
    return art(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${H}" width="${f(W)}" height="${H}">${embed(m, 0, 0, mw, H, "", false)}${embed(w, mw + gap, (H - wh) / 2, ww, wh, "", false)}</svg>`,
    );
  };
  const wordArt = wordDoc ? build(wordDoc) : null;
  const lockup = full.aspect < 2 && wordArt ? makeLockup(mark, wordArt) : full;

  // Knock-outs only read when one color carries the silhouette (ink + highlights). A mark built
  // from many equal colors (petals, facets…) prints as one solid silhouette instead.
  const knockout = !!dominant && dominant.uses / (colors.reduce((t, c) => t + c.uses, 0) || 1) >= 0.45;
  /** Dominant-color parts → ink, everything else → knocked out to the surface. */
  const recolor = (svg: string, ink: string, surface: string) =>
    svg.replace(/\b(fill|stroke)="([^"]+)"/g, (m, attr: string, v: string) => {
      if (v === "none") return m;
      if (v.startsWith("url(")) return `${attr}="${ink}"`;
      const c = parseColor(v);
      if (!c || !dominant || !knockout) return `${attr}="${ink}"`;
      const d = Math.hypot(c.r - dominant.r, c.g - dominant.g, c.b - dominant.b);
      return `${attr}="${d < 70 ? ink : surface}"`;
    });
  const monoCache = new Map<string, Art>();
  const mono = (color: string, which: "full" | "mark" | "lockup" = "full", surface?: string): Art => {
    const k = `${which}|${color}|${surface ?? ""}`;
    let a = monoCache.get(k);
    if (a) return a;
    if (which === "lockup") {
      a = wordArt && full.aspect < 2 ? makeLockup(mono(color, "mark", surface), surface ? art(recolor(wordArt.svg, color, surface)) : build(wordDoc!, color)) : mono(color, "full", surface);
    } else {
      const src = which === "mark" ? markDoc : doc;
      a = surface ? art(recolor(buildSvg(src, { trim: { pad: 0 }, background: null }), color, surface)) : build(src, color);
    }
    monoCache.set(k, a!);
    return a!;
  };
  const readable = readableOn(doc);
  const plates = new Set(colorwayInks(doc, "", { textToPath }).filter((k) => k.host).flatMap((k) => k.members));
  const onCache = new Map<string, Art>();
  const on = (surface: string, which: "full" | "mark" | "lockup" = "full"): Art => {
    const base = which === "full" ? full : which === "lockup" ? lockup : mark;
    const key = `${which}|${surface}`;
    let a = onCache.get(key);
    if (a) return a;
    const svg = readable(base.svg, surface);
    a = svg === base.svg ? base : art(svg);
    onCache.set(key, a);
    return a;
  };
  const total = colors.reduce((s, c) => s + c.uses, 0) || 1;
  const lum = colors.length ? colors.reduce((s, c) => s + luminance(c.r, c.g, c.b) * c.uses, 0) / total : 0;
  const chromatic = colors.filter((c) => saturation(c.hex) > NEUTRAL_SAT && luminance(c.r, c.g, c.b) > 0.02);
  const primary = (chromatic[0] ?? colors[0])?.hex ?? "#0B0C0E";
  const colorful = chromatic.length > 0;

  // Light or dark surroundings: whichever the logo contrasts with more.
  const score = (bg: string) => colors.reduce((s, c) => s + Math.min(contrast(c.hex, bg), 7) * c.uses, 0) / total;
  const dark = theme === "dark" ? true : theme === "light" ? false : colors.length ? score("#141518") > score("#f3f1ec") * 1.15 : false;

  // App-icon / avatar tile.
  const frameBg = doc.artboard.background;
  let tile: LogoKit["tile"];
  const singleHue = chromatic.length >= 1 && colors.filter((c) => saturation(c.hex) > NEUTRAL_SAT || luminance(c.r, c.g, c.b) < 0.5).length <= 1;
  if (frameBg && contrast(frameBg, "#ffffff") > 1.15) tile = { bg: frameBg, art: mark, border: false };
  else if (singleHue && contrast(primary, "#ffffff") >= 2.4) tile = { bg: primary, art: mono("#ffffff", "mark", primary), border: false };
  else if (lum > 0.6) tile = { bg: "#101113", art: mark, border: false };
  else tile = { bg: "#ffffff", art: mark, border: true };

  const pxCache = new Map<number, string>();
  const px = async (size: number) => {
    let url = pxCache.get(size);
    if (url) return url;
    const sq = buildSvg(markDoc, { trim: { pad: 0.04, square: true }, background: null });
    const blob = await svgToPng(sq, size, { height: size });
    url = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
    pxCache.set(size, url);
    return url;
  };

  const text = (s: string, o: TextOpts) => {
    const d = textToPath({ text: s, fontFamily: "Geist", fontWeight: o.weight ?? 500, fontSize: o.size, letterSpacing: (o.tracking ?? 0) * o.size, anchor: o.anchor ?? "start" });
    if (!d) return "";
    return `<path d="${d}" transform="translate(${f(o.x)} ${f(o.y)})" fill="${esc(o.fill)}"${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ""}/>`;
  };
  const textWidth = (s: string, o: Pick<TextOpts, "size" | "weight" | "tracking">) =>
    measureText({ text: s, fontFamily: "Geist", fontWeight: o.weight ?? 500, fontSize: o.size, letterSpacing: (o.tracking ?? 0) * o.size });

  const brand = brandName.trim() || "Brand";
  const s = slug(brand).replace(/-/g, "");
  return {
    brand,
    domain: `${s || "brand"}.com`,
    handle: `@${s || "brand"}`,
    full,
    mark,
    mono,
    on,
    plates,
    lockup,
    colors,
    primary,
    colorful,
    lum,
    dark,
    tile,
    px,
    text,
    textWidth,
  };
}

/** A soft gradient wash built from the brand color (wallpapers, banners). */
export function brandWash(id: string, k: LogoKit, dark: boolean): string {
  const base = k.colorful ? k.primary : dark ? "#2a2c31" : "#c9cdd2";
  const a = dark ? mix(base, "#08090b", 0.55) : mix(base, "#ffffff", 0.55);
  const b = dark ? mix(base, "#000000", 0.2) : mix(base, "#ffffff", 0.15);
  const c = dark ? mix(base, "#1a1b1f", 0.8) : mix(base, "#f6efe6", 0.75);
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
}
