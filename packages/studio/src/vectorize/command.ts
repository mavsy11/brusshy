import { useStore } from "../lib/store";
import { registerCommand } from "../palette-cmd/registry";
import { openVectorize } from "./run";

/** The reference image to vectorize: the selected one, else the only one in the document. */
function photoTarget(): string | null {
  const { doc, selection } = useStore.getState();
  if (!doc) return null;
  const sel = selection.find((id) => doc.nodes[id]?.type === "reference");
  if (sel) return sel;
  const refs = Object.values(doc.nodes).filter((n) => n.type === "reference");
  return refs.length === 1 ? refs[0]!.id : null;
}

registerCommand({
  id: "vectorize.photo",
  title: "Vectorize photo…",
  group: "Edit",
  keywords: ["trace", "object", "image", "silhouette", "posterize", "line art", "stencil", "cut out", "remove background"],
  when: () => photoTarget() !== null,
  run: () => {
    const id = photoTarget();
    if (id) openVectorize(id, "photo");
  },
});
