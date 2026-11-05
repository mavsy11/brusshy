import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GradientT, StyleT } from "@brusshy/core";

/**
 * SVG path data → extruded, bevelled, smooth-shaded geometry.
 *
 * Paths are parsed in the node's local space, sampled into polylines with an
 * adaptive step, transformed by the linear part of the node's world matrix
 * (with the artboard's y-down flipped to three's y-up) and extruded. The
 * translation part of the matrix is applied as the mesh position so dragging a
 * node never rebuilds its geometry.
 */

/** Linear part of a 2D affine matrix: [a, b, c, d]. */
export type Linear = [number, number, number, number];

export interface GeoSpec {
  kind: "fill" | "stroke";
  d: string;
  fillRule: StyleT["fillRule"];
  linear: Linear;
  /** Extrusion depth / bevel radius in artboard units. */
  depth: number;
  bevel: number;
  bevelSegments: number;
  /** Target polyline segment length in artboard units. */
  step: number;
  stroke?: { width: number; cap: StyleT["strokeLinecap"]; join: StyleT["strokeLinejoin"] };
  /** Gradient baked into vertex colors (tinted materials only). */
  gradient?: GradientT | null;
}

export function specKey(s: GeoSpec): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return [
    s.kind,
    s.fillRule,
    s.linear.map(r).join(","),
    r(s.depth),
    r(s.bevel),
    s.bevelSegments,
    r(s.step),
    s.stroke ? `${r(s.stroke.width)}/${s.stroke.cap}/${s.stroke.join}` : "",
    s.gradient ? JSON.stringify(s.gradient) : "",
    s.d,
  ].join("|");
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const loader = new SVGLoader();

function parsePath(d: string, fillRule: string): THREE.ShapePath[] {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${escAttr(d)}" fill="#000" fill-rule="${fillRule}"/></svg>`;
  try {
    return loader.parse(svg).paths;
  } catch {
    return [];
  }
}

const tmpA = new THREE.Vector2();
const tmpB = new THREE.Vector2();

/** Sample a list of curves into a polyline. Lines keep their corners; curves get length/curvature-adaptive steps. */
function sampleCurves(curves: THREE.Curve<THREE.Vector2>[], step: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const c of curves) {
    let n = 1;
    const isLine = (c as { isLineCurve?: boolean }).isLineCurve;
    if (!isLine) {
      c.arcLengthDivisions = 24;
      const len = c.getLength();
      let turn = 0;
      let prev: THREE.Vector2 | null = null;
      for (let i = 0; i <= 8; i++) {
        const p0 = c.getPoint(Math.max(0, i / 8 - 0.01), tmpA);
        const p1 = c.getPoint(Math.min(1, i / 8 + 0.01), tmpB);
        const t = p1.clone().sub(p0);
        if (t.lengthSq() < 1e-12) continue;
        t.normalize();
        if (prev) turn += Math.acos(clamp(prev.dot(t), -1, 1));
        prev = t;
      }
      n = clamp(Math.ceil(Math.max(len / step, turn / (4.5 * DEG))), 2, 160);
    }
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push(c.getPoint(i / n));
  }
  // Drop consecutive duplicates (and a closing duplicate).
  const eps = step * 1e-3;
  const clean: THREE.Vector2[] = [];
  for (const p of out) {
    const last = clean[clean.length - 1];
    if (!last || last.distanceTo(p) > eps) clean.push(p);
  }
  if (clean.length > 2 && clean[0]!.distanceTo(clean[clean.length - 1]!) <= eps) clean.pop();
  return clean;
}

function applyLinear(pts: THREE.Vector2[], m: Linear): THREE.Vector2[] {
  const [a, b, c, d] = m;
  // Artboard y points down; three's y points up.
  return pts.map((p) => new THREE.Vector2(a * p.x + c * p.y, -(b * p.x + d * p.y)));
}

const perimeter = (pts: THREE.Vector2[]) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += pts[i]!.distanceTo(pts[(i + 1) % pts.length]!);
  return s;
};

interface Contour {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

// ---------------------------------------------------------------- strokes

const perp = (v: THREE.Vector2) => new THREE.Vector2(-v.y, v.x);

/** Offset one side of a polyline (side +1 = left normal, -1 = right). */
function offsetSide(
  pts: THREE.Vector2[],
  closed: boolean,
  hw: number,
  side: 1 | -1,
  join: StyleT["strokeLinejoin"],
): THREE.Vector2[] {
  const n = pts.length;
  const out: THREE.Vector2[] = [];
  const dir = (i: number, j: number) => pts[j]!.clone().sub(pts[i]!).normalize();
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const p = pts[i]!;
    const d0 = hasPrev ? dir((i - 1 + n) % n, i) : null;
    const d1 = hasNext ? dir(i, (i + 1) % n) : null;
    if (!d0 || !d1) {
      const d = (d0 ?? d1)!;
      out.push(p.clone().addScaledVector(perp(d), hw * side));
      continue;
    }
    const n0 = perp(d0);
    const n1 = perp(d1);
    const m = n0.clone().add(n1);
    const ml = m.length();
    const cosHalf = ml / 2;
    if (ml < 1e-6) {
      // 180° turn: cap-like.
      out.push(p.clone().addScaledVector(n0, hw * side), p.clone().addScaledVector(n1, hw * side));
      continue;
    }
    m.divideScalar(ml);
    const miter = 1 / Math.max(cosHalf, 1e-4);
    const cross = d0.x * d1.y - d0.y * d1.x;
    const outerSide = side * cross < 0;
    const limit = join === "miter" ? 4 : 1.02;
    if (miter <= limit) {
      out.push(p.clone().addScaledVector(m, hw * miter * side));
    } else if (!outerSide) {
      const segMin = Math.min(pts[(i - 1 + n) % n]!.distanceTo(p), pts[(i + 1) % n]!.distanceTo(p));
      const len = Math.min(hw * miter, Math.sqrt(hw * hw + segMin * segMin));
      out.push(p.clone().addScaledVector(m, len * side));
    } else if (join === "round") {
      const a0 = Math.atan2(n0.y * side, n0.x * side);
      let a1 = Math.atan2(n1.y * side, n1.x * side);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      a1 = a0 + da;
      const steps = Math.max(2, Math.ceil(Math.abs(da) / (12 * DEG)));
      for (let k = 0; k <= steps; k++) {
        const a = a0 + (da * k) / steps;
        out.push(new THREE.Vector2(p.x + Math.cos(a) * hw, p.y + Math.sin(a) * hw));
      }
    } else {
      out.push(p.clone().addScaledVector(n0, hw * side), p.clone().addScaledVector(n1, hw * side));
    }
  }
  return out;
}

function capPoints(p: THREE.Vector2, d: THREE.Vector2, hw: number, cap: StyleT["strokeLinecap"]): THREE.Vector2[] {
  // From the left offset around the tip (direction d) to the right offset.
  const nrm = perp(d);
  if (cap === "butt") return [];
  if (cap === "square") {
    return [
      p.clone().addScaledVector(nrm, hw).addScaledVector(d, hw),
      p.clone().addScaledVector(nrm, -hw).addScaledVector(d, hw),
    ];
  }
  const a0 = Math.atan2(nrm.y, nrm.x);
  const steps = 14;
  const pts: THREE.Vector2[] = [];
  for (let k = 1; k < steps; k++) {
    const a = a0 - (Math.PI * k) / steps;
    pts.push(new THREE.Vector2(p.x + Math.cos(a) * hw, p.y + Math.sin(a) * hw));
  }
  return pts;
}

/** Turn a stroked polyline into closed fill contours (local space). */
function strokeContours(
  pts: THREE.Vector2[],
  closed: boolean,
  width: number,
  cap: StyleT["strokeLinecap"],
  join: StyleT["strokeLinejoin"],
): Contour[] {
  const hw = width / 2;
  if (pts.length < 2) return [];
  if (closed && pts.length >= 3) {
    const a = offsetSide(pts, true, hw, 1, join);
    const b = offsetSide(pts, true, hw, -1, join);
    const [outer, inner] = Math.abs(THREE.ShapeUtils.area(a)) >= Math.abs(THREE.ShapeUtils.area(b)) ? [a, b] : [b, a];
    return [{ outer, holes: [inner] }];
  }
  const left = offsetSide(pts, false, hw, 1, join);
  const right = offsetSide(pts, false, hw, -1, join).reverse();
  const n = pts.length;
  const dEnd = pts[n - 1]!.clone().sub(pts[n - 2]!).normalize();
  const dStart = pts[0]!.clone().sub(pts[1]!).normalize();
  const ring = [...left, ...capPoints(pts[n - 1]!, dEnd, hw, cap), ...right, ...capPoints(pts[0]!, dStart, hw, cap)];
  return [{ outer: ring, holes: [] }];
}

// ---------------------------------------------------------------- build

export interface BuiltGeometry {
  geometry: THREE.BufferGeometry;
  /** Approximate stroke thickness of the outline (artboard units). */
  thickness: number;
}

/** Local-space bounding box of a path (objectBoundingBox for gradients). */
function localBox(paths: THREE.ShapePath[], step: number): THREE.Box2 {
  const box = new THREE.Box2();
  for (const sp of paths) for (const sub of sp.subPaths) for (const p of sampleCurves(sub.curves, step * 4)) box.expandByPoint(p);
  return box;
}

function gradientAt(g: GradientT, u: number, v: number): number {
  if (g.type === "radial") return clamp(Math.hypot(u - 0.5, v - 0.5) / 0.5, 0, 1);
  const a = g.angle * DEG;
  return clamp((u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + 0.5, 0, 1);
}

function makeGradientSampler(g: GradientT): (t: number) => THREE.Color {
  const stops = [...g.stops].sort((a, b) => a.offset - b.offset);
  const cols = stops.map((s) => {
    const c = new THREE.Color();
    try {
      c.setStyle(s.color, THREE.SRGBColorSpace);
    } catch {
      /* keep white */
    }
    const srgb = new THREE.Color();
    c.getRGB(srgb, THREE.SRGBColorSpace); // r,g,b in sRGB space
    return srgb;
  });
  return (t: number) => {
    let i = 0;
    while (i < stops.length - 1 && t > stops[i + 1]!.offset) i++;
    const s0 = stops[i]!;
    const s1 = stops[Math.min(i + 1, stops.length - 1)]!;
    const span = s1.offset - s0.offset;
    const k = span > 1e-6 ? clamp((t - s0.offset) / span, 0, 1) : 0;
    const c = cols[i]!.clone().lerp(cols[Math.min(i + 1, cols.length - 1)]!, t <= s0.offset ? 0 : k);
    // Interpolated in sRGB (like SVG), stored linear for the shader.
    return new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
  };
}

/** Builds the extruded geometry for one spec. Returns null if nothing to extrude. */
export function buildGeometry(s: GeoSpec): BuiltGeometry | null {
  const paths = parsePath(s.d, s.fillRule);
  if (!paths.length) return null;
  const det = Math.abs(s.linear[0] * s.linear[3] - s.linear[1] * s.linear[2]);
  const scale = Math.sqrt(det) || 1;
  const localStep = s.step / scale;

  const contours: Contour[] = [];
  for (const sp of paths) {
    if (s.kind === "fill") {
      sp.userData = { ...(sp.userData ?? {}), style: { fillRule: s.fillRule } };
      for (const shape of sp.toShapes()) {
        const outer = sampleCurves(shape.curves, localStep);
        if (outer.length < 3) continue;
        const holes = shape.holes.map((h) => sampleCurves(h.curves, localStep)).filter((h) => h.length >= 3);
        contours.push({ outer, holes });
      }
    } else if (s.stroke) {
      for (const sub of sp.subPaths) {
        const pts = sampleCurves(sub.curves, localStep);
        if (pts.length < 2) continue;
        const first = sub.curves[0]?.getPoint(0);
        const last = sub.curves[sub.curves.length - 1]?.getPoint(1);
        const closed = (sub as THREE.Path & { autoClose?: boolean }).autoClose || (!!first && !!last && first.distanceTo(last) < localStep * 0.05);
        contours.push(...strokeContours(pts, !!closed, s.stroke.width, s.stroke.cap, s.stroke.join));
      }
    }
  }
  if (!contours.length) return null;

  // Transform to world-linear space (y up) and estimate feature thickness.
  let area = 0;
  let perim = 0;
  const shapes: THREE.Shape[] = [];
  for (const c of contours) {
    const outer = applyLinear(c.outer, s.linear);
    const holes = c.holes.map((h) => applyLinear(h, s.linear));
    area += Math.abs(THREE.ShapeUtils.area(outer));
    perim += perimeter(outer);
    for (const h of holes) {
      area -= Math.abs(THREE.ShapeUtils.area(h));
      perim += perimeter(h);
    }
    const shape = new THREE.Shape(outer);
    shape.holes = holes.map((h) => new THREE.Path(h));
    shapes.push(shape);
  }
  const thickness = perim > 0 ? Math.max(0, (2 * area) / perim) : 0;

  const depth = Math.max(s.depth, 0.25);
  const bevel = clamp(Math.min(s.bevel, depth * 0.45, thickness * 0.32), 0, 1e6);
  const hasBevel = bevel > 0.05;
  const straight = hasBevel ? Math.max(depth - 2 * bevel, depth * 0.04) : depth;
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shapes, {
    depth: straight,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: hasBevel,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: s.bevelSegments,
  });
  geo.translate(0, 0, hasBevel ? bevel : 0);
  geo.clearGroups();
  const smooth = toCreasedNormals(geo, 42 * DEG);
  if (smooth !== geo) geo.dispose();
  geo = smooth;

  if (s.gradient) {
    const box = localBox(paths, localStep);
    const size = box.getSize(new THREE.Vector2());
    const [a, b, c, d] = s.linear;
    const idet = 1 / (a * d - b * c || 1e-9);
    const sample = makeGradientSampler(s.gradient);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const X = pos.getX(i);
      const Y = -pos.getY(i);
      // Invert the linear map back to local space.
      const lx = (d * X - c * Y) * idet;
      const ly = (-b * X + a * Y) * idet;
      const u = size.x > 0 ? (lx - box.min.x) / size.x : 0.5;
      const v = size.y > 0 ? (ly - box.min.y) / size.y : 0.5;
      const col = sample(gradientAt(s.gradient, u, v));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geometry: geo, thickness };
}

/** Geometry cache keyed by spec; drops entries unused by the latest build. */
export class GeometryCache {
  private map = new Map<string, BuiltGeometry | null>();
  private used = new Set<string>();

  get(spec: GeoSpec): BuiltGeometry | null {
    const k = specKey(spec);
    this.used.add(k);
    if (!this.map.has(k)) this.map.set(k, buildGeometry(spec));
    return this.map.get(k) ?? null;
  }

  /** Call after a build: disposes geometries the build didn't use. */
  sweep() {
    for (const [k, g] of this.map) {
      if (!this.used.has(k)) {
        g?.geometry.dispose();
        this.map.delete(k);
      }
    }
    this.used.clear();
  }

  dispose() {
    for (const g of this.map.values()) g?.geometry.dispose();
    this.map.clear();
    this.used.clear();
  }
}
