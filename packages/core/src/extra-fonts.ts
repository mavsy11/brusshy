/**
 * Open-licence families that aren't on Fontsource / Google Fonts yet. They are served from their
 * npm package on jsDelivr (already allowed by the daemon's CSP), pinned to a version so a release
 * can't change a logo's outlines under it. One full variable file per family: every feature and axis.
 */

export interface ExtraFontAxis {
  min: number;
  max: number;
  default: number;
  step: number;
}

export interface ExtraFont {
  /** Same shape as a Fontsource family id. */
  id: string;
  family: string;
  category: "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
  license: string;
  weights: number[];
  styles: string[];
  variable: boolean;
  axes: Record<string, ExtraFontAxis>;
  /** The full font (WOFF2). */
  url: string;
  /** What the agent should know before using it (shown by list_fonts / font_info). */
  note: string;
}

const GEIST = "https://cdn.jsdelivr.net/npm/geist@1.9.0/dist/fonts";

export const EXTRA_FONTS: ExtraFont[] = [
  {
    id: "geist-serif",
    family: "Geist Serif",
    category: "serif",
    license: "OFL-1.1",
    weights: [400],
    styles: ["normal"],
    variable: true,
    axes: { ELSH: { min: 0, max: 100, default: 0, step: 1 } },
    url: `${GEIST}/geist-serif/GeistSerifVF.woff2`,
    note:
      "High-contrast display serif from the Geist family (Vercel): one weight, Latin only, for headlines and wordmarks, not running text. Same cap height and x-height as Geist, so the two mix on one line. Dot shapes for i, j and punctuation: features ss02 square, ss03 triangle, ss04 heart (use these; its ELSH axis does the same only in browsers, the outlines here ignore it).",
  },
];

const byFamily = new Map(EXTRA_FONTS.map((f) => [f.family.toLowerCase(), f]));

export const extraFont = (family: string): ExtraFont | undefined => byFamily.get(family.trim().toLowerCase());

