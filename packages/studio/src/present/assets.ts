import {
  animationOf,
  colorFormats,
  frameDoc,
  hasAnimation,
  listFrames,
  MOCKUPS,
  nameColor,
  type AnimationT,
  type DocT,
  type FrameNodeT,
  type MockupKind,
  type PaletteRoleT,
} from "@brusshy/core";
import { buildSvg, prepareFonts } from "../export/svg";
import { extractPalette } from "../export/util";
import { ensureFont, textWidth } from "../lib/fonts";
import { prepareLogo, type LogoKit } from "../mockups/kit";
import { brandOf, renderMockupPng } from "../mockups/render";
import { SMALL_SIZES, type Shot } from "../panels/SmallSizes";
import { svgToCanvas } from "../export/raster";

/**
 * Everything the presentation shows, prepared once when it opens: the version's art for
 * light and dark surfaces, its small sizes, palette, type system, every version and
 * (lazily, one by one) the mockups. SVGs become object URLs (isolated <img>s, no id clashes).
 */

export const INK = "#0b0c0e";
export const LIGHT = "#ffffff";

export interface DeckColor {
  hex: string;
  name: string;
  role: PaletteRoleT | "";
  rgb: string;
}

export interface DeckFont {
  family: string;
  weight: number;
  tracking?: number;
  /** CSS family name to use (registered by ensureFont), null when the font didn't load. */
  css: string | null;
}

export interface DeckVersion {
  id: string;
  name: string;
  url: string;
  svg: string;
  bg: string | null;
  aspect: number;
  active: boolean;
}

export interface DeckAssets {
  brand: string;
  docName: string;
  frameId: string;
  frameName: string;
  doc: DocT;
  /** The artboard color of the version (its "tile"), null = none. */
  tileBg: string | null;
  tileSvg: string;
  tileUrl: string;
  animation: AnimationT | null;
  light: { url: string; svg: string; aspect: number };
  dark: { url: string; svg: string; aspect: number };
  mono: { black: string; white: string };
  /** True-size renders of the art for each surface (cropped to the artwork, like an icon). */
  shots: { light: Shot[]; dark: Shot[] };
  colors: DeckColor[];
  /** The palette came from doc.palette (true) or was read off the artwork (false). */
  paletteIsBrand: boolean;
  /** sampleSize: the specimen's font size (px on the 1600×900 slide) so the sample fits one line. */
  type: { heading: DeckFont; body: DeckFont | null; sample: string; sampleSize: number; note: string; fromLogo: boolean } | null;
  versions: DeckVersion[];
  mockupKinds: { kind: MockupKind; label: string }[];
  kit: LogoKit;
}

const urls = new Set<string>();
export const svgUrl = (svg: string) => {
  const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  urls.add(u);
  return u;
};
export const blobUrl = (b: Blob) => {
  const u = URL.createObjectURL(b);
  urls.add(u);
  return u;
};
export function releaseDeckUrls() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
}

const aspectOf = (svg: string) => {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number);
  return vb && vb[2] && vb[3] ? vb[2] / vb[3] : 1;
};

async function font(family: string, weight: number, tracking?: number): Promise<DeckFont> {
  const f = await ensureFont(family, weight).catch(() => null);
  return { family, weight, tracking, css: f ? family : null };
}

export async function prepareDeck(doc: DocT, frameId: string): Promise<DeckAssets> {
  const frame = doc.nodes[frameId] as FrameNodeT;
  const fdoc = frameDoc(doc, frameId);
  await prepareFonts(fdoc);
  const brand = brandOf(fdoc);
  const kit = await prepareLogo(fdoc, brand, "auto");
  const light = kit.on(LIGHT);
  const dark = kit.on(INK);
  const tileSvg = buildSvg(fdoc, { background: null });
  const spec = animationOf(frame.animation);

  // Palette: the brand palette when there is one, otherwise the colors the logo uses.
  const brandColors = doc.palette?.colors ?? [];
  const colors: DeckColor[] = (brandColors.length ? brandColors.map((c) => ({ hex: c.hex, name: c.name, role: c.role })) : extractPalette(fdoc).colors.slice(0, 6).map((c) => ({ hex: c.hex, name: "", role: "" as const }))).map((c) => ({
    ...c,
    hex: c.hex.toUpperCase(),
    name: c.name || nameColor(c.hex),
    rgb: colorFormats(c.hex).rgb,
  }));

  // Type: the saved type system, else the font the wordmark uses.
  let type: DeckAssets["type"] = null;
  const ts = doc.typeSystem;
  if (ts?.heading?.family) {
    const [heading, body] = await Promise.all([font(ts.heading.family, ts.heading.weight, ts.heading.tracking), ts.body ? font(ts.body.family, ts.body.weight, ts.body.tracking) : Promise.resolve(null)]);
    type = { heading, body, sample: ts.sample || brand, sampleSize: 150, note: ts.note, fromLogo: false };
  } else {
    const t = Object.values(fdoc.nodes).find((n) => n.type === "text" && n.visible && n.text.trim());
    if (t && t.type === "text") type = { heading: await font(t.fontFamily, t.fontWeight), body: null, sample: t.text.trim(), sampleSize: 150, note: "", fromLogo: true };
  }
  if (type) {
    const h = type.heading;
    const w = textWidth({ text: type.sample, fontFamily: h.css ?? "Geist", fontWeight: h.weight, fontSize: 100, letterSpacing: ((h.tracking ?? 0) / 1000) * 100 });
    type.sampleSize = Math.max(56, Math.min(150, Math.floor((100 * 840) / Math.max(1, w))));
  }

  const versions: DeckVersion[] = [];
  for (const f of listFrames(doc)) {
    const d = frameDoc(doc, f.id);
    await prepareFonts(d);
    const svg = buildSvg(d, { background: null });
    versions.push({ id: f.id, name: f.name, svg, url: svgUrl(svg), bg: f.background, aspect: f.width / f.height, active: f.id === frameId });
  }

  const [lightShots, darkShots] = await Promise.all([smallShots(light.svg).catch(() => []), smallShots(dark.svg).catch(() => [])]);

  return {
    brand,
    docName: doc.name,
    frameId,
    frameName: frame.name,
    doc: fdoc,
    tileBg: frame.background,
    tileSvg,
    tileUrl: svgUrl(tileSvg),
    animation: hasAnimation(spec) ? spec : null,
    light: { url: svgUrl(light.svg), svg: light.svg, aspect: aspectOf(light.svg) },
    dark: { url: svgUrl(dark.svg), svg: dark.svg, aspect: aspectOf(dark.svg) },
    mono: { black: svgUrl(kit.mono(INK, "full", LIGHT).svg), white: svgUrl(kit.mono(LIGHT, "full", INK).svg) },
    shots: { light: lightShots, dark: darkShots },
    colors,
    paletteIsBrand: brandColors.length > 0,
    type,
    versions,
    mockupKinds: MOCKUPS.map((m) => ({ kind: m.id, label: m.label })),
    kit,
  };
}

/** The art at 16/24/32/64 px (long side): at device resolution and pixel-exact. */
async function smallShots(svg: string): Promise<Shot[]> {
  const aspect = aspectOf(svg);
  const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const out: Shot[] = [];
  for (const size of SMALL_SIZES) {
    const w = Math.max(1, Math.round(aspect >= 1 ? size : size * aspect));
    const h = Math.max(1, Math.round(aspect >= 1 ? size / aspect : size));
    const c1 = await svgToCanvas(svg, w * dpr, { height: h * dpr });
    const c2 = await svgToCanvas(svg, w, { height: h });
    out.push({ size, screen: c1.toDataURL("image/png"), exact: c2.toDataURL("image/png"), w, h });
    c1.width = c1.height = c2.width = c2.height = 0;
  }
  return out;
}

/** Mockup PNGs, rendered one at a time in the background (cached per deck). */
export function mockupLoader(doc: DocT) {
  const cache = new Map<MockupKind, Promise<{ url: string; blob: Blob }>>();
  return (kind: MockupKind) => {
    let p = cache.get(kind);
    if (!p) {
      p = renderMockupPng(doc, kind, { width: 1600, theme: "auto" }).then((r) => ({ url: blobUrl(r.blob), blob: r.blob }));
      cache.set(kind, p);
      p.catch(() => cache.delete(kind));
    }
    return p;
  };
}
