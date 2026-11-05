import { create } from "zustand";
import type { PhotoVectorizeOptions, PhotoVectorizeResult, RasterImage, VectorizeOptions, VectorizeResult } from "@brusshy/core";
import { token } from "../lib/socket";
import { refUrl } from "../export/svg";

export type VectorizeTab = "image" | "photo";

/** Which reference image the Vectorize dialog is open for (null = closed), and on which tab. */
export const useVectorize = create<{ refId: string | null; tab: VectorizeTab | null }>(() => ({ refId: null, tab: null }));
/** Open the dialog for a reference image; `tab` forces "image" (sketches, flat art) or "photo" (objects). */
export const openVectorize = (refId: string, tab: VectorizeTab | null = null) => useVectorize.setState({ refId, tab });
export const closeVectorize = () => useVectorize.setState({ refId: null, tab: null });

/** Longest side handed to the tracer (it box-filters further down by detail). */
const MAX_DECODE = 2400;

export interface Decoded {
  image: RasterImage;
  /** Object URL of the original (for the preview underlay). */
  url: string;
}

/** Fetch and decode a reference image to RGBA pixels (locally, in the browser). */
export async function decodeReference(src: string): Promise<Decoded> {
  let blob: Blob;
  if (src.startsWith("data:")) blob = await (await fetch(src)).blob();
  else {
    const res = await fetch(refUrl(src), { headers: token ? { "x-brusshy-token": token } : {} });
    if (!res.ok) throw new Error(`Could not load ${src}`);
    blob = await res.blob();
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const W = img.naturalWidth || 1024;
  const H = img.naturalHeight || 1024;
  const k = Math.min(1, MAX_DECODE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  canvas.width = canvas.height = 0;
  return { image: { width: w, height: h, data }, url };
}

/** What the worker can run: the image tracer, the photo tracer, or small photo thumbnails of every style. */
export type TraceKind = "image" | "photo" | "thumbs";
type Answer = VectorizeResult | PhotoVectorizeResult | PhotoVectorizeResult[];

/** Runs the tracer in a worker; only the latest request is answered. */
export class Tracer {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Answer) => void; reject: (e: Error) => void }>();
  private sent: RasterImage | null = null;

  private ensure() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result?: Answer; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? "Vectorizing failed"));
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "Vectorizer crashed"));
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  run(image: RasterImage, options: VectorizeOptions): Promise<VectorizeResult>;
  run(image: RasterImage, options: PhotoVectorizeOptions, kind: "photo"): Promise<PhotoVectorizeResult>;
  run(image: RasterImage, options: PhotoVectorizeOptions, kind: "thumbs"): Promise<PhotoVectorizeResult[]>;
  run(image: RasterImage, options: VectorizeOptions | PhotoVectorizeOptions, kind: TraceKind = "image"): Promise<Answer> {
    const w = this.ensure();
    const id = ++this.seq;
    // Drop answers to older requests (sliders fire fast).
    for (const [k, p] of this.pending) if (k < id) p.reject(new Error("superseded"));
    for (const k of [...this.pending.keys()]) if (k < id) this.pending.delete(k);
    const msg: { id: number; kind: TraceKind; options: VectorizeOptions | PhotoVectorizeOptions; image?: RasterImage } = { id, kind, options };
    if (this.sent !== image) {
      msg.image = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data as ArrayLike<number>) };
      this.sent = image;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage(msg);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.sent = null;
  }
}
