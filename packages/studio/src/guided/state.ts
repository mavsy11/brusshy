import { create } from "zustand";
import type { GuidedAnswers } from "./request";

/** Guided start UI state (outside the Welcome component so a zoom that remounts it keeps the answers). */
interface GuidedUi extends GuidedAnswers {
  open: boolean;
  step: 0 | 1 | 2;
  /** Direction of the last step change, for the slide. */
  dir: 1 | -1;
  uploading: number;
}

const blank = (): Omit<GuidedUi, "open"> => ({ step: 0, dir: 1, name: "", what: "", feel: [], mark: null, refs: [], uploading: 0 });

export const useGuided = create<GuidedUi>(() => ({ open: false, ...blank() }));

export function openGuided(seed: Partial<GuidedAnswers> = {}) {
  const cur = useGuided.getState();
  // Re-opening keeps what was typed; a fresh start takes the seed (e.g. the document's name).
  if (cur.name || cur.what || cur.feel.length || cur.refs.length) useGuided.setState({ open: true });
  else useGuided.setState({ ...blank(), ...seed, open: true });
}
export const closeGuided = () => useGuided.setState({ open: false });
export const resetGuided = () => useGuided.setState({ open: false, ...blank() });
