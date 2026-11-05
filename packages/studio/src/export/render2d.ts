import type { DocT, RenderParams, RenderResponse } from "@brusshy/core";
import { blobToBase64 } from "../lib/requests";
import { canvasToBlob, svgToCanvas } from "./raster";
import { buildSvg, loadRefs, prepareFonts } from "./svg";

const ACCENT = "#ff4d1f";

/** Small vermilion numbered pins (numbered in the order the agent lists annotations). */
function drawPins(doc: DocT, ctx: CanvasRenderingContext2D, w: number) {
  const k = w / doc.artboard.width;
  const r = Math.max(7, Math.min(13, w / 70));
  const list = Object.values(doc.annotations);
  list.forEach((a, i) => {
    if (a.status === "resolved" || a.status === "dismissed") return;
    const x = a.x * k;
    const y = a.y * k;
    ctx.save();
    ctx.shadowColor = "rgba(11,12,14,0.25)";
    ctx.shadowBlur = r * 0.6;
    ctx.shadowOffsetY = r * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = a.status === "in_progress" ? "#0b0c0e" : ACCENT;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(r * (i + 1 >= 10 ? 0.95 : 1.15))}px "Geist Variable", Geist, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x, y + r * 0.05);
  });
}

/** The agent's 2D preview: PNG of the artboard (optionally with working layers and annotation pins). */
export async function render2D(doc: DocT, p: RenderParams): Promise<RenderResponse> {
  await prepareFonts(doc);
  const refs = p.includeWorking ? await loadRefs(doc) : undefined;
  // Same semantics as the daemon fallback: explicit false = opaque, otherwise the artboard's own background.
  const background = p.transparent === false ? (doc.artboard.background ?? "#ffffff") : p.transparent === true ? null : undefined;
  const svg = buildSvg(doc, { includeWorking: !!p.includeWorking, refs, background });
  const width = Math.max(16, Math.min(4096, Math.round(p.width ?? 768)));
  const canvas = await svgToCanvas(svg, width, {
    overlay: p.showAnnotations ? (ctx, w) => drawPins(doc, ctx, w) : undefined,
  });
  const out = { width: canvas.width, height: canvas.height };
  const blob = await canvasToBlob(canvas);
  return { png: await blobToBase64(blob), ...out };
}
