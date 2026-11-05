import { DEFAULT_ON_FEATURES, featureOn, hasTypeControls, type TextNodeT, type TypeFields } from "@brusshy/core";
import { loadFace, peekFace, type Face, type FaceRequest } from "./sources";
import { alternateFor, substitute, type Item } from "./gsub";
import { pairKerning } from "./gpos";
import { fixGlyphVariations } from "./gvarfix";

/**
 * The type engine behind text nodes that use type controls (variable axes, OpenType features,
 * glyph alternates, optical/manual kerning). Plain text nodes keep the original opentype.js path in
 * lib/fonts.ts; fonts.ts routes a node here only when `hasTypeControls(node)`.
 *
 * Outlines come from the variation-applied glyph (opentype.js 2 applies gvar/CFF2 + HVAR + avar);
 * shaping is our GSUB engine (gsub.ts), kerning our GPOS reader (gpos.ts) or optical kerning.
 */

export type TypesetSpec = Pick<TextNodeT, "text" | "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing" | "anchor"> & TypeFields;

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };

export interface Outline {
  cmds: Cmd[];
  /** Advance in font units. */
  adv: number;
  /** Ink bounds in font units (y up); null for empty glyphs. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface Placed {
  g: number;
  chars: number[];
  /** Pen position in px from the start of the line (before the anchor offset). */
  x: number;
  outline: Outline;
}

export interface Layout {
  face: Face;
  scale: number;
  placed: Placed[];
  width: number;
  /** Anchor offset applied to every x. */
  x0: number;
}

/** opentype.js 2's variation manager (missing from the 1.x type definitions). */
type Variation = { getTransform: (g: unknown, c: Record<string, number>) => { path: { commands: Cmd[] }; advanceWidth: number }; process: { getNormalizedCoords: (c: Record<string, number>) => number[] } };
export const variationOf = (face: Face) => (face.font as unknown as { variation?: Variation }).variation ?? null;

export const faceRequestFor = (n: Pick<TypesetSpec, "fontFamily" | "fontWeight" | "axes">): FaceRequest => ({
  family: n.fontFamily,
  weight: n.fontWeight,
  italic: (n.axes?.ital ?? 0) >= 0.5,
  variable: Object.keys(n.axes ?? {}).some((k) => k !== "ital"),
});

/** fvar axes of a face (empty when static). */
export function faceAxes(face: Face): { tag: string; name: string; min: number; max: number; default: number }[] {
  const fvar = (face.font.tables as { fvar?: { axes: { tag: string; minValue: number; maxValue: number; defaultValue: number; name?: Record<string, string> }[] } }).fvar;
  if (!face.variable || !fvar) return [];
  return fvar.axes.map((a) => ({ tag: a.tag.trim(), name: a.name?.en ?? Object.values(a.name ?? {})[0] ?? a.tag, min: a.minValue, max: a.maxValue, default: a.defaultValue }));
}

/** Variation coordinates for a node: the font's defaults, wght from fontWeight, then the node's axes (clamped). */
export function coordsFor(face: Face, n: Pick<TypesetSpec, "fontWeight" | "axes">): Record<string, number> | null {
  const axes = faceAxes(face);
  if (!axes.length) return null;
  const out: Record<string, number> = {};
  for (const a of axes) {
    let v = a.default;
    if (a.tag === "wght") v = n.fontWeight;
    const want = n.axes?.[a.tag];
    if (want !== undefined && Number.isFinite(want)) v = want;
    out[a.tag] = Math.min(a.max, Math.max(a.min, v));
  }
  return out;
}

const coordsKey = (c: Record<string, number> | null) => (c ? Object.entries(c).map(([k, v]) => `${k}${Math.round(v * 100) / 100}`).join(",") : "");

/** Normalized coordinates in fvar order (for GPOS variation deltas). */
function normalized(face: Face, coords: Record<string, number> | null): number[] | null {
  const v = variationOf(face);
  if (!coords || !v) return null;
  try {
    return v.process.getNormalizedCoords({ ...coords });
  } catch {
    return null;
  }
}

function bbox(cmds: Cmd[]): Outline["box"] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) {
    for (const [x, y] of [[c.x, c.y], [c.x1, c.y1], [c.x2, c.y2]] as const) {
      if (x === undefined || y === undefined) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** Fix opentype.js's "all points" tuple bug for a glyph and its components (see gvarfix.ts). */
function repair(face: Face, gid: number, depth: number) {
  fixGlyphVariations(face, gid);
  const g = face.font.glyphs.get(gid) as unknown as { isComposite?: boolean; components?: { glyphIndex: number }[] };
  if (g?.isComposite && depth < 4) for (const c of g.components ?? []) repair(face, c.glyphIndex, depth + 1);
}

/** A glyph's outline (font units) at the given variation coordinates. Cached per face. */
export function outlineOf(face: Face, gid: number, coords: Record<string, number> | null): Outline {
  const k = `o:${gid}|${coordsKey(coords)}`;
  const hit = face.cache.get(k) as Outline | undefined;
  if (hit) return hit;
  const font = face.font;
  const glyph = font.glyphs.get(gid) ?? font.glyphs.get(0);
  let cmds: Cmd[] = [];
  let adv = 0;
  try {
    const v = variationOf(face);
    if (coords && v) {
      repair(face, gid, 0);
      const t = v.getTransform(glyph, { ...coords });
      cmds = t.path.commands;
      adv = Number(t.advanceWidth);
    } else {
      cmds = glyph.path.commands as Cmd[];
      adv = Number(glyph.advanceWidth);
    }
  } catch (e) {
    console.warn(`[type] outline failed for glyph ${gid} in ${face.family}`, e);
    try {
      cmds = glyph.path.commands as Cmd[];
    } catch {
      cmds = [];
    }
    adv = Number(glyph.advanceWidth);
  }
  if (!Number.isFinite(adv)) adv = font.unitsPerEm * 0.5;
  cmds = cmds.filter((c) => Object.values(c).every((v) => typeof v !== "number" || Number.isFinite(v)));
  const out: Outline = { cmds, adv, box: bbox(cmds) };
  if (face.cache.size > 20000) for (const key of [...face.cache.keys()].filter((x) => x.startsWith("o:") || x.startsWith("p:")).slice(0, 5000)) face.cache.delete(key);
  face.cache.set(k, out);
  return out;
}

/* ---------- optical kerning ---------- */

const BANDS = 24;

/** Horizontal ink profile: per band (0…capHeight), leftmost and rightmost ink x (font units), or null. */
function profile(face: Face, gid: number, coords: Record<string, number> | null, o: Outline): ({ l: number; r: number } | null)[] {
  const k = `p:${gid}|${coordsKey(coords)}`;
  const hit = face.cache.get(k) as ({ l: number; r: number } | null)[] | undefined;
  if (hit) return hit;
  const segs: [number, number, number, number][] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const c of o.cmds) {
    if (c.type === "M") {
      cx = sx = c.x!;
      cy = sy = c.y!;
    } else if (c.type === "L") {
      segs.push([cx, cy, c.x!, c.y!]);
      cx = c.x!;
      cy = c.y!;
    } else if (c.type === "Q" || c.type === "C") {
      let px = cx, py = cy;
      for (let s = 1; s <= 8; s++) {
        const t = s / 8, u = 1 - t;
        const x = c.type === "Q" ? u * u * cx + 2 * u * t * c.x1! + t * t * c.x! : u * u * u * cx + 3 * u * u * t * c.x1! + 3 * u * t * t * c.x2! + t * t * t * c.x!;
        const y = c.type === "Q" ? u * u * cy + 2 * u * t * c.y1! + t * t * c.y! : u * u * u * cy + 3 * u * u * t * c.y1! + 3 * u * t * t * c.y2! + t * t * t * c.y!;
        segs.push([px, py, x, y]);
        px = x;
        py = y;
      }
      cx = c.x!;
      cy = c.y!;
    } else if (c.type === "Z") {
      segs.push([cx, cy, sx, sy]);
      cx = sx;
      cy = sy;
    }
  }
  const cap = capHeight(face);
  const out = Array.from({ length: BANDS }, (_, b) => {
    const y = ((b + 0.5) / BANDS) * cap;
    let l = Infinity, r = -Infinity;
    for (const [x0, y0, x1, y1] of segs) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        if (x < l) l = x;
        if (x > r) r = x;
      }
    }
    return Number.isFinite(l) ? { l, r } : null;
  });
  face.cache.set(k, out);
  return out;
}

function capHeight(face: Face): number {
  const os2 = (face.font.tables as { os2?: { sCapHeight?: number; sxHeight?: number } }).os2;
  return os2?.sCapHeight || face.font.unitsPerEm * 0.7;
}
export function xHeight(face: Face): number {
  const os2 = (face.font.tables as { os2?: { sxHeight?: number } }).os2;
  return os2?.sxHeight || face.font.unitsPerEm * 0.5;
}

/** Mean gap (font units) between two glyphs over the bands where both have ink zones, each band capped at `depth`. */
function gapBetween(face: Face, a: { g: number; o: Outline }, b: { g: number; o: Outline }, coords: Record<string, number> | null, top: number, depth: number): number | null {
  const pa = profile(face, a.g, coords, a.o), pb = profile(face, b.g, coords, b.o);
  const cap = capHeight(face);
  let sum = 0, n = 0;
  for (let i = 0; i < BANDS; i++) {
    const y = ((i + 0.5) / BANDS) * cap;
    if (y > top) break;
    const ra = pa[i] ? a.o.adv - pa[i]!.r : depth;
    const lb = pb[i] ? pb[i]!.l : depth;
    sum += Math.min(depth, Math.max(0, ra) + Math.max(0, lb));
    n++;
  }
  return n >= 3 ? sum / n : null;
}

/**
 * Optical kerning: equalize the white space between letters (area-based, each band capped so open
 * shapes like T, L, r don't collapse), relative to the font's own n·n / H·H spacing.
 */
function opticalKern(face: Face, a: { g: number; o: Outline }, b: { g: number; o: Outline }, coords: Record<string, number> | null): number | null {
  if (!a.o.box || !b.o.box) return null;
  const upm = face.font.unitsPerEm;
  const xh = xHeight(face), cap = capHeight(face);
  const top = Math.min(a.o.box.y1, b.o.box.y1, cap);
  if (top < xh * 0.5 || a.o.box.y0 > xh * 0.5 || b.o.box.y0 > xh * 0.5) return null; // punctuation, accents: keep metric
  const caps = top > xh * 1.15;
  const depth = upm * 0.25;
  const refKey = `ref:${caps ? "H" : "n"}|${coordsKey(coords)}`;
  let ref = face.cache.get(refKey) as number | null | undefined;
  if (ref === undefined) {
    const rg = face.font.charToGlyphIndex(caps ? "H" : "n");
    const ro = outlineOf(face, rg, coords);
    ref = rg ? gapBetween(face, { g: rg, o: ro }, { g: rg, o: ro }, coords, caps ? cap : xh, depth) : null;
    face.cache.set(refKey, ref);
  }
  const gap = gapBetween(face, a, b, coords, caps ? Math.min(top, cap) : Math.min(top, xh), depth);
  if (ref === null || gap === null) return null;
  return Math.max(-0.15 * upm, Math.min(0.1 * upm, (ref - gap) * 0.85));
}

/* ---------- layout ---------- */

function featureTags(features: readonly string[] | null | undefined): Set<string> {
  const tags = new Set<string>();
  for (const t of DEFAULT_ON_FEATURES) if (featureOn(features ?? undefined, t)) tags.add(t);
  for (const f of features ?? []) if (!f.startsWith("-")) tags.add(f);
  return tags;
}

const layouts = new Map<string, Layout | null>();

/**
 * Shape and lay out a text spec. undefined while its font is loading, null if the font can't be
 * loaded (callers then fall back to the plain renderer).
 */
export function layoutText(spec: TypesetSpec): Layout | null | undefined {
  const face = peekFace(faceRequestFor(spec));
  if (face === undefined) return undefined;
  if (face === null) return null;
  const key = JSON.stringify([face.key, spec.text, spec.fontWeight, spec.fontSize, spec.letterSpacing, spec.anchor, spec.axes, spec.features, spec.alternates, spec.kerning, spec.kerns]);
  if (layouts.has(key)) return layouts.get(key)!;
  let out: Layout | null = null;
  try {
    out = compute(face, spec);
  } catch (e) {
    console.warn(`[type] layout failed for "${spec.text}" in ${spec.fontFamily}`, e);
    out = null;
  }
  if (layouts.size > 400) layouts.delete(layouts.keys().next().value!);
  layouts.set(key, out);
  return out;
}

function compute(face: Face, spec: TypesetSpec): Layout {
  const font = face.font;
  const chars = Array.from(spec.text);
  const coords = coordsFor(face, spec);
  let buf: Item[] = chars.map((c, i) => ({ g: font.charToGlyphIndex(c), chars: [i] }));
  buf = substitute(face, buf, featureTags(spec.features));
  // Per-character alternates, applied after shaping.
  for (const [idx, alt] of Object.entries(spec.alternates ?? {})) {
    if (!alt) continue;
    const i = Number(idx);
    const item = buf.find((b) => b.chars.length === 1 && b.chars[0] === i);
    if (!item || !chars[i]) continue;
    const base = font.charToGlyphIndex(chars[i]!);
    const g = alternateFor(face, item.g, alt) ?? alternateFor(face, base, alt);
    if (g !== null && g !== undefined) item.g = g;
  }
  const scale = spec.fontSize / font.unitsPerEm;
  const norm = spec.kerning === "manual" || spec.kerning === "optical" ? null : normalized(face, coords);
  const placed: Placed[] = [];
  let pen = 0;
  const outlines = buf.map((b) => outlineOf(face, b.g, coords));
  buf.forEach((b, i) => {
    const o = outlines[i]!;
    placed.push({ g: b.g, chars: b.chars, x: pen, outline: o });
    pen += o.adv * scale;
    if (i === buf.length - 1) return;
    const nb = buf[i + 1]!;
    let k = 0;
    if (spec.kerning === "optical") {
      const ok = opticalKern(face, { g: b.g, o }, { g: nb.g, o: outlines[i + 1]! }, coords);
      k = ok ?? pairKerning(face, b.g, nb.g, normalized(face, coords));
    } else if (spec.kerning !== "manual") k = pairKerning(face, b.g, nb.g, norm);
    if (Number.isFinite(k)) pen += k * scale;
    const lastChar = b.chars.length ? Math.max(...b.chars) : -1;
    const manual = lastChar >= 0 ? spec.kerns?.[lastChar] ?? 0 : 0;
    pen += (manual / 1000) * spec.fontSize + spec.letterSpacing;
  });
  const width = Math.max(0, pen);
  const x0 = spec.anchor === "middle" ? -width / 2 : spec.anchor === "end" ? -width : 0;
  return { face, scale, placed, width, x0 };
}

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) || !Number.isFinite(r) ? "0" : String(r);
};

/** SVG path data of one outline placed at (x, baseline 0) with a px scale. */
export function outlineD(o: Outline, x: number, scale: number): string {
  let d = "";
  const X = (v: number | undefined) => num(x + (v ?? 0) * scale);
  const Y = (v: number | undefined) => num(-(v ?? 0) * scale);
  for (const c of o.cmds) {
    if (c.type === "M" || c.type === "L") d += `${c.type}${X(c.x)} ${Y(c.y)}`;
    else if (c.type === "Q") d += `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`;
    else if (c.type === "C") d += `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
    else if (c.type === "Z") d += "Z";
  }
  return d;
}

/* ---------- hooks for lib/fonts.ts ---------- */

/** Outlined path of a node with type controls; undefined = not handled (loading or failed) → caller falls back. */
export function typesetPath(n: TypesetSpec): string | undefined {
  const l = layoutText(n);
  if (!l) return undefined;
  return l.placed.map((p) => outlineD(p.outline, l.x0 + p.x, l.scale)).join("");
}

export function typesetWidth(n: TypesetSpec): number | undefined {
  const l = layoutText(n);
  return l ? l.width : undefined;
}

/** Per-glyph outlines (ligatures are named by the characters they draw). */
export function typesetGlyphs(n: TypesetSpec): { text: string; d: string }[] | undefined {
  const l = layoutText(n);
  if (!l) return undefined;
  const chars = Array.from(n.text);
  return l.placed.map((p) => ({ text: p.chars.map((i) => chars[i] ?? "").join(""), d: outlineD(p.outline, l.x0 + p.x, l.scale) }));
}

/** Wait until a node's type-controls font is loaded (exports, lettering). False when it can't load. */
export async function ensureTypeset(n: TypesetSpec): Promise<boolean> {
  if (!hasTypeControls(n)) return true;
  return !!(await loadFace(faceRequestFor(n)));
}
