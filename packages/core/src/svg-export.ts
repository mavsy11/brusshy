import { fmt, shapeToPath, transformAttr } from "./geometry";
import type { DocT, GradientT, NodeT, PaintT, StyleT, TextNodeT } from "./schema";

export interface SvgExportOptions {
  /** Include sketch and reference layers (working layers). Default false. */
  includeWorking?: boolean;
  /** Paint everything with this color (monochrome variants). Light paints become a knockout in the contrasting color. */
  monochrome?: string;
  /** Override the artboard background (null = transparent). */
  background?: string | null;
  /** Resolve a reference node src to an href (e.g. data URL or served URL). */
  resolveRef?: (src: string) => string;
  /** Return outlined path data for a text node, or null to keep <text>. */
  textToPath?: (node: TextNodeT) => string | null;
  /** Add data-id attributes so tools can map elements back to nodes. */
  dataIds?: boolean;
  /** Pretty-print with indentation. */
  pretty?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function attrs(a: Record<string, string | number | undefined | null>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? fmt(v) : esc(String(v))}"`)
    .join("");
}

function gradientDef(id: string, g: GradientT): string {
  const stops = g.stops
    .map((s) => `<stop${attrs({ offset: s.offset, "stop-color": s.color })}/>`)
    .join("");
  if (g.type === "radial") return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`;
  const a = (g.angle * Math.PI) / 180;
  const x = Math.cos(a) / 2;
  const y = Math.sin(a) / 2;
  return `<linearGradient${attrs({ id, x1: 0.5 - x, y1: 0.5 - y, x2: 0.5 + x, y2: 0.5 + y })}>${stops}</linearGradient>`;
}

class Defs {
  private items: string[] = [];
  private n = 0;
  paint(p: PaintT): string {
    if (p === null) return "none";
    if (typeof p === "string") return p;
    const id = `g${++this.n}`;
    this.items.push(gradientDef(id, p));
    return `url(#${id})`;
  }
  toString() {
    return this.items.length ? `<defs>${this.items.join("")}</defs>` : "";
  }
}

/** Relative luminance (0–1) of a CSS color; unknown formats count as dark. */
export function luminance(c: string): number {
  const named: Record<string, string> = { white: "#ffffff", black: "#000000" };
  let h = (named[c.trim().toLowerCase()] ?? c).trim();
  let rgb: number[] | null = null;
  const m = /^rgba?\(([^)]+)\)/i.exec(h);
  if (m) rgb = m[1]!.split(/[\s,/]+/).slice(0, 3).map(Number);
  else if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h.slice(1).split("").map((x) => x + x).join("");
  if (!rgb && /^#[0-9a-f]{6}/i.test(h)) rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const paintLuminance = (p: PaintT): number =>
  p === null ? 0 : typeof p === "string" ? luminance(p) : p.stops.reduce((a, s) => a + luminance(s.color), 0) / p.stops.length;

/** Monochrome mapping: dark/mid paints take the mono color, very light ones become a knockout. */
function monoPaint(p: PaintT, mono: string): string {
  if (p === null) return "none";
  const knockout = luminance(mono) < 0.5 ? "#ffffff" : "#0b0c0e";
  return paintLuminance(p) > 0.7 ? knockout : mono;
}

function styleAttrs(s: StyleT, defs: Defs, mono?: string) {
  const fill = mono ? monoPaint(s.fill, mono) : defs.paint(s.fill);
  const stroke = mono ? monoPaint(s.stroke, mono) : defs.paint(s.stroke);
  const hasStroke = stroke !== "none" && s.strokeWidth > 0;
  return {
    fill,
    "fill-rule": s.fillRule !== "nonzero" ? s.fillRule : undefined,
    stroke: hasStroke ? stroke : undefined,
    "stroke-width": hasStroke ? s.strokeWidth : undefined,
    "stroke-linecap": hasStroke ? s.strokeLinecap : undefined,
    "stroke-linejoin": hasStroke ? s.strokeLinejoin : undefined,
    opacity: s.opacity !== 1 ? s.opacity : undefined,
  };
}

/** Simple centerline rendering of sketch strokes (the studio renders them with variable width). */
export function sketchStrokePath(points: [number, number, number][]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  if (rest.length === 0) return `M${fmt(first![0])} ${fmt(first![1])}h0.01`;
  return `M${fmt(first![0])} ${fmt(first![1])}` + rest.map((p) => `L${fmt(p[0])} ${fmt(p[1])}`).join("");
}

function renderNode(doc: DocT, n: NodeT, defs: Defs, o: SvgExportOptions): string {
  if (!n.visible) return "";
  if (!o.includeWorking && (n.type === "sketch" || n.type === "reference")) return "";
  const common = { "data-id": o.dataIds ? n.id : undefined, transform: transformAttr(n.transform) };
  switch (n.type) {
    case "frame": {
      const kids = n.children.map((c) => doc.nodes[c]).filter(Boolean) as NodeT[];
      const bg = n.background ? `<rect width="${fmt(n.width)}" height="${fmt(n.height)}" fill="${esc(n.background)}"/>` : "";
      return `<g${attrs(common)}>${bg}${kids.map((k) => renderNode(doc, k, defs, o)).join("")}</g>`;
    }
    case "group": {
      const kids = n.children.map((c) => doc.nodes[c]).filter(Boolean) as NodeT[];
      const inner = kids.map((k) => renderNode(doc, k, defs, o)).join("");
      return `<g${attrs({ ...common, opacity: n.style.opacity !== 1 ? n.style.opacity : undefined })}>${inner}</g>`;
    }
    case "path":
      return `<path${attrs({ ...common, d: n.d, ...styleAttrs(n.style, defs, o.monochrome) })}/>`;
    case "shape":
      return `<path${attrs({ ...common, d: shapeToPath(n), ...styleAttrs(n.style, defs, o.monochrome) })}/>`;
    case "text": {
      const outlined = o.textToPath?.(n);
      if (outlined) return `<path${attrs({ ...common, d: outlined, ...styleAttrs(n.style, defs, o.monochrome) })}/>`;
      return `<text${attrs({
        ...common,
        "font-family": n.fontFamily,
        "font-size": n.fontSize,
        "font-weight": n.fontWeight,
        "letter-spacing": n.letterSpacing || undefined,
        "text-anchor": n.anchor !== "start" ? n.anchor : undefined,
        "dominant-baseline": "alphabetic",
        ...styleAttrs(n.style, defs, o.monochrome),
      })}>${esc(n.text)}</text>`;
    }
    case "sketch":
      return `<g${attrs({ ...common, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: n.style.opacity })}>${n.strokes
        .map((s) => `<path${attrs({ d: sketchStrokePath(s.points), stroke: s.color, "stroke-width": s.size })}/>`)
        .join("")}</g>`;
    case "reference":
      return `<image${attrs({
        ...common,
        href: o.resolveRef ? o.resolveRef(n.src) : n.src,
        width: n.width,
        height: n.height,
        opacity: n.style.opacity,
        preserveAspectRatio: "none",
      })}/>`;
  }
}

/** Serialize a document (or the whole artboard) to a standalone SVG string. */
export function docToSvg(doc: DocT, o: SvgExportOptions = {}): string {
  const defs = new Defs();
  const { width, height } = doc.artboard;
  const bg = o.background !== undefined ? o.background : doc.artboard.background;
  const body = doc.root
    .map((id) => doc.nodes[id])
    .filter(Boolean)
    .map((n) => renderNode(doc, n as NodeT, defs, o))
    .join(o.pretty ? "\n  " : "");
  const bgRect = bg ? `<rect width="${fmt(width)}" height="${fmt(height)}" fill="${esc(bg)}"/>` : "";
  const nl = o.pretty ? "\n  " : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}">` +
    nl + defs.toString() + (defs.toString() ? nl : "") + bgRect + (bgRect ? nl : "") + body +
    (o.pretty ? "\n" : "") + `</svg>`
  );
}
