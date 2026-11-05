import type { ShapeEntry } from "./types";

/**
 * Catalog search: every query word must match the name, id, tags or a synonym.
 * Exact words beat prefixes beat substrings; our own generated shapes win ties.
 */

/** Small thesaurus for logo vocabulary (both directions are added below). */
const SYNONYMS: Record<string, string[]> = {
  heart: ["love", "like", "romance", "valentine", "favorite"],
  star: ["favorite", "rating", "award", "sparkle", "celebrity"],
  sparkle: ["shine", "twinkle", "glitter", "magic", "ai", "spark", "star", "new"],
  bolt: ["lightning", "energy", "power", "electric", "flash", "thunder", "fast", "charge"],
  globe: ["world", "earth", "planet", "international", "global", "web"],
  leaf: ["nature", "eco", "green", "organic", "plant", "botanical", "vegan"],
  flower: ["bloom", "floral", "blossom", "petal", "garden", "botanical"],
  drop: ["water", "liquid", "rain", "droplet", "teardrop", "ink", "oil"],
  wave: ["water", "sea", "ocean", "surf", "sound", "flow"],
  sun: ["sunny", "solar", "summer", "light", "day", "bright", "sunrise"],
  moon: ["night", "lunar", "crescent", "sleep", "dark"],
  mountain: ["peak", "summit", "outdoor", "hiking", "alpine", "adventure"],
  shield: ["security", "protection", "safe", "guard", "crest", "badge", "defense"],
  badge: ["emblem", "seal", "award", "label", "insignia", "crest"],
  arrow: ["direction", "pointer", "next", "forward", "growth", "move"],
  chevron: ["caret", "angle", "arrowhead", "rank"],
  bubble: ["chat", "speech", "message", "talk", "comment", "conversation"],
  camera: ["photo", "photography", "lens", "picture", "snapshot"],
  lens: ["aperture", "camera", "optics", "shutter"],
  ring: ["circle", "donut", "loop", "orbit", "halo", "o"],
  circle: ["round", "dot", "disc", "ring", "o"],
  square: ["box", "block", "tile", "quadrate"],
  crown: ["king", "queen", "royal", "premium", "luxury", "vip"],
  gear: ["cog", "settings", "engineering", "mechanical", "industry"],
  burst: ["starburst", "seal", "explosion", "sale", "promo", "badge"],
  blob: ["organic", "fluid", "amoeba", "liquid", "abstract"],
  infinity: ["forever", "endless", "loop", "eternal"],
  play: ["start", "video", "media", "music", "go"],
  record: ["rec", "dot", "live"],
  frame: ["border", "outline", "container", "box"],
  laurel: ["wreath", "award", "victory", "olive", "winner", "champion"],
  ribbon: ["banner", "scroll", "label", "tape"],
  pin: ["location", "map", "place", "marker", "gps"],
  eye: ["vision", "see", "view", "watch", "look", "optic"],
  key: ["access", "unlock", "password", "security"],
  lock: ["secure", "private", "padlock", "security"],
  house: ["home", "real estate", "building", "property"],
  tree: ["forest", "nature", "wood", "pine", "oak"],
  flame: ["fire", "hot", "burn", "heat", "spicy", "torch"],
  cloud: ["sky", "weather", "storage", "saas"],
  spiral: ["swirl", "twirl", "vortex", "hypnotic", "coil"],
  pattern: ["texture", "grid", "background", "halftone"],
  dots: ["dot", "halftone", "polka", "grid", "matrix"],
  stripes: ["lines", "bars", "striped"],
  check: ["tick", "done", "ok", "yes", "correct", "approved"],
  cube: ["box", "3d", "block", "isometric", "package"],
  gem: ["diamond", "jewel", "crystal", "luxury", "precious"],
  atom: ["science", "physics", "nuclear", "molecule", "tech"],
  pause: ["stop", "hold", "break"],
  letter: ["type", "glyph", "typography", "monogram"],
  bar: ["stem", "line", "stroke", "rule"],
  bowl: ["counter", "letter", "d", "b", "p"],
};

const SYN = new Map<string, Set<string>>();
for (const [k, vs] of Object.entries(SYNONYMS))
  for (const v of vs) {
    if (!SYN.has(k)) SYN.set(k, new Set());
    if (!SYN.has(v)) SYN.set(v, new Set());
    SYN.get(k)!.add(v);
    SYN.get(v)!.add(k);
  }

export interface SearchHit {
  entry: ShapeEntry;
  score: number;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const index = new WeakMap<ShapeEntry, { name: string[]; tags: string[]; text: string }>();
function indexOf(e: ShapeEntry) {
  let ix = index.get(e);
  if (!ix) {
    const name = [...new Set([...words(e.name), ...words(e.id.replace(/^icon:/, ""))])];
    const tags = [...new Set(e.tags.flatMap(words))];
    ix = { name, tags, text: `${name.join(" ")} ${tags.join(" ")}` };
    index.set(e, ix);
  }
  return ix;
}

function wordScore(ix: { name: string[]; tags: string[]; text: string }, w: string): number {
  let s = 0;
  if (ix.name.includes(w)) s = 10;
  else if (ix.name.some((n) => n.startsWith(w))) s = 7;
  else if (ix.tags.includes(w)) s = 6;
  else if (w.length >= 2 && ix.tags.some((t) => t.startsWith(w))) s = 4;
  else if (w.length >= 3 && ix.text.includes(w)) s = 2;
  if (s >= 6) return s;
  // A synonym of the word, as a whole word in the name or tags.
  const syn = SYN.get(w) ?? (w.endsWith("s") ? SYN.get(w.slice(0, -1)) : undefined);
  if (syn) for (const v of syn) if (ix.name.includes(v)) s = Math.max(s, 5);
    else if (ix.tags.includes(v)) s = Math.max(s, 3.5);
  if (!s && w.endsWith("s") && w.length > 3) return wordScore(ix, w.slice(0, -1)) * 0.9;
  return s;
}

/** Filter + rank. `category`: a shape category id, "icons", or "icons/<sub>" (e.g. icons/arrows). */
export function search(entries: ShapeEntry[], query: string, opts: { category?: string; limit?: number } = {}): SearchHit[] {
  const cat = opts.category && opts.category !== "all" ? opts.category : null;
  const [main, sub] = cat ? cat.split("/") : [null, null];
  const pool = cat ? entries.filter((e) => e.category === main && (!sub || e.sub === sub)) : entries;
  const q = words(query);
  let hits: SearchHit[];
  if (!q.length) hits = pool.map((entry) => ({ entry, score: 0 }));
  else {
    hits = [];
    for (const entry of pool) {
      const ix = indexOf(entry);
      let total = 0;
      for (const w of q) {
        const s = wordScore(ix, w);
        if (!s) {
          total = 0;
          break;
        }
        total += s;
      }
      if (total) hits.push({ entry, score: total + (entry.kind === "shape" ? 0.5 : 0) });
    }
    hits.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
  }
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}
