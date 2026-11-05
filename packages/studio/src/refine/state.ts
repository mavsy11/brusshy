import { create } from "zustand";
import {
  REFINE_LABELS,
  refineAmountSpec,
  refineOps,
  subtreeIds,
  type DocT,
  type NodeT,
  type RefineAction,
  type RefineAmountSpec,
  type RefineOptions,
} from "@brusshy/core";
import { activeFrameId, dispatch, setTool, toast, useStore } from "../lib/store";
import { topSelection } from "../lib/actions";
import { textToPath } from "../lib/fonts";
import { socket } from "../lib/socket";

/**
 * Quick refinements on the selection (no AI tokens) + "Make it more…" requests to the canvas AI.
 * Slider actions preview live (store `live` patches) and commit as one undo step.
 */

/** One click, no preview. */
export const INSTANT: RefineAction[] = ["optical-center"];

interface RefineUi {
  /** Refine panel open under the quick bar. */
  open: boolean;
  /** Action being previewed. */
  action: RefineAction | null;
  amount: number | null;
  spec: RefineAmountSpec | null;
  side: "left" | "right";
  /** Layers being refined (fixed when the preview starts). */
  ids: string[];
  /** Ids holding preview patches in the store's `live`. */
  previewIds: string[];
  summary: string;
  notes: string[];
}

export const useRefine = create<RefineUi>(() => ({ open: false, action: null, amount: null, spec: null, side: "left", ids: [], previewIds: [], summary: "", notes: [] }));

const get = () => useRefine.getState();

/** Layers the refinements act on: the selection (a selected version means its content). */
export function refineTargets(doc: DocT, selection = useStore.getState().selection): string[] {
  return topSelection(doc, selection).filter((id) => doc.nodes[id]?.type !== "frame");
}

const GEOM = new Set<NodeT["type"]>(["path", "shape", "text"]);
/** The selection holds something refinable. */
export function canRefine(doc: DocT | null = useStore.getState().doc, selection = useStore.getState().selection): boolean {
  if (!doc) return false;
  return refineTargets(doc, selection).some((id) => subtreeIds(doc, id).some((s) => GEOM.has(doc.nodes[s]!.type)));
}

/** Text layers → their outlines from the studio's fonts (so text can be refined like any path). */
function studioOptions(doc: DocT, ids: string[]): RefineOptions {
  const textOutlines: Record<string, string> = {};
  for (const id of ids)
    for (const sid of subtreeIds(doc, id)) {
      const n = doc.nodes[sid];
      if (n?.type === "text") {
        const d = textToPath(n);
        if (d) textOutlines[sid] = d;
      }
    }
  return { textOutlines };
}

function clearPreview() {
  const ids = get().previewIds;
  if (!ids.length) return;
  useStore.setState((s) => {
    const live = { ...s.live };
    for (const id of ids) delete live[id];
    return { live };
  });
  useRefine.setState({ previewIds: [] });
}

export const isRefinePreviewing = () => get().action !== null;

let raf = 0;
/** Recompute the preview for the current action/amount (throttled to one per frame). */
export function schedulePreview() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const { action, amount, ids, side } = get();
    const doc = useStore.getState().doc;
    if (!action || !doc) return;
    try {
      const r = refineOps(doc, ids, action, { ...studioOptions(doc, ids), amount: amount ?? undefined, side });
      const prev = get().previewIds;
      useStore.setState((s) => {
        const live = { ...s.live };
        for (const id of prev) delete live[id];
        Object.assign(live, r.patches);
        return { live };
      });
      useRefine.setState({ previewIds: Object.keys(r.patches), summary: r.summary, notes: r.notes });
    } catch (e) {
      useRefine.setState({ summary: "", notes: [(e as Error).message] });
    }
  });
}

export function setRefineOpen(open: boolean) {
  if (!open) cancelRefine();
  useRefine.setState({ open });
}

/** Start an action on the current selection: instant ones apply now, the rest preview with their default amount. */
export function startRefine(action: RefineAction) {
  const { doc } = useStore.getState();
  if (!doc) return;
  if (!canRefine(doc)) return toast("Select a path, shape, text or group to refine");
  const ids = refineTargets(doc);
  if (get().action) clearPreview();
  if (INSTANT.includes(action)) {
    useRefine.setState({ action: null, spec: null, amount: null });
    return applyRefine(action, ids);
  }
  const spec = refineAmountSpec(doc, ids, action, studioOptions(doc, ids));
  useRefine.setState({ open: true, action, ids, spec, amount: spec?.value ?? null, summary: "", notes: [] });
  schedulePreview();
}

export function setRefineAmount(amount: number) {
  useRefine.setState({ amount });
  schedulePreview();
}

export function setRefineSide(side: "left" | "right") {
  useRefine.setState({ side });
  schedulePreview();
}

function report(summary: string, notes: string[], changed: boolean) {
  const note = notes.find((n) => /left alone|skipped|vanish|can't|counterpart/.test(n));
  if (changed) toast(note ? `${summary} — ${note}` : summary);
  else toast(notes[0] ?? summary);
}

/** Apply an action once (one undo step). */
export function applyRefine(action: RefineAction, ids?: string[], amount?: number, side?: "left" | "right") {
  const { doc } = useStore.getState();
  if (!doc) return;
  const targets = ids ?? refineTargets(doc);
  const r = refineOps(doc, targets, action, { ...studioOptions(doc, targets), amount, side: side ?? get().side });
  if (r.ops.length) dispatch(r.ops, r.label);
  report(r.summary, r.notes, r.ops.length > 0);
}

/** Commit the previewed action. */
export function commitRefine() {
  const { action, amount, ids, side } = get();
  if (!action) return;
  cancelAnimationFrame(raf);
  clearPreview();
  useRefine.setState({ action: null, spec: null, summary: "", notes: [] });
  applyRefine(action, ids, amount ?? undefined, side);
}

export function cancelRefine() {
  cancelAnimationFrame(raf);
  clearPreview();
  useRefine.setState({ action: null, spec: null, summary: "", notes: [] });
}

/** From the command palette: make sure the quick bar is up, then start the action. */
export function refineFromPalette(action: RefineAction) {
  if (useStore.getState().tool !== "select") setTool("select");
  useRefine.setState({ open: true });
  startRefine(action);
}

export const refineLabel = (a: RefineAction) => REFINE_LABELS[a].label;

// ---------------------------------------------------------------- creative: ask the AI

export const MAKE_IT_MORE = ["modern", "playful", "premium", "minimal"] as const;
export type MoreStyle = (typeof MAKE_IT_MORE)[number];

const DIRECTION: Record<MoreStyle, string> = {
  modern: "more modern: cleaner geometry, consistent stroke weights, fewer details, confident negative space and contemporary proportions",
  playful: "more playful: friendlier rounded forms, a little bounce and personality in the curves, lively but still balanced",
  premium: "more premium: refined proportions, precise optical balance, restrained detail and elegant contrast — it should feel expensive",
  minimal: "more minimal: remove everything that isn't essential and reduce it to the fewest shapes and nodes that still read, recognizable at 16 px",
};

/** The precise request sent to the canvas chat for the selected layers. */
export function moreStylePrompt(doc: DocT, ids: string[], style: MoreStyle): string {
  const name = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return id;
    const label = n.name || (n.type === "text" ? n.text : n.type === "shape" ? n.shape : n.type);
    return `“${label}” (${id})`;
  };
  const what = ids.length === 1 ? `the selected layer ${name(ids[0]!)}` : `the ${ids.length} selected layers ${ids.slice(0, 8).map(name).join(", ")}${ids.length > 8 ? "…" : ""}`;
  return `Make ${what} ${DIRECTION[style]}. Keep the concept, silhouette and colors recognizable and change only the selected layers. One coherent pass, then check it with render_preview.`;
}

/** Send "Make it more <style>" to the canvas chat. */
export function askMoreStyle(style: MoreStyle) {
  const { doc, chat, selection } = useStore.getState();
  if (!doc) return;
  if (chat?.busy) return toast("Your AI is still working — try again when it's done");
  const ids = refineTargets(doc, selection);
  if (!ids.length) return toast("Select the layers you want your AI to rework");
  socket.send({ t: "chat", text: moreStylePrompt(doc, ids, style), frame: activeFrameId(doc), selection: ids });
  toast(`Asked your AI: make it more ${style}`, "agent");
}

// Deselecting (or leaving the select tool) closes the panel and drops any preview.
useStore.subscribe((s, prev) => {
  if (!get().open) return;
  if ((s.selection !== prev.selection && !s.selection.length) || (s.tool !== prev.tool && s.tool !== "select")) setRefineOpen(false);
});
