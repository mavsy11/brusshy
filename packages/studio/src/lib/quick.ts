import { create } from "zustand";
import { useMemo } from "react";
import { frameDoc, frameOf, type DocT, type FrameNodeT, type NodeT, type PaintT } from "@brusshy/core";
import { activeFrameId, toast, useStore } from "./store";
import { topSelection } from "./actions";
import { copyText } from "./notes";
import { buildSvg, prepareFonts } from "../export/svg";
import { svgToPng, svgViewBox } from "../export/raster";
import { downloadBlob, parseColor, slug } from "../export/util";

/** UI state for the quick-win tools (kept out of the main store so features stay independent). */
interface QuickState {
  /** Outlines (wireframe) view of the 2D canvas. */
  outlines: boolean;
  briefOpen: boolean;
  /** Pixel inspector for the small-size check. */
  smallOpen: boolean;
  /** Which paint the floating quick bar edits. */
  quickTarget: "fill" | "stroke";
}

export const useQuick = create<QuickState>(() => ({ outlines: false, briefOpen: false, smallOpen: false, quickTarget: "fill" }));

export function toggleOutlines(on = !useQuick.getState().outlines) {
  useQuick.setState({ outlines: on });
}

// Outlines view is pure CSS (styles/quickwins.css) keyed off a root attribute.
useQuick.subscribe((s) => {
  if (s.outlines) document.documentElement.dataset.outlines = "1";
  else delete document.documentElement.dataset.outlines;
});

// ---------------------------------------------------------------- palette

/** Normalized #RRGGBB (or the raw string when it can't be parsed). Alpha < 1 keeps rgba(). */
export function normColor(c: string): string {
  const p = parseColor(c);
  if (!p) return c.trim().toLowerCase();
  return p.a < 1 ? `rgba(${p.r},${p.g},${p.b},${Math.round(p.a * 100) / 100})` : p.hex;
}

const PAINTED: NodeT["type"][] = ["path", "shape", "text"];

/** Colors used in a version (fills, strokes, gradient stops, background), deduped, most used first. */
export function docPalette(doc: DocT, frameId: string | null): { color: string; count: number }[] {
  const counts = new Map<string, number>();
  const add = (c: string, w = 1) => {
    const k = normColor(c);
    if (k === "none" || k === "transparent") return;
    counts.set(k, (counts.get(k) ?? 0) + w);
  };
  const addPaint = (p: PaintT) => {
    if (!p) return;
    if (typeof p === "string") return add(p);
    for (const s of p.stops) add(s.color, 0.75);
  };
  const frame = frameId ? doc.nodes[frameId] : undefined;
  const nodes = frame?.type === "frame" ? Object.values(frameDoc(doc, frame.id).nodes) : Object.values(doc.nodes);
  for (const n of nodes) {
    if (!PAINTED.includes(n.type)) continue;
    addPaint(n.style.fill);
    if (n.style.strokeWidth > 0) addPaint(n.style.stroke);
  }
  if (frame?.type === "frame" && frame.background) add(frame.background, 0.5);
  return [...counts.entries()].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

/** Hook: the active version's palette. */
export function usePalette(): { color: string; count: number }[] {
  const doc = useStore((s) => s.doc);
  const active = useStore((s) => s.activeFrame);
  return useMemo(() => (doc ? docPalette(doc, activeFrameId(doc)) : []), [doc, active]);
}

// ---------------------------------------------------------------- selection → standalone doc

/**
 * The selection (or the whole active version) as a standalone document in its version's
 * coordinates. Nested picks keep their ancestors' transforms (ancestors only keep the
 * branches that lead to a picked layer).
 */
export function scopeDoc(doc: DocT, ids?: string[]): { doc: DocT; frame: FrameNodeT; ids: string[] | null } | null {
  const picked = ids ?? topSelection(doc).filter((id) => doc.nodes[id]?.type !== "frame");
  const selFrame = picked.length ? frameOf(doc, picked[0]) : null;
  const fid = selFrame?.id ?? (doc.nodes[useStore.getState().selection[0] ?? ""]?.type === "frame" ? useStore.getState().selection[0]! : activeFrameId(doc));
  const frame = fid ? (doc.nodes[fid] as FrameNodeT | undefined) : undefined;
  if (!frame || frame.type !== "frame") return null;
  const fd = frameDoc(doc, frame.id);
  const inFrame = picked.filter((id) => fd.nodes[id]);
  if (!inFrame.length) return { doc: fd, frame, ids: null };
  const nodes: Record<string, NodeT> = { ...fd.nodes };
  const keep = new Map<string, Set<string>>();
  const roots = new Set<string>();
  for (const id of inFrame) {
    let cur = id;
    for (let p = fd.nodes[cur]?.parent; p; p = fd.nodes[p]?.parent) {
      if (!keep.has(p)) keep.set(p, new Set());
      keep.get(p)!.add(cur);
      cur = p;
    }
    roots.add(cur);
  }
  for (const [gid, kids] of keep) {
    const g = nodes[gid];
    if (g && g.type === "group" && !inFrame.includes(gid)) nodes[gid] = { ...g, children: g.children.filter((c) => kids.has(c)) };
  }
  return { doc: { ...fd, nodes, root: fd.root.filter((r) => roots.has(r)) }, frame, ids: inFrame };
}

// ---------------------------------------------------------------- copy as SVG / PNG

async function scopeSvg(): Promise<{ svg: string; name: string; partial: boolean } | null> {
  const { doc } = useStore.getState();
  if (!doc) return null;
  const sc = scopeDoc(doc);
  if (!sc) return null;
  await prepareFonts(sc.doc);
  // A part is trimmed to its artwork; a whole version keeps its artboard (and background).
  const svg = buildSvg(sc.doc, sc.ids ? { trim: { pad: 0.02 }, background: null, pretty: true } : { pretty: true });
  return { svg, name: sc.ids ? `${doc.name} selection` : sc.doc.name, partial: !!sc.ids };
}

const textItem = (p: Promise<string>) => new ClipboardItem({ "text/plain": p.then((t) => new Blob([t], { type: "text/plain" })) });

/** ⇧⌘C — selection (or the active version) as clean SVG with outlined text. */
export async function copyAsSvg() {
  const job = scopeSvg();
  // Hand the clipboard a promise right away so Safari keeps the user gesture.
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("no async clipboard");
    await navigator.clipboard.write([textItem(job.then((r) => r?.svg ?? ""))]);
  } catch {
    const r = await job;
    if (!r) return;
    if (!(await copyText(r.svg))) {
      downloadBlob(new Blob([r.svg], { type: "image/svg+xml" }), `${slug(r.name)}.svg`);
      return toast("This browser blocked the clipboard — downloaded the SVG instead");
    }
  }
  const r = await job;
  if (r) toast(`Copied ${r.partial ? "selection" : "version"} as SVG (text outlined)`);
}

/** ⌥⇧⌘C — selection (or the active version) as a PNG image on the clipboard (2× its size). */
export async function copyAsPng() {
  const job = scopeSvg().then(async (r) => {
    if (!r) throw new Error("Nothing to copy");
    const box = svgViewBox(r.svg);
    const width = Math.round(Math.min(4096, Math.max(512, box.width * 2)));
    return { blob: await svgToPng(r.svg, width), name: r.name, partial: r.partial, width };
  });
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": job.then((j) => j.blob) })]);
    const j = await job;
    toast(`Copied ${j.partial ? "selection" : "version"} as PNG · ${j.width}px wide`);
  } catch (e) {
    let j: Awaited<typeof job>;
    try {
      j = await job;
    } catch (err) {
      return toast((err as Error).message, "error");
    }
    if ((e as Error).message === "unsupported" || (e as DOMException).name === "NotAllowedError") {
      downloadBlob(j.blob, `${slug(j.name)}.png`);
      toast("This browser can't put images on the clipboard — downloaded the PNG instead");
    } else toast(`Could not copy the image: ${(e as Error).message}`, "error");
  }
}
