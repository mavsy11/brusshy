import { create } from "zustand";
import {
  releaseRepeatOps,
  repeatGroupOf,
  repeatOps,
  updateRepeatOps,
  type GroupNodeT,
  type RepeatOptions,
} from "@brusshy/core";
import { dispatch, select, toast, useStore } from "../lib/store";
import { topSelection } from "../lib/actions";
import { textToPath } from "../lib/fonts";

/** UI state of the Explorer and Reference board dialogs (kept out of the main store). */
interface ExploreUi {
  explorer: boolean;
  board: boolean;
}

export const useExploreUi = create<ExploreUi>(() => ({ explorer: false, board: false }));

export const openExplorer = () => useExploreUi.setState({ explorer: true, board: false });
export const closeExplorer = () => useExploreUi.setState({ explorer: false });
export const openBoard = () => useExploreUi.setState({ board: true, explorer: false });
export const closeBoard = () => useExploreUi.setState({ board: false });

// ---------------------------------------------------------------- repeat

const geom = { textToPath };

/** Layers the repeat tools act on (frames excluded). */
export function repeatTargets(): string[] {
  const { doc, selection } = useStore.getState();
  if (!doc) return [];
  return topSelection(doc, selection).filter((id) => doc.nodes[id]?.type !== "frame");
}

/** The repeat group the selection belongs to (the group, its source or one of its copies). */
export function selectedRepeatGroup(): GroupNodeT | null {
  const { doc } = useStore.getState();
  const ids = repeatTargets();
  if (!doc || ids.length !== 1) return null;
  return repeatGroupOf(doc, ids[0]);
}

/** Repeat the selection (or rebuild it, when it is a repeat group or its source). One undo step. */
export function repeatSelection(o: RepeatOptions): boolean {
  const { doc } = useStore.getState();
  if (!doc) return false;
  const ids = repeatTargets();
  if (!ids.length) {
    toast("Select a shape to repeat first");
    return false;
  }
  try {
    // A copy inside a repeat group means "this repeat": rebuild the group.
    const grp = ids.length === 1 ? repeatGroupOf(doc, ids[0]) : null;
    const r = grp ? updateRepeatOps(doc, grp.id, o, geom) : repeatOps(doc, ids, o, geom);
    if (!dispatch(r.ops, r.label)) return false;
    select([r.groupId]);
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

/** Rebuild a repeat group from its (edited) source, optionally with new settings. */
export function updateRepeat(groupId: string, patch: Partial<RepeatOptions> = {}, label?: string): boolean {
  const { doc } = useStore.getState();
  if (!doc) return false;
  try {
    const r = updateRepeatOps(doc, groupId, patch, geom);
    return !!dispatch(r.ops, label ?? r.label);
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

export function releaseRepeat(groupId: string) {
  const { doc } = useStore.getState();
  if (!doc) return;
  const ops = releaseRepeatOps(doc, groupId);
  if (ops.length && dispatch(ops, "Release repeat")) toast("Now a plain group — the copies are ordinary layers");
}
