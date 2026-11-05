import type { Anchor, P, SubPath } from "./pathmodel";
import { parsePath, serializePath, splitSegment } from "./pathmodel";

/** Whole-shape and multi-node deformations on the editable path model (local coordinates). */

const rot = (q: P, c: P, a: number): P => {
  const s = Math.sin(a);
  const k = Math.cos(a);
  const x = q[0] - c[0];
  const y = q[1] - c[1];
  return [c[0] + x * k - y * s, c[1] + x * s + y * k];
};

const mapAnchor = (a: Anchor, f: (q: P) => P): Anchor => ({ p: f(a.p), cin: a.cin && f(a.cin), cout: a.cout && f(a.cout) });

export function allPoints(subs: SubPath[]): P[] {
  return subs.flatMap((s) => s.anchors.flatMap((a) => [a.p, ...(a.cin ? [a.cin] : []), ...(a.cout ? [a.cout] : [])]));
}

export function bounds(pts: P[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export type PivotKind = "center" | "bottom" | "top" | "left" | "right";

/** A pivot point on the shape's bounds. */
export function pivotOf(subs: SubPath[], kind: PivotKind): P {
  const b = bounds(subs.flatMap((s) => s.anchors.map((a) => a.p)));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (kind === "bottom") return [cx, b.y + b.h];
  if (kind === "top") return [cx, b.y];
  if (kind === "left") return [b.x, cy];
  if (kind === "right") return [b.x + b.w, cy];
  return [cx, cy];
}

/** Split every segment in two so warps follow the shape smoothly. */
export function subdivide(subs: SubPath[]): SubPath[] {
  return subs.map((s) => {
    let out = s;
    const n = s.anchors.length;
    const segs = s.closed ? n : n - 1;
    // Split from the last segment backwards so earlier indices stay valid.
    for (let i = segs - 1; i >= 0; i--) out = splitSegment(out, i, 0.5);
    return out;
  });
}

/**
 * Twist/bend around a pivot: each point rotates by `degrees · (distance / reach)^exponent`.
 * exponent 1 = even twist; 2 = bend (the far end curls the most, like a leaf tip).
 */
export function twist(subs: SubPath[], pivot: P, degrees: number, exponent = 1): SubPath[] {
  const pts = allPoints(subs);
  const reach = Math.max(1, ...pts.map((q) => Math.hypot(q[0] - pivot[0], q[1] - pivot[1])));
  const a = (degrees * Math.PI) / 180;
  const f = (q: P): P => rot(q, pivot, a * Math.pow(Math.hypot(q[0] - pivot[0], q[1] - pivot[1]) / reach, exponent));
  return subs.map((s) => ({ ...s, anchors: s.anchors.map((x) => mapAnchor(x, f)) }));
}

/** Weight of any point (anchor or handle) in a soft edit: 1 on the selection, fading smoothly to 0 at `radius`. */
export type Field = (q: P, anchorKey: string) => number;

export function softField(subs: SubPath[], selected: Set<string>, radius: number | null): Field {
  const sel: P[] = [];
  subs.forEach((s, si) => s.anchors.forEach((a, ai) => selected.has(`${si}:${ai}`) && sel.push(a.p)));
  return (q, key) => {
    if (selected.has(key)) return 1;
    if (!radius || !sel.length) return 0;
    // Each point (handles too) is weighted by where it is, so neighbouring curves bend smoothly.
    const d = Math.min(...sel.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    if (d >= radius) return 0;
    const t = 1 - d / radius;
    return t * t * (3 - 2 * t);
  };
}

/** Apply a per-point transform weighted by a soft-selection field (anchors and handles each get their own weight). */
export function applyField(subs: SubPath[], field: Field, f: (q: P, w: number) => P): SubPath[] {
  return subs.map((s, si) => ({
    ...s,
    anchors: s.anchors.map((a, ai) => {
      const k = `${si}:${ai}`;
      const one = (q: P | null) => {
        if (!q) return null;
        const w = field(q, k);
        return w ? f(q, w) : q;
      };
      return { p: one(a.p)!, cin: one(a.cin), cout: one(a.cout) };
    }),
  }));
}

/** Rotate and/or scale selected nodes about a pivot, softly if the field reaches beyond the selection. */
export function transformNodes(subs: SubPath[], field: Field, pivot: P, degrees: number, scale = 1): SubPath[] {
  const a = (degrees * Math.PI) / 180;
  return applyField(subs, field, (q, w) => {
    const r = rot(q, pivot, a * w);
    const sc = 1 + (scale - 1) * w;
    return [pivot[0] + (r[0] - pivot[0]) * sc, pivot[1] + (r[1] - pivot[1]) * sc];
  });
}

/** Move selected nodes by (dx, dy), softly. */
export function moveNodes(subs: SubPath[], field: Field, dx: number, dy: number): SubPath[] {
  return applyField(subs, field, (q, w) => [q[0] + dx * w, q[1] + dy * w]);
}

/** Catmull-Rom smoothing: give the chosen anchors (all if none) tangent handles through their neighbors. */
export function smoothNodes(subs: SubPath[], only?: Set<string>, tension = 1): SubPath[] {
  return subs.map((s, si) => {
    const n = s.anchors.length;
    return {
      ...s,
      anchors: s.anchors.map((a, ai) => {
        if (only && only.size && !only.has(`${si}:${ai}`)) return a;
        const hasPrev = s.closed || ai > 0;
        const hasNext = s.closed || ai < n - 1;
        if (!hasPrev && !hasNext) return a;
        const prev = s.anchors[(ai - 1 + n) % n]!.p;
        const next = s.anchors[(ai + 1) % n]!.p;
        const p0 = hasPrev ? prev : a.p;
        const p2 = hasNext ? next : a.p;
        const t: P = [((p2[0] - p0[0]) / 6) * tension, ((p2[1] - p0[1]) / 6) * tension];
        return { p: a.p, cin: hasPrev ? [a.p[0] - t[0], a.p[1] - t[1]] : null, cout: hasNext ? [a.p[0] + t[0], a.p[1] + t[1]] : null };
      }),
    };
  });
}

/** Turn the chosen anchors (all if none) into sharp corners. */
export function cornerNodes(subs: SubPath[], only?: Set<string>): SubPath[] {
  return subs.map((s, si) => ({
    ...s,
    anchors: s.anchors.map((a, ai) => (only && only.size && !only.has(`${si}:${ai}`) ? a : { p: a.p, cin: null, cout: null })),
  }));
}

/** Bend (curl, strongest at the far end) or twist (even) path data about a pivot on its bounds. */
export function deformPathData(d: string, kind: "bend" | "twist", degrees: number, pivot: PivotKind = "bottom"): string {
  let subs = parsePath(d);
  // Few nodes can't follow a smooth curl: add in-between nodes first (up to 3 rounds).
  for (let i = 0; i < 3 && subs.reduce((a, s) => a + s.anchors.length, 0) < 16; i++) subs = subdivide(subs);
  return serializePath(twist(subs, pivotOf(subs, pivot), degrees, kind === "bend" ? 2 : 1));
}
