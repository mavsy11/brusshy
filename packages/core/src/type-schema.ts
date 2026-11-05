import { z } from "zod";

/**
 * Type controls (Type Lab, part 2): variable-font axes, OpenType features, glyph alternates,
 * kerning modes on text nodes, the source of a lettering group, and the document's type system
 * (heading + body fonts). Kept in its own module; schema.ts spreads TEXT_TYPE_FIELDS into TextNode.
 */

/** A variation axis tag: four characters, registered lowercase (wght, wdth, slnt, opsz, ital) or custom uppercase (GRAD, SOFT…). */
export const AxisTag = z.string().regex(/^[A-Za-z0-9]{3,4}$/, "Axis tags are 4 characters, e.g. wght, wdth, opsz, GRAD");

/** Axis tag → value, e.g. { wght: 640, wdth: 87.5, opsz: 72 }. `ital: 1` picks the italic font. */
export const TypeAxes = z.record(AxisTag, z.number());

/** "ss01" turns a feature on; "-liga" turns a default-on feature (liga, calt, clig) off. */
export const FeatureSetting = z.string().regex(/^-?[a-z0-9]{4}$/i, 'Feature tags are 4 characters, e.g. "ss01", "swsh", "-liga"');

/**
 * Per-character glyph alternates: character index in `text` → "feature:n" (the n-th alternate that
 * feature offers for that glyph, 1-based; "salt" = "salt:1"). Empty string = the default glyph.
 */
export const Alternates = z.record(z.string().regex(/^\d+$/), z.string().regex(/^([a-z0-9]{4}(:\d+)?)?$/i));

/** metric = the font's own kerning pairs; optical = computed from the outlines; manual = none (only your `kerns`). */
export const KerningMode = z.enum(["metric", "optical", "manual"]);
export type KerningModeT = z.infer<typeof KerningMode>;

/** Fields added to text nodes. All optional (null = cleared, which undo needs), so older documents and other features are unaffected. */
export const TEXT_TYPE_FIELDS = {
  /** Variable-font axis values (rendered from the variable font with real outlines). */
  axes: TypeAxes.nullable().optional(),
  /** OpenType feature settings ("ss01", "swsh", "smcp", "onum", "-liga"…). */
  features: z.array(FeatureSetting).nullable().optional(),
  /** Glyph alternates for single characters (see Alternates). */
  alternates: Alternates.nullable().optional(),
  /** Kerning mode (default metric). */
  kerning: KerningMode.nullable().optional(),
  /** Manual kerning after each character, in 1/1000 em (index i = the gap between char i and i+1). */
  kerns: z.array(z.number()).nullable().optional(),
};

/** What a lettering group was made from, so letters can later be swapped for alternates in the same font. */
export const LetteringSource = z.object({
  text: z.string(),
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSize: z.number(),
  letterSpacing: z.number().default(0),
  anchor: z.enum(["start", "middle", "end"]).default("start"),
  ...TEXT_TYPE_FIELDS,
});
export type LetteringSourceT = z.infer<typeof LetteringSource>;

/** One role in the type system (heading or body). */
export const TypeRole = z.object({
  family: z.string().min(1),
  weight: z.number().int().min(1).max(1000).default(400),
  axes: TypeAxes.optional(),
  features: z.array(FeatureSetting).optional(),
  /** Tracking in 1/1000 em (e.g. 40 for an open, all-caps wordmark). */
  tracking: z.number().optional(),
  /** Fontsource category, for the AI and pairing (sans-serif, serif, display, handwriting, monospace). */
  category: z.string().optional(),
});
export type TypeRoleT = z.infer<typeof TypeRole>;

/**
 * The brand's type system: the wordmark/heading font and the body font. Structured (not part of the
 * free-text brief) so the studio can apply it in one click and agents get exact family/weight values.
 */
export const TypeSystem = z.object({
  heading: TypeRole,
  body: TypeRole.optional(),
  /** The word previewed while choosing (usually the brand name). */
  sample: z.string().default(""),
  /** Why this pairing (shown to the AI next to the fonts). */
  note: z.string().default(""),
});
export type TypeSystemT = z.infer<typeof TypeSystem>;

/** Features browsers turn on by default; a node lists "-tag" to turn one off. */
export const DEFAULT_ON_FEATURES = ["ccmp", "locl", "rlig", "liga", "clig", "calt"] as const;

/** Effective on/off for a feature tag given a node's settings. */
export function featureOn(features: readonly string[] | undefined, tag: string): boolean {
  const list = features ?? [];
  if (list.includes(`-${tag}`)) return false;
  if (list.includes(tag)) return true;
  return (DEFAULT_ON_FEATURES as readonly string[]).includes(tag);
}

/** Toggle a feature, keeping the list minimal (default-on features are stored as "-tag" when off). */
export function toggleFeature(features: readonly string[] | undefined, tag: string, on: boolean): string[] {
  const rest = (features ?? []).filter((f) => f !== tag && f !== `-${tag}`);
  const byDefault = (DEFAULT_ON_FEATURES as readonly string[]).includes(tag);
  if (on && !byDefault) rest.push(tag);
  if (!on && byDefault) rest.push(`-${tag}`);
  return rest;
}

/** Human names for the features the UI offers (ssNN/cvNN names come from the font when it has them). */
export const FEATURE_NAMES: Record<string, string> = {
  liga: "Standard ligatures",
  dlig: "Discretionary ligatures",
  hlig: "Historical ligatures",
  clig: "Contextual ligatures",
  calt: "Contextual alternates",
  salt: "Stylistic alternates",
  swsh: "Swashes",
  cswh: "Contextual swashes",
  titl: "Titling alternates",
  smcp: "Small caps",
  c2sc: "Caps to small caps",
  pcap: "Petite caps",
  case: "Case-sensitive forms",
  onum: "Oldstyle figures",
  lnum: "Lining figures",
  tnum: "Tabular figures",
  pnum: "Proportional figures",
  zero: "Slashed zero",
  ordn: "Ordinals",
  frac: "Fractions",
  sups: "Superscript",
  hist: "Historical forms",
  init: "Initial forms",
  fina: "Final forms",
  aalt: "All alternates",
};

/** Features worth a toggle in a logo tool (others are layout plumbing or for running text). */
export const DESIGN_FEATURES = /^(liga|dlig|hlig|calt|salt|swsh|cswh|titl|smcp|c2sc|pcap|case|onum|lnum|tnum|zero|hist|ss\d\d|cv\d\d)$/;

export function featureLabel(tag: string, fontName?: string | null): string {
  if (fontName) return fontName;
  const ss = /^ss(\d\d)$/.exec(tag);
  if (ss) return `Stylistic set ${Number(ss[1])}`;
  const cv = /^cv(\d\d)$/.exec(tag);
  if (cv) return `Character variant ${Number(cv[1])}`;
  return FEATURE_NAMES[tag] ?? tag;
}

/** Text fields that change how a text node is typeset (beyond family/weight/size/spacing). */
export type TypeFields = {
  axes?: Record<string, number> | null;
  features?: string[] | null;
  alternates?: Record<string, string> | null;
  kerning?: KerningModeT | null;
  kerns?: number[] | null;
};

/** True when a text node needs the full typesetting engine (axes, features, alternates, kerning). */
export function hasTypeControls(n: TypeFields): boolean {
  return (
    (!!n.axes && Object.keys(n.axes).length > 0) ||
    (!!n.features && n.features.length > 0) ||
    (!!n.alternates && Object.values(n.alternates).some(Boolean)) ||
    (!!n.kerning && n.kerning !== "metric") ||
    (!!n.kerns && n.kerns.some((k) => k !== 0))
  );
}

/** Registered axes with their friendly names (custom axes use the font's own names). */
export const AXIS_NAMES: Record<string, string> = {
  wght: "Weight",
  wdth: "Width",
  slnt: "Slant",
  ital: "Italic",
  opsz: "Optical size",
  GRAD: "Grade",
  SOFT: "Softness",
  WONK: "Wonky",
  CASL: "Casual",
  MONO: "Monospace",
  CRSV: "Cursive",
  XTRA: "Counter width",
  XOPQ: "Thick stroke",
  YOPQ: "Thin stroke",
  ELSH: "Element shape",
};

/** Studio request: font facts the browser reads from the font files (GSUB features, ss names, alternates…). */
export type TypeRequest =
  | { action: "info"; family: string; weight?: number; italic?: boolean; chars?: string }
  /**
   * Outlines of lettering letters swapped to alternates, in the text's local coordinates.
   * `letter` = index among the drawn letters, left to right (the order make_lettering created them).
   */
  | { action: "letters"; source: LetteringSourceT; picks: { letter: number; key: string; current?: string }[] };

export interface FontAxisInfo {
  tag: string;
  name: string;
  min: number;
  max: number;
  default: number;
}

export interface FontInfo {
  family: string;
  /** Where the outlines come from: the full Google Fonts or npm file (all features), or a Fontsource subset. */
  source: "google-full" | "fontsource-variable" | "fontsource-static" | "npm-full";
  axes: FontAxisInfo[];
  instances: { name: string; coords: Record<string, number> }[];
  /** Design features the font really has (GSUB), with names. */
  features: { tag: string; name: string }[];
  /** Characters that have glyph alternates → choices ("feature:n" keys). */
  alternates: Record<string, { key: string; label: string }[]>;
  metrics: { unitsPerEm: number; xHeight: number; capHeight: number };
  italic: boolean;
}

export interface LettersResponse {
  /** d = the alternate outline, moved to where the letter currently sits (keeps kerning/baseline edits). */
  letters: { letter: number; d: string; text: string }[];
}
