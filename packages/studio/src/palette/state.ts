import { create } from "zustand";
import {
  applyPaletteOps,
  generatePalette,
  imageColors,
  logoColors,
  nameColor,
  normalizeColor,
  paletteBriefText,
  type HarmonyT,
  type PaletteEntryT,
} from "@brusshy/core";
import { activeFrameId, dispatch, toast, useStore } from "../lib/store";
import { textToPath } from "../lib/fonts";

/** UI state of the palette dialog (kept out of the main store). */
interface PaletteUi {
  open: boolean;
  tab: "palette" | "colorways";
  /** Selected swatch index. */
  selected: number;
  harmony: HarmonyT;
  count: number;
  /** Live preview while a slider is dragged (index → hex); committed on release. */
  draft: Record<number, string>;
  /** The image used by the "image" harmony: a preview URL and a label. */
  image: { url: string; label: string } | null;
}

export const usePaletteUi = create<PaletteUi>(() => ({
  open: false,
  tab: "palette",
  selected: 0,
  harmony: "analogous",
  count: 5,
  draft: {},
  image: null,
}));

export function openPalette(tab: PaletteUi["tab"] = "palette") {
  const doc = useStore.getState().doc;
  const p = doc?.palette;
  usePaletteUi.setState({
    open: true,
    tab,
    harmony: p?.harmony ?? usePaletteUi.getState().harmony,
    count: p?.colors.length ? Math.max(3, Math.min(6, p.colors.length)) : usePaletteUi.getState().count,
  });
}
export const closePalette = () => usePaletteUi.setState({ open: false, draft: {} });

/** The document's palette entries (with any live slider preview applied). */
export function currentColors(): PaletteEntryT[] {
  return useStore.getState().doc?.palette?.colors ?? [];
}

export function savePalette(colors: PaletteEntryT[], label: string, extra: { harmony?: HarmonyT; seed?: number } = {}) {
  return dispatch([{ op: "doc", set: { palette: { colors, ...extra } } }], label);
}

/** Pixels of the reference image (kept outside React state: they can be large). */
let imagePixels: Uint8ClampedArray | null = null;
export function setImagePixels(px: Uint8ClampedArray | null, meta: PaletteUi["image"]) {
  imagePixels = px;
  usePaletteUi.setState({ image: meta });
}

const randomSeed = () => 1 + Math.floor(Math.random() * 2 ** 30);

/** Regenerate the unlocked colors (Space). */
export function regenerate(seed = randomSeed()) {
  const doc = useStore.getState().doc;
  if (!doc) return;
  const { harmony, count } = usePaletteUi.getState();
  const fid = activeFrameId(doc);
  let logo: { hex: string; weight: number }[] | undefined;
  let image: { hex: string; weight: number }[] | undefined;
  if (harmony === "logo") {
    logo = fid ? logoColors(doc, fid, { textToPath }) : [];
    if (!logo.length) toast("This version has no colors yet — the rest of the palette is generated", "info");
  }
  if (harmony === "image") {
    if (!imagePixels) {
      toast("Pick or drop an image first", "info");
      return;
    }
    image = imageColors(imagePixels, { seed });
  }
  const colors = generatePalette({ harmony, count, seed, current: doc.palette?.colors, logo, image });
  usePaletteUi.setState({ draft: {}, selected: Math.min(usePaletteUi.getState().selected, colors.length - 1) });
  savePalette(colors, doc.palette ? "Regenerate palette" : "Create palette", { harmony, seed });
}

/** Rename automatically when the name was the automatic one. */
function autoName(e: PaletteEntryT, hex: string): string {
  const auto = nameColor(e.hex);
  const was = e.name.replace(/^(Light|Deep) /, "").replace(/ \d+$/, "");
  return !e.name || was === auto ? nameColor(hex) : e.name;
}

export function updateColor(i: number, patch: Partial<PaletteEntryT>, label: string) {
  const colors = currentColors().map((c) => ({ ...c }));
  const e = colors[i];
  if (!e) return;
  if (patch.hex) {
    const hex = normalizeColor(patch.hex);
    if (!hex) return toast(`Not a color: ${patch.hex}`, "error");
    patch = { ...patch, hex, name: patch.name ?? autoName(e, hex) };
  }
  colors[i] = { ...e, ...patch };
  savePalette(colors, label);
}

export function moveColor(from: number, to: number) {
  const colors = [...currentColors()];
  if (from === to || !colors[from] || to < 0 || to >= colors.length) return;
  const [c] = colors.splice(from, 1);
  colors.splice(to, 0, c!);
  usePaletteUi.setState({ selected: to });
  savePalette(colors, "Reorder palette");
}

export function removeColor(i: number) {
  const colors = currentColors().filter((_, k) => k !== i);
  usePaletteUi.setState({ selected: Math.max(0, Math.min(i, colors.length - 1)) });
  if (!colors.length) dispatch([{ op: "doc", set: { palette: null } }], "Clear palette");
  else savePalette(colors, "Remove color");
}

export function addColor() {
  const colors = currentColors();
  if (colors.length >= 8) return toast("Eight colors is plenty for a brand palette", "info");
  const { harmony } = usePaletteUi.getState();
  // A fresh accent that fits: generate one more slot with everything else locked.
  const locked = colors.map((c) => ({ ...c, locked: true }));
  const next = generatePalette({ harmony: harmony === "image" || harmony === "logo" ? "analogous" : harmony, count: Math.min(6, colors.length + 1), seed: randomSeed(), current: locked });
  const fresh = next.find((c) => !c.locked) ?? { hex: "#888888", name: "Gray", role: "accent" as const, locked: false };
  usePaletteUi.setState({ selected: colors.length });
  savePalette([...colors, { ...fresh, role: fresh.role === "background" || fresh.role === "neutral" ? "accent" : fresh.role }], "Add color");
}

export function applyToVersion() {
  const doc = useStore.getState().doc;
  const fid = doc && activeFrameId(doc);
  const colors = currentColors();
  if (!doc || !fid || !colors.length) return;
  const f = doc.nodes[fid]!;
  const r = applyPaletteOps(doc, fid, colors, { textToPath });
  if (!r.ops.length) return toast(`${f.name} already uses these colors`);
  if (dispatch(r.ops, `Apply palette to ${f.name}`)) {
    const n = r.mapping.filter((m) => m.from !== m.to).length;
    toast(`${f.name} recolored — ${n} color${n === 1 ? "" : "s"} mapped${r.background ? ", background set" : ""}`);
  }
}

export function useAsBrief() {
  const colors = currentColors();
  if (!colors.length) return;
  dispatch([{ op: "doc", set: { brief: { palette: paletteBriefText(colors) } } }], "Brief palette");
  toast("Brief palette updated — your AI reads it first");
}
