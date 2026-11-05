/** Registers the 2D render + export request handlers (owned by the export module). */
import { registerExport, registerRender2D } from "../lib/requests";
import { frameDocFor, useStore } from "../lib/store";
import { showExportDone } from "./success";
import { exportForAgent } from "./pipeline";
import { render2D } from "./render2d";
import { renderAnimationRequest } from "../animation/exports";

/** The requested frame (version) as a standalone document — or the active one. */
const currentDoc = (frame?: string) => {
  const doc = frameDocFor(frame);
  if (!doc) throw new Error("No document is open in the studio");
  return doc;
};

let registered = false;

export function registerExportHandlers() {
  if (registered) return;
  registered = true;
  registerRender2D((params) => (params.animTimes?.length ? renderAnimationRequest(params) : render2D(currentDoc(params.frame), params)));
  registerExport(async (params) => {
    const doc = currentDoc(params.frame);
    const res = await exportForAgent(doc, params);
    // The user sees what their AI just exported, with a way to open the folder.
    const projectDir = useStore.getState().projectDir;
    const where = projectDir && res.dir.startsWith(projectDir) ? res.dir.slice(projectDir.length).replace(/^[\\/]/, "") : res.dir;
    const bytes = res.files.reduce((n, f) => n + (f.bytes ?? 0), 0);
    showExportDone(doc, { count: res.files.length, bytes, where, dir: res.dir, mode: "save", by: "ai", failed: res.failed?.length ?? 0 });
    return res;
  });
}
