import { create } from "zustand";
import type { IconSet, ParamValues } from "@brusshy/shapes";

/** Shapes panel state (kept outside the main store: this feature owns it). */
interface ShapesState {
  open: boolean;
  query: string;
  /** "all", a shape category id, or "icons". */
  category: string;
  /** Icon subcategory when category = "icons" ("" = all icons). */
  sub: string;
  /** 0 = solid, 1 = line. */
  iconWeight: number;
  /** Shape picked in the panel (its parameters show at the bottom). */
  picked: string | null;
  /** Parameters per shape id (remembered while the studio is open). */
  params: Record<string, ParamValues>;
  /** The node the panel inserted last, so parameter changes can re-shape it. */
  linked: { nodeId: string; shapeId: string; size: number; d: string[] } | null;
  icons: IconSet | null;
  iconsLoading: boolean;
  iconsError: string | null;
  /** Bumped when an icon weight finishes loading (previews refresh). */
  iconsV: number;
}

export const useShapes = create<ShapesState>(() => ({
  open: false,
  query: "",
  category: "all",
  sub: "",
  iconWeight: 0,
  picked: null,
  params: {},
  linked: null,
  icons: null,
  iconsLoading: false,
  iconsError: null,
  iconsV: 0,
}));

export function ensureIcons(weight = 0) {
  // Loads are cached promises, so calling again (e.g. for the line style) is cheap.
  if (!useShapes.getState().icons) useShapes.setState({ iconsLoading: true, iconsError: null });
  // The library and its symbol data are separate chunks, fetched the first time the panel opens.
  void import("@brusshy/shapes")
    .then((m) => (weight ? m.loadIconWeight("bold") : m.loadIcons()))
    .then((icons) => useShapes.setState((st) => ({ icons, iconsLoading: false, iconsV: st.iconsV + 1 })))
    .catch((e: Error) => useShapes.setState({ iconsLoading: false, iconsError: e.message }));
}

export function openShapes(query?: string) {
  useShapes.setState({ open: true, ...(query !== undefined ? { query } : {}) });
  ensureIcons(useShapes.getState().iconWeight);
}
export const closeShapes = () => useShapes.setState({ open: false });
export const toggleShapes = () => (useShapes.getState().open ? closeShapes() : openShapes());
