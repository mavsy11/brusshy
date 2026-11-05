import { z } from "zod";

/**
 * Records that Type Lab (warp + effects) keeps on nodes so the user can re-open and adjust.
 * Kept in their own module (zod only) so schema.ts can use them without import cycles.
 */

const Pt = z.tuple([z.number(), z.number()]);

/** One mesh node of a free envelope: position and its handles toward the left/right/up/down neighbours. */
export const EnvelopeNode = z.object({ p: Pt, l: Pt, r: Pt, u: Pt, d: Pt });

/**
 * A free envelope: a (rows+1)×(cols+1) mesh of Coons patches. Coordinates are normalised to the
 * warped content's bounds (0..1), so the envelope follows the content when it moves.
 */
export const Envelope = z.object({
  rows: z.number().int().min(1).max(4),
  cols: z.number().int().min(1).max(4),
  nodes: z.array(EnvelopeNode),
});

/**
 * The last warp applied to a set of layers (stored on each member). `base` holds the original
 * path data of every warped leaf (local coordinates) and `out` a fingerprint of the result, so
 * "Edit warp" re-applies from the original geometry — unless the user reshaped a leaf since.
 */
export const WarpRecord = z.object({
  id: z.string(),
  members: z.array(z.string()).default([]),
  preset: z.string(),
  amount: z.number().default(0),
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  envelope: Envelope.nullable().optional(),
  base: z.record(z.string(), z.string()).default({}),
  out: z.record(z.string(), z.string()).default({}),
});

/** A generated effect layer (outline, inline, shadow, double): its kind, resolved params and the source fingerprint. */
export const EffectRecord = z.object({
  kind: z.enum(["outline", "inline", "shadow", "double"]),
  params: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  /** Fingerprint of the source geometry it was generated from (detects stale effects). */
  sig: z.string().default(""),
});

export type EnvelopeNodeT = z.infer<typeof EnvelopeNode>;
export type EnvelopeT = z.infer<typeof Envelope>;
export type WarpRecordT = z.infer<typeof WarpRecord>;
export type EffectRecordT = z.infer<typeof EffectRecord>;
