import { parse, type Font } from "opentype.js";
import { extraFont, type ExtraFont } from "@brusshy/core";
import { unzlibSync } from "fflate";
import { useFontVersion } from "../lib/fonts";
import { token } from "../lib/socket";

/**
 * Where the type engine gets its fonts.
 *
 * Fontsource's per-subset files (what the canvas uses for plain text) are subset with only the
 * default OpenType features: stylistic sets, swashes, small caps, oldstyle figures and the `aalt`
 * alternates are stripped. So for type controls we load the *full* font from the Google Fonts
 * repository, served by the same CDN (jsDelivr's GitHub mirror, already allowed by the daemon's
 * CSP): one variable TTF covers every weight and axis. Fallbacks, in order:
 *   1. google/fonts on jsDelivr — full features, all axes (TTF, uncompressed)
 *   2. Fontsource variable subset (WOFF2, decoded with woff2-encoder — MIT, Google's woff2 in WASM)
 *   3. Fontsource static subset (WOFF), for families that aren't variable
 * Families that aren't on either yet (EXTRA_FONTS in core) come whole from their npm package.
 */

const API = "https://api.fontsource.org/v1";
const FS_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
const GF_CDN = "https://cdn.jsdelivr.net/gh/google/fonts@main";

// Ids go into CDN URLs: only what a Fontsource id can contain, so a family name can't point at another path.
export const fontId = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
const gfDir = (family: string) => family.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export interface FamilyMeta {
  id: string;
  family: string;
  weights: number[];
  styles: string[];
  variable: boolean;
  category: string;
  license: string;
  type: string;
}

export interface FsAxis {
  default: number;
  min: number;
  max: number;
  step: number;
}

const memo = <T>(fn: (k: string) => Promise<T>) => {
  const cache = new Map<string, Promise<T>>();
  return (k: string) => {
    let p = cache.get(k);
    if (!p) {
      p = fn(k);
      cache.set(k, p);
    }
    return p;
  };
};

const getJson = async <T>(url: string): Promise<T | null> => {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

export const extraMeta = (x: ExtraFont): FamilyMeta => ({ id: x.id, family: x.family, weights: x.weights, styles: x.styles, variable: x.variable, category: x.category, license: x.license, type: "npm" });

/** Fontsource metadata for a family (weights, styles, variable, category, licence). */
export const familyMeta = memo(async (family: string) => {
  const x = extraFont(family);
  return x ? extraMeta(x) : getJson<FamilyMeta>(`${API}/fonts/${fontId(family)}`);
});

/** Variable axes Fontsource knows for a family ({} when static). */
export const familyAxes = memo(async (family: string) => {
  const x = extraFont(family);
  if (x) return { ...x.axes };
  const r = await getJson<{ axes: Record<string, { default: string; min: string; max: string; step: string }> }>(`${API}/variable/${fontId(family)}`);
  const out: Record<string, FsAxis> = {};
  for (const [tag, a] of Object.entries(r?.axes ?? {})) out[tag] = { default: Number(a.default), min: Number(a.min), max: Number(a.max), step: Number(a.step) || 1 };
  return out;
});

interface GfFile {
  style: "normal" | "italic";
  weight: number;
  filename: string;
}
interface GfMeta {
  dir: string;
  files: GfFile[];
}

/** The family's folder in the Google Fonts repository (METADATA.pb lists its exact font files). */
const gfMeta = memo(async (family: string): Promise<GfMeta | null> => {
  const meta = await familyMeta(family);
  if (meta && meta.type && meta.type !== "google") return null;
  const lic = (meta?.license ?? "").toLowerCase();
  const order = lic.startsWith("apache") ? ["apache", "ofl", "ufl"] : lic.startsWith("ufl") ? ["ufl", "ofl", "apache"] : ["ofl", "apache", "ufl"];
  for (const l of order) {
    const dir = `${l}/${gfDir(family)}`;
    try {
      const r = await fetch(`${GF_CDN}/${dir}/METADATA.pb`);
      if (!r.ok) continue;
      const text = await r.text();
      const files: GfFile[] = [];
      for (const block of text.split(/\nfonts \{/).slice(1)) {
        const body = block.slice(0, block.indexOf("\n}"));
        const style = /style:\s*"(\w+)"/.exec(body)?.[1] === "italic" ? "italic" : "normal";
        const weight = Number(/weight:\s*(\d+)/.exec(body)?.[1] ?? 400);
        const filename = /filename:\s*"([^"]+)"/.exec(body)?.[1];
        if (filename) files.push({ style, weight, filename });
      }
      if (files.length) return { dir, files };
    } catch {
      /* try the next licence folder */
    }
  }
  return null;
});

export type FaceSource = "google-full" | "fontsource-variable" | "fontsource-static" | "npm-full";

/** A parsed font plus raw table access (the engine reads GSUB feature names and GPOS kerning itself). */
export interface Face {
  key: string;
  family: string;
  font: Font;
  source: FaceSource;
  italic: boolean;
  /** Has variation axes (fvar + gvar/CFF2). */
  variable: boolean;
  /** Static faces: the weight this file is. */
  weight: number;
  /** Raw table bytes by tag (decompressed). */
  table: (tag: string) => DataView | null;
  /** Engine caches (glyph outlines, kerning, GSUB plans…). */
  cache: Map<string, unknown>;
}

export interface FaceRequest {
  family: string;
  weight: number;
  italic?: boolean;
  /** The node uses variable axes: prefer a variable file. */
  variable?: boolean;
}

/** Table directory of an sfnt or WOFF 1 file (WOFF tables are zlib-inflated on first access). */
function tableReader(buf: ArrayBuffer): (tag: string) => DataView | null {
  const dv = new DataView(buf);
  const sig = dv.getUint32(0);
  const dir = new Map<string, { off: number; len: number; comp: number }>();
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (sig === 0x774f4646) {
    // wOFF
    const n = dv.getUint16(12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20;
      dir.set(tag(o), { off: dv.getUint32(o + 4), comp: dv.getUint32(o + 8), len: dv.getUint32(o + 12) });
    }
  } else {
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      dir.set(tag(o), { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12), comp: dv.getUint32(o + 12) });
    }
  }
  const cache = new Map<string, DataView | null>();
  return (t: string) => {
    if (cache.has(t)) return cache.get(t)!;
    const e = dir.get(t);
    let out: DataView | null = null;
    if (e) {
      try {
        const bytes = new Uint8Array(buf, e.off, e.comp);
        if (e.comp < e.len) {
          const raw = unzlibSync(bytes);
          out = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        } else out = new DataView(buf, e.off, e.len);
      } catch {
        out = null;
      }
    }
    cache.set(t, out);
    return out;
  };
}

let woff2: Promise<(b: ArrayBuffer) => Promise<Uint8Array>> | null = null;
/** WOFF2 → TTF. The daemon decodes it: the WASM decoder generates code at run time, which the studio's CSP forbids. */
export async function decodeWoff2(buf: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const r = await fetch("/api/woff2", { method: "POST", body: buf, headers: { "content-type": "font/woff2", "x-brusshy-token": token } });
    if (r.ok) return await r.arrayBuffer();
  } catch {
    /* no daemon (tests, a static harness): decode here */
  }
  woff2 ??= import("woff2-encoder/decompress").then((m) => m.default);
  const out = await (await woff2)(buf);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

async function fetchBuf(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function makeFace(key: string, family: string, buf: ArrayBuffer, source: FaceSource, italic: boolean, weight: number): Face | null {
  try {
    const font = parse(buf);
    return { key, family, font, source, italic, variable: !!(font as unknown as { variation?: unknown }).variation, weight, table: tableReader(buf), cache: new Map() };
  } catch (e) {
    console.warn(`[type] could not parse ${family} (${source})`, e);
    return null;
  }
}

const nearest = (ws: number[], w: number) => ws.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), ws[0] ?? 400);

/** Resolve which file serves a request (cheap: metadata only). The key identifies the face. */
async function resolve(req: FaceRequest): Promise<{ key: string; load: () => Promise<Face | null> } | null> {
  const italic = !!req.italic;
  const style = italic ? "italic" : "normal";
  const x = extraFont(req.family);
  if (x) {
    const key = `npm|${x.url}`;
    return {
      key,
      load: async () => {
        const buf = await fetchBuf(x.url);
        if (!buf) return null;
        try {
          return makeFace(key, x.family, await decodeWoff2(buf), "npm-full", false, x.weights[0] ?? 400);
        } catch (e) {
          console.warn("[type] woff2 decode failed", e);
          return null;
        }
      },
    };
  }
  const gf = await gfMeta(req.family);
  if (gf) {
    const files = gf.files.filter((f) => f.style === style);
    const pool = files.length ? files : gf.files;
    const vf = pool.find((f) => f.filename.includes("["));
    const file = vf ?? pool.find((f) => f.weight === nearest(pool.map((p) => p.weight), req.weight))!;
    const url = `${GF_CDN}/${gf.dir}/${encodeURIComponent(file.filename)}`;
    const key = `gf|${gf.dir}/${file.filename}`;
    return {
      key,
      load: async () => {
        const buf = await fetchBuf(url);
        return buf ? makeFace(key, req.family, buf, "google-full", file.style === "italic", file.weight) : null;
      },
    };
  }
  const meta = await familyMeta(req.family);
  if (!meta) return null;
  const id = fontId(req.family);
  const hasItalic = meta.styles.includes("italic");
  const st = italic && hasItalic ? "italic" : "normal";
  if (meta.variable && req.variable) {
    const axes = Object.keys(await familyAxes(req.family)).filter((t) => t !== "ital");
    const custom = axes.some((t) => t !== t.toLowerCase());
    const names = custom ? ["full", "standard", "wght"] : axes.some((t) => t !== "wght") ? ["standard", "wght"] : ["wght"];
    const key = `fsvf|${id}|${names[0]}|${st}`;
    return {
      key,
      load: async () => {
        for (const n of names) {
          const buf = await fetchBuf(`${FS_CDN}/${id}:vf@latest/latin-${n}-${st}.woff2`);
          if (!buf) continue;
          try {
            return makeFace(key, req.family, await decodeWoff2(buf), "fontsource-variable", st === "italic", 400);
          } catch (e) {
            console.warn("[type] woff2 decode failed", e);
          }
        }
        return null;
      },
    };
  }
  const w = nearest(meta.weights, req.weight);
  const key = `fs|${id}|${w}|${st}`;
  return {
    key,
    load: async () => {
      const buf = await fetchBuf(`${FS_CDN}/${id}@latest/latin-${w}-${st}.woff`);
      return buf ? makeFace(key, req.family, buf, "fontsource-static", st === "italic", w) : null;
    },
  };
}

const faces = new Map<string, Face | null>();
const loadingFaces = new Map<string, Promise<Face | null>>();
/** Request → face key, once resolved (so lookups are synchronous after the first load). */
const resolved = new Map<string, string | null>();
const reqKey = (r: FaceRequest) => `${r.family.trim().toLowerCase()}|${r.italic ? "i" : "n"}|${r.variable ? "v" : `s${r.weight}`}`;

/** Load (or get) the face for a request. Bumps the font version when it arrives so outlines re-render. */
export function loadFace(req: FaceRequest): Promise<Face | null> {
  const rk = reqKey(req);
  const fk = resolved.get(rk);
  if (fk !== undefined) {
    if (fk === null) return Promise.resolve(null);
    if (faces.has(fk)) return Promise.resolve(faces.get(fk)!);
    const p = loadingFaces.get(fk);
    if (p) return p;
  }
  const job = (async () => {
    const r = await resolve(req);
    if (!r) {
      resolved.set(rk, null);
      return null;
    }
    resolved.set(rk, r.key);
    if (faces.has(r.key)) {
      // Same file as another request (e.g. one variable font for every weight): re-render readers of this one.
      useFontVersion.setState((st) => ({ v: st.v + 1 }));
      return faces.get(r.key)!;
    }
    let p = loadingFaces.get(r.key);
    if (!p) {
      p = r.load().then((f) => {
        faces.set(r.key, f);
        loadingFaces.delete(r.key);
        useFontVersion.setState((s) => ({ v: s.v + 1 }));
        return f;
      });
      loadingFaces.set(r.key, p);
    }
    return p;
  })().catch(() => null);
  return job;
}

/** The face for a request if it is already loaded; starts loading it otherwise (returns undefined while loading). */
export function peekFace(req: FaceRequest): Face | null | undefined {
  const fk = resolved.get(reqKey(req));
  if (fk === null) return null;
  if (fk !== undefined && faces.has(fk)) return faces.get(fk)!;
  void loadFace(req);
  return undefined;
}

/** CSS font for UI previews (lists, waterfalls): registers a FontFace once and returns its family name. */
const cssFaces = new Map<string, Promise<boolean>>();
export function previewFamily(family: string, weight: number, o: { italic?: boolean; variable?: boolean } = {}): { name: string; ready: Promise<boolean> } {
  const id = fontId(family);
  const st = o.italic ? "italic" : "normal";
  const name = `bp-${id}${o.variable ? "-vf" : ""}`;
  const k = o.variable ? `${name}|${st}` : `${name}|${weight}|${st}`;
  let ready = cssFaces.get(k);
  if (!ready) {
    const vf = `${FS_CDN}/${id}:vf@latest/latin-wght-${st}.woff2`;
    const x = extraFont(family);
    const tryLoad = async (url: string) => {
      const face = new FontFace(name, `url(${url})`, { weight: o.variable ? "1 1000" : String(weight), style: st });
      await face.load();
      document.fonts.add(face);
      return true;
    };
    // A static weight the family doesn't ship falls back to its variable file, then to its nearest weight.
    if (x) ready = tryLoad(x.url).catch(() => false);
    else ready = tryLoad(o.variable ? vf : `${FS_CDN}/${id}@latest/latin-${weight}-${st}.woff2`)
      .catch(() => (o.variable ? Promise.reject() : tryLoad(vf)))
      .catch(async () => {
        const meta = await familyMeta(family);
        const w = meta ? nearest(meta.weights, weight) : 400;
        return tryLoad(`${FS_CDN}/${id}@latest/latin-${w}-${st}.woff2`);
      })
      .catch(() => false);
    cssFaces.set(k, ready);
  }
  return { name, ready };
}
