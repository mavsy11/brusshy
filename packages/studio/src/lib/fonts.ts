import { parse, Path, type Font, type Glyph } from "opentype.js";
import { create } from "zustand";
import { extraFont, hasTypeControls, type DocT, type TextNodeT } from "@brusshy/core";
import { ensureTypeset, typesetGlyphs, typesetPath, typesetWidth } from "../typeset/engine";
import { decodeWoff2 } from "../typeset/sources";

/** Type controls (variable axes, OpenType features, alternates, kerning) — handled by typeset/engine.ts. */
type TypeOpts = Partial<Pick<TextNodeT, "axes" | "features" | "alternates" | "kerning" | "kerns">>;

/** Curated families that look good in logos (Fontsource / Google Fonts, plus EXTRA_FONTS from npm; all open licence). */
export const FONT_FAMILIES = [
  "Geist",
  "Inter",
  "Inter Tight",
  "Manrope",
  "Space Grotesk",
  "Bricolage Grotesque",
  "Syne",
  "Unbounded",
  "Montserrat",
  "Archivo Black",
  "Bebas Neue",
  "Oswald",
  "Playfair Display",
  "Cormorant Garamond",
  "Instrument Serif",
  "Geist Serif",
  "DM Serif Display",
  "Abril Fatface",
  "Cinzel",
  "Rye",
  "Poiret One",
  "Limelight",
  "Righteous",
  "Fredoka",
  "Baloo 2",
  "Pacifico",
  "Lobster",
  "Space Mono",
];

const fontId = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

interface Meta {
  weights: number[];
}

const metaCache = new Map<string, Promise<Meta | null>>();
const fontCache = new Map<string, Font>();
const loading = new Map<string, Promise<Font | null>>();

/** Bumps whenever a font finishes loading so text outlines re-render. */
export const useFontVersion = create<{ v: number }>(() => ({ v: 0 }));

async function meta(family: string): Promise<Meta | null> {
  const id = fontId(family);
  let p = metaCache.get(id);
  const x = extraFont(family);
  if (!p && x) metaCache.set(id, (p = Promise.resolve({ weights: x.weights })));
  if (!p) {
    p = fetch(`https://api.fontsource.org/v1/fonts/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Meta>) : null))
      .catch(() => null);
    metaCache.set(id, p);
  }
  return p;
}

const nearest = (weights: number[], w: number) => weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), weights[0] ?? 400);

const key = (family: string, weight: number) => `${fontId(family)}|${weight}`;

/** Load a family/weight for display (FontFace) and for outlining (opentype). */
export function ensureFont(family: string, weight: number): Promise<Font | null> {
  const k0 = key(family, weight);
  const cached = fontCache.get(k0);
  if (cached) return Promise.resolve(cached);
  const existing = loading.get(k0);
  if (existing) return existing;
  const p = (async () => {
    const m = await meta(family);
    if (!m?.weights?.length) return null;
    const w = nearest(m.weights, weight);
    const k = key(family, w);
    let font = fontCache.get(k);
    if (!font) {
      const x = extraFont(family);
      const res = await fetch(x ? x.url : `https://cdn.jsdelivr.net/fontsource/fonts/${fontId(family)}@latest/latin-${w}-normal.woff`);
      if (!res.ok) return null;
      const buf = x ? await decodeWoff2(await res.arrayBuffer()) : await res.arrayBuffer();
      font = parse(buf);
      fontCache.set(k, font);
      try {
        // FontFace may detach the buffer, and opentype reads glyphs lazily from it: give it a copy.
        const face = new FontFace(family, buf.slice(0), { weight: String(w) });
        await face.load();
        document.fonts.add(face);
      } catch {
        /* display falls back; outlines still work */
      }
    }
    fontCache.set(k0, font);
    useFontVersion.setState((s) => ({ v: s.v + 1 }));
    return font;
  })().catch(() => null);
  loading.set(k0, p);
  return p;
}

/**
 * Glyph-by-glyph layout with kerning only. Used when opentype's shaping engine
 * throws on a font feature it doesn't support yet (some GSUB lookups).
 */
function simpleLayout(font: Font, text: string, size: number, letterSpacing: number) {
  const scale = size / font.unitsPerEm;
  const glyphs = Array.from(text).map((ch) => font.charToGlyph(ch));
  let x = 0;
  const placed = glyphs.map((g, i) => {
    const at = x;
    const adv = Number(g.advanceWidth);
    x += (Number.isFinite(adv) ? adv : font.unitsPerEm * 0.5) * scale + letterSpacing;
    const next = glyphs[i + 1];
    if (next) {
      let k = 0;
      try {
        k = Number(font.getKerningValue(g, next));
      } catch {
        /* kerning table this engine can't read */
      }
      if (Number.isFinite(k)) x += k * scale;
    }
    return { g, at };
  });
  return { placed, width: Math.max(0, x - letterSpacing) };
}

/** Fonts whose shaping failed once: opentype may later return garbage (NaN) instead of throwing. */
const broken = new WeakSet<Font>();

function safeWidth(font: Font, text: string, size: number, letterSpacing: number): number {
  if (!broken.has(font)) {
    try {
      const w = font.getAdvanceWidth(text, size, { kerning: true, letterSpacing: letterSpacing / size });
      if (Number.isFinite(w)) return w;
    } catch {
      /* unsupported GSUB/GPOS lookup */
    }
    broken.add(font);
  }
  return simpleLayout(font, text, size, letterSpacing).width;
}

/** Shaped path when the font's features work; glyph-by-glyph otherwise. Never returns NaN coordinates. */
function shapedPath(font: Font, text: string, x: number, y: number, size: number, letterSpacingEm: number): Path {
  if (!broken.has(font)) {
    try {
      const p = font.getPath(text, x, y, size, { kerning: true, letterSpacing: letterSpacingEm });
      if (p.commands.every((c) => Object.values(c).every((v) => typeof v !== "number" || Number.isFinite(v)))) return p;
    } catch {
      /* unsupported GSUB/GPOS lookup */
    }
    broken.add(font);
  }
  const out = new Path();
  for (const { g, at } of simpleLayout(font, text, size, letterSpacingEm * size).placed) out.extend(g.getPath(x + at, y, size));
  return out;
}

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) || !Number.isFinite(r) ? "0" : String(r);
};

/**
 * Serialize an opentype path ourselves: its toPathData() prints tiny values
 * (e.g. 1e-14 left by float math) as "NaN" for some positions and sizes.
 */
export function pathToD(p: Path): string {
  let d = "";
  for (const c of p.commands) {
    if (c.type === "M" || c.type === "L") d += `${c.type}${num(c.x)} ${num(c.y)}`;
    else if (c.type === "Q") d += `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
    else if (c.type === "C") d += `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
    else if (c.type === "Z") d += "Z";
  }
  return d;
}

/** getAdvanceWidth that never throws (letterSpacing in em, like opentype). */
export function safeAdvance(font: Font, text: string, size: number, letterSpacingEm = 0): number {
  return safeWidth(font, text, size, letterSpacingEm * size);
}

/** getPath that never throws: falls back to glyph-by-glyph layout (letterSpacing in em). */
export function safeGetPath(font: Font, text: string, x: number, y: number, size: number, letterSpacingEm = 0): Path {
  return shapedPath(font, text, x, y, size, letterSpacingEm);
}

/** Outline a text node to path data (local coordinates, baseline at y=0). Null until the font is loaded. */
export function textToPath(n: Pick<TextNodeT, "text" | "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing" | "anchor"> & TypeOpts): string | null {
  if (hasTypeControls(n)) {
    // Full type engine; while its font loads (or if it can't), fall through to the plain outline.
    const d = typesetPath(n);
    if (d !== undefined) return d;
  }
  const font = fontCache.get(key(n.fontFamily, n.fontWeight));
  if (!font) {
    void ensureFont(n.fontFamily, n.fontWeight);
    return null;
  }
  const width = safeWidth(font, n.text, n.fontSize, n.letterSpacing);
  const x = n.anchor === "middle" ? -width / 2 : n.anchor === "end" ? -width : 0;
  return pathToD(shapedPath(font, n.text, x, 0, n.fontSize, n.letterSpacing / n.fontSize));
}

/** Advance width of a text node in px (falls back to an estimate). */
export function textWidth(n: Pick<TextNodeT, "text" | "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing"> & TypeOpts): number {
  if (hasTypeControls(n)) {
    const w = typesetWidth({ anchor: "start", ...n });
    if (w !== undefined) return w;
  }
  const font = fontCache.get(key(n.fontFamily, n.fontWeight));
  if (!font) return n.text.length * n.fontSize * 0.55;
  return safeWidth(font, n.text, n.fontSize, n.letterSpacing);
}

const finitePath = (p: Path) => p.commands.every((c) => Object.values(c).every((v) => typeof v !== "number" || Number.isFinite(v)));

/**
 * Per-glyph outlines of a text node, laid out exactly like textToPath (same shaping, kerning and
 * letter-spacing; local coordinates, baseline at y=0, anchor applied). Used by custom lettering.
 * Null until the font is loaded.
 */
export function textGlyphs(n: Pick<TextNodeT, "text" | "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing" | "anchor"> & TypeOpts): { text: string; d: string }[] | null {
  if (hasTypeControls(n)) {
    const g = typesetGlyphs(n);
    if (g !== undefined) return g;
  }
  const font = fontCache.get(key(n.fontFamily, n.fontWeight));
  if (!font) {
    void ensureFont(n.fontFamily, n.fontWeight);
    return null;
  }
  const width = safeWidth(font, n.text, n.fontSize, n.letterSpacing);
  const x0 = n.anchor === "middle" ? -width / 2 : n.anchor === "end" ? -width : 0;
  const chars = Array.from(n.text);
  if (!broken.has(font)) {
    try {
      const out: { g: Glyph; p: Path }[] = [];
      const opts = { kerning: true, letterSpacing: n.letterSpacing / n.fontSize };
      font.forEachGlyph(n.text, x0, 0, n.fontSize, opts, (g, gx, gy, gs, o) => out.push({ g, p: g.getPath(gx, gy, gs, o, font) }));
      if (out.every((x) => finitePath(x.p))) {
        // One glyph per character unless the font substituted ligatures: then name glyphs by what they draw.
        const same = out.length === chars.length;
        return out.map(({ g, p }, i) => ({
          text: same ? chars[i]! : g.unicode !== undefined ? String.fromCodePoint(g.unicode) : (g.name ?? "").split(".")[0]!.replace(/_/g, "") || "?",
          d: pathToD(p),
        }));
      }
    } catch {
      /* unsupported GSUB/GPOS lookup */
    }
    broken.add(font);
  }
  return simpleLayout(font, n.text, n.fontSize, n.letterSpacing).placed.map(({ g, at }, i) => ({ text: chars[i]!, d: pathToD(g.getPath(x0 + at, 0, n.fontSize)) }));
}

/** Load every font a document uses (await before exporting). */
export async function preloadDocFonts(doc: DocT): Promise<void> {
  const wants = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n.type !== "text") continue;
    if (hasTypeControls(n)) jobs.push(ensureTypeset(n));
    const k = key(n.fontFamily, n.fontWeight);
    if (wants.has(k)) continue;
    wants.add(k);
    jobs.push(ensureFont(n.fontFamily, n.fontWeight));
  }
  await Promise.all(jobs);
}

if (import.meta.env.DEV) (window as unknown as { __fonts: unknown }).__fonts = { fontCache, ensureFont, textToPath };
