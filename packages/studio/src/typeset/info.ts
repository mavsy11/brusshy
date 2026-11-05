import { pathDataBounds, translateD, type FontInfo, type LetteringSourceT, type LettersResponse, type TypeRequest } from "@brusshy/core";
import { registerRequest } from "../lib/requests";
import { familyMeta, loadFace, type Face } from "./sources";
import { designFeatures, glyphAlternates, type GlyphAlt } from "./gsub";
import { coordsFor, faceAxes, faceRequestFor, layoutText, outlineD, outlineOf, xHeight, type Layout, type TypesetSpec } from "./engine";

/** Font facts for the UI and the agent, read from the font files the engine renders with. */

const BASIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&";

export async function fontInfo(family: string, o: { weight?: number; italic?: boolean; chars?: string } = {}): Promise<FontInfo> {
  const face = await loadFace({ family, weight: o.weight ?? 400, italic: o.italic, variable: true });
  if (!face) throw new Error(`Font "${family}" could not be loaded (is it on fonts.google.com / fontsource.org?)`);
  const meta = await familyMeta(family);
  const fvar = (face.font.tables as { fvar?: { instances: { name?: Record<string, string>; coordinates: Record<string, number> }[] } }).fvar;
  const alternates: FontInfo["alternates"] = {};
  for (const ch of new Set(Array.from((o.chars ?? "") + BASIC))) {
    const g = face.font.charToGlyphIndex(ch);
    if (!g) continue;
    const alts = glyphAlternates(face, g);
    if (alts.length) alternates[ch] = alts.map(({ key, label }) => ({ key, label }));
  }
  const os2 = (face.font.tables as { os2?: { sCapHeight?: number } }).os2;
  return {
    family,
    source: face.source,
    axes: faceAxes(face),
    instances: face.variable ? (fvar?.instances ?? []).map((i) => ({ name: i.name?.en ?? Object.values(i.name ?? {})[0] ?? "", coords: { ...i.coordinates } })) : [],
    features: designFeatures(face),
    alternates,
    metrics: { unitsPerEm: face.font.unitsPerEm, xHeight: xHeight(face), capHeight: os2?.sCapHeight || face.font.unitsPerEm * 0.7 },
    italic: !!meta?.styles.includes("italic"),
  };
}

/** Drawn glyphs of a layout, left to right — lettering letters map to these by index. */
export const drawnGlyphs = (l: Layout) => l.placed.filter((p) => p.outline.cmds.length > 0);

/** Load the font for a spec and lay it out (waits for the font). */
export async function layoutWhenReady(spec: TypesetSpec): Promise<Layout> {
  const face = await loadFace(faceRequestFor(spec));
  if (!face) throw new Error(`Font "${spec.fontFamily}" could not be loaded`);
  const l = layoutText(spec);
  if (!l) throw new Error(`Could not lay out "${spec.text}" in ${spec.fontFamily}`);
  return l;
}

/** Alternates for one drawn letter of a lettering source (with the glyph it currently is). */
export function letterChoices(l: Layout, letter: number): { g: number; alts: GlyphAlt[] } | null {
  const p = drawnGlyphs(l)[letter];
  if (!p) return null;
  return { g: p.g, alts: glyphAlternates(l.face, p.g) };
}

/** Outline of a glyph placed where a letter of the layout sits (same pen position and scale). */
export function glyphAtLetter(l: Layout, letter: number, g: number): string | null {
  const p = drawnGlyphs(l)[letter];
  if (!p) return null;
  const o = outlineOf(l.face, g, coordsFor(l.face, faceSpec(l)));
  return outlineD(o, l.x0 + p.x, l.scale);
}
const specs = new WeakMap<Layout, TypesetSpec>();
const faceSpec = (l: Layout) => specs.get(l) ?? { fontWeight: 400 };

export async function sourceLayout(source: LetteringSourceT): Promise<Layout> {
  const l = await layoutWhenReady(source as TypesetSpec);
  specs.set(l, source as TypesetSpec);
  return l;
}

/**
 * Swap lettering letters for alternates. If the letter's current outline is passed, the new glyph is
 * moved by however far the letter has moved since it was made (kerning / baseline edits baked into
 * its path): we find which glyph it currently is (default or an earlier alternate) by its size.
 */
export async function letterSwaps(source: LetteringSourceT, picks: { letter: number; key: string; current?: string }[]): Promise<LettersResponse> {
  const l = await sourceLayout(source);
  const drawn = drawnGlyphs(l);
  const chars = Array.from(source.text);
  const out: LettersResponse["letters"] = [];
  for (const { letter, key: k0, current } of picks) {
    let key = k0;
    const p = drawn[letter];
    if (!p) throw new Error(`Letter ${letter} not found (the word has ${drawn.length} letters)`);
    const ch = chars[p.chars[0] ?? 0] ?? "";
    // A ligature (several characters) only offers its own alternates; its "default" is the ligature.
    const cmapG = p.chars.length > 1 ? p.g : l.face.font.charToGlyphIndex(ch) || p.g;
    const choices = [p.g, cmapG, ...glyphAlternates(l.face, p.g).map((a) => a.g), ...glyphAlternates(l.face, cmapG).map((a) => a.g)];
    let g = cmapG;
    if (key) {
      if (!key.includes(":")) key = `${key}:1`;
      const alt = glyphAlternates(l.face, p.g).find((a) => a.key === key) ?? glyphAlternates(l.face, cmapG).find((a) => a.key === key);
      if (!alt) throw new Error(`"${p.chars.map((i) => chars[i]).join("")}" has no alternate "${key}" in ${source.fontFamily}`);
      g = alt.g;
    }
    let d = glyphAtLetter(l, letter, g)!;
    if (current) {
      const cur = pathDataBounds(current);
      let dx = 0, dy = 0;
      if (cur) {
        const was = [...new Set(choices)]
          .map((cg) => pathDataBounds(glyphAtLetter(l, letter, cg) ?? ""))
          .find((b) => b && Math.abs(b.x1 - b.x0 - (cur.x1 - cur.x0)) < 0.5 && Math.abs(b.y1 - b.y0 - (cur.y1 - cur.y0)) < 0.5);
        const ref = was ?? pathDataBounds(glyphAtLetter(l, letter, p.g) ?? "");
        if (ref) {
          // Left edges when we know which glyph it is; centers when its shape was edited by hand.
          dx = was ? cur.x0 - ref.x0 : (cur.x0 + cur.x1) / 2 - (ref.x0 + ref.x1) / 2;
          dy = cur.y1 - ref.y1;
        }
      }
      if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) d = translateD(d, dx, dy);
    }
    out.push({ letter, d, text: p.chars.map((i) => chars[i]).join("") });
  }
  return { letters: out };
}

export type { Face };

// The agent's font_info / set_type (lettering alternates) ask the studio.
registerRequest("type", async (p: TypeRequest) => {
  if (p.action === "info") return fontInfo(p.family, { weight: p.weight, italic: p.italic, chars: p.chars });
  return letterSwaps(p.source, p.picks);
});
