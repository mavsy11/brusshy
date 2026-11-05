import { create } from "zustand";
import { frameDoc, type TimelineItem } from "@brusshy/core";
import { activeFrameId, useStore } from "./store";
import { buildSvg, prepareFonts } from "../export/svg";
import { svgToCanvas } from "../export/raster";

/**
 * Thumbnails for the History panel. The studio only ever holds the current document, so
 * each step is captured when the document sits at that step (after an edit, undo, redo or
 * jump). Cached per step, LRU-bounded, small PNGs.
 */

const LIMIT = 180;
const SIZE = 168;
const MAX_BYTES = 80_000;

const cache = new Map<string, string>();

// Survive page reloads (daemon restarts, dev reloads): the most recent thumbnails, size-capped.
const STORE_KEY = "brusshy:history-thumbs";
const STORE_MAX = 1_500_000;
try {
  const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "[]") as [string, string][];
  for (const [k, v] of saved) if (typeof k === "string" && typeof v === "string" && v.startsWith("data:image/png")) cache.set(k, v);
} catch {
  /* storage unavailable or corrupt */
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out: [string, string][] = [];
    let bytes = 0;
    for (const [k, v] of [...cache.entries()].reverse()) {
      if (bytes + v.length > STORE_MAX) break;
      bytes += v.length;
      out.unshift([k, v]);
    }
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch {
      /* quota: thumbnails are a nicety */
    }
  }, 1000);
}

/** Bumps whenever a thumbnail lands, so rows re-render. */
export const useThumbVersion = create<{ v: number }>(() => ({ v: 0 }));

export const stepKey = (docId: string, it: TimelineItem | undefined, offset = 0) =>
  it ? `${docId}|${it.at}|${it.author}|${it.label}` : `${docId}|start@${offset}`;

export function thumbFor(key: string): string | undefined {
  return cache.get(key);
}

function put(key: string, url: string) {
  cache.delete(key);
  cache.set(key, url);
  while (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  useThumbVersion.setState((s) => ({ v: s.v + 1 }));
  persist();
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function capture() {
  const s = useStore.getState();
  // Optimistic local edits aren't steps yet: wait for the daemon's echo (it re-triggers us).
  if (!s.doc || s.pending.length || Object.keys(s.live).length) return;
  const t = s.timeline;
  const item = t.cursor > 0 ? t.items[t.cursor - 1] : undefined;
  const key = stepKey(s.doc.id, item, t.offset);
  const fid = activeFrameId(s.doc);
  if (!fid) return;
  const fd = frameDoc(s.doc, fid);
  if (running) return schedule();
  running = true;
  try {
    await prepareFonts(fd);
    const svg = buildSvg(fd, {});
    const { width, height } = fd.artboard;
    const k = SIZE / Math.max(width, height);
    const c = await svgToCanvas(svg, Math.max(1, Math.round(width * k)), { height: Math.max(1, Math.round(height * k)) });
    const url = c.toDataURL("image/png");
    c.width = c.height = 0;
    if (url.length <= MAX_BYTES) put(key, url);
  } catch {
    /* a thumbnail is never worth an error */
  } finally {
    running = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void capture(), 320);
}

useStore.subscribe((s, prev) => {
  if (s.doc !== prev.doc || s.timeline !== prev.timeline || s.activeFrame !== prev.activeFrame || s.pending !== prev.pending) schedule();
});
