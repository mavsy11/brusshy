import { useStore, type Camera } from "../lib/store";
import { MAX_ZOOM, MIN_ZOOM, getViewport } from "./camera";

/**
 * Smooth camera moves for deliberate jumps (fit, zoom buttons, picking a version).
 * Zoom is interpolated in log space around the point at the viewport centre so the
 * move reads as one glide instead of a swoop. Any other camera change (wheel, pan,
 * drag) cancels the glide on the next frame. Honors prefers-reduced-motion.
 */

const DURATION = 300;

let raf = 0;
let target: Camera | null = null;
let lastSet: Camera | null = null;

const reduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** easeOutQuart: quick start, soft landing (close to the UI's cubic-bezier(.32,.72,0,1)). */
const ease = (t: number) => 1 - (1 - t) ** 4;

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  target = null;
  lastSet = null;
}

export function animateCamera(to: Camera, ms = DURATION) {
  const from = useStore.getState().camera;
  stop();
  const same = Math.abs(from.zoom - to.zoom) < 1e-4 && Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5;
  if (same || ms <= 0 || reduced()) {
    useStore.setState({ camera: to });
    return;
  }
  const { w, h } = getViewport();
  const cx = w / 2;
  const cy = h / 2;
  // World point under the viewport centre, before and after.
  const a = [(cx - from.x) / from.zoom, (cy - from.y) / from.zoom];
  const b = [(cx - to.x) / to.zoom, (cy - to.y) / to.zoom];
  const lz0 = Math.log(from.zoom);
  const lz1 = Math.log(to.zoom);
  const t0 = performance.now();
  target = to;
  const step = (now: number) => {
    // Someone else moved the camera (wheel, pan, a fit without animation): let them win.
    if (lastSet && useStore.getState().camera !== lastSet) return stop();
    // rAF timestamps can predate t0 (they mark the frame start): clamp so the glide never overshoots backwards.
    const t = Math.min(1, Math.max(0, (now - t0) / ms));
    const k = ease(t);
    let cam: Camera;
    if (t >= 1) cam = to;
    else {
      const zoom = Math.exp(lz0 + (lz1 - lz0) * k);
      const wx = a[0]! + (b[0]! - a[0]!) * k;
      const wy = a[1]! + (b[1]! - a[1]!) * k;
      cam = { zoom, x: cx - wx * zoom, y: cy - wy * zoom };
    }
    lastSet = cam;
    useStore.setState({ camera: cam });
    if (t < 1) raf = requestAnimationFrame(step);
    else stop();
  };
  raf = requestAnimationFrame(step);
}

/** Zoom about the viewport centre, animated. Repeated presses build on the glide's target. */
export function zoomToAnimated(zoom: number) {
  const base = target ?? useStore.getState().camera;
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const { w, h } = getViewport();
  const k = z / base.zoom;
  const sx = w / 2;
  const sy = h / 2;
  animateCamera({ zoom: z, x: sx - (sx - base.x) * k, y: sy - (sy - base.y) * k });
}

/** The zoom the camera is heading to (for relative steps like +/−). */
export const targetZoom = () => (target ?? useStore.getState().camera).zoom;
