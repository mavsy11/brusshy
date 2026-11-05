import { DESIGN_FEATURES, featureLabel } from "@brusshy/core";
import type { Face } from "./sources";

/**
 * A small GSUB engine (glyph substitution) over opentype.js's parsed tables. opentype.js only
 * shapes Latin `liga`/`rlig` (and throws on some lookups); this applies any feature set the user
 * turns on — stylistic sets, swashes, small caps, figures, contextual alternates — with lookup
 * types 1–8 (single, multiple, alternate, ligature, context, chained context, extension, reverse),
 * lookup flags (ignore marks/bases/ligatures, mark attachment class) and lookup-list order.
 * Not covered: GSUB FeatureVariations (rvrn swaps at certain axis values) — documented limit.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface Item {
  g: number;
  /** Character indices (in the node's text) this glyph draws. */
  chars: number[];
}

export function coverageIndex(cov: Any, g: number): number {
  if (!cov) return -1;
  if (cov.format === 1) {
    const gl: number[] = cov.glyphs;
    let lo = 0, hi = gl.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (gl[m] === g) return m;
      if (gl[m]! < g) lo = m + 1;
      else hi = m - 1;
    }
    return gl.indexOf(g); // unsorted coverage in a broken font
  }
  if (cov.format === 2) {
    for (const r of cov.ranges) if (g >= r.start && g <= r.end) return r.index + g - r.start;
  }
  return -1;
}

export function classOf(cd: Any, g: number): number {
  if (!cd) return 0;
  if (cd.format === 1) {
    const i = g - cd.startGlyph;
    return i >= 0 && i < cd.classes.length ? cd.classes[i] : 0;
  }
  if (cd.format === 2) {
    for (const r of cd.ranges) if (g >= r.start && g <= r.end) return r.classId;
  }
  return 0;
}

const gsubOf = (face: Face): Any => (face.font.tables as Any).gsub ?? null;

/** Feature records for the script we shape with (latn, else DFLT, else the first), default language. */
function featureIndexes(face: Face): number[] {
  const k = "gsub:featureIdx";
  if (face.cache.has(k)) return face.cache.get(k) as number[];
  const gsub = gsubOf(face);
  let out: number[] = [];
  if (gsub) {
    const scripts: Any[] = gsub.scripts ?? [];
    const s = scripts.find((x) => x.tag === "latn") ?? scripts.find((x) => x.tag === "DFLT") ?? scripts[0];
    const ls = s?.script?.defaultLangSys ?? s?.script?.langSysRecords?.[0]?.langSys;
    out = ls ? [...ls.featureIndexes] : gsub.features.map((_: unknown, i: number) => i);
    if (ls && ls.reqFeatureIndex !== undefined && ls.reqFeatureIndex !== 0xffff) out.push(ls.reqFeatureIndex);
  }
  face.cache.set(k, out);
  return out;
}

/** Lookup indices per feature tag (for the shaping script). */
function featureLookups(face: Face): Map<string, number[]> {
  const k = "gsub:featureLookups";
  if (face.cache.has(k)) return face.cache.get(k) as Map<string, number[]>;
  const gsub = gsubOf(face);
  const m = new Map<string, number[]>();
  if (gsub) {
    for (const i of featureIndexes(face)) {
      const f = gsub.features[i];
      if (!f) continue;
      const list = m.get(f.tag) ?? [];
      for (const l of f.feature.lookupListIndexes) if (!list.includes(l)) list.push(l);
      m.set(f.tag, list);
    }
  }
  face.cache.set(k, m);
  return m;
}

/** GSUB feature tags the font has (for the shaping script). */
export function gsubFeatures(face: Face): string[] {
  return [...featureLookups(face).keys()];
}

/** Names fonts give their stylistic sets (featureParams → name table), e.g. ss02 "Alternative a". */
export function featureNames(face: Face): Record<string, string> {
  const k = "gsub:names";
  if (face.cache.has(k)) return face.cache.get(k) as Record<string, string>;
  const out: Record<string, string> = {};
  const dv = face.table("GSUB");
  try {
    if (dv) {
      const fl = dv.getUint16(6);
      const n = dv.getUint16(fl);
      const names = face.font.names as Any;
      for (let i = 0; i < n; i++) {
        const rec = fl + 2 + i * 6;
        const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
        if (!/^(ss|cv)\d\d$/.test(tag) || out[tag]) continue;
        const fo = fl + dv.getUint16(rec + 4);
        const po = dv.getUint16(fo);
        if (!po) continue;
        // ssXX: version, UINameID. cvXX: format, featUiLabelNameId.
        const id = dv.getUint16(fo + po + 2);
        const nm = names?.windows?.[id]?.en ?? names?.unicode?.[id]?.en ?? names?.macintosh?.[id]?.en ?? Object.values(names?.windows?.[id] ?? {})[0];
        if (typeof nm === "string" && nm.trim() && !/^name:?$/i.test(nm.trim())) out[tag] = nm.trim();
      }
    }
  } catch {
    /* malformed featureParams: names are optional */
  }
  face.cache.set(k, out);
  return out;
}

/** Design features with names, in a sensible order (only those the font has). */
export function designFeatures(face: Face): { tag: string; name: string }[] {
  const names = featureNames(face);
  const order = ["liga", "dlig", "hlig", "calt", "salt", "swsh", "cswh", "titl", "smcp", "c2sc", "pcap", "case", "onum", "lnum", "tnum", "zero", "hist"];
  const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : /^ss/.test(t) ? 100 + Number(t.slice(2)) : 200 + Number(t.slice(2)));
  return gsubFeatures(face)
    .filter((t) => DESIGN_FEATURES.test(t))
    .sort((a, b) => rank(a) - rank(b))
    .map((tag) => ({ tag, name: featureLabel(tag, names[tag]) }));
}

/* ---------- applying lookups ---------- */

interface Ctx {
  gsub: Any;
  gdef: Any;
  /** Alternate index for type-3 lookups (0 = first alternate). */
  alt: number;
  depth: number;
}

function glyphClass(ctx: Ctx, g: number): number {
  return ctx.gdef?.classDef ? classOf(ctx.gdef.classDef, g) : 0;
}

function skipped(ctx: Ctx, flag: number, g: number): boolean {
  if (!flag || !ctx.gdef) return false;
  const c = glyphClass(ctx, g);
  if (c === 1 && flag & 2) return true;
  if (c === 2 && flag & 4) return true;
  if (c === 3) {
    if (flag & 8) return true;
    const mat = flag >> 8;
    if (mat && ctx.gdef.markAttachClassDef && classOf(ctx.gdef.markAttachClassDef, g) !== mat) return true;
  }
  return false;
}

const next = (ctx: Ctx, buf: Item[], i: number, flag: number) => {
  let j = i + 1;
  while (j < buf.length && skipped(ctx, flag, buf[j]!.g)) j++;
  return j;
};
const prev = (ctx: Ctx, buf: Item[], i: number, flag: number) => {
  let j = i - 1;
  while (j >= 0 && skipped(ctx, flag, buf[j]!.g)) j--;
  return j;
};

/** Match `count` more glyphs after i; returns their indices (first = i) or null. */
function matchInput(ctx: Ctx, buf: Item[], i: number, flag: number, rest: ((g: number, k: number) => boolean) | null, count: number): number[] | null {
  const pos = [i];
  let j = i;
  for (let k = 0; k < count; k++) {
    j = next(ctx, buf, j, flag);
    if (j >= buf.length || (rest && !rest(buf[j]!.g, k))) return null;
    pos.push(j);
  }
  return pos;
}

function matchBack(ctx: Ctx, buf: Item[], i: number, flag: number, test: (g: number, k: number) => boolean, count: number): boolean {
  let j = i;
  for (let k = 0; k < count; k++) {
    j = prev(ctx, buf, j, flag);
    if (j < 0 || !test(buf[j]!.g, k)) return false;
  }
  return true;
}

function matchAhead(ctx: Ctx, buf: Item[], last: number, flag: number, test: (g: number, k: number) => boolean, count: number): boolean {
  let j = last;
  for (let k = 0; k < count; k++) {
    j = next(ctx, buf, j, flag);
    if (j >= buf.length || !test(buf[j]!.g, k)) return false;
  }
  return true;
}

/** Apply nested lookups of a (chained) context rule at matched positions. Returns the length delta. */
function applyRecords(ctx: Ctx, buf: Item[], pos: number[], records: Any[]): number {
  let delta = 0;
  for (const r of records) {
    const at = pos[r.sequenceIndex];
    if (at === undefined) continue;
    const before = buf.length;
    applyLookupAt(ctx, buf, at + delta, r.lookupListIndex);
    delta += buf.length - before;
  }
  return delta;
}

/** Try one subtable at position i. Returns the index to continue from, or -1 if it didn't apply. */
function applySubtable(ctx: Ctx, buf: Item[], i: number, type: number, st: Any, flag: number): number {
  const g = buf[i]!.g;
  switch (type) {
    case 1: {
      const c = coverageIndex(st.coverage, g);
      if (c < 0) return -1;
      buf[i] = { ...buf[i]!, g: st.substFormat === 1 ? (g + st.deltaGlyphId + 65536) % 65536 : st.substitute[c] };
      return i + 1;
    }
    case 2: {
      const c = coverageIndex(st.coverage, g);
      if (c < 0) return -1;
      const seq: number[] = st.sequences[c] ?? [];
      if (!seq.length) return -1;
      buf.splice(i, 1, ...seq.map((s, k) => ({ g: s, chars: k === 0 ? buf[i]!.chars : [] })));
      return i + seq.length;
    }
    case 3: {
      const c = coverageIndex(st.coverage, g);
      if (c < 0) return -1;
      const set: number[] = st.alternateSets[c] ?? [];
      if (!set.length) return -1;
      buf[i] = { ...buf[i]!, g: set[Math.min(ctx.alt, set.length - 1)]! };
      return i + 1;
    }
    case 4: {
      const c = coverageIndex(st.coverage, g);
      if (c < 0) return -1;
      for (const lig of st.ligatureSets[c] ?? []) {
        const comps: number[] = lig.components;
        const pos = matchInput(ctx, buf, i, flag, (gg, k) => gg === comps[k], comps.length);
        if (!pos) continue;
        const chars = pos.flatMap((p) => buf[p]!.chars);
        for (let k = pos.length - 1; k >= 1; k--) buf.splice(pos[k]!, 1);
        buf[i] = { g: lig.ligGlyph, chars };
        return i + 1;
      }
      return -1;
    }
    case 5: {
      if (st.substFormat === 1) {
        const c = coverageIndex(st.coverage, g);
        if (c < 0) return -1;
        for (const rule of st.ruleSets[c] ?? []) {
          const pos = matchInput(ctx, buf, i, flag, (gg, k) => gg === rule.input[k], rule.input.length);
          if (pos) return pos[pos.length - 1]! + 1 + applyRecords(ctx, buf, pos, rule.lookupRecords);
        }
        return -1;
      }
      if (st.substFormat === 2) {
        if (coverageIndex(st.coverage, g) < 0) return -1;
        for (const rule of st.classSets[classOf(st.classDef, g)] ?? []) {
          const pos = matchInput(ctx, buf, i, flag, (gg, k) => classOf(st.classDef, gg) === rule.classes[k], rule.classes.length);
          if (pos) return pos[pos.length - 1]! + 1 + applyRecords(ctx, buf, pos, rule.lookupRecords);
        }
        return -1;
      }
      if (st.substFormat === 3) {
        const covs: Any[] = st.coverages;
        if (coverageIndex(covs[0], g) < 0) return -1;
        const pos = matchInput(ctx, buf, i, flag, (gg, k) => coverageIndex(covs[k + 1], gg) >= 0, covs.length - 1);
        if (!pos) return -1;
        return pos[pos.length - 1]! + 1 + applyRecords(ctx, buf, pos, st.lookupRecords);
      }
      return -1;
    }
    case 6: {
      if (st.substFormat === 1) {
        const c = coverageIndex(st.coverage, g);
        if (c < 0) return -1;
        for (const rule of st.chainRuleSets[c] ?? []) {
          if (!matchBack(ctx, buf, i, flag, (gg, k) => gg === rule.backtrack[k], rule.backtrack.length)) continue;
          const pos = matchInput(ctx, buf, i, flag, (gg, k) => gg === rule.input[k], rule.input.length);
          if (!pos || !matchAhead(ctx, buf, pos[pos.length - 1]!, flag, (gg, k) => gg === rule.lookahead[k], rule.lookahead.length)) continue;
          return pos[pos.length - 1]! + 1 + applyRecords(ctx, buf, pos, rule.lookupRecords);
        }
        return -1;
      }
      if (st.substFormat === 2) {
        if (coverageIndex(st.coverage, g) < 0) return -1;
        for (const rule of st.chainClassSet[classOf(st.inputClassDef, g)] ?? []) {
          if (!matchBack(ctx, buf, i, flag, (gg, k) => classOf(st.backtrackClassDef, gg) === rule.backtrack[k], rule.backtrack.length)) continue;
          const pos = matchInput(ctx, buf, i, flag, (gg, k) => classOf(st.inputClassDef, gg) === rule.input[k], rule.input.length);
          if (!pos || !matchAhead(ctx, buf, pos[pos.length - 1]!, flag, (gg, k) => classOf(st.lookaheadClassDef, gg) === rule.lookahead[k], rule.lookahead.length)) continue;
          return pos[pos.length - 1]! + 1 + applyRecords(ctx, buf, pos, rule.lookupRecords);
        }
        return -1;
      }
      if (st.substFormat === 3) {
        const inp: Any[] = st.inputCoverage, back: Any[] = st.backtrackCoverage, ahead: Any[] = st.lookaheadCoverage;
        if (!inp.length || coverageIndex(inp[0], g) < 0) return -1;
        if (!matchBack(ctx, buf, i, flag, (gg, k) => coverageIndex(back[k], gg) >= 0, back.length)) return -1;
        const pos = matchInput(ctx, buf, i, flag, (gg, k) => coverageIndex(inp[k + 1], gg) >= 0, inp.length - 1);
        if (!pos || !matchAhead(ctx, buf, pos[pos.length - 1]!, flag, (gg, k) => coverageIndex(ahead[k], gg) >= 0, ahead.length)) return -1;
        return pos[pos.length - 1]! + 1 + applyRecords(ctx, buf, pos, st.lookupRecords);
      }
      return -1;
    }
    case 8: {
      const c = coverageIndex(st.coverage, g);
      if (c < 0) return -1;
      const back: Any[] = st.backtrackCoverage, ahead: Any[] = st.lookaheadCoverage;
      if (!matchBack(ctx, buf, i, flag, (gg, k) => coverageIndex(back[k], gg) >= 0, back.length)) return -1;
      if (!matchAhead(ctx, buf, i, flag, (gg, k) => coverageIndex(ahead[k], gg) >= 0, ahead.length)) return -1;
      buf[i] = { ...buf[i]!, g: st.substitutes[c] };
      return i + 1;
    }
  }
  return -1;
}

function subtablesOf(lookup: Any): { type: number; st: Any }[] {
  return (lookup.subtables ?? [])
    .map((st: Any) => (lookup.lookupType === 7 ? { type: st.lookupType, st: st.extension } : { type: lookup.lookupType, st }))
    .filter((x: { st: Any }) => x.st && !x.st.error);
}

/** Apply one lookup at one position only (nested lookups from context rules). */
function applyLookupAt(ctx: Ctx, buf: Item[], i: number, li: number) {
  const lookup = ctx.gsub.lookups[li];
  if (!lookup || ctx.depth > 8 || i < 0 || i >= buf.length) return;
  ctx.depth++;
  try {
    for (const { type, st } of subtablesOf(lookup)) if (applySubtable(ctx, buf, i, type, st, lookup.lookupFlag ?? 0) >= 0) break;
  } finally {
    ctx.depth--;
  }
}

/** Apply one lookup across the buffer (reverse chaining runs right to left). */
function applyLookup(ctx: Ctx, buf: Item[], li: number) {
  const lookup = ctx.gsub.lookups[li];
  if (!lookup) return;
  const flag = lookup.lookupFlag ?? 0;
  const subs = subtablesOf(lookup);
  const reverse = subs.some((s) => s.type === 8);
  if (reverse) {
    for (let i = buf.length - 1; i >= 0; i--) {
      if (skipped(ctx, flag, buf[i]!.g)) continue;
      for (const { type, st } of subs) if (applySubtable(ctx, buf, i, type, st, flag) >= 0) break;
    }
    return;
  }
  let i = 0;
  let guard = 0;
  while (i < buf.length && guard++ < 10000) {
    if (skipped(ctx, flag, buf[i]!.g)) {
      i++;
      continue;
    }
    let moved = -1;
    for (const { type, st } of subs) {
      moved = applySubtable(ctx, buf, i, type, st, flag);
      if (moved >= 0) break;
    }
    i = moved > i ? moved : i + 1;
  }
}

/** Substitute glyphs for the enabled feature tags (lookups run in lookup-list order, as specified). */
export function substitute(face: Face, buf: Item[], tags: Set<string>): Item[] {
  const gsub = gsubOf(face);
  if (!gsub || !tags.size) return buf;
  const fl = featureLookups(face);
  const lookups = new Set<number>();
  for (const t of tags) for (const l of fl.get(t) ?? []) lookups.add(l);
  const ctx: Ctx = { gsub, gdef: (face.font.tables as Any).gdef ?? null, alt: 0, depth: 0 };
  const out = buf.map((x) => ({ ...x }));
  for (const li of [...lookups].sort((a, b) => a - b)) {
    try {
      applyLookup(ctx, out, li);
    } catch (e) {
      console.warn(`[type] GSUB lookup ${li} failed in ${face.family}`, e);
    }
  }
  return out;
}

/* ---------- glyph alternates ---------- */

const ALT_FEATURES = /^(salt|ss\d\d|swsh|cswh|cv\d\d|titl|hist|smcp|c2sc|pcap|onum|lnum|case|init|fina|aalt)$/;

export interface GlyphAlt {
  /** "feature:n" (n is 1-based within that feature). */
  key: string;
  label: string;
  g: number;
}

/**
 * Every single-glyph alternate a font offers for a glyph, from non-contextual single (type 1) and
 * alternate (type 3) lookups of design features, deduplicated. `aalt` is listed last as a catch-all.
 */
export function glyphAlternates(face: Face, g: number): GlyphAlt[] {
  const k = `gsub:alts:${g}`;
  if (face.cache.has(k)) return face.cache.get(k) as GlyphAlt[];
  const gsub = gsubOf(face);
  const out: GlyphAlt[] = [];
  if (gsub) {
    const fl = featureLookups(face);
    const names = featureNames(face);
    const tags = [...fl.keys()].filter((t) => ALT_FEATURES.test(t)).sort((a, b) => (a === "aalt" ? 1 : b === "aalt" ? -1 : a.localeCompare(b)));
    const seen = new Set<number>([g]);
    for (const tag of tags) {
      const found: number[] = [];
      for (const li of fl.get(tag) ?? []) {
        const lookup = gsub.lookups[li];
        if (!lookup) continue;
        for (const { type, st } of subtablesOf(lookup)) {
          const c = coverageIndex(st.coverage, g);
          if (c < 0) continue;
          if (type === 1) found.push(st.substFormat === 1 ? (g + st.deltaGlyphId + 65536) % 65536 : st.substitute[c]);
          else if (type === 3) found.push(...(st.alternateSets[c] ?? []));
        }
      }
      let n = 0;
      for (const alt of found) {
        n++;
        if (seen.has(alt)) continue;
        seen.add(alt);
        const base = tag === "aalt" ? "Alternate" : featureLabel(tag, names[tag]);
        out.push({ key: `${tag}:${n}`, label: found.length > 1 ? `${base} ${n}` : base, g: alt });
      }
    }
  }
  face.cache.set(k, out);
  return out;
}

/** Resolve an alternates key ("salt:2", "ss01") for a glyph. */
export function alternateFor(face: Face, g: number, key: string): number | null {
  const [tag, nStr] = key.split(":");
  const n = Number(nStr ?? 1) || 1;
  const exact = glyphAlternates(face, g).find((a) => a.key === `${tag}:${n}`);
  if (exact) return exact.g;
  // The key named an alternate that duplicated an earlier one: look it up directly.
  const gsub = gsubOf(face);
  const fl = featureLookups(face);
  const found: number[] = [];
  for (const li of fl.get(tag!) ?? []) {
    const lookup = gsub?.lookups[li];
    if (!lookup) continue;
    for (const { type, st } of subtablesOf(lookup)) {
      const c = coverageIndex(st.coverage, g);
      if (c < 0) continue;
      if (type === 1) found.push(st.substFormat === 1 ? (g + st.deltaGlyphId + 65536) % 65536 : st.substitute[c]);
      else if (type === 3) found.push(...(st.alternateSets[c] ?? []));
    }
  }
  return found[n - 1] ?? null;
}
