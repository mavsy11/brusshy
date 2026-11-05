import svgpath from "svgpath";
import { apply, decompose, invert, multiply, transformMatrix, type DocT, type NodeT, type TransformT } from "@brusshy/core";
import { localBBox, parentMatrix, type Pt } from "./geom";

/** Pure functions that turn a gesture into a node patch (used live while dragging, then committed as an op). */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Convert a world-space delta into the node's parent space. */
export function worldDeltaToParent(doc: DocT, n: NodeT, dx: number, dy: number): Pt {
  const inv = invert(parentMatrix(doc, n));
  return [inv[0] * dx + inv[2] * dy, inv[1] * dx + inv[3] * dy];
}

export function movePatch(doc: DocT, n: NodeT, dx: number, dy: number): Partial<NodeT> {
  const [px, py] = worldDeltaToParent(doc, n, dx, dy);
  return { transform: { ...n.transform, x: r3(n.transform.x + px), y: r3(n.transform.y + py) } };
}

export interface ResizeHandle {
  /** Handle position as fractions of the local bbox: 0, 0.5 or 1. */
  u: number;
  v: number;
}

/**
 * Resize by dragging a handle to `world`. Geometry is rebuilt (paths re-drawn,
 * shapes resized) rather than scaled, so strokes and radii stay crisp.
 */
export function resizePatch(
  doc: DocT,
  n: NodeT,
  h: ResizeHandle,
  world: Pt,
  opts: { keepRatio?: boolean; fromCenter?: boolean },
): Partial<NodeT> {
  const b = localBBox(doc, n);
  if (b.w === 0 && b.h === 0) return {};
  const local = multiply(parentMatrix(doc, n), transformMatrix(n.transform));
  const p = apply(invert(local), world[0], world[1]);
  const au = opts.fromCenter ? 0.5 : 1 - h.u;
  const av = opts.fromCenter ? 0.5 : 1 - h.v;
  const A: Pt = [b.x + au * b.w, b.y + av * b.h];
  const H: Pt = [b.x + h.u * b.w, b.y + h.v * b.h];
  const minF = (size: number) => (size > 0 ? 1 / size : 1);
  let fx = h.u === 0.5 || H[0] === A[0] ? 1 : (p[0] - A[0]) / (H[0] - A[0]);
  let fy = h.v === 0.5 || H[1] === A[1] ? 1 : (p[1] - A[1]) / (H[1] - A[1]);
  const uniform = opts.keepRatio || n.type === "text";
  if (uniform) {
    const f = h.u === 0.5 ? fy : h.v === 0.5 ? fx : Math.abs(fx) > Math.abs(fy) ? fx : fy;
    fx = fy = f;
  }
  fx = Math.max(fx, minF(b.w));
  fy = Math.max(fy, minF(b.h));
  return scalePatch(n, A, fx, fy);
}

/** Scale a node's geometry about local point A by (fx, fy). */
export function scalePatch(n: NodeT, A: Pt, fx: number, fy: number): Partial<NodeT> {
  const t = n.transform;
  // Shifting the local origin to A·(1-f) keeps A fixed for origin-based geometry.
  const shiftedOrigin = (): TransformT => {
    const o = apply(transformMatrix(t), A[0] * (1 - fx), A[1] * (1 - fy));
    return { ...t, x: r3(o[0]), y: r3(o[1]) };
  };
  switch (n.type) {
    case "frame":
      // Frames are resized from the panel (W/H) so their content never scales.
      return {};
    case "path":
      return { d: svgpath(n.d).translate(-A[0], -A[1]).scale(fx, fy).translate(A[0], A[1]).round(2).toString() };
    case "sketch":
      return {
        strokes: n.strokes.map((s) => ({
          ...s,
          points: s.points.map(([x, y, pr]) => [r3(A[0] + (x - A[0]) * fx), r3(A[1] + (y - A[1]) * fy), pr] as [number, number, number]),
        })),
      };
    case "shape":
    case "reference":
      return { width: r3(n.width * fx), height: r3(n.height * fy), transform: shiftedOrigin() };
    case "text":
      return { fontSize: r3(n.fontSize * fy), letterSpacing: r3(n.letterSpacing * fy), transform: shiftedOrigin() };
    case "group": {
      const next = { ...t, scaleX: r3(t.scaleX * fx), scaleY: r3(t.scaleY * fy) };
      const before = apply(transformMatrix(t), A[0], A[1]);
      const after = apply(transformMatrix({ ...next, x: 0, y: 0 }), A[0], A[1]);
      return { transform: { ...next, x: r3(before[0] - after[0]), y: r3(before[1] - after[1]) } };
    }
  }
}

/** Rotate around the bbox center to an absolute rotation (degrees). */
export function rotatePatch(doc: DocT, n: NodeT, rotation: number): Partial<NodeT> {
  const b = localBBox(doc, n);
  const C: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  const t = n.transform;
  const before = apply(transformMatrix(t), C[0], C[1]);
  const next = { ...t, rotation: r3(((rotation % 360) + 540) % 360 - 180) };
  const after = apply(transformMatrix({ ...next, x: 0, y: 0 }), C[0], C[1]);
  return { transform: { ...next, x: r3(before[0] - after[0]), y: r3(before[1] - after[1]) } };
}

/** Bbox center of a node in world space. */
export function worldCenter(doc: DocT, n: NodeT): Pt {
  const b = localBBox(doc, n);
  const m = multiply(parentMatrix(doc, n), transformMatrix(n.transform));
  return apply(m, b.x + b.w / 2, b.y + b.h / 2);
}

/** Flip horizontally/vertically about the bbox center. */
export function flipPatch(doc: DocT, n: NodeT, axis: "x" | "y"): Partial<NodeT> {
  const b = localBBox(doc, n);
  const C: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  const fx = axis === "x" ? -1 : 1;
  const fy = axis === "y" ? -1 : 1;
  if (n.type === "path") return { d: svgpath(n.d).translate(-C[0], -C[1]).scale(fx, fy).translate(C[0], C[1]).round(2).toString() };
  if (n.type === "sketch") return scalePatch(n, C, fx, fy);
  const t = n.transform;
  const next = { ...t, scaleX: t.scaleX * fx, scaleY: t.scaleY * fy };
  const before = apply(transformMatrix(t), C[0], C[1]);
  const after = apply(transformMatrix({ ...next, x: 0, y: 0 }), C[0], C[1]);
  return { transform: { ...next, x: r3(before[0] - after[0]), y: r3(before[1] - after[1]) } };
}

/** Rotate a node about a world-space pivot (used to rotate several layers as one). */
export function rotateAboutPatch(doc: DocT, n: NodeT, pivot: Pt, degrees: number): Partial<NodeT> {
  const pm = parentMatrix(doc, n);
  const a = (degrees * Math.PI) / 180;
  const R = multiply(multiply([1, 0, 0, 1, pivot[0], pivot[1]], [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]), [1, 0, 0, 1, -pivot[0], -pivot[1]]);
  const local = multiply(invert(pm), multiply(R, multiply(pm, transformMatrix(n.transform))));
  return { transform: decompose(local) };
}

/** Uniformly scale a node about a world-space anchor, rebuilding geometry so strokes stay crisp. */
export function scaleAboutPatch(doc: DocT, n: NodeT, anchor: Pt, k: number): Partial<NodeT> {
  const local = multiply(parentMatrix(doc, n), transformMatrix(n.transform));
  const A = apply(invert(local), anchor[0], anchor[1]);
  return scalePatch(n, A, k, k);
}
