import { EXTRA_FONTS, FONT_TRAITS } from "@brusshy/core";
import { FONT_FAMILIES } from "../lib/fonts";
import { extraMeta, type FamilyMeta } from "./sources";

/** The Fontsource catalog (≈2 000 families) plus EXTRA_FONTS, for search, cached for the session. */

export type Category = "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
export const CATEGORIES: { id: Category | "all" | "curated"; label: string }[] = [
  { id: "curated", label: "Curated" },
  { id: "all", label: "All" },
  { id: "sans-serif", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "display", label: "Display" },
  { id: "handwriting", label: "Handwriting" },
  { id: "monospace", label: "Mono" },
];

let list: Promise<FamilyMeta[]> | null = null;

export function catalog(): Promise<FamilyMeta[]> {
  list ??= fetch("https://api.fontsource.org/v1/fonts")
    .then((r) => (r.ok ? (r.json() as Promise<FamilyMeta[] & { subsets?: string[] }[]>) : []))
    .then((all) =>
      (all as (FamilyMeta & { subsets: string[] })[]).filter((f) => f.subsets?.includes("latin") && ["sans-serif", "serif", "display", "handwriting", "monospace"].includes(f.category)),
    )
    .then((fs) => [...fs, ...EXTRA_FONTS.map(extraMeta)])
    .catch(() => {
      list = null;
      return [];
    });
  return list;
}

const curated = new Set([...FONT_FAMILIES, ...FONT_TRAITS.map((t) => t.family)].map((f) => f.toLowerCase()));
export const isCurated = (family: string) => curated.has(family.toLowerCase());

/** Search by name (all words must match), filter by category; curated families first, then A→Z. */
export function search(all: FamilyMeta[], query: string, cat: Category | "all" | "curated"): FamilyMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .filter((f) => (cat === "curated" ? isCurated(f.family) : cat === "all" || f.category === cat))
    .filter((f) => words.every((w) => f.family.toLowerCase().includes(w)))
    .sort((a, b) => {
      const qa = words.length && a.family.toLowerCase().startsWith(words[0]!) ? 0 : 1;
      const qb = words.length && b.family.toLowerCase().startsWith(words[0]!) ? 0 : 1;
      if (qa !== qb) return qa - qb;
      const ca = isCurated(a.family) ? 0 : 1, cb = isCurated(b.family) ? 0 : 1;
      return ca - cb || a.family.localeCompare(b.family);
    });
}

export const CATEGORY_LABEL: Record<string, string> = {
  "sans-serif": "Sans",
  serif: "Serif",
  display: "Display",
  handwriting: "Handwriting",
  monospace: "Mono",
};
