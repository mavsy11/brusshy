import { REFINE_ACTIONS, REFINE_LABELS } from "@brusshy/core";
import { useStore } from "../lib/store";
import { registerCommands } from "../palette-cmd/registry";
import { RefineIcons } from "./icons";
import { askMoreStyle, canRefine, MAKE_IT_MORE, refineFromPalette, refineTargets } from "./state";

const selected = () => {
  const { doc, selection } = useStore.getState();
  const n = doc ? refineTargets(doc, selection).length : 0;
  return n ? `${n} layer${n === 1 ? "" : "s"}` : undefined;
};

const KEYWORDS: Record<string, string[]> = {
  simplify: ["reduce nodes", "clean", "points", "fewer"],
  smooth: ["curves", "wobbly", "even", "fair"],
  bolder: ["thicker", "weight", "heavier", "offset", "grow", "expand"],
  thinner: ["lighter", "weight", "offset", "shrink", "contract"],
  round: ["corners", "fillet", "radius", "soft"],
  "optical-center": ["centre", "align", "visual", "balance", "middle"],
  "snap-grid": ["pixel", "round coordinates", "align"],
  symmetric: ["mirror", "symmetry", "flip half", "balance"],
};

// Deterministic refinements (no AI tokens) and the creative "Make it more…" asks.
registerCommands([
  ...REFINE_ACTIONS.map((a) => ({
    id: `refine.${a}`,
    title: REFINE_LABELS[a].label,
    group: "Refine",
    keywords: ["refine", ...(KEYWORDS[a] ?? []), REFINE_LABELS[a].hint],
    icon: RefineIcons[a],
    hint: selected,
    when: () => canRefine(),
    run: () => refineFromPalette(a),
  })),
  ...MAKE_IT_MORE.map((m) => ({
    id: `refine.more.${m}`,
    title: `Make it more ${m}`,
    group: "Refine",
    keywords: ["ai", "ask", "style", "creative", m],
    icon: RefineIcons.ai,
    hint: () => "asks your AI",
    when: () => canRefine(),
    run: () => askMoreStyle(m),
  })),
]);
