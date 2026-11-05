import { useEffect, useState } from "react";
import { create } from "zustand";
import type { FontInfo } from "@brusshy/core";
import { fontInfo } from "./info";
import { familyAxes, familyMeta, type FamilyMeta } from "./sources";

/** UI state for type controls: the letter picked in a word strip, and the Fonts dialog. */
export const useTypeUI = create<{
  /** Node (text or lettering group) + letter index picked in its strip. */
  letter: { id: string; index: number } | null;
  fontsOpen: boolean;
  /** What picking a font does: fill a type-system role, or set the selected text's font. */
  fontsTarget: "heading" | "body" | "selection";
}>(() => ({ letter: null, fontsOpen: false, fontsTarget: "heading" }));

export const openFonts = (target: "heading" | "body" | "selection" = "heading") => useTypeUI.setState({ fontsOpen: true, fontsTarget: target });

const infos = new Map<string, Promise<FontInfo>>();
export function fontInfoCached(family: string, italic = false): Promise<FontInfo> {
  const k = `${family.toLowerCase()}|${italic}`;
  let p = infos.get(k);
  if (!p) {
    p = fontInfo(family, { italic });
    p.catch(() => infos.delete(k));
    infos.set(k, p);
  }
  return p;
}

/** Font facts for the controls (null while loading; error text when it can't load). */
export function useFontInfo(family: string, italic = false): { info: FontInfo | null; error: string | null } {
  const [s, set] = useState<{ k: string; info: FontInfo | null; error: string | null }>({ k: "", info: null, error: null });
  const k = `${family}|${italic}`;
  useEffect(() => {
    let alive = true;
    fontInfoCached(family, italic).then(
      (info) => alive && set({ k, info, error: null }),
      (e: Error) => alive && set({ k, info: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [k, family, italic]);
  return s.k === k ? s : { info: null, error: null };
}

/** Fontsource metadata (weights, styles, variable) for a family. */
export function useFamilyMeta(family: string): FamilyMeta | null {
  const [m, set] = useState<{ f: string; meta: FamilyMeta | null }>({ f: "", meta: null });
  useEffect(() => {
    let alive = true;
    void familyMeta(family).then((meta) => alive && set({ f: family, meta }));
    void familyAxes(family);
    return () => {
      alive = false;
    };
  }, [family]);
  return m.f === family ? m.meta : null;
}
