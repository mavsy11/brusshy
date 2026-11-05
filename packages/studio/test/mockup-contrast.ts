import { applyOps, createDoc, frameDoc, listFrames, MOCKUPS, svgToOps, type DocT, type MockupKind, type NodeT } from "@brusshy/core";
import { svgToCanvas } from "../src/export/raster";
import { prepareLogo, setEmbedProbe, type LogoKit } from "../src/mockups/kit";
import { brandOf } from "../src/mockups/render";
import { businessCards, letterhead, storefront, tote } from "../src/mockups/scenes-print";
import { appIcon, avatar, browserTab } from "../src/mockups/scenes-screen";
import { render3DMockup } from "../src/mockups/three";
import brusshyMark from "./fixtures/brusshy-mark.svg?raw";

/*
 * Pixel check for every mockup: each color of every placed logo must read against whatever is
 * drawn right under it. For one color of one embed we render the scene three ways (as is, that
 * color painted magenta, that color removed): magenta vs removed gives the color's pixels, and
 * as-is vs removed gives the contrast between the color and what it covers.
 *
 * A color that carries other colors of the logo (the plate of a badge) may melt into the surface,
 * as long as what sits on it reads against it. So may a one-color knock-out (a part printed in the
 * surface's own color, straight on the surface), as long as the rest of that logo reads.
 * Decorative embeds (watermarks) and logos under 48 px (the favicon and avatar ladders, judged
 * by the pixel checks instead) are skipped.
 */

const W = 800;
const H = 600;
const MIN_CONTRAST = 1.6;
/** Pixels: below this a color is too small to judge at this size (a sparkle). */
const MIN_AREA = 24;
/** A logo smaller than this across (px) is a size-ladder thumbnail. */
const MIN_EMBED = 48;
/** At or below this a part matches what it covers on purpose (a knock-out). */
const KNOCKOUT = 1.06;

const FIXTURES: { name: string; svg: string }[] = [
  // The real Brusshy logo: dark plate, light mark, dark details cut into the mark.
  { name: "Brusshy", svg: brusshyMark },
  // Navy badge with a white star on it, orange bar beside it.
  {
    name: "Harbor",
    svg: `<svg viewBox="0 0 1024 1024"><circle cx="300" cy="512" r="220" fill="#1b2a52"/><path d="M300 380 L335 470 L430 475 L355 535 L380 630 L300 575 L220 630 L245 535 L170 475 L265 470 Z" fill="#ffffff"/><rect x="560" y="470" width="380" height="84" rx="20" fill="#f2691d"/></svg>`,
  },
  // A plain near-black mark, no plate.
  {
    name: "Inkwell",
    svg: `<svg viewBox="0 0 1024 1024"><path d="M200 800 L512 220 L824 800 Z" fill="#14161a"/><circle cx="512" cy="640" r="90" fill="#14161a"/></svg>`,
  },
  // A light mark meant for dark grounds.
  {
    name: "Paperlight",
    svg: `<svg viewBox="0 0 1024 1024"><rect x="220" y="220" width="584" height="584" rx="140" fill="none" stroke="#f6f3ec" stroke-width="70"/><circle cx="512" cy="512" r="120" fill="#f6f3ec"/></svg>`,
  },
  // One brand hue with a white detail.
  {
    name: "Ember",
    svg: `<svg viewBox="0 0 1024 1024"><path d="M512 160 C700 360 780 500 780 640 C780 790 660 880 512 880 C364 880 244 790 244 640 C244 500 324 360 512 160 Z" fill="#e4472a"/><circle cx="512" cy="660" r="110" fill="#ffffff"/></svg>`,
  },
  // A white plate with a dark mark (the light twin of the Brusshy badge).
  {
    name: "Chalk",
    svg: `<svg viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#ffffff"/><path d="M300 740 L512 280 L724 740 L620 740 L512 500 L404 740 Z" fill="#101113"/></svg>`,
  },
];

const FLAT: Partial<Record<MockupKind, (k: LogoKit) => string | Promise<string>>> = {
  "business-card": businessCards,
  "app-icon": appIcon,
  "browser-tab": browserTab,
  avatar,
  storefront,
  tote,
  letterhead,
};

export interface InkResult {
  embed: number;
  color: string;
  area: number;
  contrast: number;
  plate: boolean;
  knockout: boolean;
  ok: boolean;
}
export interface SceneResult {
  fixture: string;
  kind: MockupKind;
  theme: "light" | "dark";
  inks: InkResult[];
  ok: boolean;
  png: string;
}

function docFrom(name: string, svg: string): DocT {
  let doc = createDoc(name);
  const fid = listFrames(doc)[0]!.id;
  const { ops } = svgToOps(svg);
  doc = applyOps(
    doc,
    ops.map((o) => (o.op === "add" && !(o as { parent?: string }).parent ? { ...o, parent: fid } : o)),
  ).doc;
  return frameDoc(doc, fid);
}

const lum = (r: number, g: number, b: number) => {
  const c = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const pixels = (c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  c.width = c.height = 0;
  return d;
};

const hex6 = (v: string): string | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join("") : m[1]!;
  return `#${h.toLowerCase()}`;
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * Colors painted in an embed, one ink per exact color. Near-identical colors are not merged: one
 * drawn over the other is exactly the failure this test looks for (#f4f5f5 on #ffffff).
 */
function inksOf(inner: string): string[][] {
  const seen = new Set<string>();
  for (const m of inner.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) {
    const h = hex6(m[1]!);
    if (h) seen.add(h);
  }
  return [...seen].map((h) => [h]);
}

/** Repaint (or remove) one ink group inside an embed's SVG. */
const repaint = (inner: string, group: string[], to: string) =>
  inner.replace(/\b(fill|stroke)="([^"]+)"/g, (m, attr: string, v: string) => (group.includes(hex6(v) ?? "") ? `${attr}="${to}"` : m));

type Probe = { embed: number; group: string[] | "all"; to: string } | null;

async function scenePixels(build: () => string | Promise<string>, p: Probe): Promise<Uint8ClampedArray> {
  setEmbedProbe((inner, i) => {
    if (!p || i !== p.embed) return inner;
    if (p.group === "all") return inner.replace(/\b(fill|stroke)="(?!none)[^"]+"/g, `$1="none"`);
    return repaint(inner, p.group, p.to);
  });
  try {
    return pixels(await svgToCanvas(await build(), W, { height: H }));
  } finally {
    setEmbedProbe(null);
  }
}

const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number, t: number) =>
  Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) >= t;

/** Size (px across) of a whole logo: where the scene changes when the logo is removed. */
function extent(normal: Uint8ClampedArray, bare: Uint8ClampedArray): number {
  const box = [W, H, -1, -1];
  for (let i = 0, p = 0; i < normal.length; i += 4, p++) {
    if (!differs(normal, bare, i, 30)) continue;
    const x = p % W;
    const y = (p / W) | 0;
    box[0] = Math.min(box[0]!, x);
    box[1] = Math.min(box[1]!, y);
    box[2] = Math.max(box[2]!, x);
    box[3] = Math.max(box[3]!, y);
  }
  return box[2]! < 0 ? 0 : Math.max(box[2]! - box[0]!, box[3]! - box[1]!) + 1;
}

/**
 * Judge one color's pixels: its area, its contrast with what it covers, its bounding box, and
 * how much of it sits on other parts of the logo (vs straight on the scene).
 */
function measure(normal: Uint8ClampedArray, shown: Uint8ClampedArray, hidden: Uint8ClampedArray, bare: Uint8ClampedArray) {
  const cs: number[] = [];
  let onLogo = 0;
  const box = [W, H, -1, -1];
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < shown.length; i += 4, p++) {
    if (!differs(shown, hidden, i, 60)) continue;
    mask[p] = 1;
    if (differs(hidden, bare, i, 30)) onLogo++;
    const x = p % W;
    const y = (p / W) | 0;
    box[0] = Math.min(box[0]!, x);
    box[1] = Math.min(box[1]!, y);
    box[2] = Math.max(box[2]!, x);
    box[3] = Math.max(box[3]!, y);
    cs.push(ratio(lum(normal[i]!, normal[i + 1]!, normal[i + 2]!), lum(hidden[i]!, hidden[i + 1]!, hidden[i + 2]!)));
  }
  cs.sort((a, b) => a - b);
  // Bounds without the stray 2 % at each side (soft shadows, antialiasing) for the plate test.
  if (cs.length > 50) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let p = 0; p < mask.length; p++) if (mask[p]) xs.push(p % W), ys.push((p / W) | 0);
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const q = (a: number[], t: number) => a[Math.min(a.length - 1, Math.floor(a.length * t))]!;
    box[0] = q(xs, 0.02);
    box[1] = q(ys, 0.02);
    box[2] = q(xs, 0.98);
    box[3] = q(ys, 0.98);
  }
  return { area: cs.length, contrast: cs.length ? cs[cs.length >> 1]! : 0, box, mask, onLogo: cs.length ? onLogo / cs.length : 0 };
}

/** A plate carries other inks: most of another ink's pixels sit inside its box, and it fills that box. */
function plates(ms: { area: number; box: number[]; mask: Uint8Array }[]): boolean[] {
  return ms.map((m, i) => {
    const [x0, y0, x1, y1] = m.box as [number, number, number, number];
    const boxArea = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
    if (m.area < MIN_AREA || m.area / boxArea < 0.3) return false;
    return ms.some((o, j) => {
      if (j === i || o.area < 4) return false;
      let inside = 0;
      for (let p = 0; p < o.mask.length; p++) if (o.mask[p] && p % W >= x0 && p % W <= x1 && ((p / W) | 0) >= y0 && ((p / W) | 0) <= y1) inside++;
      return inside / o.area >= 0.8;
    });
  });
}

type Measured = ReturnType<typeof measure> & { group: string[] };

/** Verdict for every ink of one logo. `blind` inks are pressed tone-on-tone on purpose. */
function judge(embed: number, ms: Measured[], blind: (m: Measured) => boolean = () => false, isPlate?: (m: Measured) => boolean): InkResult[] {
  const plate = isPlate ? ms.map(isPlate) : plates(ms);
  const out: InkResult[] = [];
  ms.forEach((m, i) => {
    if (m.area < MIN_AREA) return;
    const knockout = m.contrast <= KNOCKOUT && m.onLogo < 0.5;
    const b = blind(m);
    const ok = b || plate[i]! || knockout || m.contrast >= MIN_CONTRAST;
    out.push({ embed, color: m.group.join("+") + (b ? " (blind)" : ""), area: m.area, contrast: Math.round(m.contrast * 100) / 100, plate: plate[i]!, knockout, ok });
  });
  // Something of the logo has to read: plates and knock-outs alone are not a logo.
  if (out.length && !out.some((r) => !r.knockout && !r.color.endsWith("(blind)") && r.contrast >= MIN_CONTRAST)) out.forEach((r) => (r.ok = false));
  return out;
}

async function checkFlat(fixture: string, doc: DocT, kind: MockupKind, theme: "light" | "dark"): Promise<SceneResult> {
  const k = await prepareLogo(doc, brandOf(doc), theme);
  const build = () => FLAT[kind]!(k);
  // Pass 1: which logos the scene places, and their inks.
  const embeds: { decor: boolean; inks: string[][] }[] = [];
  setEmbedProbe((inner, i, decor) => {
    embeds[i] = { decor, inks: inksOf(inner) };
    return inner;
  });
  const svg = await build();
  setEmbedProbe(null);
  const canvas = await svgToCanvas(svg, W, { height: H });
  const png = canvas.toDataURL("image/png");
  const normal = pixels(canvas);
  const inks: InkResult[] = [];
  for (const [e, info] of embeds.entries()) {
    if (!info || info.decor) continue;
    const bare = await scenePixels(build, { embed: e, group: "all", to: "none" });
    if (extent(normal, bare) < MIN_EMBED) continue;
    const ms: Measured[] = [];
    for (const group of info.inks) {
      const shown = await scenePixels(build, { embed: e, group, to: "#ff00ff" });
      const hidden = await scenePixels(build, { embed: e, group, to: "none" });
      ms.push({ group, ...measure(normal, shown, hidden, bare) });
    }
    inks.push(...judge(e, ms));
  }
  return { fixture, kind, theme, inks, ok: inks.every((i) => i.ok), png };
}

/** 3D: hide one ink's nodes (same kit, so the scene makes the same decisions) and compare. */
async function check3D(fixture: string, doc: DocT, kind: "foil-card" | "wall-sign", theme: "light" | "dark"): Promise<SceneResult> {
  const k = await prepareLogo(doc, brandOf(doc), theme);
  const render = async (d: DocT) => pixels(await render3DMockup(kind, d, k, W, H));
  const first = await render3DMockup(kind, doc, k, W, H);
  const png = first.toDataURL("image/png");
  const normal = pixels(first);
  const leaves = Object.values(doc.nodes).filter((n): n is NodeT => n.type !== "group" && n.type !== "frame");
  const colorOf = (n: NodeT) => hex6(typeof n.style.fill === "string" ? n.style.fill : typeof n.style.stroke === "string" ? n.style.stroke : "") ?? "";
  const groups = inksOf(leaves.map((n) => `fill="${colorOf(n)}"`).join(" "));
  const hide = (group: string[] | null) => {
    const d: DocT = { ...doc, nodes: { ...doc.nodes } };
    for (const n of leaves) if (!group || group.includes(colorOf(n))) d.nodes[n.id] = { ...n, visible: false } as NodeT;
    return d;
  };
  const bare = await render(hide(null));
  const ms: Measured[] = [];
  for (const group of groups) ms.push({ group, ...measure(normal, normal, await render(hide(group)), bare) });
  // The foil card stamps the dominant ink in foil and presses the rest blind (paper on paper):
  // only the foil has to stand out there.
  const dominant = k.colors[0]?.hex.toLowerCase();
  const near = (h: string) => !!dominant && Math.hypot(...rgb(h).map((v, j) => v - rgb(dominant)[j]!)) < 70;
  // In 3D the parts stand at different depths, so their pixels don't nest the way the plate
  // test expects: plates come from the logo's geometry (the inks other inks are drawn on).
  const inks = judge(0, ms, (m) => kind === "foil-card" && !m.group.some(near), (m) => m.group.some((h) => k.plates.has(h)));
  return { fixture, kind, theme, inks, ok: inks.every((i) => i.ok), png };
}

async function run(only?: { fixture?: string; kind?: string }): Promise<SceneResult[]> {
  const out: SceneResult[] = [];
  for (const fx of FIXTURES) {
    if (only?.fixture && only.fixture !== fx.name) continue;
    const doc = docFrom(fx.name, fx.svg);
    for (const m of MOCKUPS) {
      if (only?.kind && only.kind !== m.id) continue;
      for (const theme of ["light", "dark"] as const) {
        const r = m.engine === "3d" ? await check3D(fx.name, doc, m.id as "foil-card" | "wall-sign", theme) : await checkFlat(fx.name, doc, m.id, theme);
        out.push(r);
        console.log(`${r.ok ? "ok  " : "FAIL"} ${fx.name} · ${m.id} · ${theme}`);
      }
    }
  }
  return out;
}

(window as unknown as { runContrast: typeof run }).runContrast = run;
document.title = "ready";
