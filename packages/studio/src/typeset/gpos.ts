import type { Face } from "./sources";

/**
 * Pair kerning read straight from the GPOS bytes. opentype.js skips extension lookups (type 9),
 * which large fonts use for their kerning, and ignores variable-font kerning deltas; this reader
 * handles pair adjustment formats 1 and 2, extension lookups, and VariationIndex device tables
 * (deltas from the GDEF item variation store), so kerning follows the weight/width axes.
 * Falls back to the legacy `kern` table through opentype.js.
 */

interface PairSub {
  off: number;
  fmt: 1 | 2;
  cov: number;
  vf1: number;
  vf2: number;
}

interface Kern {
  dv: DataView;
  subs: PairSub[][]; // per lookup
  store: VarStore | null;
}

interface VarStore {
  regions: { start: number; peak: number; end: number }[][];
  data: { regionIndexes: number[]; rows: number[][] }[];
}

const u16 = (dv: DataView, o: number) => dv.getUint16(o);
const s16 = (dv: DataView, o: number) => dv.getInt16(o);
const bits = (vf: number) => {
  let n = 0;
  for (let b = vf & 0xff; b; b >>= 1) n += b & 1;
  return n * 2;
};

function coverage(dv: DataView, off: number, g: number): number {
  const fmt = u16(dv, off);
  if (fmt === 1) {
    const n = u16(dv, off + 2);
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const v = u16(dv, off + 4 + m * 2);
      if (v === g) return m;
      if (v < g) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  }
  if (fmt === 2) {
    const n = u16(dv, off + 2);
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const r = off + 4 + m * 6;
      const s = u16(dv, r), e = u16(dv, r + 2);
      if (g < s) hi = m - 1;
      else if (g > e) lo = m + 1;
      else return u16(dv, r + 4) + g - s;
    }
  }
  return -1;
}

function classDef(dv: DataView, off: number, g: number): number {
  if (!off) return 0;
  const fmt = u16(dv, off);
  if (fmt === 1) {
    const start = u16(dv, off + 2), n = u16(dv, off + 4);
    return g >= start && g < start + n ? u16(dv, off + 6 + (g - start) * 2) : 0;
  }
  if (fmt === 2) {
    const n = u16(dv, off + 2);
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const r = off + 4 + m * 6;
      const s = u16(dv, r), e = u16(dv, r + 2);
      if (g < s) hi = m - 1;
      else if (g > e) lo = m + 1;
      else return u16(dv, r + 4);
    }
  }
  return 0;
}

function parseVarStore(dv: DataView, off: number): VarStore | null {
  try {
    const regOff = off + dv.getUint32(off + 2);
    const dataCount = u16(dv, off + 6);
    const axisCount = u16(dv, regOff), regionCount = u16(dv, regOff + 2);
    const regions: VarStore["regions"] = [];
    for (let r = 0; r < regionCount; r++) {
      const axes = [];
      for (let a = 0; a < axisCount; a++) {
        const o = regOff + 4 + (r * axisCount + a) * 6;
        axes.push({ start: s16(dv, o) / 16384, peak: s16(dv, o + 2) / 16384, end: s16(dv, o + 4) / 16384 });
      }
      regions.push(axes);
    }
    const data: VarStore["data"] = [];
    for (let i = 0; i < dataCount; i++) {
      const d = off + dv.getUint32(off + 8 + i * 4);
      const itemCount = u16(dv, d);
      const wordField = u16(dv, d + 2);
      const long = (wordField & 0x8000) !== 0;
      const words = wordField & 0x7fff;
      const rc = u16(dv, d + 4);
      const regionIndexes = Array.from({ length: rc }, (_, k) => u16(dv, d + 6 + k * 2));
      let p = d + 6 + rc * 2;
      const rows: number[][] = [];
      for (let it = 0; it < itemCount; it++) {
        const row: number[] = [];
        for (let k = 0; k < rc; k++) {
          if (k < words) {
            row.push(long ? dv.getInt32(p) : s16(dv, p));
            p += long ? 4 : 2;
          } else {
            row.push(long ? s16(dv, p) : dv.getInt8(p));
            p += long ? 2 : 1;
          }
        }
        rows.push(row);
      }
      data.push({ regionIndexes, rows });
    }
    return { regions, data };
  } catch {
    return null;
  }
}

function load(face: Face): Kern | null {
  const k = "gpos:kern";
  if (face.cache.has(k)) return face.cache.get(k) as Kern | null;
  let out: Kern | null = null;
  const dv = face.table("GPOS");
  try {
    if (dv) {
      const scriptList = u16(dv, 4), featureList = u16(dv, 6), lookupList = u16(dv, 8);
      // Script: latn, else DFLT, else first; default language system.
      const sc = u16(dv, scriptList);
      let langSys = 0;
      let pick = -1;
      for (let i = 0; i < sc; i++) {
        const tag = String.fromCharCode(...new Uint8Array(dv.buffer, dv.byteOffset + scriptList + 2 + i * 6, 4));
        if (tag === "latn") pick = i;
        else if (tag === "DFLT" && pick < 0) pick = i;
      }
      if (pick < 0 && sc) pick = 0;
      let featureIdx: number[] | null = null;
      if (pick >= 0) {
        const so = scriptList + u16(dv, scriptList + 2 + pick * 6 + 4);
        langSys = u16(dv, so) ? so + u16(dv, so) : u16(dv, so + 2) ? so + u16(dv, so + 8) : 0;
        if (langSys) {
          const n = u16(dv, langSys + 4);
          featureIdx = Array.from({ length: n }, (_, i) => u16(dv, langSys + 6 + i * 2));
        }
      }
      const fc = u16(dv, featureList);
      const lookups = new Set<number>();
      for (let i = 0; i < fc; i++) {
        const rec = featureList + 2 + i * 6;
        const tag = String.fromCharCode(...new Uint8Array(dv.buffer, dv.byteOffset + rec, 4));
        if (tag !== "kern" || (featureIdx && !featureIdx.includes(i))) continue;
        const fo = featureList + u16(dv, rec + 4);
        const lc = u16(dv, fo + 2);
        for (let j = 0; j < lc; j++) lookups.add(u16(dv, fo + 4 + j * 2));
      }
      const subs: PairSub[][] = [];
      for (const li of [...lookups].sort((a, b) => a - b)) {
        const lo = lookupList + u16(dv, lookupList + 2 + li * 2);
        const type = u16(dv, lo);
        const n = u16(dv, lo + 4);
        const list: PairSub[] = [];
        for (let s = 0; s < n; s++) {
          let so = lo + u16(dv, lo + 6 + s * 2);
          let t = type;
          if (t === 9) {
            t = u16(dv, so + 2);
            so = so + dv.getUint32(so + 4);
          }
          if (t !== 2) continue;
          const fmt = u16(dv, so) as 1 | 2;
          if (fmt !== 1 && fmt !== 2) continue;
          list.push({ off: so, fmt, cov: so + u16(dv, so + 2), vf1: u16(dv, so + 4), vf2: u16(dv, so + 6) });
        }
        if (list.length) subs.push(list);
      }
      // GDEF ≥ 1.3 holds the item variation store for device-table deltas.
      let store: VarStore | null = null;
      const gdef = face.table("GDEF");
      if (gdef && u16(gdef, 0) === 1 && u16(gdef, 2) >= 3) {
        const vs = gdef.getUint32(14);
        if (vs) store = parseVarStore(gdef, vs);
      }
      if (subs.length) out = { dv, subs, store };
    }
  } catch (e) {
    console.warn(`[type] GPOS kerning unreadable in ${face.family}`, e);
    out = null;
  }
  face.cache.set(k, out);
  return out;
}

function deltaFor(kern: Kern, device: number, norm: number[] | null): number {
  if (!device || !kern.store || !norm) return 0;
  const dv = kern.dv;
  if (u16(dv, device + 4) !== 0x8000) return 0; // a hinting device table, not a variation index
  const outer = u16(dv, device), inner = u16(dv, device + 2);
  const data = kern.store.data[outer];
  const row = data?.rows[inner];
  if (!data || !row) return 0;
  let sum = 0;
  data.regionIndexes.forEach((ri, k) => {
    const region = kern.store!.regions[ri];
    if (!region) return;
    let scalar = 1;
    for (let a = 0; a < region.length && scalar; a++) {
      const { start, peak, end } = region[a]!;
      const v = norm[a] ?? 0;
      if (peak === 0 || start > peak || peak > end || (start < 0 && end > 0)) continue;
      if (v < start || v > end) scalar = 0;
      else if (v === peak) continue;
      else if (v < peak) scalar *= (v - start) / (peak - start);
      else scalar *= (end - v) / (end - peak);
    }
    sum += scalar * (row[k] ?? 0);
  });
  return sum;
}

/** XAdvance (+ its variation delta) from the value record at `o` with format vf; subtable start for device offsets. */
function xAdvance(kern: Kern, sub: number, o: number, vf: number, norm: number[] | null): number {
  const dv = kern.dv;
  let p = o;
  let x = 0;
  if (vf & 0x1) p += 2;
  if (vf & 0x2) p += 2;
  if (vf & 0x4) {
    x = s16(dv, p);
    p += 2;
  }
  if (vf & 0x8) p += 2;
  if (vf & 0x10) p += 2;
  if (vf & 0x20) p += 2;
  if (vf & 0x40) {
    const dev = u16(dv, p);
    if (dev) x += deltaFor(kern, sub + dev, norm);
  }
  return x;
}

/**
 * Kerning between two glyphs in font units (positive = apart). `norm` = normalized axis coordinates
 * (fvar order) for variable fonts. Sums every kern lookup, first matching subtable per lookup.
 */
export function pairKerning(face: Face, left: number, right: number, norm: number[] | null): number {
  const kern = load(face);
  if (!kern) {
    const kp = (face.font as unknown as { kerningPairs?: Record<string, number> }).kerningPairs;
    return kp?.[`${left},${right}`] ?? 0;
  }
  const dv = kern.dv;
  let total = 0;
  for (const list of kern.subs) {
    for (const s of list) {
      const ci = coverage(dv, s.cov, left);
      if (ci < 0) continue;
      const size1 = bits(s.vf1), size2 = bits(s.vf2);
      if (s.fmt === 1) {
        const setOff = s.off + u16(dv, s.off + 10 + ci * 2);
        const n = u16(dv, setOff);
        const rec = 2 + size1 + size2;
        let lo = 0, hi = n - 1, found = -1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          const g2 = u16(dv, setOff + 2 + m * rec);
          if (g2 === right) {
            found = m;
            break;
          }
          if (g2 < right) lo = m + 1;
          else hi = m - 1;
        }
        if (found < 0) continue;
        total += xAdvance(kern, s.off, setOff + 2 + found * rec + 2, s.vf1, norm);
        break;
      } else {
        const cd1 = s.off + u16(dv, s.off + 8), cd2 = s.off + u16(dv, s.off + 10);
        const c1count = u16(dv, s.off + 12), c2count = u16(dv, s.off + 14);
        const c1 = classDef(dv, cd1, left), c2 = classDef(dv, cd2, right);
        if (c1 >= c1count || c2 >= c2count) break;
        const rec = size1 + size2;
        total += xAdvance(kern, s.off, s.off + 16 + (c1 * c2count + c2) * rec, s.vf1, norm);
        break;
      }
    }
  }
  return total;
}
