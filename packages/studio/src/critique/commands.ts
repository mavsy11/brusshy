import { listFrames } from "@brusshy/core";
import { activeFrameId, useStore } from "../lib/store";
import { registerCommands } from "../palette-cmd/registry";
import { toggleCritique } from "./state";
import { openCompare } from "../compare/state";

const versionName = () => {
  const doc = useStore.getState().doc;
  const id = doc ? activeFrameId(doc) : null;
  return id && doc ? doc.nodes[id]?.name : undefined;
};

registerCommands([
  {
    id: "critique.toggle",
    title: "Critique this version",
    group: "Versions",
    keywords: ["review", "feedback", "score", "audit", "legibility", "balance", "contrast", "alignment", "kerning", "spacing"],
    hint: versionName,
    when: () => !!useStore.getState().doc,
    run: toggleCritique,
  },
  {
    id: "compare.open",
    title: "Compare versions",
    group: "Versions",
    keywords: ["before", "after", "diff", "difference", "split", "onion skin", "side by side"],
    hint: () => {
      const doc = useStore.getState().doc;
      return doc && listFrames(doc).length > 1 ? `${versionName()} vs previous` : "needs two versions";
    },
    when: () => {
      const doc = useStore.getState().doc;
      return !!doc && listFrames(doc).length > 1;
    },
    run: () => openCompare(),
  },
]);
