import { create } from "zustand";
import type { DocT } from "@brusshy/core";
import { buildSvg, prepareFonts } from "./svg";

/** The card shown after an export finishes (export/ExportSuccess.tsx). */
export interface ExportDone {
  id: number;
  /** data: URL of the exported version, or "" while it renders. */
  thumb: string;
  count: number;
  bytes: number;
  /** Shown to the user: path relative to the project, or the .zip name. */
  where: string;
  /** Absolute export folder (save mode) — used for Reveal / Copy path. */
  dir: string | null;
  mode: "save" | "zip";
  by: "you" | "ai";
  failed: number;
  name: string;
}

export const useExportDone = create<{ card: ExportDone | null }>(() => ({ card: null }));

let seq = 0;

export function showExportDone(doc: DocT, info: Omit<ExportDone, "id" | "thumb" | "name">) {
  const id = ++seq;
  useExportDone.setState({ card: { ...info, id, thumb: "", name: doc.name } });
  void prepareFonts(doc)
    .then(() => {
      const svg = buildSvg(doc, { trim: { pad: 0.08, square: true }, background: null });
      const thumb = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      const cur = useExportDone.getState().card;
      if (cur?.id === id) useExportDone.setState({ card: { ...cur, thumb } });
    })
    .catch(() => {
      /* the card works without a preview */
    });
}

export function dismissExportDone() {
  useExportDone.setState({ card: null });
}
