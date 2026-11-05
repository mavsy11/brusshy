import { apply, colorwayInks, contrastRatio, IDENTITY, multiply, normalizeColor, pathDataBounds, shapeToPath, transformMatrix, type DocT, type Mat, type NodeT, type PaintT } from "@brusshy/core";
import { textToPath } from "../lib/fonts";
import { buildSvg } from "./svg";

/**
 * The logo's color variants and their file names. Every name says the background the file
 * is meant for (`acme-color-on-light.svg`, `acme-symbol-white-on-dark.svg`), so a person or an
 * agent picks the right one without opening it.
 */

export type Ground = "light" | "dark";
export type Ink = "color" | "black" | "white";
export type Part = "logo" | "symbol";

/** The surfaces the variants are checked against (the brand kit's paper and ink). */
export const GROUNDS: Record<Ground, string> = { light: "#ffffff", dark: "#0b0c0e" };

export interface LogoVariant {
  part: Part;
  ink: Ink;
  ground: Ground;
  /** Transparent SVG of the variant. */
  svg: string;
}

/** `acme-color-on-light`, `acme-symbol-white-on-dark`… (no extension). */
export const variantName = (base: string, v: Pick<LogoVariant, "part" | "ink" | "ground">) =>
  `${base}${v.part === "symbol" ? "-symbol" : ""}-${v.ink}-on-${v.ground}`;

export const tone = (css: string): Ground => (contrastRatio(css, "#000000") >= contrastRatio(css, "#ffffff") ? "light" : "dark");

/**
 * The part of the logo that works as an icon: a layer named "icon"/"mark"/"symbol" if there is one,
 * otherwise everything except top-level wordmarks (text is unreadable at 16 px).
 */
export function iconMark(doc: DocT): DocT {
  const visible = doc.root.filter((id) => {
    const n = doc.nodes[id];
    return n && n.visible && n.type !== "sketch" && n.type !== "reference";
  });
  const named = visible.find((id) => /^(icon|mark|symbol|isotype|isotipo)$/i.test(doc.nodes[id]!.name.trim()));
  if (named) return { ...doc, root: [named] };
  const symbol = visible.filter((id) => doc.nodes[id]!.type !== "text");
  return symbol.length && symbol.length < visible.length ? { ...doc, root: symbol } : doc;
}

/** The symbol on its own, when the logo has one apart from its wordmark. */
export function symbolDoc(doc: DocT): DocT | null {
  const m = iconMark(doc);
  return m.root.length !== doc.root.length || m.root.some((id, i) => id !== doc.root[i]) ? m : null;
}

/**
 * The ground the logo's own colors are drawn for: its artboard's, else whichever its inks that
 * touch the ground contrast with more (a light mark on a dark badge is a badge for light grounds).
 */
export function designedFor(doc: DocT): Ground {
  if (doc.artboard.background) return tone(doc.artboard.background);
  const inks = colorwayInks(doc, "", { textToPath }).filter((k) => !k.onMark && !k.hole);
  if (!inks.length) return "light";
  const score = (bg: string) => inks.reduce((s, k) => s + Math.min(contrastRatio(k.hex, bg), 7) * k.share, 0);
  return score("#141518") > score("#f3f1ec") * 1.15 ? "dark" : "light";
}

/**
 * Full-color art for a surface: parts sitting on the surface that would vanish there (a dark
 * wordmark on a dark page) take the readable ink; everything else keeps its color. A plate
 * (the badge under a mark) keeps its color even when it melts into the surface: the mark on it
 * reads against the plate, and recoloring the plate alone would erase it.
 */
export function readableOn(doc: DocT): (svg: string, surface: string) => string {
  const inks = colorwayInks(doc, "", { textToPath }).filter((k) => !k.onMark && !k.hole);
  return (svg, surface) => {
    const fade = inks.filter((k) => !k.host && contrastRatio(k.hex, surface) < 1.8);
    if (!fade.length) return svg;
    const ink = contrastRatio(surface, "#ffffff") >= contrastRatio(surface, "#121315") ? "#ffffff" : "#121315";
    const swap = new Set(fade.flatMap((k) => k.members));
    return svg.replace(/\b(fill|stroke|stop-color)="([^"]+)"/g, (m, attr: string, v: string) => {
      if (v === "none" || v.startsWith("url(")) return m;
      const hex = normalizeColor(v);
      return hex && swap.has(hex) ? `${attr}="${ink}"` : m;
    });
  };
}

interface Leaf {
  id: string;
  box: [number, number, number, number];
  /** Has a fill (not a stroke-only outline or text): it can carry other parts. */
  solid: boolean;
}

/** Visible painted layers in paint order (bottom first), with their artboard bounds. */
function leaves(doc: DocT): Leaf[] {
  const out: Leaf[] = [];
  const walk = (id: string, m: Mat) => {
    const n = doc.nodes[id];
    if (!n || !n.visible || n.type === "sketch" || n.type === "reference") return;
    const mm = multiply(m, transformMatrix(n.transform));
    if (n.type === "group" || n.type === "frame") return n.children.forEach((c) => walk(c, mm));
    const d = n.type === "path" ? n.d : n.type === "shape" ? shapeToPath(n) : n.type === "text" ? textToPath(n) : null;
    let b = d ? pathDataBounds(d) : null;
    if (!b && n.type === "text") {
      // Font not loaded: estimate the line's box (as the colorway inks do).
      const w = Array.from(n.text).length * n.fontSize * 0.56;
      const x0 = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
      b = { x0, y0: -n.fontSize * 0.72, x1: x0 + w, y1: 0 };
    }
    if (!b) return;
    const pts = [apply(mm, b.x0, b.y0), apply(mm, b.x1, b.y0), apply(mm, b.x0, b.y1), apply(mm, b.x1, b.y1)];
    const box: Leaf["box"] = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
    out.push({ id, box, solid: n.type !== "text" && n.style.fill !== null });
  };
  doc.root.forEach((id) => walk(id, IDENTITY));
  return out;
}

const area = (b: Leaf["box"]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a: Leaf["box"], b: Leaf["box"]) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);

/**
 * The logo recolored for a surface, layer by layer (the exported on-dark / on-light files): a
 * layer that sits on the ground and would vanish there takes the readable ink. A layer drawn on
 * another filled part (details on the mark) keeps its color, and so does a plate: a filled part
 * with other parts drawn inside it (the badge under a mark), even when it melts into the surface.
 * Outlines and text never count as plates.
 */
export function colorOn(doc: DocT, surface: string): DocT {
  const ink = contrastRatio(surface, "#ffffff") >= contrastRatio(surface, "#121315") ? "#ffffff" : "#121315";
  const fades = (c: string) => contrastRatio(c, surface) < 1.8;
  const swap = (p: PaintT): PaintT => {
    if (p === null) return p;
    if (typeof p === "string") return fades(p) ? ink : p;
    return { ...p, stops: p.stops.map((st) => (fades(st.color) ? { ...st, color: ink } : st)) };
  };
  const list = leaves(doc);
  const nodes = { ...doc.nodes };
  list.forEach((leaf, i) => {
    // Drawn on a filled part below: a detail on the mark, not on the ground.
    if (list.slice(0, i).some((l) => l.solid && overlap(l.box, leaf.box) >= 0.9 * area(leaf.box))) return;
    // A plate: other parts are drawn inside it.
    if (leaf.solid && list.slice(i + 1).some((l) => overlap(l.box, leaf.box) >= 0.9 * area(l.box) && area(l.box) < area(leaf.box))) return;
    const n = doc.nodes[leaf.id]!;
    nodes[leaf.id] = { ...n, style: { ...n.style, fill: swap(n.style.fill), stroke: swap(n.style.stroke) } } as NodeT;
  });
  return { ...doc, nodes };
}

/**
 * Every variant of the logo (and of its symbol, when it has one): full color on the ground it
 * was drawn for and on the other one, black on light, white on dark.
 */
export function logoVariants(doc: DocT, o: { trim: false | { pad: number; square?: boolean }; pretty?: boolean }): LogoVariant[] {
  const home = designedFor(doc);
  const away: Ground = home === "light" ? "dark" : "light";
    const out: LogoVariant[] = [];
  const parts: [Part, DocT][] = [["logo", doc]];
  const sym = symbolDoc(doc);
  if (sym) parts.push(["symbol", sym]);
  for (const [part, d] of parts) {
    out.push({ part, ink: "color", ground: home, svg: buildSvg(d, { trim: o.trim, background: null, pretty: o.pretty }) });
    out.push({ part, ink: "color", ground: away, svg: buildSvg(colorOn(d, GROUNDS[away]), { trim: o.trim, background: null, pretty: o.pretty }) });
    // One color maps light paints to knockouts: start from the version drawn for light grounds.
    const lightDoc = home === "light" ? d : colorOn(d, GROUNDS.light);
    out.push({ part, ink: "black", ground: "light", svg: buildSvg(lightDoc, { trim: o.trim, background: null, monochrome: "#000000", pretty: o.pretty }) });
    out.push({ part, ink: "white", ground: "dark", svg: buildSvg(lightDoc, { trim: o.trim, background: null, monochrome: "#ffffff", pretty: o.pretty }) });
  }
  return out;
}

export const INK_LABEL: Record<Ink, string> = { color: "Full color", black: "Black", white: "White" };
export const GROUND_LABEL: Record<Ground, string> = { light: "Light backgrounds", dark: "Dark backgrounds" };
