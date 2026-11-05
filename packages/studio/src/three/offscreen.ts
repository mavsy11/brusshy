import * as THREE from "three";
import type { DocT, SceneT } from "@brusshy/core";
import { preloadDocFonts } from "../lib/fonts";
import { Stage } from "./stage";

/**
 * One shared offscreen WebGL renderer for PNG renders, video frames and
 * agent previews (works whether or not the 3D view is mounted).
 */

let shared: { renderer: THREE.WebGLRenderer; stage: Stage; canvas: HTMLCanvasElement } | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function getOffscreen() {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  const stage = new Stage(renderer, { samples: 8 });
  canvas.addEventListener("webglcontextlost", () => {
    shared = null;
  });
  shared = { renderer, stage, canvas };
  return shared;
}

/** Serialize offscreen jobs (they share one renderer). */
export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

export interface FrameOptions {
  width: number;
  height: number;
  transparent: boolean;
  azimuth: number;
  elevation: number;
  /** Supersampling factor (auto when omitted). */
  ss?: number;
}

/** Largest single render (render pixels) before switching to tiles. */
const TILE = 2048;
const PAD = 64;

/** Prepare the shared stage for a document. Awaits fonts. */
export async function prepare(doc: DocT, override: Partial<SceneT> = {}) {
  await preloadDocFonts(doc);
  const off = getOffscreen();
  off.stage.setDoc(doc, override);
  return off;
}

/** Render one frame of the prepared stage into a 2D canvas of exactly width × height. */
export function renderFrame(o: FrameOptions, out?: HTMLCanvasElement): HTMLCanvasElement {
  const { stage, canvas } = getOffscreen();
  const sc = stage.settings!;
  const ss = o.ss ?? (Math.max(o.width, o.height) <= 1100 ? 2 : 1);
  const FW = Math.round(o.width * ss);
  const FH = Math.round(o.height * ss);
  stage.setTransparent(o.transparent);

  const target = out ?? document.createElement("canvas");
  target.width = o.width;
  target.height = o.height;
  const ctx = target.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, o.width, o.height);

  if (FW <= TILE && FH <= TILE) {
    stage.setSize(FW, FH, 1);
    stage.placeCamera(o.azimuth, o.elevation, sc.camera.distance, sc.camera.fov, FW / FH);
    stage.render();
    ctx.drawImage(canvas, 0, 0, FW, FH, 0, 0, o.width, o.height);
    return target;
  }

  // Tiled: constant tile size (no reallocations), padded so screen-space effects don't seam.
  stage.setSize(TILE, TILE, 1);
  stage.placeCamera(o.azimuth, o.elevation, sc.camera.distance, sc.camera.fov, FW / FH);
  stage.beginTiles(FW, FH);
  const inner = TILE - PAD * 2;
  for (let y0 = 0; y0 < FH; y0 += inner) {
    for (let x0 = 0; x0 < FW; x0 += inner) {
      const w = Math.min(inner, FW - x0);
      const h = Math.min(inner, FH - y0);
      stage.renderTile(FW, FH, x0 - PAD, y0 - PAD, TILE, TILE);
      ctx.drawImage(canvas, PAD, PAD, w, h, x0 / ss, y0 / ss, w / ss, h / ss);
    }
  }
  return target;
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality),
  );
}
