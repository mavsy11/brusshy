import type { DocT, PaintT } from "@brusshy/core";

/** File-name slug of the document name ("Acme Logo" → "acme-logo"). */
export function slug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "logo";
}

/** The daemon only accepts basenames, so folder paths inside the export are flattened. */
export const flatName = (name: string) => name.split("/").pop() || name;

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const textBlob = (s: string, type = "text/plain") => new Blob([s], { type: `${type};charset=utf-8` });

let colorCtx: CanvasRenderingContext2D | null = null;

/** Normalize any CSS color to { hex, r, g, b, a }. Returns null for unparseable input. */
export function parseColor(css: string): { hex: string; r: number; g: number; b: number; a: number } | null {
  if (!css || css === "none" || css === "transparent") return null;
  colorCtx ??= document.createElement("canvas").getContext("2d");
  if (!colorCtx) return null;
  colorCtx.fillStyle = "#010203";
  colorCtx.fillStyle = css;
  const v = String(colorCtx.fillStyle);
  if (v === "#010203" && css.trim().toLowerCase() !== "#010203") return null;
  if (v.startsWith("#")) {
    const r = parseInt(v.slice(1, 3), 16);
    const g = parseInt(v.slice(3, 5), 16);
    const b = parseInt(v.slice(5, 7), 16);
    return { hex: v.toUpperCase(), r, g, b, a: 1 };
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1]!.split(",").map((x) => parseFloat(x));
  const hex = "#" + [r, g, b].map((c) => Math.round(c!).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { hex, r: r!, g: g!, b: b!, a: a! };
}

/** Relative luminance (sRGB) for picking legible text over a swatch. */
export function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Naive CMYK (no ICC profile): good enough as a starting point for print. */
export function toCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  return [c, m, y, k].map((v) => Math.round(v * 100)) as [number, number, number, number];
}

/** Ids of the nodes that end up in exports (visible, non-working), in paint order. */
export function exportableIds(doc: DocT): string[] {
  const out: string[] = [];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n || !n.visible || n.type === "sketch" || n.type === "reference") continue;
      out.push(id);
      if (n.type === "group") walk(n.children);
    }
  };
  walk(doc.root);
  return out;
}

export interface PaletteColor {
  hex: string;
  r: number;
  g: number;
  b: number;
  /** How many paints reference it (used to order the palette). */
  uses: number;
}

export interface PaletteGradient {
  type: "linear" | "radial";
  angle: number;
  stops: { offset: number; hex: string }[];
}

/** Distinct solid colors and gradients used by the exported artwork. */
export function extractPalette(doc: DocT): { colors: PaletteColor[]; gradients: PaletteGradient[] } {
  const colors = new Map<string, PaletteColor>();
  const gradients: PaletteGradient[] = [];
  const seenGradients = new Set<string>();
  const add = (css: string, weight = 1) => {
    const c = parseColor(css);
    if (!c || c.a === 0) return;
    const cur = colors.get(c.hex);
    if (cur) cur.uses += weight;
    else colors.set(c.hex, { hex: c.hex, r: c.r, g: c.g, b: c.b, uses: weight });
  };
  const paint = (p: PaintT, weight: number) => {
    if (p === null) return;
    if (typeof p === "string") return add(p, weight);
    const stops = p.stops
      .map((s) => ({ offset: s.offset, hex: parseColor(s.color)?.hex ?? "" }))
      .filter((s) => s.hex);
    for (const s of stops) add(s.hex, weight * 0.5);
    const key = `${p.type}|${p.angle}|${stops.map((s) => s.offset + s.hex).join()}`;
    if (stops.length >= 2 && !seenGradients.has(key)) {
      seenGradients.add(key);
      gradients.push({ type: p.type, angle: p.angle, stops });
    }
  };
  for (const id of exportableIds(doc)) {
    const n = doc.nodes[id]!;
    if (n.type === "group") continue;
    paint(n.style.fill, 2);
    if (n.style.strokeWidth > 0) paint(n.style.stroke, 1);
  }
  return { colors: [...colors.values()].sort((a, b) => b.uses - a.uses), gradients };
}

export const sleepFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
