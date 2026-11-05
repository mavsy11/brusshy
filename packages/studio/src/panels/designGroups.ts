import { create } from "zustand";
import type { DocT } from "@brusshy/core";
import { useStore } from "../lib/store";
import { topSelection } from "../lib/actions";

/**
 * Design tab organisation: four groups behind a segmented control, collapsible sections with
 * remembered state, and the section → group map the command palette uses to reveal a section.
 */

export type DesignGroup = "design" | "brand" | "motion" | "review";
/** What the panel is describing: a whole version, one layer, or several layers. */
export type DesignContext = "version" | "node" | "multi";

export const DESIGN_GROUPS: { id: DesignGroup; label: string; hint: string }[] = [
  { id: "design", label: "Design", hint: "Shape, type, color, warp, effects, repeat, deform, 3D" },
  { id: "brand", label: "Brand", hint: "Lockup, palette, style series, mockups" },
  { id: "motion", label: "Motion", hint: "Entrance and loop animation" },
  { id: "review", label: "Review", hint: "Critique, compare, small sizes, AI lock" },
];

/** Section key from its title: "Lockup · Horizontal" → "lockup", "Letters · 5" → "letters". */
export function sectionKey(title: string): string {
  return title.split(" · ")[0]!.trim().toLowerCase();
}

/** Which group holds a section. Sections not listed are pinned above the groups. */
const SECTION_GROUP: Record<string, DesignGroup> = {
  // Design — the selected layer
  parts: "design",
  type: "design",
  "brand fonts": "design",
  "type controls": "design",
  "variable axes": "design",
  "weight & style": "design",
  opentype: "design",
  spacing: "design",
  letters: "design",
  lettering: "design",
  fill: "design",
  stroke: "design",
  opacity: "design",
  warp: "design",
  effects: "design",
  deform: "design",
  repeat: "design",
  "3d": "design",
  sketch: "design",
  "reference image": "design",
  // Brand — the version as a brand asset
  lockup: "brand",
  preview: "brand",
  palette: "brand",
  colorways: "brand",
  style: "brand",
  "style series": "brand",
  mockups: "brand",
  // Motion
  animation: "motion",
  // Review
  review: "review",
  critique: "review",
  compare: "review",
  "small sizes": "review",
  "your ai": "review",
  "lock for ai": "review",
};

export function groupOfSection(title: string): DesignGroup | null {
  const k = sectionKey(title);
  if (SECTION_GROUP[k]) return SECTION_GROUP[k]!;
  // Prefix match, so "Style" also finds "Style series" and the other way round.
  const hit = Object.keys(SECTION_GROUP).find((s) => s.startsWith(k) || k.startsWith(s));
  return hit ? SECTION_GROUP[hit]! : null;
}

/** Advanced sections start folded; the user's own choice wins once made. */
const DEFAULT_COLLAPSED = new Set(["3d", "deform", "opentype"]);

interface DesignUi {
  group: Record<DesignContext, DesignGroup>;
  collapsed: Record<string, boolean>;
}

const KEY = "brusshy:design-panel";
const DEFAULTS: DesignUi = { group: { version: "brand", node: "design", multi: "design" }, collapsed: {} };
const isGroup = (g: unknown): g is DesignGroup => g === "design" || g === "brand" || g === "motion" || g === "review";

function load(): DesignUi {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DesignUi> | null;
    if (v && typeof v === "object") {
      const g = (v.group ?? {}) as Partial<Record<DesignContext, unknown>>;
      const collapsed: Record<string, boolean> = {};
      for (const [k, b] of Object.entries(v.collapsed ?? {})) if (typeof b === "boolean") collapsed[k] = b;
      return {
        group: {
          version: isGroup(g.version) ? g.version : DEFAULTS.group.version,
          node: isGroup(g.node) ? g.node : DEFAULTS.group.node,
          multi: isGroup(g.multi) ? g.multi : DEFAULTS.group.multi,
        },
        collapsed,
      };
    }
  } catch {
    /* storage unavailable */
  }
  return { group: { ...DEFAULTS.group }, collapsed: {} };
}

export const useDesignUi = create<DesignUi>(() => load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(useDesignUi.getState()));
  } catch {
    /* storage unavailable */
  }
}

export function setDesignGroup(ctx: DesignContext, group: DesignGroup) {
  if (useDesignUi.getState().group[ctx] === group) return;
  useDesignUi.setState((s) => ({ group: { ...s.group, [ctx]: group } }));
  save();
}

export const isCollapsed = (s: DesignUi, key: string) => s.collapsed[key] ?? DEFAULT_COLLAPSED.has(key);

export function setSectionCollapsed(key: string, collapsed: boolean) {
  useDesignUi.setState((s) => ({ collapsed: { ...s.collapsed, [key]: collapsed } }));
  save();
}

export function designContext(doc: DocT, selection: string[]): DesignContext {
  const ids = topSelection(doc, selection);
  if (ids.length === 0) return "version";
  if (ids.length > 1) return "multi";
  return doc.nodes[ids[0]!]?.type === "frame" ? "version" : "node";
}

/**
 * Command palette: switch the Design tab to the group that holds `title` (for the current
 * selection) and unfold that section. Returns the section key.
 */
export function showDesignGroupForReveal(title: string): string {
  const key = sectionKey(title);
  const group = groupOfSection(title);
  const { doc, selection } = useStore.getState();
  if (group && doc) setDesignGroup(designContext(doc, selection), group);
  if (isCollapsed(useDesignUi.getState(), key)) setSectionCollapsed(key, false);
  return key;
}
