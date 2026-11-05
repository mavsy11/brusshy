import type { Contour } from "./geom";

/** A numeric control on a parametric shape. Values are always numbers (choices are indices). */
export type ShapeParam =
  | { key: string; label: string; type: "range"; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: "int"; min: number; max: number; default: number }
  | { key: string; label: string; type: "choice"; options: string[]; default: number }
  | { key: string; label: string; type: "seed"; default: number };

export type ParamValues = Record<string, number>;

/** One output path (box coordinates). */
export interface ShapePath {
  d: string;
  fillRule: "nonzero" | "evenodd";
  /** Part name for multi-part shapes (e.g. a cube's faces). */
  name?: string;
}

/** Normalised geometry in a 100×100 box, centred on (50, 50). */
export interface ShapeGeometry {
  id: string;
  name: string;
  paths: ShapePath[];
  /** The box the paths are drawn in (always 100 for generated shapes and icons). */
  box: number;
  /** Bounds of the drawing inside the box. */
  bounds: { x: number; y: number; width: number; height: number };
}

export const SHAPE_CATEGORIES = [
  { id: "basic", label: "Basic" },
  { id: "stars", label: "Stars & bursts" },
  { id: "organic", label: "Organic" },
  { id: "lines", label: "Lines & waves" },
  { id: "arrows", label: "Arrows" },
  { id: "badges", label: "Badges & banners" },
  { id: "frames", label: "Frames & rings" },
  { id: "letterforms", label: "Letterforms" },
  { id: "symbols", label: "Symbols" },
  { id: "marks", label: "Abstract marks" },
  { id: "patterns", label: "Patterns" },
] as const;
export type ShapeCategory = (typeof SHAPE_CATEGORIES)[number]["id"];

/** Subcategories of the icon set. */
export const ICON_CATEGORIES = [
  { id: "arrows", label: "Arrows" },
  { id: "commerce", label: "Commerce" },
  { id: "communication", label: "Communication" },
  { id: "design", label: "Design" },
  { id: "devices", label: "Devices" },
  { id: "education", label: "Education" },
  { id: "finance", label: "Math & finance" },
  { id: "games", label: "Games" },
  { id: "health", label: "Health" },
  { id: "media", label: "Media" },
  { id: "nature", label: "Weather & nature" },
  { id: "office", label: "Office" },
  { id: "people", label: "People" },
  { id: "security", label: "Security" },
  { id: "tech", label: "Technology" },
  { id: "time", label: "Time" },
  { id: "travel", label: "Maps & travel" },
] as const;
export type IconCategory = (typeof ICON_CATEGORIES)[number]["id"];

export interface DrawPart {
  name?: string;
  solids: Contour[];
  holes: Contour[];
  /** Bands (outer + inner): rings whose inside can hold other solids. */
  bands: [Contour, Contour][];
  clip: Contour[];
  evenodd: boolean;
  /** Merge everything into clean outlines (boolean union, then fitted curves). */
  merge: boolean;
}

/** A drawing in progress: parts of solid contours and holes. */
export class Draw {
  parts: DrawPart[] = [Draw.blank()];
  private static blank(name?: string): DrawPart {
    return { name, solids: [], holes: [], bands: [], clip: [], evenodd: false, merge: false };
  }
  private get cur() {
    return this.parts[this.parts.length - 1]!;
  }
  /** Add filled contours (they union with each other). */
  add(...cs: (Contour | Contour[])[]) {
    for (const c of cs.flat()) this.cur.solids.push(c);
    return this;
  }
  /** Cut contours out of everything in this part. */
  hole(...cs: (Contour | Contour[])[]) {
    for (const c of cs.flat()) this.cur.holes.push(c);
    return this;
  }
  /** A band between two nested contours; other solids may sit inside it (a globe's meridians). */
  ring(outer: Contour, inner: Contour) {
    this.cur.bands.push([outer, inner]);
    return this;
  }
  /** Keep only what lies inside these contours (merged parts only). */
  clipTo(...cs: Contour[]) {
    this.cur.clip.push(...cs);
    this.cur.merge = true;
    return this;
  }
  /** Use the even-odd rule for this part (alternating fills, no orientation fix-up). */
  evenodd() {
    this.cur.evenodd = true;
    return this;
  }
  /** Boolean-merge this part into clean outlines (overlaps unioned, holes cut through everything). */
  union() {
    this.cur.merge = true;
    return this;
  }
  /** Start a new, separately named path. */
  part(name: string) {
    const c = this.cur;
    if (c.solids.length || c.holes.length || c.bands.length) this.parts.push(Draw.blank(name));
    else c.name = name;
    return this;
  }
}

/** A parametric shape generated in code. */
export interface ShapeDef {
  id: string;
  name: string;
  category: ShapeCategory;
  tags: string[];
  params?: ShapeParam[];
  draw: (p: ParamValues, d: Draw) => void;
}

/** Catalog entry for search and the grid (generated shapes and icons alike). */
export interface ShapeEntry {
  id: string;
  name: string;
  kind: "shape" | "icon";
  /** Shape category id, or "icons". */
  category: ShapeCategory | "icons";
  /** Icon subcategory. */
  sub?: IconCategory;
  tags: string[];
  params?: ShapeParam[];
}
