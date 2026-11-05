import { create } from "zustand";

/** Stage view: only the active version, centred on a calm background (for screen recording). */
export type StageBg = "paper" | "ink" | "version";
export const STAGE_BGS: StageBg[] = ["paper", "ink", "version"];
export const STAGE_BG_LABEL: Record<StageBg, string> = { paper: "Paper", ink: "Ink", version: "Version background" };

const KEY = "brusshy:stage:bg";

function savedBg(): StageBg | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "paper" || v === "ink" || v === "version" ? v : null;
  } catch {
    return null;
  }
}

export const useStage = create<{ open: boolean; bg: StageBg | null }>(() => ({ open: false, bg: savedBg() }));

export const openStage = () => useStage.setState({ open: true });
/** Asks the open stage to play its exit; it closes itself when the camera lands. */
export const requestStageExit = () => window.dispatchEvent(new Event("brusshy:stage-exit"));
export const toggleStage = () => (useStage.getState().open ? requestStageExit() : openStage());
export const closeStage = () => useStage.setState({ open: false });

export function setStageBg(bg: StageBg) {
  useStage.setState({ bg });
  try {
    localStorage.setItem(KEY, bg);
  } catch {
    /* storage unavailable */
  }
}
