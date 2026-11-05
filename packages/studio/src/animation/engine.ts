import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeVideo } from "mediabunny";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
  animatedSvg,
  animationOf,
  findFrame,
  hasAnimation,
  sampleAnimation,
  targetSelector,
  NO_ANIMATION,
  type AnimPlan,
  type AnimationT,
  type DocT,
} from "@brusshy/core";
import { textToPath } from "../lib/fonts";
import { worldBox } from "../lib/geom";
import { activeFrameId, useStore } from "../lib/store";
import { canvasToBlob, loadImage, setRootAttrs, withBackground } from "../export/raster";
import { prepareFonts, svgFile } from "../export/svg";

/**
 * Logo animation in the studio: one plan (from @brusshy/core) drives the live preview,
 * the animated SVG and every rendered frame (video, GIF, the agent's contact sheet).
 */

/** The animation spec of a version (by id/name; default the active one). */
export function frameAnimation(ref?: string | null, doc = useStore.getState().doc): AnimationT {
  if (!doc) return NO_ANIMATION;
  const id = (ref ? findFrame(doc, ref)?.id : null) ?? activeFrameId(doc);
  const f = id ? doc.nodes[id] : null;
  return f?.type === "frame" ? animationOf(f.animation) : NO_ANIMATION;
}

/** Accurate artboard-space bounds measured with the studio's geometry (outlined text included). */
export const boundsFor = (doc: DocT) => (id: string) => {
  const n = doc.nodes[id];
  return n ? worldBox(doc, n) : null;
};

export interface BuiltAnimation {
  svg: string;
  plan: AnimPlan;
  scope: string;
}

/** The animated SVG markup of a projected version. `animate:false` = static CSS only (frames are styled inline). */
export function buildAnimation(doc: DocT, spec: AnimationT, o: { animate?: boolean; background?: string | null; scope?: string } = {}): BuiltAnimation {
  const r = animatedSvg(doc, spec, { textToPath, boundsOf: boundsFor(doc), animate: o.animate, scope: o.scope });
  return { ...r, svg: o.background ? withBackground(r.svg, o.background) : r.svg };
}

const declString = (d: Record<string, string> | undefined) =>
  d
    ? Object.entries(d)
        .map(([k, v]) => `${k}:${v}`)
        .join(";")
    : "";

/** Writes sampled values as inline styles on an SVG tree (live DOM or a parsed template). */
export class StyleApplier {
  private els = new Map<string, Element[]>();
  private last = new Map<string, string>();
  constructor(
    root: ParentNode,
    public plan: AnimPlan,
  ) {
    for (const t of plan.tracks) {
      if (this.els.has(t.sel)) continue;
      this.els.set(t.sel, Array.from(root.querySelectorAll(targetSelector(t.sel))));
    }
  }
  apply(time: number) {
    const s = sampleAnimation(this.plan, time);
    for (const [sel, els] of this.els) {
      const css = declString(s[sel]);
      if (this.last.get(sel) === css) continue;
      this.last.set(sel, css);
      for (const el of els) {
        if (css) el.setAttribute("style", css);
        else el.removeAttribute("style");
      }
    }
  }
}

/** Renders frames of the animation into one reusable canvas. */
export class FrameRenderer {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private doc: Document;
  private styles: StyleApplier;
  private ser = new XMLSerializer();

  private constructor(
    built: BuiltAnimation,
    readonly width: number,
    readonly height: number,
    private background: string | null,
  ) {
    const sized = setRootAttrs(built.svg, { width, height, preserveAspectRatio: "xMidYMid meet" });
    this.doc = new DOMParser().parseFromString(sized, "image/svg+xml");
    if (this.doc.querySelector("parsererror")) throw new Error("Could not prepare the animation frames");
    this.styles = new StyleApplier(this.doc, built.plan);
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
  }

  get plan() {
    return this.styles.plan;
  }

  static async create(doc: DocT, spec: AnimationT, width: number, height: number, background: string | null): Promise<FrameRenderer> {
    await prepareFonts(doc);
    return new FrameRenderer(buildAnimation(doc, spec, { animate: false }), width, height, background);
  }

  /** Draw the frame at `time` ms into the canvas. */
  async draw(time: number): Promise<HTMLCanvasElement> {
    this.styles.apply(time);
    const svg = this.ser.serializeToString(this.doc);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = await loadImage(url);
      const { ctx, width: w, height: h } = this;
      ctx.clearRect(0, 0, w, h);
      if (this.background) {
        ctx.fillStyle = this.background;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return this.canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  dispose() {
    this.canvas.width = this.canvas.height = 0;
  }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const tick = () => new Promise((r) => setTimeout(r, 0));

function requireAnimation(spec: AnimationT) {
  if (!hasAnimation(spec)) throw new Error("This version has no animation yet — pick an entrance or loop in the Animation panel (or set_animation)");
}

/** Length of an exported clip (entrance + hold, or + two loop cycles), ms. */
export const clipLength = (plan: AnimPlan) => Math.max(800, plan.total);

/** GIFs repeat the whole clip, so one loop cycle is enough (smaller files). */
const gifLength = (plan: AnimPlan) => Math.max(800, plan.loop ? plan.loop.start + plan.loop.period : plan.total);

/** Self-contained animated SVG file (CSS keyframes; plays in any browser). */
export async function exportAnimatedSvg(doc: DocT, spec: AnimationT): Promise<Blob> {
  requireAnimation(spec);
  await prepareFonts(doc);
  const { svg } = buildAnimation(doc, spec, { scope: "brusshy-anim", background: doc.artboard.background });
  return new Blob([svgFile(svg, `${doc.name} (animated)`)], { type: "image/svg+xml;charset=utf-8" });
}

export interface AnimVideoOptions {
  size?: number;
  fps?: number;
  /** Transparent WebM (VP9 alpha) instead of an opaque MP4. */
  transparent?: boolean;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

/** MP4 (H.264) of the animation, WebM (VP9) when H.264 is unavailable or a transparent clip is asked for. */
export async function renderAnimVideo(doc: DocT, spec: AnimationT, o: AnimVideoOptions = {}): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  requireAnimation(spec);
  if (typeof VideoEncoder === "undefined") throw new Error("Video export needs WebCodecs (a recent Chrome, Edge, Safari or Firefox)");
  const size = Math.max(256, Math.min(2160, o.size ?? 1080));
  const fps = Math.max(12, Math.min(60, Math.round(o.fps ?? 30)));
  const W = even(size);
  const H = even((size * doc.artboard.height) / doc.artboard.width);
  const wantAlpha = !!o.transparent && !doc.artboard.background;
  const q = { width: W, height: H, quality: QUALITY_HIGH };
  let codec: "avc" | "vp9" | null = null;
  if (wantAlpha && (await canEncodeVideo("vp9", q))) codec = "vp9";
  else if (await canEncodeVideo("avc", q)) codec = "avc";
  else if (await canEncodeVideo("vp9", q)) codec = "vp9";
  if (!codec) throw new Error("This browser can't encode H.264 or VP9 video");
  const alpha = wantAlpha && codec === "vp9";
  const r = await FrameRenderer.create(doc, spec, W, H, alpha ? null : (doc.artboard.background ?? "#ffffff"));
  try {
    const frames = Math.max(2, Math.round((clipLength(r.plan) / 1000) * fps));
    const target = new BufferTarget();
    const output = new Output({ format: codec === "avc" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target });
    const source = new CanvasSource(r.canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2, ...(alpha ? { alpha: "keep" as const } : {}) });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) {
        await output.cancel();
        throw new Error("Cancelled");
      }
      await r.draw((i * 1000) / fps);
      await source.add(i / fps, 1 / fps);
      o.onProgress?.(((i + 1) / frames) * 0.98);
      if (i % 6 === 5) await tick();
    }
    await output.finalize();
    o.onProgress?.(1);
    const ext = codec === "avc" ? "mp4" : "webm";
    return { blob: new Blob([target.buffer!], { type: ext === "mp4" ? "video/mp4" : "video/webm" }), ext };
  } finally {
    r.dispose();
  }
}

/** GIF has 1-bit transparency: keep the shape's antialiased color, drop faint edge pixels. */
function binarizeAlpha(data: Uint8ClampedArray) {
  for (let p = 3; p < data.length; p += 4) data[p] = data[p]! < 110 ? 0 : 255;
}

/** Looping GIF. Transparent (1-bit alpha) when asked and the artboard has no background. */
export async function renderGif(doc: DocT, spec: AnimationT, o: AnimVideoOptions = {}): Promise<Blob> {
  requireAnimation(spec);
  const size = Math.max(64, Math.min(1200, o.size ?? 480));
  const fps = Math.max(5, Math.min(50, Math.round(o.fps ?? 20)));
  const W = Math.round(size);
  const H = Math.max(1, Math.round((size * doc.artboard.height) / doc.artboard.width));
  const alpha = !!o.transparent && !doc.artboard.background;
  const r = await FrameRenderer.create(doc, spec, W, H, alpha ? null : (doc.artboard.background ?? "#ffffff"));
  try {
    const frames = Math.max(2, Math.round((gifLength(r.plan) / 1000) * fps));
    const delay = Math.round(1000 / fps);
    const format = alpha ? "rgba4444" : "rgb565";
    // One palette for the whole clip (no flicker): sampled from frames across the timeline.
    const probes = [0.15, 0.35, 0.55, 0.75, 1].map((p) => Math.min(frames - 1, Math.round(p * (frames - 1))));
    const pixels: Uint8ClampedArray[] = [];
    for (const i of probes) {
      await r.draw((i * 1000) / fps);
      const data = r.canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
      if (alpha) binarizeAlpha(data);
      pixels.push(data);
    }
    const all = new Uint8ClampedArray(pixels.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of pixels) {
      all.set(p, off);
      off += p.length;
    }
    const palette = quantize(all, 256, alpha ? { format, oneBitAlpha: true, clearAlpha: true } : { format });
    let tIndex = alpha ? palette.findIndex((c) => c[3] === 0) : -1;
    if (alpha && tIndex < 0) {
      palette.length >= 256 ? (palette[palette.length - 1] = [0, 0, 0, 0]) : palette.push([0, 0, 0, 0]);
      tIndex = palette.findIndex((c) => c[3] === 0);
    }
    const gif = GIFEncoder();
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new Error("Cancelled");
      await r.draw((i * 1000) / fps);
      const data = r.canvas.getContext("2d")!.getImageData(0, 0, W, H).data;
      if (alpha) binarizeAlpha(data);
      const index = applyPalette(data, palette, format);
      gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay, repeat: 0, ...(alpha ? { transparent: true, transparentIndex: tIndex, dispose: 2 } : {}) });
      o.onProgress?.(((i + 1) / frames) * 0.98);
      if (i % 4 === 3) await tick();
    }
    gif.finish();
    o.onProgress?.(1);
    return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
  } finally {
    r.dispose();
  }
}

/** A labelled contact sheet of the animation (what the agent sees). */
export async function renderAnimSheet(doc: DocT, spec: AnimationT, times: number[], cell = 256): Promise<{ png: string; width: number; height: number; times: number[]; plan: AnimPlan }> {
  requireAnimation(spec);
  const W = Math.max(96, Math.min(512, Math.round(cell)));
  const H = Math.max(1, Math.round((W * doc.artboard.height) / doc.artboard.width));
  const r = await FrameRenderer.create(doc, spec, W, H, doc.artboard.background ?? "#ffffff");
  try {
    const list = times.slice(0, 16);
    const cols = Math.min(list.length, list.length <= 4 ? list.length : list.length <= 9 ? 3 : 4);
    const rows = Math.ceil(list.length / cols);
    const pad = 12;
    const label = 22;
    const sheet = document.createElement("canvas");
    sheet.width = cols * W + (cols + 1) * pad;
    sheet.height = rows * (H + label) + (rows + 1) * pad;
    const ctx = sheet.getContext("2d")!;
    ctx.fillStyle = "#f4f5f5";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      const x = pad + (i % cols) * (W + pad);
      const y = pad + Math.floor(i / cols) * (H + label + pad);
      await r.draw(t);
      ctx.drawImage(r.canvas, x, y + label);
      ctx.strokeStyle = "#dfe2e3";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + label + 0.5, W - 1, H - 1);
      ctx.fillStyle = "#585f63";
      ctx.font = '600 12px "Geist Variable", Geist, system-ui, sans-serif';
      ctx.textBaseline = "middle";
      const phase = r.plan.loop && t >= r.plan.loop.start ? " · loop" : t >= r.plan.entranceEnd && r.plan.entranceEnd > 0 ? " · end" : "";
      ctx.fillText(`${i + 1}  ${(t / 1000).toFixed(2)} s${phase}`, x + 2, y + label / 2);
    }
    const blob = await canvasToBlob(sheet);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const out = { png: btoa(s), width: sheet.width, height: sheet.height, times: list, plan: r.plan };
    sheet.width = sheet.height = 0;
    return out;
  } finally {
    r.dispose();
  }
}
