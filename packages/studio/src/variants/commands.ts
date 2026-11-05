/** Command-palette entries for the one-click variant actions. */
import { activeFrameId, useStore } from "../lib/store";
import { registerCommands } from "../palette-cmd/registry";
import { XIcons } from "../explore/icons";
import { askVariant, canVary } from "./requests";

const activeName = () => {
  const doc = useStore.getState().doc;
  const id = doc && activeFrameId(doc);
  return id ? (doc.nodes[id]?.name ?? null) : null;
};

registerCommands([
  {
    id: "variants.more",
    title: "More like this",
    group: "AI",
    icon: XIcons.explore,
    keywords: ["variants", "same style", "similar", "alternatives", "options", "4 variants", "directions"],
    hint: () => (activeName() ? `4 variants of ${activeName()}` : null),
    when: () => canVary(),
    run: () => askVariant("more"),
  },
  {
    id: "variants.vary",
    title: "Vary this",
    group: "AI",
    icon: XIcons.refresh,
    keywords: ["variant", "subtle", "tweak", "iterate", "alternative", "refine", "copy"],
    hint: () => (activeName() ? `one subtle change to ${activeName()}` : null),
    when: () => canVary(),
    run: () => askVariant("vary"),
  },
]);
