import { assignPalette, normalizeColor, parseColor, remapPaint, styleProfile, type PaletteColor, type StyleOptions } from "./style";
import { frameDoc } from "./frames";
import type { DocT, NodeT } from "./schema";
import type { OpT } from "./ops";
import { COLOR_NAMES } from "./palette-names";
import { PaletteEntry, type HarmonyT, type PaletteEntryT, type PaletteRoleT } from "./palette-schema";

/**
 * Brand palette generator (pure, deterministic for a seed). Works in OKLCH so
 * lightness steps look even to the eye; colors are gamut-mapped into sRGB by
 * reducing chroma (hue and lightness stay put).
 */

// ---------------------------------------------------------------- OKLab / OKLCH

export interface Oklch {
  /** Lightness 0–1. */
  l: number;
  /** Chroma 0–~0.37. */
  c: number;
  /** Hue in degrees 0–360. */
  h: number;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** sRGB 0–255 → OKLab [L, a, b]. */
export function rgbToOklab(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → sRGB 0–1 (unclamped: values outside 0–1 are out of gamut). */
function oklabToRgb01(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => (v < 0 ? -toGamma(-v) : toGamma(v))) as [number, number, number];
}

const lchToLab = (o: Oklch): [number, number, number] => {
  const r = (o.h * Math.PI) / 180;
  return [o.l, o.c * Math.cos(r), o.c * Math.sin(r)];
};

const inGamut = (rgb: [number, number, number], eps = 1e-4) => rgb.every((v) => v >= -eps && v <= 1 + eps);

export function hexToOklch(hex: string): Oklch {
  const p = parseColor(hex);
  const [L, a, b] = rgbToOklab(p ? p.rgb : [0, 0, 0]);
  const c = Math.hypot(a, b);
  return { l: L, c, h: c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");

/** OKLCH → #rrggbb, reducing chroma until it fits in sRGB (keeps hue and lightness). */
export function oklchToHex(o: Oklch): string {
  const l = Math.max(0, Math.min(1, o.l));
  let c = Math.max(0, o.c);
  let rgb = oklabToRgb01(...lchToLab({ l, c, h: o.h }));
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToRgb01(...lchToLab({ l, c: mid, h: o.h })))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklabToRgb01(...lchToLab({ l, c, h: o.h }));
  }
  return "#" + rgb.map(hex2).join("");
}

/** Largest in-gamut chroma for a hue at a lightness. */
export function maxChroma(h: number, l: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToRgb01(...lchToLab({ l, c: mid, h })))) lo = mid;
    else hi = mid;
  }
  return lo;
}

const cuspCache = new Map<number, { l: number; c: number }>();
/** The most saturated point of a hue (yellows peak light, blues peak dark). */
export function hueCusp(h: number): { l: number; c: number } {
  const key = Math.round(((h % 360) + 360) % 360);
  const hit = cuspCache.get(key);
  if (hit) return hit;
  let best = { l: 0.6, c: 0 };
  for (let l = 0.3; l <= 0.96; l += 0.01) {
    const c = maxChroma(key, l);
    if (c > best.c) best = { l, c };
  }
  cuspCache.set(key, best);
  return best;
}

/** Perceptual distance (OKLab ΔE, ~0.02 = just noticeable). */
export function colorDistance(a: string, b: string): number {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return 1;
  const x = rgbToOklab(pa.rgb);
  const y = rgbToOklab(pb.rgb);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------- formats & contrast

export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  oklch: string;
}

const r1 = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function colorFormats(hex: string): ColorFormats {
  const p = parseColor(hex);
  const [r, g, b] = p ? p.rgb.map(Math.round) : [0, 0, 0];
  const R = r! / 255;
  const G = g! / 255;
  const B = b! / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const L = (max + min) / 2;
  const d = max - min;
  const S = d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1));
  let H = 0;
  if (d) H = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  H = (H * 60 + 360) % 360;
  const o = hexToOklch(hex);
  return {
    hex: (normalizeColor(hex) ?? hex).toUpperCase(),
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${Math.round(H)}, ${Math.round(S * 100)}%, ${Math.round(L * 100)}%)`,
    oklch: `oklch(${r1(o.l * 100)}% ${r1(o.c, 3)} ${o.c < 0.002 ? 0 : r1(o.h)})`,
  };
}

/** WCAG 2 relative luminance (0–1). */
export function relativeLuminance(hex: string): number {
  const p = parseColor(hex);
  if (!p) return 0;
  const [r, g, b] = p.rgb.map((v) => toLinear(v / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type ContrastLevel = "AAA" | "AA" | "AA large" | "fail";
/** Text rating: AAA ≥ 7, AA ≥ 4.5 (body text), AA large ≥ 3 (large text, logos, icons). */
export function contrastLevel(ratio: number): ContrastLevel {
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fail";
}

export interface ContrastPair {
  a: number;
  b: number;
  ratio: number;
  level: ContrastLevel;
}

/** Every pair of palette colors with its contrast, best first. */
export function contrastPairs(hexes: string[]): ContrastPair[] {
  const out: ContrastPair[] = [];
  for (let i = 0; i < hexes.length; i++)
    for (let j = i + 1; j < hexes.length; j++) {
      const ratio = contrastRatio(hexes[i]!, hexes[j]!);
      out.push({ a: i, b: j, ratio: r1(ratio, 2), level: contrastLevel(ratio) });
    }
  return out.sort((x, y) => y.ratio - x.ratio);
}

// ---------------------------------------------------------------- names

const NAME_LAB = COLOR_NAMES.map(([name, hex]) => ({ name, lab: rgbToOklab(parseColor(hex)!.rgb) }));

function nameCandidates(hex: string): string[] {
  const p = parseColor(hex);
  if (!p) return [hex];
  const [L, a, b] = rgbToOklab(p.rgb);
  const C = Math.hypot(a, b);
  // Hue matters more than lightness for chromatic colors; chroma less for near-neutrals.
  return NAME_LAB.map((n) => {
    const nc = Math.hypot(n.lab[1], n.lab[2]);
    const dL = (L - n.lab[0]) * 0.9;
    const dab = Math.hypot(a - n.lab[1], b - n.lab[2]) * (C < 0.03 && nc < 0.03 ? 0.6 : 1.25);
    return { name: n.name, d: Math.hypot(dL, dab) };
  })
    .sort((x, y) => x.d - y.d)
    .map((x) => x.name);
}

/** Nearest simple name for a color ("Vermilion", "Navy", "Paper"…). */
export function nameColor(hex: string): string {
  return nameCandidates(hex)[0]!;
}

/** Names for a whole palette, unique (falls back to "Light X" / "Deep X" or the next nearest name). */
export function namePalette(hexes: string[], fixed: (string | null)[] = []): string[] {
  const used = new Map<string, string>();
  fixed.forEach((n, i) => n && used.set(n.toLowerCase(), hexes[i]!));
  return hexes.map((hex, i) => {
    const own = fixed[i];
    if (own) return own;
    const cands = nameCandidates(hex);
    for (const c of cands.slice(0, 3)) {
      const taken = used.get(c.toLowerCase());
      if (!taken) {
        used.set(c.toLowerCase(), hex);
        return c;
      }
      const v = `${hexToOklch(hex).l > hexToOklch(taken).l ? "Light" : "Deep"} ${c}`;
      if (!used.has(v.toLowerCase())) {
        used.set(v.toLowerCase(), hex);
        return v;
      }
    }
    const fallback = `${cands[0]} ${i + 1}`;
    used.set(fallback.toLowerCase(), hex);
    return fallback;
  });
}

// ---------------------------------------------------------------- generator

/** Small, fast, seedable PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roles of a fresh palette by size: one lead color, supporting colors, a dark ink and a light ground. */
export const ROLE_TEMPLATE: Record<number, PaletteRoleT[]> = {
  2: ["primary", "background"],
  3: ["primary", "neutral", "background"],
  4: ["primary", "secondary", "neutral", "background"],
  5: ["primary", "secondary", "accent", "neutral", "background"],
  6: ["primary", "secondary", "accent", "accent", "neutral", "background"],
};

export const HARMONY_LABELS: Record<HarmonyT, string> = {
  analogous: "Analogous",
  complementary: "Complementary",
  split: "Split complementary",
  triadic: "Triadic",
  monochrome: "Monochrome",
  logo: "From the logo",
  image: "From an image",
};

/** Hue offsets from the base hue for the chromatic slots: primary, secondary, accent, accent 2. */
function harmonyOffsets(h: HarmonyT, rng: () => number): number[] {
  const j = () => (rng() - 0.5) * 10;
  const dir = rng() < 0.5 ? 1 : -1;
  switch (h) {
    case "analogous":
      return [0, dir * (28 + j()), -dir * (30 + j()), dir * (58 + j())];
    case "complementary":
      return [0, 180 + j(), 180 + j(), 12 * dir];
    case "split":
      return [0, 150 + j(), 210 + j(), 30 * dir];
    case "triadic":
      return [0, 120 + j(), 240 + j(), 180];
    case "monochrome":
      return [0, 0, 0, 0];
    default:
      return [0, dir * 30, -dir * 30, 180];
  }
}

const CHROMATIC: PaletteRoleT[] = ["primary", "secondary", "accent"];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const wrapHue = (h: number) => ((h % 360) + 360) % 360;

export interface GenerateOptions {
  harmony: HarmonyT;
  /** 3–6 colors (default: the current palette's size, else 5). */
  count?: number;
  seed?: number;
  /** Current palette: locked entries stay exactly where they are. */
  current?: PaletteEntryT[];
  /** "logo": the version's colors by area share (see logoColors). */
  logo?: { hex: string; weight: number }[];
  /** "image": colors sampled from a reference image (see imageColors). */
  image?: { hex: string; weight: number }[];
}

interface Slot {
  role: PaletteRoleT;
  /** Index among chromatic slots (primary 0, secondary 1, accent 2, second accent 3). */
  k: number;
}

function slotsFor(roles: PaletteRoleT[]): Slot[] {
  let accents = 0;
  return roles.map((role) => {
    if (role === "primary") return { role, k: 0 };
    if (role === "secondary") return { role, k: 1 };
    if (role === "accent") return { role, k: 2 + Math.min(1, accents++) };
    return { role, k: -1 };
  });
}

/** Generate one color for a slot around base hue H. */
function makeColor(slot: Slot, H: number, offs: number[], harmony: HarmonyT, rng: () => number, vivid: number, prim: Oklch | null): Oklch {
  const jit = (s: number) => (rng() - 0.5) * 2 * s;
  if (slot.role === "neutral") {
    // Dark ink with a whisper of the brand hue.
    return { l: 0.2 + rng() * 0.09, c: 0.008 + rng() * (harmony === "monochrome" ? 0.035 : 0.022), h: H + jit(12) };
  }
  if (slot.role === "background") {
    return { l: 0.955 + rng() * 0.03, c: 0.004 + rng() * (harmony === "monochrome" ? 0.018 : 0.011), h: H + jit(14) };
  }
  const h = wrapHue(H + (offs[slot.k] ?? 0));
  const cusp = hueCusp(h);
  if (harmony === "monochrome" && prim && slot.k > 0) {
    // Same hue, distinct steps of lightness: a deeper shade, a lighter tint, a pale tint.
    const l = slot.k === 1 ? prim.l - 0.17 - rng() * 0.07 : slot.k === 2 ? prim.l + 0.16 + rng() * 0.06 : 0.86 + rng() * 0.05;
    const lc = clamp(l, 0.22, 0.93);
    return { l: lc, c: Math.min(0.2, maxChroma(h, lc) * (slot.k === 3 ? 0.3 : lc > 0.75 ? 0.5 : 0.75) * vivid), h };
  }
  let l: number;
  let cf: number;
  if (slot.k === 0) {
    l = mix(cusp.l, 0.56, 0.5) + jit(0.06);
    cf = 0.82 + rng() * 0.14;
  } else if (slot.k === 1) {
    const base = prim?.l ?? 0.58;
    const dir = base > 0.64 ? -1 : base < 0.46 ? 1 : rng() < 0.6 ? -1 : 1;
    l = base + dir * (0.1 + rng() * 0.1);
    // Same-hue secondaries (complementary's 2nd slot sits opposite) need clearer separation.
    cf = 0.55 + rng() * 0.25;
  } else if (slot.k === 2) {
    l = Math.min(0.8, mix(cusp.l, 0.64, 0.45) + jit(0.05));
    cf = 0.74 + rng() * 0.2;
    if (harmony === "complementary") l = clamp(l + 0.12, 0.3, 0.9);
  } else {
    l = 0.8 + rng() * 0.08;
    cf = 0.45 + rng() * 0.2;
  }
  l = clamp(l, 0.28, 0.9);
  const cap = slot.k === 2 ? 0.21 : slot.k === 0 ? 0.21 : 0.17;
  return { l, c: Math.min(cap, maxChroma(h, l) * cf * vivid), h };
}

/** Darken (or lighten) `o` until it reaches `min` contrast against `against`. */
function ensureContrast(o: Oklch, against: string, min: number): Oklch {
  let cur = o;
  const bgL = hexToOklch(against).l;
  const step = bgL > 0.6 ? -0.02 : 0.02;
  for (let i = 0; i < 30 && contrastRatio(oklchToHex(cur), against) < min; i++) cur = { ...cur, l: clamp(cur.l + step, 0.05, 0.98) };
  return cur;
}

/** The base hue implied by locked colors (a locked primary wins), or null. */
function lockedBaseHue(locked: { e: PaletteEntryT; slot: Slot }[], offs: number[]): number | null {
  const chromatic = locked.filter(({ e }) => hexToOklch(e.hex).c > 0.035);
  const lead = chromatic.find(({ e }) => e.role === "primary") ?? chromatic.find(({ slot }) => slot.k >= 0) ?? chromatic[0];
  if (!lead) return null;
  const h = hexToOklch(lead.e.hex).h;
  return wrapHue(h - (lead.slot.k >= 0 ? (offs[lead.slot.k] ?? 0) : 0));
}

/** Pick colors from a source list (logo inks or image samples) for the open slots. */
function pickFromSource(src: { hex: string; weight: number }[], slots: Slot[], open: number[], rng: () => number, isImage: boolean): Map<number, string> {
  const out = new Map<number, string>();
  const info = src.map((s) => ({ ...s, o: hexToOklch(s.hex) }));
  const taken: string[] = [];
  const far = (hex: string) => taken.every((t) => colorDistance(t, hex) > 0.07);
  const chrom = info.filter((s) => s.o.c >= 0.04);
  // Images: weigh in chroma (a small vivid area beats a big dull one for brand color); vary with the seed.
  const score = (s: (typeof info)[number]) => s.weight * (isImage ? 0.35 + s.o.c * 6 : 1) * (isImage ? 0.75 + rng() * 0.5 : 1);
  const ranked = [...chrom].sort((a, b) => score(b) - score(a));
  for (const i of open) {
    const slot = slots[i]!;
    let pick: (typeof info)[number] | undefined;
    if (slot.role === "neutral") pick = [...info].filter((s) => s.o.l < 0.4 && s.o.c < 0.08).sort((a, b) => a.o.l - b.o.l).find((s) => far(s.hex));
    else if (slot.role === "background") pick = [...info].filter((s) => s.o.l > 0.88 && s.o.c < 0.06).sort((a, b) => b.o.l - a.o.l).find((s) => far(s.hex));
    else pick = ranked.find((s) => far(s.hex));
    if (pick) {
      out.set(i, pick.hex);
      taken.push(pick.hex);
    }
  }
  return out;
}

/**
 * Generate a palette. Locked colors in `current` are kept at their index; the
 * rest is regenerated from the harmony around a base hue (from the locked
 * colors, the source colors, or the seed).
 */
export function generatePalette(o: GenerateOptions): PaletteEntryT[] {
  const current = o.current ?? [];
  const count = clamp(Math.round(o.count ?? (current.length || 5)), 2, 6);
  const seed = o.seed ?? 1;
  const rng = mulberry32(seed * 2654435761 + 7);
  const harmony = o.harmony;

  // Roles: locked entries keep theirs; open slots keep the user's role when the size is unchanged, else follow the template.
  const lockedAt = new Map<number, PaletteEntryT>();
  current.forEach((e, i) => e.locked && i < count && lockedAt.set(i, e));
  // Locked colors beyond the new size move into the last open places.
  current.forEach((e, i) => {
    if (!e.locked || i < count) return;
    for (let k = count - 1; k >= 0; k--)
      if (!lockedAt.has(k)) {
        lockedAt.set(k, e);
        break;
      }
  });
  const template = [...ROLE_TEMPLATE[count]!];
  const roles: PaletteRoleT[] = [];
  if (current.length === count) for (let i = 0; i < count; i++) roles.push(lockedAt.get(i)?.role ?? current[i]!.role);
  else {
    const pool = [...template];
    for (const e of lockedAt.values()) {
      const k = pool.indexOf(e.role);
      if (k >= 0) pool.splice(k, 1);
    }
    for (let i = 0; i < count; i++) roles.push(lockedAt.get(i)?.role ?? pool.shift() ?? "accent");
  }
  const slots = slotsFor(roles);
  const offs = harmonyOffsets(harmony === "logo" || harmony === "image" ? "analogous" : harmony, rng);
  const vivid = rng() < 0.22 ? 0.55 + rng() * 0.2 : 0.85 + rng() * 0.15;

  const hexes: (string | null)[] = Array.from({ length: count }, (_, i) => lockedAt.get(i)?.hex ?? null);
  const open = hexes.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);

  // Source-driven harmonies fill what they can from the logo / image first.
  const src = harmony === "logo" ? o.logo : harmony === "image" ? o.image : undefined;
  if (src?.length) {
    const picked = pickFromSource(src, slots, open, rng, harmony === "image");
    for (const [i, hex] of picked) hexes[i] = hex;
  }

  const locked = [...lockedAt.entries()].map(([i, e]) => ({ e, slot: slots[i]! }));
  let H = lockedBaseHue(locked, offs);
  if (H === null) {
    const lead = hexes.map((h, i) => (h && slots[i]!.k >= 0 ? { h: hexToOklch(h), k: slots[i]!.k } : null)).find((x) => x && x.h.c > 0.035);
    H = lead ? wrapHue(lead.h.h - (offs[lead.k] ?? 0)) : rng() * 360;
  }

  // Primary first (others are placed relative to it), then the rest in order.
  const order = [...hexes.keys()].sort((a, b) => (slots[a]!.k === 0 ? -1 : 0) - (slots[b]!.k === 0 ? -1 : 0));
  const primIdx = slots.findIndex((s) => s.k === 0);
  let prim: Oklch | null = primIdx >= 0 && hexes[primIdx] ? hexToOklch(hexes[primIdx]!) : null;
  const generated = new Set<number>();
  for (const i of order) {
    if (hexes[i]) continue;
    const c = makeColor(slots[i]!, H, offs, harmony, rng, vivid, prim);
    hexes[i] = oklchToHex(c);
    generated.add(i);
    if (slots[i]!.k === 0) prim = hexToOklch(hexes[i]!);
  }

  // Logo palettes need the lead color to read on the light ground (≥ 3:1) and the ink to be clearly dark.
  const bgIdx = roles.indexOf("background");
  const bg = bgIdx >= 0 ? hexes[bgIdx]! : "#ffffff";
  for (const i of generated) {
    const s = slots[i]!;
    if (s.k === 0) hexes[i] = oklchToHex(ensureContrast(hexToOklch(hexes[i]!), bg, 3));
    else if (s.role === "neutral") hexes[i] = oklchToHex(ensureContrast(hexToOklch(hexes[i]!), bg, 9));
  }

  const names = namePalette(hexes as string[], hexes.map((_, i) => lockedAt.get(i)?.name || null));
  return hexes.map((hex, i) =>
    PaletteEntry.parse({ hex: hex!, name: names[i], role: roles[i], locked: lockedAt.has(i) }),
  );
}

// ---------------------------------------------------------------- nudges

export interface Nudge {
  /** −1…1 → lightness ±0.25 (OKLCH L). */
  lightness?: number;
  /** −1…1 → chroma ×0…×2. */
  saturation?: number;
  /** −1…1 → hue turns toward warm orange (+) or cool blue (−), up to 40°. */
  warmth?: number;
}

const WARM = 55;
const COOL = 250;

/** Nudge a color's lightness, saturation and warmth in OKLCH. */
export function nudgeColor(hex: string, n: Nudge): string {
  const o = hexToOklch(hex);
  let { l, c, h } = o;
  if (n.lightness) l = clamp(l + n.lightness * 0.25, 0, 1);
  if (n.saturation) c = Math.max(0, c * (1 + n.saturation));
  if (n.warmth) {
    const target = n.warmth > 0 ? WARM : COOL;
    const w = Math.abs(n.warmth);
    if (c < 0.02) {
      // Near-neutrals take a tint instead of a hue turn.
      h = target;
      c = c + 0.025 * w;
    } else {
      const diff = ((target - h + 540) % 360) - 180;
      h = wrapHue(h + Math.sign(diff) * Math.min(Math.abs(diff), 40 * w));
    }
  }
  return oklchToHex({ l, c, h });
}

// ---------------------------------------------------------------- sources

/** The version's own colors by area share (for the "logo" harmony), with its background as a light/dark ground. */
export function logoColors(doc: DocT, frameId: string, o: StyleOptions = {}): { hex: string; weight: number }[] {
  const p = styleProfile(frameDoc(doc, frameId), { ...o, name: undefined });
  const out = p.palette.map((c) => ({ hex: c.hex, weight: c.share }));
  const f = doc.nodes[frameId];
  const bg = f?.type === "frame" && f.background ? normalizeColor(f.background) : null;
  if (bg && !out.some((c) => c.hex === bg)) out.push({ hex: bg, weight: 0.05 });
  return out;
}

/**
 * Dominant colors of an image: k-means in OKLab over sampled RGBA pixels
 * (transparent ones skipped), seeded so "regenerate" explores other picks.
 */
export function imageColors(rgba: ArrayLike<number>, o: { seed?: number; k?: number; maxSamples?: number } = {}): { hex: string; weight: number }[] {
  const k = o.k ?? 10;
  const total = Math.floor(rgba.length / 4);
  const stride = Math.max(1, Math.floor(total / (o.maxSamples ?? 6000)));
  const pts: [number, number, number][] = [];
  for (let i = 0; i < total; i += stride) {
    if (rgba[i * 4 + 3]! < 128) continue;
    pts.push(rgbToOklab([rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!]));
  }
  if (!pts.length) return [];
  const rng = mulberry32((o.seed ?? 1) * 7919 + 13);
  const d2 = (a: number[], b: number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
  // k-means++ seeding.
  const cents: [number, number, number][] = [pts[Math.floor(rng() * pts.length)]!];
  while (cents.length < Math.min(k, pts.length)) {
    const ds = pts.map((p) => Math.min(...cents.map((c) => d2(p, c))));
    const sum = ds.reduce((a, b) => a + b, 0);
    if (sum <= 0) break;
    let r = rng() * sum;
    let idx = 0;
    while ((r -= ds[idx]!) > 0 && idx < ds.length - 1) idx++;
    cents.push([...pts[idx]!]);
  }
  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 14; iter++) {
    pts.forEach((p, i) => {
      let best = 0;
      let bd = Infinity;
      cents.forEach((c, j) => {
        const d = d2(p, c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      assign[i] = best;
    });
    const acc = cents.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      const a = acc[assign[i]!]!;
      a[0]! += p[0];
      a[1]! += p[1];
      a[2]! += p[2];
      a[3]!++;
    });
    acc.forEach((a, j) => a[3]! && (cents[j] = [a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!]));
  }
  const counts = cents.map(() => 0);
  for (let i = 0; i < pts.length; i++) counts[assign[i]!]!++;
  const out: { hex: string; weight: number; lab: [number, number, number] }[] = [];
  cents.forEach((c, j) => {
    if (!counts[j]) return;
    const near = out.find((x) => Math.sqrt(d2(x.lab, c)) < 0.035);
    if (near) near.weight += counts[j]! / pts.length;
    else {
      const C = Math.hypot(c[1], c[2]);
      out.push({ hex: oklchToHex({ l: c[0], c: C, h: ((Math.atan2(c[2], c[1]) * 180) / Math.PI + 360) % 360 }), weight: counts[j]! / pts.length, lab: c });
    }
  });
  return out.sort((a, b) => b.weight - a.weight).map(({ hex, weight }) => ({ hex, weight: Math.round(weight * 1000) / 1000 }));
}

// ---------------------------------------------------------------- palette as data

export type PaletteInput = { hex: string; name?: string; role?: PaletteRoleT; locked?: boolean };

/** Normalize loose input (any CSS color, optional names/roles) into palette entries; roles default by position. */
export function toPaletteEntries(input: PaletteInput[]): PaletteEntryT[] {
  const hexes = input.map((c) => {
    const h = normalizeColor(c.hex);
    if (!h) throw new Error(`Not a color: "${c.hex}"`);
    return h;
  });
  const template = ROLE_TEMPLATE[clamp(input.length, 2, 6)] ?? ROLE_TEMPLATE[6]!;
  const names = namePalette(hexes, input.map((c) => c.name?.trim() || null));
  return input.map((c, i) => PaletteEntry.parse({ hex: hexes[i], name: names[i], role: c.role ?? template[Math.min(i, template.length - 1)] ?? "accent", locked: c.locked ?? false }));
}

const ROLE_LABEL: Record<PaletteRoleT, string> = { primary: "Primary", secondary: "Secondary", accent: "Accent", neutral: "Neutral", background: "Background" };
export const roleLabel = (r: PaletteRoleT) => ROLE_LABEL[r];

/** One line for the brief's palette field: "Primary Vermilion #E4472A · … · Background Paper #F6F3EC". */
export function paletteBriefText(colors: PaletteEntryT[]): string {
  return colors.map((c) => `${ROLE_LABEL[c.role]} ${c.name || nameColor(c.hex)} ${c.hex.toUpperCase()}`).join(" · ");
}

/** The palette as the agent reads it in get_document. */
export function paletteLines(doc: DocT): string[] {
  const colors = doc.palette?.colors ?? [];
  if (!colors.length) return [];
  return [
    "Brand palette (set by the user — use these exact colors):",
    ...colors.map((c) => `  • ${c.role}: ${c.hex} "${c.name}"${c.locked ? " (locked)" : ""}`),
  ];
}

const ROLE_WEIGHT: Record<PaletteRoleT, number> = { primary: 0.5, secondary: 0.24, accent: 0.14, neutral: 0.12, background: 0.04 };

/** Palette entries as weighted palette colors (for assignPalette). */
export function paletteAsProfile(colors: PaletteEntryT[]): PaletteColor[] {
  return colors.map((c) => ({
    hex: c.hex,
    share: ROLE_WEIGHT[c.role],
    roles: ["fill"],
    members: [c.hex],
    lightness: hexToOklch(c.hex).l * 100,
    name: c.name,
  }));
}

/** Update ops that remap every paint in a frame through `member` (raw color → new color). */
export function recolorFrameOps(doc: DocT, frameId: string, member: Map<string, string>, skip?: (n: NodeT) => boolean): { ops: OpT[]; skipped: string[] } {
  const ops: OpT[] = [];
  const skipped: string[] = [];
  for (const n of Object.values(frameDoc(doc, frameId).nodes)) {
    if (n.type !== "path" && n.type !== "shape" && n.type !== "text") continue;
    const fill = remapPaint(n.style.fill, member);
    const stroke = remapPaint(n.style.stroke, member);
    if (fill === undefined && stroke === undefined) continue;
    if (skip?.(n)) {
      skipped.push(n.id);
      continue;
    }
    const style: Record<string, unknown> = {};
    if (fill !== undefined) style.fill = fill;
    if (stroke !== undefined) style.stroke = stroke;
    ops.push({ op: "update", id: n.id, set: { style } });
  }
  return { ops, skipped };
}

/**
 * Recolor a version with the brand palette (one batch → one undo step), with the
 * same lightness-ordered pairing as match_palette. Background-role colors become
 * the version's background when it has one.
 */
export function applyPaletteOps(
  doc: DocT,
  frameId: string,
  colors: PaletteEntryT[],
  o: StyleOptions & { skip?: (n: NodeT) => boolean } = {},
): { ops: OpT[]; mapping: { from: string; to: string }[]; skipped: string[]; background: string | null } {
  // Grounds take part too (lightly weighted): light details on a mark become the ground color.
  const tgt = styleProfile(frameDoc(doc, frameId), { ...o, name: undefined });
  const pairs = assignPalette(paletteAsProfile(colors), tgt.palette);
  const member = new Map<string, string>();
  for (const c of tgt.palette) {
    const to = pairs.get(c.hex);
    if (to) for (const m of c.members) member.set(m, to);
  }
  const { ops, skipped } = recolorFrameOps(doc, frameId, member, o.skip);
  const f = doc.nodes[frameId];
  const ground = colors.find((c) => c.role === "background");
  let background: string | null = null;
  if (f?.type === "frame" && f.background && ground && normalizeColor(f.background) !== ground.hex) {
    background = ground.hex;
    ops.push({ op: "update", id: frameId, set: { background } });
  }
  const mapping = tgt.palette.filter((c) => pairs.has(c.hex)).map((c) => ({ from: c.hex, to: pairs.get(c.hex)! }));
  return { ops, mapping, skipped, background };
}

