import { BOOLEAN_LABELS, BOOLEAN_OPS } from "@brusshy/core";
import { activeFrameId, setTool, useStore } from "../lib/store";
import { registerCommands } from "../palette-cmd/registry";
import { addTemplate, booleanTargets, clearConstruction, frameNode, runBoolean } from "./actions";
import { BOOL_HINTS, BOOL_ICONS } from "./BooleanButtons";
import { toggleConstruction, useConstruct } from "./state";

const hasConstruction = () => {
  const doc = useStore.getState().doc;
  return !!frameNode(doc, activeFrameId(doc))?.construction?.guides.length;
};

registerCommands([
  {
    id: "construct.builder",
    title: "Shape builder",
    group: "Tools",
    shortcut: "M",
    keywords: ["construction", "grid", "regions", "fill", "circles", "build"],
    run: () => setTool("builder"),
  },
  {
    id: "construct.toggle",
    title: "Show / hide construction",
    group: "View",
    shortcut: "⇧G",
    keywords: ["guides", "grid", "construction lines"],
    hint: () => (useConstruct.getState().visible ? "Shown" : "Hidden"),
    run: toggleConstruction,
  },
  {
    id: "construct.circle-grid",
    title: "Insert circle grid (golden ratio)",
    group: "Construction",
    keywords: ["golden", "phi", "1.618", "fibonacci", "circles", "grid"],
    run: () => addTemplate("circle-grid", { ratio: useConstruct.getState().ratio }),
  },
  { id: "construct.circle-grid-2", title: "Insert circle grid 1 : 2", group: "Construction", keywords: ["circles", "grid", "half"], run: () => addTemplate("circle-grid", { ratio: 2 }) },
  { id: "construct.square-grid", title: "Insert square grid", group: "Construction", keywords: ["grid", "unit", "cells"], run: () => addTemplate("square-grid", { divisions: useConstruct.getState().divisions }) },
  { id: "construct.diagonal-grid", title: "Insert diagonal grid", group: "Construction", keywords: ["grid", "45", "diagonal"], run: () => addTemplate("square-grid", { divisions: useConstruct.getState().divisions, diagonals: true }) },
  { id: "construct.keylines", title: "Insert keylines", group: "Construction", keywords: ["icon", "square", "circle", "diamond", "optical size"], run: () => addTemplate("keylines") },
  { id: "construct.radial", title: "Insert radial grid", group: "Construction", keywords: ["flower", "sun", "aperture", "sectors", "rosette"], run: () => addTemplate("radial", { sectors: useConstruct.getState().sectors }) },
  { id: "construct.clear", title: "Clear construction", group: "Construction", keywords: ["remove guides", "delete grid"], when: hasConstruction, run: () => clearConstruction() },
  ...BOOLEAN_OPS.map((op) => ({
    id: `boolean.${op}`,
    title: BOOLEAN_LABELS[op],
    group: "Combine",
    keywords: ["boolean", "pathfinder", "shapes", op === "subtract" ? "minus front" : op, op === "exclude" ? "xor" : op],
    icon: BOOL_ICONS[op],
    hint: BOOL_HINTS[op].split(" — ")[1],
    when: () => {
      const { doc, selection } = useStore.getState();
      return !!doc && booleanTargets(doc, selection).length >= 2;
    },
    run: () => runBoolean(op),
  })),
]);
