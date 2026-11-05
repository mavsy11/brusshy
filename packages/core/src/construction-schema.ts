import { z } from "zod";

/**
 * Construction layer of a version (frame): guide circles, lines and polygons used to *find*
 * a mark's curves and proportions. It lives on the frame (`frame.construction`), not as nodes,
 * so it is never exported, extruded or measured — only drawn on the canvas (thin vermilion
 * lines, hideable) and on the construction sheet. Coordinates are frame (artboard) units.
 */

const GuideBase = z.object({
  id: z.string(),
  /** What the guide belongs to: grid lines are drawn lighter than key circles on the sheet. */
  role: z.enum(["key", "grid", "keyline", "radial", "derived"]).default("key"),
  /** Dimension label shown on the construction sheet (e.g. "r = 1.618"). */
  label: z.string().optional(),
});

export const GuideCircle = GuideBase.extend({
  kind: z.literal("circle"),
  cx: z.number(),
  cy: z.number(),
  r: z.number().positive(),
});

export const GuideLine = GuideBase.extend({
  kind: z.literal("line"),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
});

export const GuidePolygon = GuideBase.extend({
  kind: z.literal("polygon"),
  points: z.array(z.tuple([z.number(), z.number()])).min(3),
});

export const Guide = z.discriminatedUnion("kind", [GuideCircle, GuideLine, GuidePolygon]);

export const Construction = z.object({
  guides: z.array(Guide).default([]),
  /** Human description of the grid, e.g. "Circle grid · golden ratio 1 : 1.618". */
  title: z.string().optional(),
  /** Ratio the grid is built on (1.618, 2, 1.5…), for the sheet's labels. */
  ratio: z.number().positive().optional(),
  /** Grid unit in artboard units (square grids), for the sheet's labels. */
  unit: z.number().positive().optional(),
});

export type GuideT = z.infer<typeof Guide>;
export type GuideCircleT = z.infer<typeof GuideCircle>;
export type GuideLineT = z.infer<typeof GuideLine>;
export type GuidePolygonT = z.infer<typeof GuidePolygon>;
export type ConstructionT = z.infer<typeof Construction>;
