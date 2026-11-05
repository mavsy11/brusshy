import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeVideo } from "mediabunny";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { ExportParams, TimelapseExportOptions } from "@brusshy/core";
import { slug } from "../export/util";
import { loadTimelapse, type TLModel } from "./data";
import { ASPECT_SIZE, makePlan, autoBuildMs, overlayFontsReady, TimelapseCompositor, type Aspect, type TLLook } from "./compose";

/** Design-timelapse exports: MP4 (WebM fallback) and GIF, square 1080×1080 and/or vertical 1080×1920. */

export type TimelapseFormat = "timelapse" | "timelapse-gif";
export const isTimelapseFormat = (f: string): f is TimelapseFormat => f === "timelapse" || f === "timelapse-gif";
export const TIMELAPSE_LABELS: Record<TimelapseFormat, string> = { timelapse: "Timelapse video", "timelapse-gif": "Timelapse GIF" };

const aspectsOf = (o?: TimelapseExportOptions): Aspect[] => {
  const a = (o?.aspects ?? ["square"]).filter((x): x is Aspect => x === "square" || x === "vertical");
  return a.length ? [...new Set(a)] : ["square"];
};

export function timelapseDetail(f: TimelapseFormat, o: ExportParams): string {
  const t = o.timelapse ?? {};
  const sizes = aspectsOf(t)
    .map((a) => (a === "square" ? "1:1" : "9:16"))
    .join(" + ");
  const len = t.seconds ? `${t.seconds} s` : "auto length";
  return f === "timelapse" ? `${sizes} · MP4 · ${len}` : `${sizes} · ${t.gifSize ?? 540} px · ${len}`;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const tick = () => new Promise((r) => setTimeout(r, 0));

export interface TLRenderOptions {
  aspect: Aspect;
  /** Output width (height follows the aspect). */
  width?: number;
  fps?: number;
  /** Build length in ms (default: auto from the number of steps). */
  buildMs?: number;
  look?: Partial<TLLook>;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

function compositorFor(m: TLModel, o: TLRenderOptions, W: number, H: number) {
  const look: TLLook = { aspect: o.aspect, captions: o.look?.captions ?? true, clock: o.look?.clock ?? true, sketches: o.look?.sketches ?? true };
  const plan = makePlan(m, o.buildMs ?? autoBuildMs(m));
  // Export walks the states in order: a small cache is enough.
  return new TimelapseCompositor(m, look, W, H, plan, 6);
}

/** MP4 (H.264), WebM (VP9) when H.264 can't be encoded here. */
export async function renderTimelapseVideo(m: TLModel, o: TLRenderOptions): Promise<{ blob: Blob; ext: "mp4" | "webm"; width: number; height: number }> {
  if (typeof VideoEncoder === "undefined") throw new Error("Video export needs WebCodecs (a recent Chrome, Edge, Safari or Firefox)");
  const base = ASPECT_SIZE[o.aspect];
  const W = even(Math.max(360, Math.min(2160, o.width ?? base.w)));
  const H = even((W * base.h) / base.w);
  const fps = Math.max(24, Math.min(60, Math.round(o.fps ?? 30)));
  const q = { width: W, height: H, quality: QUALITY_HIGH };
  const codec = (await canEncodeVideo("avc", q)) ? "avc" : (await canEncodeVideo("vp9", q)) ? "vp9" : null;
  if (!codec) throw new Error("This browser can't encode H.264 or VP9 video");
  await overlayFontsReady();
  const comp = compositorFor(m, o, W, H);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  try {
    const frames = Math.max(2, Math.round((comp.plan.total / 1000) * fps));
    const target = new BufferTarget();
    const output = new Output({ format: codec === "avc" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target });
    const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) {
        await output.cancel();
        throw new Error("Cancelled");
      }
      await comp.draw(ctx, (i * 1000) / fps);
      await source.add(i / fps, 1 / fps);
      o.onProgress?.(((i + 1) / frames) * 0.98);
      if (i % 4 === 3) await tick();
    }
    await output.finalize();
    o.onProgress?.(1);
    const ext = codec === "avc" ? "mp4" : "webm";
    return { blob: new Blob([target.buffer!], { type: ext === "mp4" ? "video/mp4" : "video/webm" }), ext, width: W, height: H };
  } finally {
    comp.dispose();
    canvas.width = canvas.height = 0;
  }
}

/** Looping GIF (one palette for the whole clip, so nothing flickers). */
export async function renderTimelapseGif(m: TLModel, o: TLRenderOptions): Promise<Blob> {
  const base = ASPECT_SIZE[o.aspect];
  const W = Math.round(Math.max(240, Math.min(1080, o.width ?? 540)));
  const H = Math.round((W * base.h) / base.w);
  const fps = Math.max(8, Math.min(30, Math.round(o.fps ?? 15)));
  await overlayFontsReady();
  const comp = compositorFor(m, o, W, H);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;
  try {
    const frames = Math.max(2, Math.round((comp.plan.total / 1000) * fps));
    const probes = [0.08, 0.3, 0.55, 0.75, 0.9, 0.99].map((p) => Math.min(frames - 1, Math.round(p * (frames - 1))));
    const pixels: Uint8ClampedArray[] = [];
    for (const i of probes) {
      await comp.draw(ctx, (i * 1000) / fps);
      pixels.push(ctx.getImageData(0, 0, W, H).data);
    }
    const all = new Uint8ClampedArray(pixels.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of pixels) {
      all.set(p, off);
      off += p.length;
    }
    const palette = quantize(all, 256, { format: "rgb565" });
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new Error("Cancelled");
      await comp.draw(ctx, (i * 1000) / fps);
      const index = applyPalette(ctx.getImageData(0, 0, W, H).data, palette, "rgb565");
      gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay, repeat: 0 });
      o.onProgress?.(((i + 1) / frames) * 0.98);
      if (i % 3 === 2) await tick();
    }
    gif.finish();
    o.onProgress?.(1);
    return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
  } finally {
    comp.dispose();
    canvas.width = canvas.height = 0;
  }
}

/** One timelapse format for the export pipeline (`o.frame` picks the version). */
export async function exportTimelapse(f: TimelapseFormat, o: ExportParams, docName: string, onProgress: (p: number) => void, signal?: AbortSignal): Promise<{ name: string; blob: Blob }[]> {
  const m = await loadTimelapse(o.frame);
  if (!m.data.steps.length) throw new Error("This version has no history to replay yet");
  const t = o.timelapse ?? {};
  const aspects = aspectsOf(t);
  const base = slug(docName);
  const buildMs = t.seconds ? Math.max(2, Math.min(120, t.seconds)) * 1000 : undefined;
  const look = { sketches: t.sketches, captions: t.captions, clock: t.clock };
  const out: { name: string; blob: Blob }[] = [];
  for (let i = 0; i < aspects.length; i++) {
    const aspect = aspects[i]!;
    const prog = (p: number) => onProgress((i + p) / aspects.length);
    const suffix = aspect === "vertical" ? "9x16" : "1x1";
    if (f === "timelapse") {
      const r = await renderTimelapseVideo(m, { aspect, width: t.size, buildMs, look, onProgress: prog, signal });
      out.push({ name: `${base}-timelapse-${suffix}.${r.ext}`, blob: r.blob });
    } else {
      out.push({ name: `${base}-timelapse-${suffix}.gif`, blob: await renderTimelapseGif(m, { aspect, width: t.gifSize, buildMs, look, onProgress: prog, signal }) });
    }
  }
  return out;
}
