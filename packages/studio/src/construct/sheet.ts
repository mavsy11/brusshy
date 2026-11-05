import { constructionSheetSvg, deriveConstruction, listFrames, type DocT, type ExportParams, type SheetText } from "@brusshy/core";
import { activeFrameId, useStore } from "../lib/store";
import { ensureFont, textToPath } from "../lib/fonts";
import { buildSvg } from "../export/svg";
import { svgToPng } from "../export/raster";
import { textBlob } from "../export/util";
import { textOutlinesFor } from "./actions";

/** The canvas frame a projected frame doc came from. */
function sourceFrame(fdoc: DocT) {
  const full = useStore.getState().doc;
  if (!full) return null;
  const byChild = fdoc.root.length ? full.nodes[fdoc.root[0]!]?.parent : null;
  const f = byChild ? full.nodes[byChild] : null;
  if (f?.type === "frame") return f;
  // An empty version has no children to trace back: it's the active one being exported.
  const a = full.nodes[activeFrameId(full) ?? ""];
  return a?.type === "frame" ? a : null;
}

/** Sheet labels outlined with the UI fonts (an SVG drawn as an image can't use page fonts). */
const outlinedText: SheetText = (s, x, y, o) => {
  const fam = o.mono ? "Geist Mono" : "Geist";
  const d = textToPath({ text: s, fontFamily: fam, fontWeight: o.weight ?? 400, fontSize: o.size, letterSpacing: (o.tracking ?? 0) * o.size, anchor: o.anchor ?? "start" }) ?? (o.mono ? textToPath({ text: s, fontFamily: "Geist", fontWeight: o.weight ?? 400, fontSize: o.size, letterSpacing: (o.tracking ?? 0) * o.size, anchor: o.anchor ?? "start" }) : null);
  if (!d) {
    const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<text x="${x}" y="${y}" font-family="Geist, Helvetica, Arial, sans-serif" font-size="${o.size}" font-weight="${o.weight ?? 400}" fill="${o.color}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}>${esc}</text>`;
  }
  const halo = o.halo ? ` stroke="${o.halo}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"` : "";
  return `<path d="${d}" transform="translate(${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100})" fill="${o.color}"${halo}/>`;
};

export const constructionDetail = (o: ExportParams) => `PNG 2048 + SVG${o.construction?.dark ? " · light and dark" : ""}`;

/** "construction" export: the construction sheet of the version (light, optionally dark). */
export async function exportConstruction(fdoc: DocT, o: ExportParams, base: string, onProgress: (p: number) => void): Promise<{ files: { name: string; blob: Blob }[]; note?: string }> {
  await Promise.all([ensureFont("Geist", 400), ensureFont("Geist", 500), ensureFont("Geist", 600), ensureFont("Geist Mono", 400)]);
  const frame = sourceFrame(fdoc);
  const outlines = textOutlinesFor(fdoc, fdoc.root);
  const drawn = frame?.construction?.guides.length ? frame.construction : null;
  const construction = drawn ?? deriveConstruction(fdoc, { textOutlines: outlines });
  const derived = !drawn;
  const markSvg = buildSvg(fdoc, { background: null, trim: { pad: 0.06 } });
  const full = useStore.getState().doc;
  const versions = full ? listFrames(full).length : 1;
  const subtitle = [versions > 1 ? frame?.name : null, `${fdoc.artboard.width} × ${fdoc.artboard.height}`].filter(Boolean).join(" · ");
  const files: { name: string; blob: Blob }[] = [];
  const tones = o.construction?.dark ? ([false, true] as const) : ([false] as const);
  let step = 0;
  for (const dark of tones) {
    const svg = constructionSheetSvg(fdoc, construction, { dark, title: full?.name ?? fdoc.name, subtitle, derived, text: outlinedText, textOutlines: outlines, markSvg });
    const suffix = dark ? "-construction-dark" : "-construction";
    files.push({ name: `${base}${suffix}.svg`, blob: textBlob(svg, "image/svg+xml") });
    files.push({ name: `${base}${suffix}.png`, blob: await svgToPng(svg, 2048) });
    onProgress(++step / tones.length);
  }
  return { files, note: derived ? "No construction drawn: derived from the mark's curves (keylines, centre lines, fitted circles)" : undefined };
}
