import { create } from "zustand";

/** Shape builder tool sub-modes: fill regions, draw guide circles, draw guide lines. */
export type BuilderMode = "fill" | "circle" | "line";

interface ConstructState {
  /** Construction layer shown on the canvas (always shown while the shape builder is active). */
  visible: boolean;
  mode: BuilderMode;
  /** Selected guide (frame id + guide id). */
  guide: { frame: string; id: string } | null;
  /** Region fill color; null = brand primary. */
  fill: string | null;
  /** Templates menu open. */
  menu: boolean;
  ratio: number;
  sectors: number;
  divisions: number;
}

const readVisible = () => {
  try {
    return localStorage.getItem("brusshy:construction") !== "0";
  } catch {
    return true;
  }
};

export const useConstruct = create<ConstructState>(() => ({
  visible: readVisible(),
  mode: "fill",
  guide: null,
  fill: null,
  menu: false,
  ratio: (1 + Math.sqrt(5)) / 2,
  sectors: 8,
  divisions: 8,
}));

export function setConstructionVisible(on: boolean) {
  useConstruct.setState({ visible: on });
  try {
    localStorage.setItem("brusshy:construction", on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

export const toggleConstruction = () => setConstructionVisible(!useConstruct.getState().visible);
