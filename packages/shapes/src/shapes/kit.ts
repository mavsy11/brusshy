import type { Pt } from "../geom";
import type { ParamValues, ShapeCategory, ShapeDef, ShapeParam } from "../types";
import type { Draw } from "../types";

/** Authoring helpers shared by the shape modules. */

export const range = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ShapeParam => ({ key, label, type: "range", min, max, step, default: def });
export const int = (key: string, label: string, min: number, max: number, def: number): ShapeParam => ({ key, label, type: "int", min, max, default: def });
export const choice = (key: string, label: string, options: string[], def = 0): ShapeParam => ({ key, label, type: "choice", options, default: def });
export const seed = (def = 7): ShapeParam => ({ key: "seed", label: "Seed", type: "seed", default: def });
export const round = (def = 0.2, label = "Roundness") => range("round", label, 0, 1, def);
export const thick = (def = 0.2, min = 0.03, max = 0.6, label = "Thickness") => range("thick", label, min, max, def);

/** `const S = maker("basic")` then `S(id, name, tags, draw, params?)`. */
export const maker =
  (category: ShapeCategory) =>
  (id: string, name: string, tags: string, draw: (p: ParamValues, d: Draw) => void, params?: ShapeParam[]): ShapeDef =>
    shape(category, id, name, tags, draw, params);

export function shape(
  category: ShapeCategory,
  id: string,
  name: string,
  tags: string,
  draw: (p: ParamValues, d: Draw) => void,
  params?: ShapeParam[],
): ShapeDef {
  return { id, name, category, tags: tags.split(/\s+/).filter(Boolean), params, draw };
}

/** Axis-aligned rectangle corners (clockwise from top-left). */
export const rectPts = (w: number, h: number, cx = 50, cy = 50): Pt[] => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];

export const mirrorPts = (pts: Pt[], cx = 50): Pt[] => pts.map(([x, y]) => [2 * cx - x, y] as Pt).reverse();
