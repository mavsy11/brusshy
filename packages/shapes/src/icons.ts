import type { IconCategory, ShapeEntry, ShapeParam } from "./types";

/**
 * The symbol set: Phosphor Icons (MIT, © Phosphor Icons — see icons/LICENSE-phosphor.txt),
 * converted by scripts/build-icons.mjs. Every icon is already a filled outline (no strokes),
 * so it behaves like any other logo shape. Two weights ship: "fill" (solid) and "bold" (line
 * look, still a filled outline). The data is loaded lazily, so it never sits in a main bundle.
 */

export const ICON_SOURCE = { name: "Phosphor Icons", url: "https://phosphoricons.com", license: "MIT" } as const;
export const ICON_LICENSE = `Phosphor Icons — MIT License — Copyright (c) 2023 Phosphor Icons`;
export const ICON_WEIGHTS = ["fill", "bold"] as const;
export type IconWeight = (typeof ICON_WEIGHTS)[number];

export const ICON_PARAMS: ShapeParam[] = [{ key: "weight", label: "Style", type: "choice", options: ["Solid", "Line"], default: 0 }];

export interface IconSet {
  /** [name, category, comma-separated tags] */
  catalog: [string, IconCategory, string][];
  fill: Record<string, string>;
  /** Loaded on demand (loadIconWeight). */
  bold?: Record<string, string>;
}

let base: Promise<IconSet> | null = null;
let boldP: Promise<IconSet> | null = null;

/** Load the icon catalog and the solid weight (cached). */
export function loadIcons(): Promise<IconSet> {
  base ??= Promise.all([import("./icons/catalog.json"), import("./icons/fill.json")]).then(([c, f]) => ({
    catalog: (c.default ?? c) as unknown as IconSet["catalog"],
    fill: (f.default ?? f) as unknown as Record<string, string>,
  }));
  return base;
}

/** Make sure a weight is loaded (the line weight is a separate chunk). */
export function loadIconWeight(weight: IconWeight): Promise<IconSet> {
  if (weight === "fill") return loadIcons();
  boldP ??= Promise.all([loadIcons(), import("./icons/bold.json")]).then(([set, b]) => {
    set.bold = (b.default ?? b) as unknown as Record<string, string>;
    return set;
  });
  return boldP;
}

let entries: { set: IconSet; list: ShapeEntry[] } | null = null;
export function iconEntries(set: IconSet): ShapeEntry[] {
  if (entries?.set === set) return entries.list;
  const list: ShapeEntry[] = set.catalog.map(([name, sub, tags]) => ({
    id: `icon:${name}`,
    name: name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
    kind: "icon",
    category: "icons",
    sub,
    tags: tags ? tags.split(",") : [],
    params: ICON_PARAMS,
  }));
  entries = { set, list };
  return list;
}
