import { create } from "zustand";

/** Open/close state of the timelapse player (kept out of the shared app store). */
export const useTimelapseUI = create<{ open: boolean; frame: string | null }>(() => ({ open: false, frame: null }));

/** Open the design timelapse of a version (default: the active one). */
export const openTimelapse = (frame: string | null = null) => useTimelapseUI.setState({ open: true, frame });
export const closeTimelapse = () => useTimelapseUI.setState({ open: false });
