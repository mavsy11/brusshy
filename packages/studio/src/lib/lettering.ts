import { applyOps, arrangeLetters, LAYOUT_RANGE, letteringOps, type GlyphsParams, type LetterLayout, type NodeT, type OpT } from "@brusshy/core";
import { dispatch, select, toast, useStore } from "./store";
import { ensureFont, textGlyphs } from "./fonts";
import { ensureTypeset } from "../typeset/engine";
import { registerRequest } from "./requests";

/** Custom lettering in the studio: per-letter paths and letter layouts (each one undo step). */

const get = () => useStore.getState();

/** Glyph outlines with the canvas's fonts (waits for the font to load). */
export async function loadGlyphs(p: GlyphsParams): Promise<{ text: string; d: string }[]> {
  const font = await ensureFont(p.fontFamily, p.fontWeight);
  // Type controls (axes, features, alternates): wait for the full font the type engine uses.
  await ensureTypeset(p);
  if (!font) throw new Error(`Font "${p.fontFamily}" could not be loaded`);
  const glyphs = textGlyphs(p);
  if (!glyphs) throw new Error(`Font "${p.fontFamily}" is not ready`);
  return glyphs;
}

// The agent's make_lettering / arrange_letters ask the studio for outlines.
registerRequest("glyphs", async (p) => ({ glyphs: await loadGlyphs(p) }));

/** Remembered layout per lettering group (this session), so the panel shows what was applied. */
export const layoutMemory = new Map<string, { layout: LetterLayout; amount: number }>();

const layoutLabel = (l: LetterLayout) => l[0]!.toUpperCase() + l.slice(1);

/**
 * Text → group of per-letter paths, optionally laid out right away — one undo step.
 * The group keeps the text's id, so the selection and any references stay valid.
 */
export async function makeLettering(id: string, layout?: LetterLayout, amount?: number): Promise<boolean> {
  const doc0 = get().doc;
  const n = doc0?.nodes[id];
  if (!n || n.type !== "text") return false;
  try {
    const glyphs = await loadGlyphs(n);
    const doc = get().doc;
    const cur = doc?.nodes[id];
    if (!doc || cur?.type !== "text") return false;
    const { ops } = letteringOps(doc, id, glyphs);
    const all: OpT[] = [...ops];
    if (layout && layout !== "straight") {
      const amt = amount ?? LAYOUT_RANGE[layout].default;
      const next = applyOps(doc, ops).doc;
      all.push(...arrangeLetters(next, id, layout, amt).map(({ id: lid, transform }) => ({ op: "update", id: lid, set: { transform } }) as OpT));
      layoutMemory.set(id, { layout, amount: amt });
    }
    if (!dispatch(all, layout && layout !== "straight" ? `Lettering: ${layoutLabel(layout)}` : "Make lettering")) return false;
    select([id]);
    toast(`“${cur.text.trim()}” is now ${ops.length - 2} editable letters — select one to reshape it`);
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

/** Live preview of a layout (no history) while a slider moves. */
export function previewArrange(groupId: string, layout: LetterLayout, amount: number) {
  const doc = get().doc;
  if (!doc) return;
  try {
    const placed = arrangeLetters(doc, groupId, layout, amount);
    useStore.setState((s) => {
      const live = { ...s.live };
      for (const p of placed) live[p.id] = { transform: p.transform } as Partial<NodeT>;
      return { live };
    });
  } catch {
    /* not a lettering group (any more) */
  }
}

function clearPreview(groupId: string) {
  const doc = get().doc;
  const g = doc?.nodes[groupId];
  if (g?.type !== "group") return;
  useStore.setState((s) => {
    const live = { ...s.live };
    for (const c of g.children) delete live[c];
    return { live };
  });
}

/** Apply a layout to a lettering group — one undo step. */
export function commitArrange(groupId: string, layout: LetterLayout, amount: number) {
  const doc = get().doc;
  if (!doc) return;
  try {
    const placed = arrangeLetters(doc, groupId, layout, amount);
    const changed = placed.filter((p) => JSON.stringify(doc.nodes[p.id]?.transform) !== JSON.stringify(p.transform));
    if (changed.length) dispatch(changed.map(({ id, transform }) => ({ op: "update", id, set: { transform } }) as OpT), layout === "straight" ? "Letters: straight" : `Letters: ${layoutLabel(layout)} ${Math.round(amount)}${LAYOUT_RANGE[layout].unit}`);
    layoutMemory.set(groupId, { layout, amount });
  } catch (e) {
    toast((e as Error).message, "error");
  } finally {
    clearPreview(groupId);
  }
}
