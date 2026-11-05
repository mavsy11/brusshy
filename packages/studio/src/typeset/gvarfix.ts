import type { Face } from "./sources";

/**
 * Workaround for an opentype.js 2.0 gvar bug: a tuple with *private* point numbers whose count is 0
 * means "all points", but opentype.js stores an empty list and then reads that tuple's deltas with
 * the *shared* point count — garbage outlines (e.g. Roboto Flex "F" at slnt −10 explodes to 30 000
 * units tall). Before a glyph is varied we re-read its tuple headers from the raw gvar bytes and,
 * for those tuples, give opentype the explicit all-points list and correctly parsed deltas.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Raw {
  dv: DataView;
  axisCount: number;
  glyphCount: number;
  longOffsets: boolean;
  arrayOff: number;
}

function raw(face: Face): Raw | null {
  const k = "gvar:raw";
  if (face.cache.has(k)) return face.cache.get(k) as Raw | null;
  let out: Raw | null = null;
  const dv = face.table("gvar");
  if (dv && dv.byteLength > 20) {
    out = { dv, axisCount: dv.getUint16(4), glyphCount: dv.getUint16(12), longOffsets: (dv.getUint16(14) & 1) === 1, arrayOff: dv.getUint32(16) };
  }
  face.cache.set(k, out);
  return out;
}

function packedPoints(dv: DataView, p: { o: number }): number[] | "all" {
  let count = dv.getUint8(p.o++);
  if (count === 0) return "all";
  if (count & 0x80) count = ((count & 0x7f) << 8) | dv.getUint8(p.o++);
  const pts: number[] = [];
  let last = 0;
  while (pts.length < count) {
    const ctl = dv.getUint8(p.o++);
    const words = (ctl & 0x80) !== 0;
    const run = (ctl & 0x7f) + 1;
    for (let i = 0; i < run && pts.length < count; i++) {
      last += words ? dv.getUint16((p.o += 2) - 2) : dv.getUint8(p.o++);
      pts.push(last);
    }
  }
  return pts;
}

function packedDeltas(dv: DataView, p: { o: number }, count: number): number[] {
  const out: number[] = [];
  while (out.length < count) {
    const ctl = dv.getUint8(p.o++);
    const run = (ctl & 0x3f) + 1;
    const zero = (ctl & 0x80) !== 0, words = (ctl & 0x40) !== 0;
    for (let i = 0; i < run && out.length < count; i++) {
      if (zero && words) out.push(dv.getInt32((p.o += 4) - 4)); // DELTAS_ARE_LONGS (newer spec)
      else if (zero) out.push(0);
      else if (words) out.push(dv.getInt16((p.o += 2) - 2));
      else out.push(dv.getInt8(p.o++));
    }
  }
  return out;
}

/** Repair one glyph's tuple data in place (once). Safe to call before every getTransform. */
export function fixGlyphVariations(face: Face, gid: number) {
  const k = `gvar:fixed:${gid}`;
  if (face.cache.has(k)) return;
  face.cache.set(k, true);
  const r = raw(face);
  const gvar = (face.font.tables as any).gvar;
  const vd = gvar?.glyphVariations?.[gid];
  if (!r || !vd?.headers?.length || gid >= r.glyphCount) return;
  try {
    const { dv, axisCount } = r;
    const offAt = (i: number) => (r.longOffsets ? dv.getUint32(20 + i * 4) : dv.getUint16(20 + i * 2) * 2);
    const start = r.arrayOff + offAt(gid);
    if (offAt(gid + 1) === offAt(gid)) return;
    const countField = dv.getUint16(start);
    const count = countField & 0x0fff;
    const shared = (countField & 0x8000) !== 0;
    const dataOff = start + dv.getUint16(start + 2);
    let h = start + 4;
    const heads: { size: number; priv: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      const size = dv.getUint16(h);
      const idx = dv.getUint16(h + 2);
      h += 4;
      if (idx & 0x8000) h += axisCount * 2;
      if (idx & 0x4000) h += axisCount * 4;
      heads.push({ size, priv: (idx & 0x2000) !== 0 });
    }
    const p = { o: dataOff };
    if (shared) packedPoints(dv, p);
    const glyph = face.font.glyphs.get(gid) as any;
    void glyph.path; // makes opentype load the glyph's points
    const nAll = (glyph.isComposite ? (glyph.components?.length ?? 0) : (glyph.points?.length ?? 0)) + 4;
    heads.forEach((hd, i) => {
      const o0 = p.o;
      const header = vd.headers[i];
      if (hd.priv && header) {
        const q = { o: p.o };
        const pts = packedPoints(dv, q);
        if (pts === "all") {
          const dx = packedDeltas(dv, q, nAll);
          const dy = packedDeltas(dv, q, nAll);
          Object.defineProperty(header, "privatePoints", { value: Array.from({ length: nAll }, (_, j) => j), writable: true, configurable: true });
          Object.defineProperty(header, "deltas", { value: dx, writable: true, configurable: true });
          Object.defineProperty(header, "deltasY", { value: dy, writable: true, configurable: true });
        }
      }
      p.o = o0 + hd.size;
    });
  } catch (e) {
    console.warn(`[type] gvar repair failed for glyph ${gid} in ${face.family}`, e);
  }
}
