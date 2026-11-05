import {
  colorwayDoc,
  colorwayList,
  colorwaySheetSvg,
  findFrame,
  frameDoc,
  planColorways,
  type Colorway,
  type ColorwaysResponse,
  type DocT,
} from "@brusshy/core";
import { blobToBase64, registerRequest } from "../lib/requests";
import { useStore } from "../lib/store";
import { buildSvg, prepareFonts } from "../export/svg";
import { svgToPng, svgViewBox } from "../export/raster";
import { textToPath } from "../lib/fonts";

/** Artwork of one colorway as a standalone SVG (outlined text, no background: the tile paints it). */
export function colorwaySvg(doc: DocT, frameId: string, cw: Colorway): string {
  return buildSvg(colorwayDoc(doc, frameId, cw), { background: null });
}

/** The agent's make_colorways asks the studio for the contact sheet (fonts outlined like the canvas). */
registerRequest("colorways", async (p): Promise<ColorwaysResponse> => {
  const doc = useStore.getState().doc;
  if (!doc) throw new Error("No document is open in the studio");
  const f = findFrame(doc, p.frame);
  if (!f) throw new Error(`Frame ${p.frame} not found`);
  const colors = p.palette ?? doc.palette?.colors ?? [];
  if (colors.length < 2) throw new Error("The palette needs at least 2 colors");
  await prepareFonts(frameDoc(doc, f.id));
  const plan = planColorways(doc, f.id, colors, { textToPath });
  if (!plan.all.length) throw new Error(`"${f.name}" has nothing to recolor`);
  const svg = colorwaySheetSvg(plan, (cw) => colorwaySvg(doc, f.id, cw), { title: `${doc.name} · ${f.name} — colorways`, tile: p.tile });
  const box = svgViewBox(svg);
  const png = await svgToPng(svg, box.width);
  return { png: await blobToBase64(png), width: Math.round(box.width), height: Math.round(box.height), list: colorwayList(plan) };
});

/** Decode an image (URL or file) to RGBA pixels at a small size for color sampling. */
export async function imagePixels(src: string, max = 160): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || max) * k));
  const h = Math.max(1, Math.round((img.naturalHeight || max) * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is not available");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}
