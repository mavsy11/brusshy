/** Command-palette entry for the Stage view. */
import { useStore } from "../lib/store";
import { registerCommand } from "../palette-cmd/registry";
import { toggleStage, useStage } from "./state";

registerCommand({
  id: "stage.toggle",
  title: "Stage view",
  group: "View",
  shortcut: "⇧S",
  keywords: ["record", "recording", "screen", "clean", "hide ui", "chrome", "focus", "zen", "video", "showcase"],
  hint: () => (useStage.getState().open ? "exit" : "only the logo, for recording"),
  when: () => !!useStore.getState().doc,
  run: toggleStage,
});
