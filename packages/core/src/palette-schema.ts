import { z } from "zod";

/**
 * The brand palette as data (doc.palette): a short ordered list of colors with
 * a role each. Kept in its own module (zod only) so schema.ts can import it
 * without pulling in the generator.
 */

export const PALETTE_ROLES = ["primary", "secondary", "accent", "neutral", "background"] as const;
export const PaletteRole = z.enum(PALETTE_ROLES);
export type PaletteRoleT = z.infer<typeof PaletteRole>;

export const PaletteEntry = z.object({
  /** #rrggbb (lowercase). */
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "hex must be #rrggbb")
    .transform((s) => s.toLowerCase()),
  name: z.string().max(60).default(""),
  role: PaletteRole.default("accent"),
  /** Locked colors survive "regenerate". */
  locked: z.boolean().default(false),
});
export type PaletteEntryT = z.infer<typeof PaletteEntry>;

export const PALETTE_HARMONIES = ["analogous", "complementary", "split", "triadic", "monochrome", "logo", "image"] as const;
export const Harmony = z.enum(PALETTE_HARMONIES);
export type HarmonyT = z.infer<typeof Harmony>;

export const BrandPalette = z.object({
  colors: z.array(PaletteEntry).max(12).default([]),
  /** How it was generated last (the panel reopens on it). */
  harmony: Harmony.optional(),
  seed: z.number().int().optional(),
});
export type BrandPaletteT = z.infer<typeof BrandPalette>;
