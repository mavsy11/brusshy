/**
 * Offline font pairing rules for the type system (heading + body). No network, no third-party data:
 * a curated table of families with their classification and era (hand-assigned) and real metrics
 * measured from the font files (x-height / em, stroke contrast thin÷thick of "o", width of "n" / em).
 */

export type FontGroup = "sans" | "serif" | "slab" | "display" | "script" | "mono";
export type FontClass =
  | "neo-grotesque"
  | "grotesque"
  | "geometric"
  | "humanist"
  | "rounded"
  | "condensed"
  | "wide"
  | "transitional"
  | "old-style"
  | "didone"
  | "inscriptional"
  | "soft-serif"
  | "slab"
  | "fat-face"
  | "deco"
  | "western"
  | "script"
  | "handwritten"
  | "mono";
export type FontEra = "renaissance" | "18th-c" | "19th-c" | "deco" | "modernist" | "retro" | "contemporary";

export interface FontTraits {
  family: string;
  /** Fontsource category. */
  category: "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
  cls: FontClass;
  era: FontEra;
  /** x-height in em (null = unknown or caps-only). */
  xh: number | null;
  /** Stroke contrast, thin ÷ thick (1 = monoline, 0.1 = hairlines). */
  contrast: number | null;
  /** Advance of "n" in em (≈ how wide the face runs). */
  width: number | null;
  /** Good for running text (paragraphs, UI) — not only for headlines and wordmarks. */
  body: boolean;
  /** Has no real lowercase (all caps / small caps). */
  capsOnly?: boolean;
  /** Fonts from one design family (e.g. "IBM Plex"). */
  superfamily?: string;
}

const GROUP: Record<FontClass, FontGroup> = {
  "neo-grotesque": "sans",
  grotesque: "sans",
  geometric: "sans",
  humanist: "sans",
  rounded: "sans",
  condensed: "sans",
  wide: "sans",
  transitional: "serif",
  "old-style": "serif",
  didone: "serif",
  inscriptional: "serif",
  "soft-serif": "serif",
  slab: "slab",
  "fat-face": "display",
  deco: "display",
  western: "display",
  script: "script",
  handwritten: "script",
  mono: "mono",
};

const ERA_ORDER: FontEra[] = ["renaissance", "18th-c", "19th-c", "deco", "modernist", "retro", "contemporary"];

type Row = [family: string, cat: FontTraits["category"], cls: FontClass, era: FontEra, xh: number | null, contrast: number, width: number, body: 0 | 1, extra?: { capsOnly?: boolean; superfamily?: string }];

// prettier-ignore
const ROWS: Row[] = [
  ["Geist", "sans-serif", "neo-grotesque", "contemporary", 0.53, 0.91, 0.581, 1, { superfamily: "Geist" }],
  ["Inter", "sans-serif", "neo-grotesque", "contemporary", 0.546, 0.88, 0.591, 1, { superfamily: "Inter" }],
  ["Inter Tight", "sans-serif", "neo-grotesque", "contemporary", 0.546, 0.9, 0.539, 1, { superfamily: "Inter" }],
  ["Manrope", "sans-serif", "geometric", "contemporary", 0.54, 0.9, 0.594, 1],
  ["Space Grotesk", "sans-serif", "grotesque", "contemporary", 0.486, 0.9, 0.613, 1, { superfamily: "Space" }],
  ["Bricolage Grotesque", "sans-serif", "grotesque", "contemporary", 0.517, 0.82, 0.596, 1],
  ["Syne", "sans-serif", "grotesque", "contemporary", 0.5, 0.94, 0.554, 0],
  ["Unbounded", "sans-serif", "wide", "contemporary", 0.566, 0.77, 0.743, 0],
  ["Montserrat", "sans-serif", "geometric", "modernist", 0.525, 0.88, 0.676, 1],
  ["Archivo Black", "sans-serif", "grotesque", "modernist", 0.528, 0.68, 0.667, 0, { superfamily: "Archivo" }],
  ["Bebas Neue", "sans-serif", "condensed", "modernist", null, 0.91, 0.427, 0, { capsOnly: true }],
  ["Oswald", "sans-serif", "condensed", "modernist", 0.578, 0.74, 0.439, 0],
  ["DM Sans", "sans-serif", "geometric", "contemporary", 0.504, 0.84, 0.574, 1, { superfamily: "DM" }],
  ["Work Sans", "sans-serif", "grotesque", "modernist", 0.5, 0.86, 0.619, 1],
  ["Source Sans 3", "sans-serif", "humanist", "contemporary", 0.486, 0.8, 0.547, 1, { superfamily: "Source" }],
  ["IBM Plex Sans", "sans-serif", "neo-grotesque", "contemporary", 0.516, 0.83, 0.568, 1, { superfamily: "IBM Plex" }],
  ["Open Sans", "sans-serif", "humanist", "contemporary", 0.535, 0.8, 0.613, 1],
  ["Lato", "sans-serif", "humanist", "contemporary", 0.506, 0.76, 0.556, 1],
  ["Nunito", "sans-serif", "rounded", "contemporary", 0.484, 0.79, 0.568, 1, { superfamily: "Nunito" }],
  ["Nunito Sans", "sans-serif", "geometric", "contemporary", 0.486, 0.79, 0.568, 1, { superfamily: "Nunito" }],
  ["Karla", "sans-serif", "grotesque", "contemporary", 0.478, 0.85, 0.604, 1],
  ["Rubik", "sans-serif", "rounded", "contemporary", 0.52, 0.8, 0.606, 1],
  ["Outfit", "sans-serif", "geometric", "contemporary", 0.475, 0.94, 0.548, 1],
  ["Plus Jakarta Sans", "sans-serif", "geometric", "contemporary", 0.536, 0.94, 0.573, 1],
  ["Sora", "sans-serif", "geometric", "contemporary", 0.534, 0.9, 0.64, 1],
  ["Figtree", "sans-serif", "geometric", "contemporary", 0.5, 0.91, 0.558, 1],
  ["Public Sans", "sans-serif", "neo-grotesque", "contemporary", 0.517, 0.79, 0.577, 1],
  ["Archivo", "sans-serif", "grotesque", "modernist", 0.526, 0.8, 0.563, 1, { superfamily: "Archivo" }],
  ["Barlow", "sans-serif", "grotesque", "contemporary", 0.506, 0.86, 0.539, 1],
  ["Josefin Sans", "sans-serif", "geometric", "deco", 0.378, 0.83, 0.553, 0],
  ["Raleway", "sans-serif", "geometric", "contemporary", 0.519, 0.87, 0.583, 1],
  ["Poppins", "sans-serif", "geometric", "modernist", 0.548, 0.86, 0.64, 1],
  ["Lexend", "sans-serif", "geometric", "contemporary", 0.525, 0.9, 0.595, 1],
  ["Libre Franklin", "sans-serif", "grotesque", "modernist", 0.53, 0.73, 0.584, 1],
  ["Hanken Grotesk", "sans-serif", "grotesque", "contemporary", 0.493, 0.89, 0.547, 1],
  ["Schibsted Grotesk", "sans-serif", "grotesque", "contemporary", 0.527, 0.76, 0.581, 1],
  ["Instrument Sans", "sans-serif", "neo-grotesque", "contemporary", 0.51, 0.83, 0.599, 1, { superfamily: "Instrument" }],
  ["Onest", "sans-serif", "grotesque", "contemporary", 0.527, 0.88, 0.591, 1],
  ["Fira Sans", "sans-serif", "humanist", "contemporary", 0.527, 0.75, 0.586, 1, { superfamily: "Fira" }],
  ["Alegreya Sans", "sans-serif", "humanist", "contemporary", 0.458, 0.76, 0.516, 1, { superfamily: "Alegreya" }],
  ["Epilogue", "sans-serif", "grotesque", "contemporary", 0.531, 0.91, 0.613, 1],
  ["League Spartan", "sans-serif", "geometric", "modernist", 0.41, 0.89, 0.51, 0],
  ["Anton", "sans-serif", "condensed", "modernist", 0.732, 0.76, 0.499, 0],
  ["Big Shoulders Display", "display", "condensed", "contemporary", 0.6, 0.8, 0.37, 0],
  ["Roboto", "sans-serif", "neo-grotesque", "contemporary", 0.528, 0.82, 0.552, 1, { superfamily: "Roboto" }],
  ["Roboto Flex", "sans-serif", "neo-grotesque", "contemporary", 0.514, 0.8, 0.556, 1, { superfamily: "Roboto" }],
  ["Familjen Grotesk", "sans-serif", "grotesque", "contemporary", 0.5, 0.8, 0.542, 1],
  ["Playfair Display", "serif", "didone", "18th-c", 0.514, 0.21, 0.597, 0],
  ["Cormorant Garamond", "serif", "old-style", "renaissance", 0.386, 0.3, 0.517, 0, { superfamily: "Cormorant" }],
  ["Instrument Serif", "serif", "transitional", "retro", 0.51, 0.33, 0.47, 0, { superfamily: "Instrument" }],
  ["Geist Serif", "serif", "transitional", "contemporary", 0.53, 0.33, 0.602, 0, { superfamily: "Geist" }],
  ["DM Serif Display", "serif", "didone", "18th-c", 0.481, 0.13, 0.578, 0, { superfamily: "DM" }],
  ["Abril Fatface", "display", "fat-face", "19th-c", 0.476, 0.09, 0.616, 0],
  ["Cinzel", "serif", "inscriptional", "renaissance", null, 0.41, 0.779, 0, { capsOnly: true }],
  ["Lora", "serif", "transitional", "contemporary", 0.5, 0.39, 0.607, 1],
  ["Merriweather", "serif", "transitional", "contemporary", 0.555, 0.49, 0.663, 1],
  ["Libre Baskerville", "serif", "transitional", "18th-c", 0.53, 0.45, 0.689, 1],
  ["EB Garamond", "serif", "old-style", "renaissance", 0.4, 0.37, 0.528, 1],
  ["Crimson Pro", "serif", "old-style", "contemporary", 0.42, 0.53, 0.537, 1],
  ["Spectral", "serif", "transitional", "contemporary", 0.45, 0.48, 0.582, 1],
  ["Newsreader", "serif", "transitional", "contemporary", 0.426, 0.52, 0.573, 1],
  ["Fraunces", "serif", "soft-serif", "retro", 0.482, 0.38, 0.617, 0],
  ["Literata", "serif", "transitional", "contemporary", 0.507, 0.61, 0.661, 1],
  ["Source Serif 4", "serif", "transitional", "contemporary", 0.475, 0.53, 0.643, 1, { superfamily: "Source" }],
  ["IBM Plex Serif", "serif", "transitional", "contemporary", 0.516, 0.53, 0.639, 1, { superfamily: "IBM Plex" }],
  ["Bodoni Moda", "serif", "didone", "18th-c", 0.46, 0.19, 0.596, 0],
  ["Young Serif", "serif", "old-style", "retro", 0.5, 0.68, 0.681, 0],
  ["Gloock", "serif", "didone", "contemporary", 0.508, 0.08, 0.636, 0],
  ["Alegreya", "serif", "old-style", "renaissance", 0.452, 0.61, 0.548, 1, { superfamily: "Alegreya" }],
  ["Cormorant", "serif", "old-style", "renaissance", 0.386, 0.3, 0.517, 0, { superfamily: "Cormorant" }],
  ["Roboto Slab", "serif", "slab", "contemporary", 0.528, 0.78, 0.656, 1, { superfamily: "Roboto" }],
  ["Zilla Slab", "serif", "slab", "contemporary", 0.445, 0.82, 0.573, 1],
  ["Arvo", "serif", "slab", "modernist", 0.506, 0.81, 0.667, 1],
  ["Bitter", "serif", "slab", "contemporary", 0.528, 0.7, 0.633, 1],
  ["Rye", "display", "western", "19th-c", null, 0.96, 0.676, 0],
  ["Poiret One", "display", "deco", "deco", 0.45, 0.88, 0.524, 0],
  ["Limelight", "display", "deco", "deco", 0.521, 0.14, 0.731, 0],
  ["Righteous", "display", "deco", "retro", 0.526, 0.99, 0.562, 0],
  ["Shrikhand", "display", "fat-face", "retro", 0.52, 0.52, 0.716, 0],
  ["Fredoka", "sans-serif", "rounded", "contemporary", 0.5, 1, 0.557, 0],
  ["Baloo 2", "display", "rounded", "contemporary", 0.46, 0.8, 0.55, 0],
  ["Pacifico", "handwriting", "script", "retro", 0.46, 1, 0.496, 0],
  ["Lobster", "display", "script", "retro", 0.5, 0.94, 0.505, 0],
  ["Caveat", "handwriting", "handwritten", "contemporary", 0.4, 0.79, 0.45, 0],
  ["Dancing Script", "handwriting", "script", "contemporary", 0.332, 0.68, 0.466, 0],
  ["Great Vibes", "handwriting", "script", "18th-c", 0.328, 0.52, 0.338, 0],
  ["Space Mono", "monospace", "mono", "retro", 0.496, 0.93, 0.612, 0, { superfamily: "Space" }],
  ["JetBrains Mono", "monospace", "mono", "contemporary", 0.55, 0.89, 0.6, 0],
  ["IBM Plex Mono", "monospace", "mono", "contemporary", 0.516, 0.81, 0.6, 0, { superfamily: "IBM Plex" }],
  ["Fira Code", "monospace", "mono", "contemporary", 0.526, 0.77, 0.6, 0, { superfamily: "Fira" }],
];

export const FONT_TRAITS: FontTraits[] = ROWS.map(([family, category, cls, era, xh, contrast, width, body, extra]) => ({
  family,
  category,
  cls,
  era,
  xh,
  contrast,
  width,
  body: body === 1,
  ...(extra ?? {}),
}));

const byName = new Map(FONT_TRAITS.map((t) => [t.family.toLowerCase(), t]));

/** Pairings type designers keep coming back to (small bonus, never decisive). */
const PROVEN: [string, string][] = [
  ["Playfair Display", "Source Sans 3"],
  ["Playfair Display", "Lato"],
  ["Fraunces", "Inter"],
  ["Space Grotesk", "Inter"],
  ["Syne", "Inter"],
  ["Bebas Neue", "Montserrat"],
  ["Cormorant Garamond", "Montserrat"],
  ["Libre Baskerville", "Source Sans 3"],
  ["DM Serif Display", "DM Sans"],
  ["Instrument Serif", "Inter"],
  ["Abril Fatface", "Lato"],
  ["Oswald", "Lora"],
  ["Unbounded", "Manrope"],
  ["Gloock", "Instrument Sans"],
  ["Bricolage Grotesque", "Geist"],
  ["Geist Serif", "Geist"],
  ["Young Serif", "Work Sans"],
];

export const fontGroup = (t: Pick<FontTraits, "cls">): FontGroup => GROUP[t.cls];

const CATEGORY_DEFAULT: Record<FontTraits["category"], FontClass> = {
  "sans-serif": "grotesque",
  serif: "transitional",
  display: "deco",
  handwriting: "script",
  monospace: "mono",
};

/**
 * Traits for any family: curated when known, otherwise guessed from its Fontsource category
 * (and metrics measured from the font, when the caller has them).
 */
export function fontTraits(family: string, fallback?: { category?: string; xh?: number | null; contrast?: number | null; width?: number | null }): FontTraits {
  const known = byName.get(family.trim().toLowerCase());
  if (known) return known;
  const category = (["sans-serif", "serif", "display", "handwriting", "monospace"].includes(fallback?.category ?? "") ? fallback!.category : "sans-serif") as FontTraits["category"];
  const cls = CATEGORY_DEFAULT[category];
  return {
    family,
    category,
    cls,
    era: "contemporary",
    xh: fallback?.xh ?? null,
    contrast: fallback?.contrast ?? null,
    width: fallback?.width ?? null,
    body: category === "sans-serif" || category === "serif",
  };
}

export interface PairingScore {
  heading: string;
  body: string;
  score: number;
  /** Why it works, strongest first. */
  reasons: string[];
  /** What to watch out for. */
  warnings: string[];
}

const pretty = (c: FontClass) => (c === "neo-grotesque" ? "neo-grotesque sans" : c === "grotesque" ? "grotesque sans" : c === "geometric" ? "geometric sans" : c === "humanist" ? "humanist sans" : c === "rounded" ? "rounded sans" : c === "condensed" ? "condensed sans" : c === "wide" ? "wide sans" : c === "transitional" ? "transitional serif" : c === "old-style" ? "old-style serif" : c === "didone" ? "high-contrast didone" : c === "inscriptional" ? "inscriptional capitals" : c === "soft-serif" ? "soft serif" : c === "slab" ? "slab serif" : c === "fat-face" ? "fat face" : c === "deco" ? "art-deco display" : c === "western" ? "western display" : c === "handwritten" ? "handwritten script" : c);

/** Score a heading × body pairing with readable reasons (higher is better; > 3 is a strong pair). */
export function scorePairing(heading: FontTraits, body: FontTraits): PairingScore {
  let score = 0;
  const reasons: [number, string][] = [];
  const warnings: string[] = [];
  const gh = fontGroup(heading), gb = fontGroup(body);
  const same = heading.family.toLowerCase() === body.family.toLowerCase();

  // 1. Body must read well in paragraphs.
  if (body.capsOnly) {
    score -= 5;
    warnings.push(`${body.family} has no lowercase — it can't set body text`);
  } else if (gb === "display" || gb === "script") {
    score -= 4;
    warnings.push(`${body.family} is a ${pretty(body.cls)} — tiring to read in paragraphs`);
  } else if (gb === "mono") {
    score -= 1;
    warnings.push("A monospaced body reads technical — fine for dev tools, odd elsewhere");
  } else if (!body.body) {
    score -= 1.5;
    warnings.push(`${body.family} is drawn for headlines; at text sizes it gets tight or fussy`);
  } else score += 1;

  // 2. Contrast of classification.
  if (same) {
    score += 1;
    reasons.push([1, "One family for both — make the contrast with weight and size"]);
  } else if (heading.superfamily && heading.superfamily === body.superfamily) {
    score += 2.5;
    reasons.push([2.5, `Same superfamily (${heading.superfamily}) — drawn to work together`]);
  } else if (gh !== gb) {
    score += 3;
    reasons.push([3, `Clear contrast: ${pretty(heading.cls)} heading × ${pretty(body.cls)} body`]);
  } else if (heading.cls === body.cls) {
    score -= 2.5;
    warnings.push(`Both are ${pretty(heading.cls)}s — similar but not the same reads as a mistake`);
  } else if (gh === "sans") {
    score += 0.5;
    reasons.push([0.5, `Two sans with different skeletons (${heading.cls} × ${body.cls}) — keep a clear weight contrast`]);
  } else {
    score -= 0.5;
    warnings.push("Two serifs compete — give the heading much more weight or size");
  }

  // 3. x-height compatibility (lowercase headings and body sit together on a line).
  if (heading.xh !== null && body.xh !== null && !heading.capsOnly && !same) {
    const diff = Math.abs(heading.xh - body.xh);
    const s = 1.5 - diff * 25;
    score += Math.max(-1, s);
    if (diff <= 0.03) reasons.push([1.2, `Matching x-heights (${heading.xh.toFixed(2)} / ${body.xh.toFixed(2)} em)`]);
    else if (diff >= 0.08) warnings.push(`x-heights differ a lot (${heading.xh.toFixed(2)} vs ${body.xh.toFixed(2)} em) — size the body up or down to match`);
  }

  // 4. Era / mood.
  const d = Math.abs(ERA_ORDER.indexOf(heading.era) - ERA_ORDER.indexOf(body.era));
  if (!same) {
    if (d === 0) {
      score += 1;
      reasons.push([0.9, `Same era (${heading.era})`]);
    } else if (d === 1) score += 0.5;
    else if (d >= 4 && gh === gb) {
      score -= 0.5;
      warnings.push(`Different eras (${heading.era} × ${body.era}) — reads as intentional only with strong contrast`);
    }
  }

  // 5. Stroke contrast: one star at a time.
  if (heading.contrast !== null && body.contrast !== null && !same) {
    if (heading.contrast < 0.35 && body.contrast > 0.7) {
      score += 0.6;
      reasons.push([0.6, "High-contrast display over an even, sturdy body"]);
    } else if (heading.contrast < 0.35 && body.contrast < 0.35) {
      score -= 1;
      warnings.push("Two high-contrast faces — hairlines fight each other");
    }
  }

  // 6. Proportions.
  if (heading.cls === "condensed" && body.cls === "condensed") {
    score -= 0.5;
    warnings.push("Two condensed faces — the page gets cramped");
  }
  if (PROVEN.some(([h, b]) => h.toLowerCase() === heading.family.toLowerCase() && b.toLowerCase() === body.family.toLowerCase())) {
    score += 1;
    reasons.push([1.1, "A proven pairing"]);
  }

  return {
    heading: heading.family,
    body: body.family,
    score: Math.round(score * 10) / 10,
    reasons: reasons.sort((a, b) => b[0] - a[0]).map(([, r]) => r),
    warnings,
  };
}

/**
 * Best partners for a family. role "heading" = the family is the heading, suggest bodies;
 * role "body" = suggest headings for it. Candidates come from the curated table.
 */
export function suggestPairings(
  family: string,
  o: { role?: "heading" | "body"; limit?: number; traits?: Parameters<typeof fontTraits>[1]; candidates?: FontTraits[] } = {},
): PairingScore[] {
  const me = fontTraits(family, o.traits);
  const role = o.role ?? "heading";
  const pool = (o.candidates ?? FONT_TRAITS).filter((t) => t.family.toLowerCase() !== family.trim().toLowerCase());
  const scored = pool
    .filter((t) => (role === "heading" ? t.body && !t.capsOnly : true))
    .map((t) => (role === "heading" ? scorePairing(me, t) : scorePairing(t, me)));
  scored.sort((a, b) => b.score - a.score || a[role === "heading" ? "body" : "heading"].localeCompare(b[role === "heading" ? "body" : "heading"]));
  return scored.slice(0, o.limit ?? 6);
}

/** One-line description of a family for the AI ("geometric sans, contemporary, x-height 0.53 em"). */
export function describeTraits(t: FontTraits): string {
  const bits = [pretty(t.cls), t.era];
  if (t.xh !== null) bits.push(`x-height ${t.xh.toFixed(2)} em`);
  if (t.contrast !== null) bits.push(t.contrast < 0.35 ? "high stroke contrast" : t.contrast > 0.8 ? "monoline" : "moderate contrast");
  if (t.capsOnly) bits.push("caps only");
  bits.push(t.body ? "works for body text" : "headline/wordmark use");
  return bits.join(", ");
}
