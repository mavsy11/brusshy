import { MOCKUPS, type DocT, type MockupKind, type MockupTheme } from "@brusshy/core";
import { canvasToBlob, svgToCanvas } from "../export/raster";
import { prepareLogo, SH, SW, type LogoKit } from "./kit";
import { businessCards, letterhead, storefront, tote } from "./scenes-print";
import { appIcon, avatar, browserTab } from "./scenes-screen";
import { render3DMockup } from "./three";

const FLAT: Partial<Record<MockupKind, (k: LogoKit) => string | Promise<string>>> = {
  "business-card": businessCards,
  "app-icon": appIcon,
  "browser-tab": browserTab,
  avatar,
  storefront,
  tote,
  letterhead,
};

export interface RenderedMockup {
  kind: MockupKind;
  canvas: HTMLCanvasElement;
  theme: "light" | "dark";
}

/** Brand name for labels: the document name without a trailing version name ("Acme V2" → "Acme"). */
export const brandOf = (doc: DocT) => doc.name.replace(/\s+V\d+$/i, "").trim() || "Brand";

const kits = new WeakMap<DocT, Map<string, Promise<LogoKit>>>();

/** Logo kits are cached per (projected) document and theme, so a gallery renders fast. */
function kitFor(doc: DocT, theme: MockupTheme): Promise<LogoKit> {
  let m = kits.get(doc);
  if (!m) kits.set(doc, (m = new Map()));
  let k = m.get(theme);
  if (!k) {
    k = prepareLogo(doc, brandOf(doc), theme);
    m.set(theme, k);
    k.catch(() => m!.delete(theme));
  }
  return k;
}

/** Draw one mockup scene (4:3) at `width` px. */
export async function renderMockup(doc: DocT, kind: MockupKind, o: { width?: number; theme?: MockupTheme } = {}): Promise<RenderedMockup> {
  const width = Math.max(200, Math.min(4096, Math.round(o.width ?? 1600)));
  const height = Math.round((width * SH) / SW);
  const k = await kitFor(doc, o.theme ?? "auto");
  const theme = k.dark ? "dark" : "light";
  const info = MOCKUPS.find((m) => m.id === kind);
  if (!info) throw new Error(`Unknown mockup "${kind}"`);
  if (info.engine === "3d") {
    const canvas = await render3DMockup(kind as "foil-card" | "wall-sign", doc, k, width, height);
    return { kind, canvas, theme };
  }
  const svg = await FLAT[kind]!(k);
  const canvas = await svgToCanvas(svg, width, { height });
  return { kind, canvas, theme };
}

export async function renderMockupPng(doc: DocT, kind: MockupKind, o: { width?: number; theme?: MockupTheme } = {}): Promise<{ blob: Blob; width: number; height: number; theme: "light" | "dark" }> {
  const r = await renderMockup(doc, kind, o);
  const blob = await canvasToBlob(r.canvas);
  const out = { blob, width: r.canvas.width, height: r.canvas.height, theme: r.theme };
  r.canvas.width = r.canvas.height = 0;
  return out;
}
