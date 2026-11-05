import { buildTimelapse, type DocT, type History, type TimelapseData } from "@brusshy/core";

/**
 * GET /api/timelapse: the build steps of one version, reconstructed from the undo history
 * (see core/timelapse.ts). Rebuilding walks the whole history, so the last answer is cached
 * until the document or its history changes.
 */
let cache: { key: string; data: TimelapseData } | null = null;

export function timelapseFor(doc: DocT, history: History, frameId: string, max = 300): TimelapseData {
  const { past } = history.toJSON();
  const last = past[past.length - 1];
  const key = [doc.id, doc.updatedAt, past.length, last?.at ?? 0, frameId, max].join("|");
  if (cache?.key === key) return cache.data;
  const data = buildTimelapse(doc, past, frameId, { max });
  cache = { key, data };
  return data;
}
