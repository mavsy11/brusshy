import { findFrame, type FrameNodeT } from "@brusshy/core";
import { activeFrameId, setActiveFrame, useStore } from "../lib/store";
import { sendChatRequest } from "../lib/chatBridge";

/**
 * One-click variant actions on a version: "More like this" (4 new variants in the same style)
 * and "Vary this" (one copy with a subtle change). Brusshy has no AI of its own — both send a
 * precise request to the user's AI through the canvas chat.
 */

export const MORE_COUNT = 4;

/** Request text for "More like this" on a version. */
export function moreLikeThisText(f: Pick<FrameNodeT, "id" | "name">): string {
  const n = f.name || "this version";
  return [
    `More like this: make ${MORE_COUNT} new variants in the same style as ${n}.`,
    `Call make_variants with count ${MORE_COUNT} and from_frame "${f.id}" so each variant starts as a copy of ${n}, side by side.`,
    `Keep what defines ${n}: its drawing style (stroke weight, corners, line or fill, level of detail), its palette (the same colors in the same roles) and its construction (geometry, grid, proportions, type treatment).`,
    `Vary only the composition or the idea: give each variant a different arrangement, symbol or concept, clearly distinct from the others and from ${n}.`,
    `Edit each copy with frame=<its id> and never change ${n} itself. render_preview every variant, then end with one short line per variant.`,
  ].join(" ");
}

/** Request text for "Vary this" on a version. */
export function varyThisText(f: Pick<FrameNodeT, "id" | "name">): string {
  const n = f.name || "this version";
  return [
    `Vary this: make one variant of ${n} with a single subtle change.`,
    `Call duplicate_frame with frame "${f.id}" and edit only the copy.`,
    `Keep the concept, composition, palette and type as they are; change one thing a designer would try next — a proportion, a weight, a corner, the spacing or one detail — so it still reads as the same logo, refined differently.`,
    `Never change ${n} itself. render_preview the copy and tell me in one line what you changed.`,
  ].join(" ");
}

export type VariantAction = "more" | "vary";

const frameOrActive = (id?: string | null) => {
  const doc = useStore.getState().doc;
  if (!doc) return null;
  return findFrame(doc, id ?? activeFrameId(doc));
};

/** The version has something to vary (an empty artboard has no style to keep). */
export function canVary(id?: string | null): boolean {
  const f = frameOrActive(id);
  return !!f && f.children.length > 0;
}

/** Make the version active and send the request for it to the canvas chat. */
export function askVariant(action: VariantAction, id?: string | null) {
  const f = frameOrActive(id);
  if (!f || !f.children.length) return;
  setActiveFrame(f.id);
  return sendChatRequest(action === "more" ? moreLikeThisText(f) : varyThisText(f), { frame: f.id });
}
