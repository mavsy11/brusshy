import type { DocT, NodeT, ShapeNodeT, TransformT } from "./schema";

/** 2D affine matrix [a, b, c, d, e, f] as in SVG's matrix(). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** translate(x y) rotate(r) scale(sx sy) — rotation is around the node's local origin. */
export function transformMatrix(t: TransformT): Mat {
  const r = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * t.scaleX, sin * t.scaleX, -sin * t.scaleY, cos * t.scaleY, t.x, t.y];
}

export function transformAttr(t: TransformT): string | undefined {
  const parts: string[] = [];
  if (t.x || t.y) parts.push(`translate(${fmt(t.x)} ${fmt(t.y)})`);
  if (t.rotation) parts.push(`rotate(${fmt(t.rotation)})`);
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${fmt(t.scaleX)} ${fmt(t.scaleY)})`);
  return parts.length ? parts.join(" ") : undefined;
}

/** Matrix from a node's local space to artboard space (includes all ancestor groups). */
export function worldMatrix(doc: DocT, id: string): Mat {
  const chain: NodeT[] = [];
  let cur: NodeT | undefined = doc.nodes[id];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  return chain.reduce<Mat>((m, n) => multiply(m, transformMatrix(n.transform)), IDENTITY);
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** Polygon with each corner rounded by a quadratic curve of radius r (clamped to half the edge). */
export function roundedPolygonPath(points: [number, number][], r: number): string {
  if (r <= 0) return "M" + points.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join("L") + "Z";
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const p = points[i]!;
    const next = points[(i + 1) % n]!;
    const d1 = Math.hypot(prev[0] - p[0], prev[1] - p[1]);
    const d2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a: [number, number] = [p[0] + ((prev[0] - p[0]) / d1) * rr, p[1] + ((prev[1] - p[1]) / d1) * rr];
    const b: [number, number] = [p[0] + ((next[0] - p[0]) / d2) * rr, p[1] + ((next[1] - p[1]) / d2) * rr];
    d += `${i === 0 ? "M" : "L"}${fmt(a[0])} ${fmt(a[1])}Q${fmt(p[0])} ${fmt(p[1])} ${fmt(b[0])} ${fmt(b[1])}`;
  }
  return d + "Z";
}

export function shapePoints(s: Pick<ShapeNodeT, "shape" | "width" | "height" | "sides" | "innerRatio">): [number, number][] {
  const cx = s.width / 2;
  const cy = s.height / 2;
  const pts: [number, number][] = [];
  if (s.shape === "polygon") {
    for (let i = 0; i < s.sides; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / s.sides;
      pts.push([cx + Math.cos(a) * cx, cy + Math.sin(a) * cy]);
    }
  } else if (s.shape === "star") {
    for (let i = 0; i < s.sides * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / s.sides;
      const k = i % 2 === 0 ? 1 : s.innerRatio;
      pts.push([cx + Math.cos(a) * cx * k, cy + Math.sin(a) * cy * k]);
    }
  }
  return pts;
}

/** Shape nodes as path data in local coordinates (origin = top-left of the shape box). */
export function shapeToPath(s: Pick<ShapeNodeT, "shape" | "width" | "height" | "radius" | "sides" | "innerRatio">): string {
  const w = s.width;
  const h = s.height;
  if (s.shape === "rect") {
    const r = Math.min(s.radius, w / 2, h / 2);
    if (r <= 0) return `M0 0H${fmt(w)}V${fmt(h)}H0Z`;
    return (
      `M${fmt(r)} 0H${fmt(w - r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(w)} ${fmt(r)}` +
      `V${fmt(h - r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(w - r)} ${fmt(h)}` +
      `H${fmt(r)}A${fmt(r)} ${fmt(r)} 0 0 1 0 ${fmt(h - r)}` +
      `V${fmt(r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(r)} 0Z`
    );
  }
  if (s.shape === "ellipse") {
    const rx = w / 2;
    const ry = h / 2;
    return (
      `M0 ${fmt(ry)}A${fmt(rx)} ${fmt(ry)} 0 1 1 ${fmt(w)} ${fmt(ry)}` +
      `A${fmt(rx)} ${fmt(ry)} 0 1 1 0 ${fmt(ry)}Z`
    );
  }
  return roundedPolygonPath(shapePoints(s), s.radius);
}
