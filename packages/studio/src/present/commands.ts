/** Command-palette entries for the design timelapse and presentation mode. */
import { registerCommand } from "../palette-cmd/registry";
import { useStore } from "../lib/store";
import { openTimelapse } from "../timelapse/state";
import { openPresentation } from "./state";

const hasDoc = () => !!useStore.getState().doc;

registerCommand({ id: "present.open", title: "Present to a client", group: "View", keywords: ["presentation", "slides", "deck", "pitch", "fullscreen"], when: hasDoc, run: openPresentation });
registerCommand({ id: "timelapse.open", title: "Design timelapse", group: "View", keywords: ["replay", "history", "video", "how it was made", "process"], when: () => hasDoc() && useStore.getState().timeline.items.length > 0, run: () => openTimelapse() });
