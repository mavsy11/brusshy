/** Command-palette entries for the Explorer, the reference board and exact repeats. */
import { describeRepeat } from "@brusshy/core";
import { registerCommand } from "../palette-cmd/registry";
import { useStore } from "../lib/store";
import { XIcons } from "./icons";
import { openBoard, openExplorer, repeatSelection, repeatTargets, selectedRepeatGroup, updateRepeat } from "./state";

const hasDoc = () => !!useStore.getState().doc;
const canRepeat = () => repeatTargets().length > 0;

registerCommand({ id: "explore.open", title: "Explore techniques…", group: "AI", keywords: ["variants", "directions", "monogram", "letter", "construction", "ideas", "concepts"], icon: XIcons.explore, when: hasDoc, run: openExplorer });
registerCommand({ id: "board.open", title: "Reference board…", group: "Panels", keywords: ["inspiration", "moodboard", "references", "images", "mood"], icon: XIcons.board, when: hasDoc, hint: () => { const n = useStore.getState().doc?.board?.items.length ?? 0; return n ? `${n} image${n === 1 ? "" : "s"}` : null; }, run: openBoard });
registerCommand({ id: "repeat.radial", title: "Radial repeat ×8", group: "Edit", keywords: ["rotate copies", "petals", "flower", "sun", "rosette", "circular array"], icon: XIcons.radial, when: canRepeat, run: () => repeatSelection({ mode: "radial", count: 8 }) });
registerCommand({ id: "repeat.mirror", title: "Mirror (left ↔ right)", group: "Edit", keywords: ["symmetry", "reflect", "symmetric", "half"], icon: XIcons.mirror, when: canRepeat, run: () => repeatSelection({ mode: "mirror", axis: "vertical" }) });
registerCommand({ id: "repeat.mirrorV", title: "Mirror (top ↕ bottom)", group: "Edit", keywords: ["symmetry", "reflect", "symmetric", "half"], icon: XIcons.mirror, when: canRepeat, run: () => repeatSelection({ mode: "mirror", axis: "horizontal" }) });
registerCommand({ id: "repeat.grid", title: "Grid array 3×3", group: "Edit", keywords: ["pattern", "rows", "columns", "array", "modules"], icon: XIcons.grid, when: canRepeat, run: () => repeatSelection({ mode: "grid", count: 3, rows: 3 }) });
registerCommand({ id: "repeat.update", title: "Update repeat", group: "Edit", keywords: ["rebuild", "refresh", "copies", "source"], icon: XIcons.refresh, when: () => !!selectedRepeatGroup(), hint: () => { const g = selectedRepeatGroup(); return g?.repeat ? describeRepeat(g.repeat) : null; }, run: () => { const g = selectedRepeatGroup(); if (g) updateRepeat(g.id, {}, "Update repeat"); } });
