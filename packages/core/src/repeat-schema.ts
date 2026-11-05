import { z } from "zod";

/**
 * The recipe a repeat group keeps (GroupNode.repeat), so "Update repeat" can rebuild the
 * copies after the source changes. Coordinates are in the group's own space.
 */
export const REPEAT_MODES = ["radial", "mirror", "grid"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];
export const MIRROR_AXES = ["vertical", "horizontal", "both"] as const;
export type MirrorAxis = (typeof MIRROR_AXES)[number];
export const PIVOT_MODES = ["selection", "artboard", "point"] as const;
export type PivotMode = (typeof PIVOT_MODES)[number];

export const RepeatRecipe = z.object({
  mode: z.enum(REPEAT_MODES),
  /** The unit that is repeated (a child of the group); every other child is a generated copy. */
  source: z.string(),
  /** Radial: number of instances (source included). Grid: columns. */
  count: z.number().int().min(1).max(72).default(8),
  /** Grid: rows. */
  rows: z.number().int().min(1).max(72).default(1),
  /** Radial: sweep in degrees (360 = full turn; less = a fan with both ends included). */
  angle: z.number().min(-360).max(360).default(360),
  /** Radial / mirror centre, in the group's space (resolved when the repeat was made). */
  pivot: z.tuple([z.number(), z.number()]).default([0, 0]),
  /** How the pivot was chosen (shown in the UI; the point above is what counts). */
  pivotMode: z.enum(PIVOT_MODES).default("artboard"),
  /** Mirror: vertical = left↔right across a vertical line; horizontal = top↔bottom; both = 4-way. */
  axis: z.enum(MIRROR_AXES).default("vertical"),
  /** Grid: gaps between copies' bounds (artboard units). */
  gapX: z.number().default(0),
  gapY: z.number().default(0),
  /** Radial: every other copy scaled by this (toward its side facing the centre). */
  altScale: z.number().min(0.05).max(4).default(1),
  /** Radial: every other copy mirrored across its own radius (pinwheels → symmetric rosettes). */
  altMirror: z.boolean().default(false),
  /** Radial: copies turn with the circle (true) or stay upright (false). */
  orient: z.boolean().default(true),
  /** Mirror: the copies were merged with the source into one shape. */
  merged: z.boolean().default(false),
});
export type RepeatRecipeT = z.infer<typeof RepeatRecipe>;
