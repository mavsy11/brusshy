import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeVideo,
} from "mediabunny";
import type { DocT } from "@brusshy/core";
import { canvasToBlob, exclusive, prepare, renderFrame } from "./offscreen";

/** Public API of the 3D module, used by export and by the daemon's render requests. */

export interface Render3DOptions {
  width: number;
  /** Defaults to width × artboard aspect. */
  height?: number;
  /** Transparent background (ignores doc.scene.background). */
  transparent?: boolean;
  /** Camera override in degrees; defaults to doc.scene.camera. */
  azimuth?: number;
  elevation?: number;
}

const MAX = 4096;
const clampPx = (n: number) => Math.max(16, Math.min(MAX, Math.round(n)));

/** Output size for a doc + requested width/height (height follows the artboard aspect). */
export function render3DSize(doc: DocT, width: number, height?: number): { width: number; height: number } {
  const w = clampPx(width);
  const h = clampPx(height ?? (w * doc.artboard.height) / doc.artboard.width);
  return { width: w, height: h };
}

/** PNG render of the document's 3D scene (offscreen; up to 4096 px, supersampled/tiled). */
export async function render3D(doc: DocT, o: Render3DOptions): Promise<Blob> {
  return exclusive(async () => {
    const { width, height } = render3DSize(doc, o.width, o.height);
    await prepare(doc);
    const canvas = renderFrame({
      width,
      height,
      transparent: !!o.transparent,
      azimuth: o.azimuth ?? doc.scene.camera.azimuth,
      elevation: o.elevation ?? doc.scene.camera.elevation,
    });
    return canvasToBlob(canvas);
  });
}

/** Binary glTF of the extruded logo with its PBR materials (y-up, logo ~2 units wide). */
export async function exportGLB(doc: DocT): Promise<Blob> {
  return exclusive(async () => {
    const { stage } = await prepare(doc);
    const root = new THREE.Scene();
    root.name = doc.name || "logo";
    const logo = stage.logoRoot.clone(true);
    logo.name = "logo";
    root.add(logo);
    // Weld the smooth-shaded triangle soup into indexed meshes (several times smaller files).
    const welded: THREE.BufferGeometry[] = [];
    logo.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = mergeVertices(m.geometry, 1e-4);
      welded.push(g);
      m.geometry = g;
    });
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
    welded.forEach((g) => g.dispose());
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB export failed");
    return new Blob([result], { type: "model/gltf-binary" });
  });
}

export interface VideoOptions {
  seconds?: number;
  fps?: number;
  size?: number;
  motion?: "turntable" | "float";
  onProgress?: (p: number) => void;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Logo pose at loop phase t ∈ [0, 1) — both motions loop seamlessly. */
function poseAt(motion: "turntable" | "float", t: number): [number, number, number] {
  const a = t * Math.PI * 2;
  if (motion === "turntable") return [a, 0, 0];
  return [Math.sin(a) * 0.42, Math.sin(a * 2) * 0.045, Math.sin(a) * 0.035];
}

/** Turntable / float loop. MP4 (H.264 via WebCodecs + mediabunny); WebM fallback. */
export async function renderVideo(doc: DocT, o: VideoOptions): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  return exclusive(async () => {
    const seconds = Math.max(1, Math.min(30, o.seconds ?? 6));
    const fps = Math.max(12, Math.min(60, Math.round(o.fps ?? 30)));
    const size = Math.max(256, Math.min(2160, o.size ?? 1080));
    const motion = o.motion ?? "turntable";
    const W = even(size);
    const H = even((size * doc.artboard.height) / doc.artboard.width);
    // Video has no alpha: fall back to the paper color for transparent docs.
    const { stage } = await prepare(doc, { background: doc.scene.background ?? "#f4f5f5" });
    const frames = Math.round(seconds * fps);
    const cam = doc.scene.camera;
    const frame = document.createElement("canvas");
    const ss = Math.max(W, H) * 2 <= 2048 ? 2 : 1;
    const draw = (i: number) => {
      const [ry, bob, tilt] = poseAt(motion, i / frames);
      stage.setPose(ry, bob, tilt);
      renderFrame({ width: W, height: H, transparent: false, azimuth: cam.azimuth, elevation: cam.elevation, ss }, frame);
    };
    const progress = (p: number) => o.onProgress?.(Math.min(1, Math.max(0, p)));

    try {
      draw(0);
      const hasWebCodecs = typeof VideoEncoder !== "undefined";
      const codec = hasWebCodecs
        ? (await canEncodeVideo("avc", { width: W, height: H, quality: QUALITY_HIGH }))
          ? "avc"
          : (await canEncodeVideo("vp9", { width: W, height: H, quality: QUALITY_HIGH }))
            ? "vp9"
            : null
        : null;

      if (codec) {
        const target = new BufferTarget();
        const output = new Output({
          format: codec === "avc" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
          target,
        });
        const source = new CanvasSource(frame, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
        output.addVideoTrack(source, { frameRate: fps });
        await output.start();
        for (let i = 0; i < frames; i++) {
          if (i > 0) draw(i);
          await source.add(i / fps, 1 / fps);
          progress((i + 1) / frames * 0.98);
          if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
        }
        await output.finalize();
        progress(1);
        const ext = codec === "avc" ? "mp4" : "webm";
        return { blob: new Blob([target.buffer!], { type: ext === "mp4" ? "video/mp4" : "video/webm" }), ext };
      }

      // Fallback: MediaRecorder (real-time capture).
      const blob = await recordWithMediaRecorder(frame, frames, fps, draw, progress);
      return { blob, ext: "webm" };
    } finally {
      stage.setPose(0, 0, 0);
    }
  });
}

async function recordWithMediaRecorder(
  canvas: HTMLCanvasElement,
  frames: number,
  fps: number,
  draw: (i: number) => void,
  progress: (p: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("Video export isn't supported in this browser");
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start();
  const start = performance.now();
  for (let i = 0; i < frames; i++) {
    draw(i);
    track.requestFrame();
    progress((i + 1) / frames);
    const due = start + ((i + 1) * 1000) / fps;
    await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
  }
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: "video/webm" });
}
