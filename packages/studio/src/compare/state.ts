import { create } from "zustand";
import { findFrame, listFrames } from "@brusshy/core";
import { activeFrameId, toast, useStore } from "../lib/store";

export type CompareMode = "split" | "side" | "onion";

interface CompareUi {
  open: boolean;
  /** Before / after versions (frame ids). */
  a: string | null;
  b: string | null;
  mode: CompareMode;
  /** Highlight the pixels that changed. */
  diff: boolean;
  /** Split position 0–1 (before on the left of it). */
  split: number;
  /** Onion skin: opacity of the after version over the before one. */
  opacity: number;
}

function readMode(): CompareMode {
  try {
    const m = localStorage.getItem("brusshy:compare:mode");
    return m === "side" || m === "onion" ? m : "split";
  } catch {
    return "split";
  }
}

export const useCompare = create<CompareUi>(() => ({ open: false, a: null, b: null, mode: readMode(), diff: false, split: 0.5, opacity: 0.5 }));

useCompare.subscribe((s, prev) => {
  if (s.mode === prev.mode) return;
  try {
    localStorage.setItem("brusshy:compare:mode", s.mode);
  } catch {
    /* storage unavailable */
  }
});

/** Open the compare view: after = the given (or active) version, before = the previous one. */
export function openCompare(after?: string | null, before?: string | null) {
  const doc = useStore.getState().doc;
  if (!doc) return;
  const frames = listFrames(doc);
  if (frames.length < 2) return toast("Compare needs two versions — duplicate this one (⌘D) to make a variant");
  let b = (after ? findFrame(doc, after)?.id : null) ?? activeFrameId(doc) ?? frames[frames.length - 1]!.id;
  const i = frames.findIndex((f) => f.id === b);
  let a = before ? findFrame(doc, before)?.id ?? null : null;
  if (!a) {
    // The first version has nothing before it: it becomes "before" and the next one "after".
    if (i > 0) a = frames[i - 1]!.id;
    else {
      a = b;
      b = frames[1]!.id;
    }
  }
  useCompare.setState({ open: true, a, b, split: 0.5 });
}

export function closeCompare() {
  useCompare.setState({ open: false });
}

export function toggleCompare() {
  if (useCompare.getState().open) closeCompare();
  else openCompare();
}
