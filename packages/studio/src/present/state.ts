import { create } from "zustand";

/** Open/close state of the presentation (kept out of the shared app store). */
export const usePresentUI = create<{ open: boolean }>(() => ({ open: false }));

export const openPresentation = () => usePresentUI.setState({ open: true });
export const closePresentation = () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  usePresentUI.setState({ open: false });
};

export type PresentTheme = "light" | "dark";
const THEME_KEY = "brusshy:present:theme";

export function initialTheme(): PresentTheme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* blocked storage */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveTheme(t: PresentTheme) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
}
