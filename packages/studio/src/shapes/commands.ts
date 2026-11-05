import { registerCommand } from "../palette-cmd/registry";
import { useStore } from "../lib/store";
import { openShapes } from "./state";

registerCommand({
  id: "shapes.open",
  title: "Insert shape…",
  group: "Panels",
  keywords: ["shapes", "library", "symbols", "icons", "star", "badge", "shield", "arrow", "laurel", "frame", "pattern"],
  when: () => !!useStore.getState().doc && useStore.getState().view !== "3d",
  run: () => openShapes(),
});
