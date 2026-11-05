import type { DocT, ExportParams, RenderParams, RenderResponse } from "@brusshy/core";
import { frameDocFor } from "../lib/store";
import { exportAnimatedSvg, frameAnimation, renderAnimSheet, renderAnimVideo, renderGif } from "./engine";
import { slug } from "../export/util";

/** Logo-animation exports plugged into the export pipeline (formats anim-svg, anim-video, gif). */

export type AnimFormat = "anim-svg" | "anim-video" | "gif";
export const ANIM_FORMATS: AnimFormat[] = ["anim-svg", "anim-video", "gif"];
export const isAnimFormat = (f: string): f is AnimFormat => (ANIM_FORMATS as string[]).includes(f);

export const ANIM_LABELS: Record<AnimFormat, string> = {
  "anim-svg": "Animated SVG",
  "anim-video": "Animation video",
  gif: "Animated GIF",
};

export function animDetail(f: AnimFormat, o: ExportParams): string {
  const a = o.anim ?? {};
  switch (f) {
    case "anim-svg":
      return "CSS keyframes · self-contained";
    case "anim-video":
      return `${a.size ?? 1080} px · ${a.transparent ? "WebM with alpha" : "MP4"}`;
    case "gif":
      return `${a.gifSize ?? 480} px${a.transparent ? " · transparent" : ""}`;
  }
}

/** Run one animation export for a projected version (`o.frame` picks the spec; default the active version). */
export async function exportAnimation(doc: DocT, f: AnimFormat, o: ExportParams, onProgress: (p: number) => void): Promise<{ name: string; blob: Blob }[]> {
  const spec = frameAnimation(o.frame);
  const base = slug(doc.name);
  const a = o.anim ?? {};
  switch (f) {
    case "anim-svg":
      return [{ name: `${base}-animated.svg`, blob: await exportAnimatedSvg(doc, spec) }];
    case "anim-video": {
      const r = await renderAnimVideo(doc, spec, { size: a.size, fps: a.fps, transparent: a.transparent, onProgress });
      return [{ name: `${base}-animation.${r.ext}`, blob: r.blob }];
    }
    case "gif":
      return [{ name: `${base}-animation.gif`, blob: await renderGif(doc, spec, { size: a.gifSize, fps: a.fps, transparent: a.transparent, onProgress }) }];
  }
}

/** The agent's animation preview: a contact sheet of frames across the timeline (render request with animTimes). */
export async function renderAnimationRequest(p: RenderParams): Promise<RenderResponse> {
  const doc = frameDocFor(p.frame);
  if (!doc) throw new Error("No document is open in the studio");
  const spec = frameAnimation(p.frame);
  const { png, width, height } = await renderAnimSheet(doc, spec, p.animTimes ?? [0], p.width ?? 256);
  return { png, width, height };
}
