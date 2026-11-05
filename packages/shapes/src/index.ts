import svgpath from "svgpath";
import { BASIC } from "./shapes/basic";
import { STARS } from "./shapes/stars";
import { ORGANIC } from "./shapes/organic";
import { LINES } from "./shapes/lines";
import { ARROWS } from "./shapes/arrows";
import { BADGES } from "./shapes/badges";
import { FRAMES } from "./shapes/frames";
import { LETTERFORMS } from "./shapes/letterforms";
import { SYMBOLS } from "./shapes/symbols";
import { MARKS } from "./shapes/marks";
import { PATTERNS } from "./shapes/patterns";
import { renderDef } from "./render";
import { ICON_WEIGHTS, iconEntries, type IconSet } from "./icons";
import { search, type SearchHit } from "./search";
import { ICON_CATEGORIES, SHAPE_CATEGORIES, type ParamValues, type ShapeDef, type ShapeEntry, type ShapeGeometry } from "./types";

export * from "./types";
export { cleanParams, defaults, FIT } from "./render";
export { ICON_LICENSE, ICON_PARAMS, ICON_SOURCE, ICON_WEIGHTS, loadIcons, loadIconWeight, type IconSet, type IconWeight } from "./icons";
export { search, type SearchHit } from "./search";

/** Every generated shape, in catalog order. */
export const SHAPES: ShapeDef[] = [...BASIC, ...STARS, ...ORGANIC, ...LINES, ...ARROWS, ...BADGES, ...FRAMES, ...LETTERFORMS, ...SYMBOLS, ...MARKS, ...PATTERNS];
const BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export const getShape = (id: string): ShapeDef | undefined => BY_ID.get(id);

/** Catalog entries of the generated shapes (no icons). */
export const SHAPE_ENTRIES: ShapeEntry[] = SHAPES.map((s) => ({ id: s.id, name: s.name, kind: "shape", category: s.category, tags: s.tags, params: s.params }));

/** Full catalog: generated shapes, plus the icon set once loaded. */
export function catalog(icons?: IconSet | null): ShapeEntry[] {
  return icons ? [...SHAPE_ENTRIES, ...iconEntries(icons)] : SHAPE_ENTRIES;
}

export const isIconId = (id: string) => id.startsWith("icon:");

/**
 * Geometry for any catalog id in the 100 box. Generated shapes take their params;
 * icons take `weight` (0 = solid, 1 = line) and need the icon set loaded.
 */
export function renderShape(id: string, params?: ParamValues, icons?: IconSet | null): ShapeGeometry {
  if (isIconId(id)) {
    const name = id.slice(5);
    if (!icons) throw new Error("Icons are not loaded yet");
    const weight = ICON_WEIGHTS[Math.round(params?.weight ?? 0)] ?? "fill";
    const set = icons[weight];
    if (!set) throw new Error(`The ${weight} icon style is not loaded (loadIconWeight("${weight}"))`);
    const raw = set[name];
    if (!raw) throw new Error(`Unknown icon "${name}"`);
    const d = svgpath(raw).scale(100 / 256).round(2).toString();
    return { id, name: titleCase(name), paths: [{ d, fillRule: "nonzero" }], box: 100, bounds: { x: 0, y: 0, width: 100, height: 100 } };
  }
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown shape "${id}"`);
  return renderDef(def, params);
}

/** Paths of a geometry placed at (cx, cy) with its longest side = size (the box is scaled so the drawing fits). */
export function placeGeometry(g: ShapeGeometry, size: number, cx = 0, cy = 0): { d: string; fillRule: "nonzero" | "evenodd"; name?: string }[] {
  const k = size / Math.max(g.bounds.width, g.bounds.height, 1e-6);
  const ox = g.bounds.x + g.bounds.width / 2;
  const oy = g.bounds.y + g.bounds.height / 2;
  const dec = size >= 200 ? 2 : 3;
  return g.paths.map((p) => ({ ...p, d: svgpath(p.d).translate(-ox, -oy).scale(k).translate(cx, cy).round(dec).toString() }));
}

/** A tiny standalone SVG of a geometry (previews, contact sheets). */
export function geometrySvg(g: ShapeGeometry, opts: { size?: number; fill?: string; background?: string | null } = {}): string {
  const size = opts.size ?? 100;
  const bg = opts.background ? `<rect width="100" height="100" fill="${opts.background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.box} ${g.box}" width="${size}" height="${size}">${bg}${g.paths
    .map((p) => `<path d="${p.d}" fill="${opts.fill ?? "#0b0c0e"}"${p.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""}/>`)
    .join("")}</svg>`;
}

/** Search the catalog (generated shapes always; icons when loaded). */
export function searchShapes(query: string, opts: { category?: string; icons?: IconSet | null; limit?: number } = {}): SearchHit[] {
  return search(catalog(opts.icons), query, opts);
}

export const CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(SHAPE_CATEGORIES.map((c) => [c.id, c.label])),
  icons: "Icons",
};
export const ICON_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(ICON_CATEGORIES.map((c) => [c.id, c.label]));

export const titleCase = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

