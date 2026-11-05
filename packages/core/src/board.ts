import { z } from "zod";
import type { DocT } from "./schema";

/**
 * Reference board: 3–12 inspiration images stored on the document (not on the canvas), each
 * with a role that says what the AI should take from it, and an optional note. Images live in
 * the project's brusshy/refs/ folder (uploaded through /api/refs like reference layers).
 * Edited with the `doc` op ({op:"doc", set:{board:{items:[…]}}}), so it has undo like the rest.
 */

export const BOARD_ROLES = ["reference", "palette", "silhouette", "style"] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];
export const BOARD_MAX = 12;
export const BOARD_SUGGESTED_MIN = 3;

export const BoardItem = z.object({
  id: z.string(),
  /** Path relative to the project's brusshy/ folder, e.g. refs/poster.jpg. */
  src: z.string().min(1),
  role: z.enum(BOARD_ROLES).default("reference"),
  note: z.string().max(400).default(""),
  /** Original file name, for the user. */
  name: z.string().max(200).default(""),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
export type BoardItemT = z.infer<typeof BoardItem>;

export const RefBoard = z.object({
  items: z.array(BoardItem).max(BOARD_MAX).default([]),
});
export type RefBoardT = z.infer<typeof RefBoard>;

/** What the AI takes from an image, by its role (same meaning as reference layers' roles). */
export const BOARD_ROLE_HINT: Record<BoardRole, string> = {
  reference: "general inspiration: take the idea, structure or technique — never copy the mark",
  palette: "take only its colors (pick 1–3 dominant ones); ignore its shapes",
  silhouette: "match its outer shape / proportions; ignore its colors and inner details",
  style: "match its rendering style (stroke weight, corners, texture, era); not its subject or layout",
};

export const BOARD_ROLE_LABEL: Record<BoardRole, string> = {
  reference: "Reference",
  palette: "Palette",
  silhouette: "Silhouette",
  style: "Style",
};

/** Lines for get_document's summary (empty when there is no board). */
export function boardLines(doc: DocT): string[] {
  const items = doc.board?.items ?? [];
  if (!items.length) return [];
  const counts = BOARD_ROLES.map((r) => [r, items.filter((i) => i.role === r).length] as const).filter(([, n]) => n > 0);
  return [
    `Reference board: ${items.length} image${items.length === 1 ? "" : "s"} (${counts.map(([r, n]) => `${n} ${r}`).join(", ")}) — call get_board to see them with their roles and notes. Take the technique and feel, never copy a mark.`,
  ];
}

/** Ops-ready board value with one item changed (null = remove it). */
export function boardWith(doc: DocT, id: string, patch: Partial<BoardItemT> | null): RefBoardT {
  const items = doc.board?.items ?? [];
  return { items: patch === null ? items.filter((i) => i.id !== id) : items.map((i) => (i.id === id ? { ...i, ...patch, id } : i)) };
}
