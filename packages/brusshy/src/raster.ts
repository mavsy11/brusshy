import { Resvg } from "@resvg/resvg-js";

/** Rasterize an SVG to PNG on the server (used when no studio tab is open). */
export function renderSvgPng(svg: string, width: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(16, Math.min(8192, Math.round(width))) },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
  });
  return Buffer.from(r.render().asPng());
}
