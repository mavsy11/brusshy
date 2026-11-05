import getStroke from "perfect-freehand";
import { docToSvg, type DocT, type NodeT, type SketchStrokeT, type TextNodeT } from "@brusshy/core";
import { preloadDocFonts, textToPath } from "../lib/fonts";
import { token } from "../lib/socket";
import { measureContent, padBox, tidyBox, withBackground, withViewBox, type Box } from "./raster";
import { exportableIds } from "./util";

export interface BuildSvgOptions {
  /** Paint every visible paint with this color. */
  monochrome?: string;
  /** Background fill; null = transparent; undefined = the artboard background. */
  background?: string | null;
  /** Include sketch + reference layers. Needs `refs` for reference images to show up in rasters. */
  includeWorking?: boolean;
  /** Reference src → data URL (see loadRefs). */
  refs?: Map<string, string>;
  /** Crop the viewBox to the artwork bounds plus padding (ratio of the longest side). */
  trim?: false | { pad: number; square?: boolean };
  pretty?: boolean;
}

/** Load every font used by the doc so text can be outlined. */
export async function prepareFonts(doc: DocT): Promise<void> {
  await preloadDocFonts(doc);
}

/** Text nodes that could not be outlined (font failed to load) — they stay as live <text>. */
export function unoutlinedText(doc: DocT): TextNodeT[] {
  return exportableIds(doc)
    .map((id) => doc.nodes[id]!)
    .filter((n): n is TextNodeT => n.type === "text" && !!n.text.trim() && !textToPath(n));
}

/** Served URL for a reference src ("refs/a.png" → "/refs/a.png"). */
export const refUrl = (src: string) => (src.startsWith("data:") || /^(https?:|blob:|\/)/.test(src) ? src : `/${src.replace(/^\.?\//, "")}`);

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Inline reference images as data URLs so rasterizing never taints the canvas. */
export async function loadRefs(doc: DocT): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const srcs = new Set(Object.values(doc.nodes).flatMap((n) => (n.type === "reference" && n.visible ? [n.src] : [])));
  await Promise.all(
    [...srcs].map(async (src) => {
      if (src.startsWith("data:")) return out.set(src, src);
      try {
        const res = await fetch(refUrl(src), { headers: token ? { "x-brusshy-token": token } : {} });
        if (!res.ok) return;
        out.set(src, await blobToDataUrl(await res.blob()));
      } catch {
        /* missing reference: rendered as an empty image */
      }
    }),
  );
  return out;
}

/** perfect-freehand outline → SVG path data (quadratic midpoints, like the studio canvas). */
export function freehandPath(s: SketchStrokeT): string {
  const pts = s.points;
  if (!pts.length) return "";
  const constantPressure = pts.every((p) => p[2] === pts[0]![2]);
  const outline = getStroke(
    pts.map((p) => [p[0], p[1], p[2]]),
    { size: s.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: constantPressure, last: true },
  );
  if (outline.length < 3) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(outline[0]![0]!)} ${f(outline[0]![1]!)}Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = outline[(i + 1) % outline.length]!;
    d += `${f(x0!)} ${f(y0!)} ${f((x0! + x1!) / 2)} ${f((y0! + y1!) / 2)} `;
  }
  return d.trim() + "Z";
}

/** Replace sketch nodes with groups of filled freehand outlines (variable width, like the canvas). */
function withFreehandSketches(doc: DocT): DocT {
  const sketches = Object.values(doc.nodes).filter((n) => n.type === "sketch");
  if (!sketches.length) return doc;
  const nodes: Record<string, NodeT> = { ...doc.nodes };
  for (const n of sketches) {
    if (n.type !== "sketch") continue;
    const kids: string[] = [];
    n.strokes.forEach((s, i) => {
      const id = `${n.id}__stroke${i}`;
      const d = freehandPath(s);
      if (!d) return;
      kids.push(id);
      nodes[id] = {
        id,
        type: "path",
        name: "",
        parent: n.id,
        visible: true,
        locked: false,
        aiLock: false,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        style: { ...n.style, fill: s.color, stroke: null, strokeWidth: 0, opacity: 1, fillRule: "nonzero" },
        d,
      };
    });
    nodes[n.id] = {
      id: n.id,
      type: "group",
      name: n.name,
      parent: n.parent,
      visible: n.visible,
      locked: n.locked,
      aiLock: n.aiLock,
      transform: n.transform,
      style: n.style,
      children: kids,
    };
  }
  return { ...doc, nodes };
}

/** The artwork bounds (viewBox units) of the exportable layers, or null if empty. */
export function artworkBounds(doc: DocT, includeWorking = false): Box | null {
  return measureContent(docToSvg(includeWorking ? withFreehandSketches(doc) : doc, { includeWorking, background: null, textToPath }));
}

/** Build a production SVG: outlined text, optional monochrome, trim and background. Call prepareFonts first. */
export function buildSvg(doc: DocT, o: BuildSvgOptions = {}): string {
  const src = o.includeWorking ? withFreehandSketches(doc) : doc;
  let svg = docToSvg(src, {
    includeWorking: o.includeWorking,
    monochrome: o.monochrome,
    background: null,
    textToPath,
    resolveRef: (s) => o.refs?.get(s) ?? refUrl(s),
    pretty: o.pretty,
  });
  if (o.trim) {
    const b = measureContent(svg);
    if (b) svg = withViewBox(svg, tidyBox(padBox(b, o.trim.pad, o.trim.square)));
  }
  const bg = o.background !== undefined ? o.background : doc.artboard.background;
  return withBackground(svg, bg);
}

/** Add an XML prolog + generator comment for standalone .svg files. */
export function svgFile(svg: string, docName: string): string {
  const name = docName.replace(/--/g, "-").replace(/[<>]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${name} -->\n${svg}\n`;
}
