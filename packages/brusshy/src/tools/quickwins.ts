import zlib from "node:zlib";
import { z } from "zod";
import type { RenderResponse } from "@brusshy/core";
import { renderSvgPng } from "../raster";
import { fail, ok, text, type ToolKit } from "./kit";

/** Sizes a logo has to survive: favicon, tab/toolbar, small UI, app list. */
export const SMALL_SIZES = [16, 24, 32, 64] as const;

const LIGHT = "#ffffff";
const DARK = "#0b0c0e";

/** Integer magnification so each size fills ~128 px in the sheet (keeps pixels square and crisp). */
const zoomFor = (size: number) => Math.max(1, Math.floor(128 / size));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced — what browsers and resvg emit). Null if unsupported. */
export function decodePng(b64: string): { w: number; h: number; px: Uint8Array } | null {
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8;
    let w = 0;
    let h = 0;
    let type = 0;
    const idat: Buffer[] = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const kind = buf.toString("ascii", off + 4, off + 8);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (kind === "IHDR") {
        w = data.readUInt32BE(0);
        h = data.readUInt32BE(4);
        type = data[9]!;
        if (data[8] !== 8 || data[12] !== 0 || (type !== 6 && type !== 2)) return null;
      } else if (kind === "IDAT") idat.push(data);
      else if (kind === "IEND") break;
      off += 12 + len;
    }
    const bpp = type === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * bpp;
    const out = new Uint8Array(w * h * 4);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)]!;
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = new Uint8Array(stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp]! : 0;
        const b = prev[i]!;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        const x = line[i]!;
        let v = x;
        if (f === 1) v = x + a;
        else if (f === 2) v = x + b;
        else if (f === 3) v = x + ((a + b) >> 1);
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        cur[i] = v & 255;
      }
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        out[o] = cur[x * bpp]!;
        out[o + 1] = cur[x * bpp + 1]!;
        out[o + 2] = cur[x * bpp + 2]!;
        out[o + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255;
      }
      prev = cur;
    }
    return { w, h, px: out };
  } catch {
    return null;
  }
}

/** Pixel-exact magnification as SVG blocks (resvg would smooth an upscaled <image>). */
function pixelBlocks(png: string, x0: number, y0: number, k: number): string | null {
  const img = decodePng(png);
  if (!img) return null;
  const out: string[] = [];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const o = (y * img.w + x) * 4;
      const a = img.px[o + 3]!;
      if (a === 0) continue;
      const hex = ((img.px[o]! << 16) | (img.px[o + 1]! << 8) | img.px[o + 2]!).toString(16).padStart(6, "0");
      out.push(`<rect x="${x0 + x * k}" y="${y0 + y * k}" width="${k}" height="${k}" fill="#${hex}"${a < 255 ? ` fill-opacity="${(a / 255).toFixed(3)}"` : ""}/>`);
    }
  return `<g shape-rendering="crispEdges">${out.join("")}</g>`;
}

export interface SmallRender {
  size: number;
  png: string;
  width: number;
  height: number;
}

/**
 * One contact sheet: a light row and a dark row; per size a magnified, pixel-exact view
 * (nearest-neighbour, so you see exactly which pixels survive) plus the true 1:1 render.
 */
export function contactSheetSvg(name: string, renders: SmallRender[]): string {
  const pad = 20;
  const cell = 148;
  const head = 44;
  const rowH = cell + 64;
  const width = pad * 2 + renders.length * cell + (renders.length - 1) * 12;
  const height = head + rowH * 2 + pad;
  const parts: string[] = [];
  parts.push(`<rect width="${width}" height="${height}" fill="#f4f5f5"/>`);
  parts.push(
    `<text x="${pad}" y="28" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="600" fill="#0b0c0e">${esc(name)} — small-size check</text>`,
    `<text x="${width - pad}" y="28" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#8e9599">magnified (pixel-exact) · 1:1 below</text>`,
  );
  (["light", "dark"] as const).forEach((tone, row) => {
    const bg = tone === "light" ? LIGHT : DARK;
    const ink = tone === "light" ? "#585f63" : "#b9bec1";
    const y0 = head + row * rowH;
    renders.forEach((r, i) => {
      const x0 = pad + i * (cell + 12);
      const k = zoomFor(r.size);
      const w = r.width * k;
      const h = r.height * k;
      parts.push(`<rect x="${x0}" y="${y0}" width="${cell}" height="${rowH - 12}" rx="10" fill="${bg}" stroke="#dfe2e3"/>`);
      const ix = x0 + (cell - w) / 2;
      const iy = y0 + 10 + (cell - 20 - h) / 2;
      parts.push(
        pixelBlocks(r.png, Math.round(ix), Math.round(iy), k) ??
          `<image x="${ix}" y="${iy}" width="${w}" height="${h}" image-rendering="optimizeSpeed" preserveAspectRatio="none" href="data:image/png;base64,${r.png}"/>`,
      );
      // True size, as it would appear on screen.
      const tx = x0 + 14;
      const ty = y0 + cell + 6;
      parts.push(`<image x="${tx}" y="${ty + (32 - r.height) / 2}" width="${r.width}" height="${r.height}" href="data:image/png;base64,${r.png}"/>`);
      parts.push(
        `<text x="${x0 + cell - 14}" y="${ty + 21}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="${ink}">${r.size}px · ${tone}</text>`,
      );
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

export function registerQuickWinTools(kit: ToolKit) {
  kit.tool(
    "check_small_sizes",
    "Final-size check before you say a logo is done: one contact-sheet image of the version at 16, 24, 32 and 64 px on light and dark backgrounds (magnified pixel-exact, plus 1:1). Look for details that vanish, counters that fill in, strokes that blur, and contrast on dark.",
    { frame: z.string().optional().describe("Frame (version) id or name (default: active frame)") },
    async ({ frame }) => {
      const s = await kit.state();
      const f = kit.frameFor(s, frame);
      const c = await kit.daemon();
      const long = Math.max(f.width, f.height);
      const renders: SmallRender[] = [];
      let source = "studio";
      for (const size of SMALL_SIZES) {
        // The longest side of the artboard becomes `size` px.
        const width = Math.max(1, Math.round((size * f.width) / long));
        const r = await c.call<RenderResponse & { source?: string }>("POST", "/api/render", { frame: f.id, view: "2d", width, transparent: true });
        if (r.source === "server") source = "server";
        renders.push({ size, png: r.png, width: r.width, height: r.height });
      }
      if (!renders.length) return fail("Nothing to render.");
      const svg = contactSheetSvg(`${s.doc.name} · ${f.name}`, renders);
      const sheet = renderSvgPng(svg, Number(/width="(\d+)"/.exec(svg)?.[1] ?? 680));
      return ok(
        { type: "image", data: sheet.toString("base64"), mimeType: "image/png" },
        text(
          [
            `Version "${f.name}" at ${SMALL_SIZES.join(" / ")} px (longest side), light row then dark row.`,
            "Judge honestly: does the idea still read at 16 px? Fix vanishing hairlines (thicken or drop them), merging gaps/counters (open them up), and tiny text (drop it from the icon).",
            "Dark row: a single dark ink disappearing on dark is expected — mention that a reversed (light) variant is needed rather than changing the main logo.",
            source === "server" ? "(Rendered on the server because the studio is not open: fonts may differ.)" : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    },
    "Checking at 16 px…",
  );
}
