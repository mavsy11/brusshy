import { listFrames, type DocT } from "@brusshy/core";
import { useStore, type Camera } from "../lib/store";
import type { Pt } from "../lib/geom";

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;

export const toWorld = (c: Camera, sx: number, sy: number): Pt => [(sx - c.x) / c.zoom, (sy - c.y) / c.zoom];
export const toScreen = (c: Camera, wx: number, wy: number): Pt => [c.x + wx * c.zoom, c.y + wy * c.zoom];

/** Space the floating panels take, so "fit" centers the artboard in what's visible. */
export const SAFE = { left: 76, right: 300, top: 72, bottom: 56 };

/** In split view the side panel sits over the 3D pane, so the 2D pane has no right-hand panel. */
export function setSplitSafe(split: boolean) {
  SAFE.right = split ? 24 : 300;
}

let viewport = { w: window.innerWidth, h: window.innerHeight };
export function setViewport(w: number, h: number) {
  viewport = { w, h };
}
export const getViewport = () => viewport;

/** Bounds of every version (frame) on the canvas. */
export function framesBox(doc: DocT): { x: number; y: number; w: number; h: number } {
  const frames = listFrames(doc);
  if (!frames.length) return { x: 0, y: 0, w: doc.artboard.width, h: doc.artboard.height };
  const x0 = Math.min(...frames.map((f) => f.transform.x));
  const y0 = Math.min(...frames.map((f) => f.transform.y));
  const x1 = Math.max(...frames.map((f) => f.transform.x + f.width));
  const y1 = Math.max(...frames.map((f) => f.transform.y + f.height));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Camera that fits one version. */
export function fitFrame(doc: DocT, frameId: string): Camera {
  const f = doc.nodes[frameId];
  if (!f || f.type !== "frame") return fitCamera(doc);
  return fitCamera(doc, { x: f.transform.x, y: f.transform.y, w: f.width, h: f.height });
}

export function fitCamera(doc: DocT, box?: { x: number; y: number; w: number; h: number }, pad = 64): Camera {
  const b = box ?? framesBox(doc);
  const aw = Math.max(100, viewport.w - SAFE.left - SAFE.right - pad * 2);
  const ah = Math.max(100, viewport.h - SAFE.top - SAFE.bottom - pad * 2);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(aw / Math.max(1, b.w), ah / Math.max(1, b.h))));
  const cx = SAFE.left + (viewport.w - SAFE.left - SAFE.right) / 2;
  const cy = SAFE.top + (viewport.h - SAFE.top - SAFE.bottom) / 2;
  return { zoom, x: cx - (b.x + b.w / 2) * zoom, y: cy - (b.y + b.h / 2) * zoom };
}

export function zoomAt(sx: number, sy: number, factor: number) {
  const c = useStore.getState().camera;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
  const k = zoom / c.zoom;
  useStore.setState({ camera: { zoom, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k } });
}

export function zoomTo(zoom: number) {
  zoomAt(viewport.w / 2, viewport.h / 2, zoom / useStore.getState().camera.zoom);
}

/** Grid step in world units that keeps dots ~14–40 px apart on screen. */
export function gridStep(zoom: number): number {
  let step = 32;
  while (step * zoom < 14) step *= 2;
  while (step * zoom > 40 && step > 1) step /= 2;
  return step;
}
