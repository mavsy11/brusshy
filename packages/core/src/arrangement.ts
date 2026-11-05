import { differenceD, EndType, FillRule, inflatePathsD, intersectD, JoinType, unionD, type PathD, type PathsD } from "@countertype/clipper2-ts";
import {
  boxesTouch,
  circleContour,
  flattenContour,
  fromPathD,
  fuseRegions,
  nodeOutline,
  outlineRegion,
  pathsBox,
  polygonContour,
  PREC,
  PrimSet,
  regionComponents,
  regionToExactPath,
  ringArea,
  shapeLeaves,
  shapeTolerance,
  toPathD,
  windingAt,
  type GBox,
  type Contour,
  type Outline,
} from "./boolean";
import { worldMatrix } from "./geometry";
import type { P } from "./pathmodel";
import type { ConstructionT, GuideT } from "./construction-schema";
import type { DocT, FrameNodeT } from "./schema";

/**
 * Region fill ("shape builder"): the closed regions formed by the construction guides and the
 * shapes of a version. A face is found on demand for a point: intersect every closed curve the
 * point is inside, subtract every one it is outside, keep the connected piece around the point,
 * then slit it with the open lines (a line only splits where it crosses the piece). The face's
 * boundary is rebuilt on the exact circles/lines/curves (see boolean.ts), so a filled petal is
 * made of true arcs with sharp tips.
 */

export interface ArrRegion {
  paths: PathsD;
  box: GBox;
}

export interface Arrangement {
  tol: number;
  /** Universe: faces touching it are open (outside everything) and never filled. */
  universe: PathsD;
  ubox: GBox;
  regions: ArrRegion[];
  cuts: { path: PathD; box: GBox }[];
  prims: PrimSet;
  /** Half-width of the slit used to split faces along open lines. */
  hair: number;
}

export interface ArrangementInput {
  /** Closed and open contours, all in the same (frame) space. */
  closed: { contours: Contour[]; fillRule?: "nonzero" | "evenodd" }[];
  open: Contour[];
  /** Area of interest (e.g. the artboard): the universe is this plus everything, padded. */
  bounds?: { x: number; y: number; w: number; h: number };
  tol?: number;
}

export function guideContour(g: GuideT): Contour {
  if (g.kind === "circle") return circleContour([g.cx, g.cy], g.r);
  if (g.kind === "polygon") return polygonContour(g.points as P[]);
  return polygonContour([[g.x1, g.y1], [g.x2, g.y2]], false);
}

export function buildArrangement(input: ArrangementInput): Arrangement {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (q: P) => {
    x0 = Math.min(x0, q[0]);
    y0 = Math.min(y0, q[1]);
    x1 = Math.max(x1, q[0]);
    y1 = Math.max(y1, q[1]);
  };
  const all = [...input.closed.flatMap((c) => c.contours), ...input.open];
  if (input.bounds) {
    grow([input.bounds.x, input.bounds.y]);
    grow([input.bounds.x + input.bounds.w, input.bounds.y + input.bounds.h]);
  }
  const coarse = all.map((c) => flattenContour(c, 1));
  coarse.forEach((pts) => pts.forEach(grow));
  if (!Number.isFinite(x0)) {
    x0 = y0 = 0;
    x1 = y1 = 1024;
  }
  const ext = Math.max(x1 - x0, y1 - y0, 1);
  const tol = input.tol ?? shapeTolerance(ext) * 2;
  const pad = ext * 0.04 + 4;
  const universe: PathsD = [toPathD([[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad], [x0 - pad, y1 + pad]])];
  const prims = new PrimSet(tol, tol * 2.5 + 2 * 10 ** -PREC);
  const regions: ArrRegion[] = [];
  for (const c of input.closed) {
    prims.addContours(c.contours);
    const paths = outlineRegion({ contours: c.contours.map((k) => ({ ...k, closed: true })), fillRule: c.fillRule ?? "nonzero" }, tol);
    if (paths.length) regions.push({ paths, box: pathsBox(paths) });
  }
  const cuts: Arrangement["cuts"] = [];
  for (const c of input.open) {
    prims.addContours([c]);
    const pts = flattenContour(c, tol);
    if (pts.length >= 2) {
      const path = toPathD(pts);
      cuts.push({ path, box: pathsBox([path]) });
    }
  }
  return { tol, universe, ubox: pathsBox(universe), regions, cuts, prims, hair: tol * 0.6 };
}

export interface Face {
  paths: PathsD;
  box: GBox;
  area: number;
}

const NZ = FillRule.NonZero;

/** The face containing q, or null (on a line, or outside everything). */
export function faceAt(arr: Arrangement, q: P): Face | null {
  let A: PathsD = arr.universe;
  const inside: ArrRegion[] = [];
  const outside: ArrRegion[] = [];
  for (const r of arr.regions) {
    const inBox = q[0] >= r.box.x0 && q[0] <= r.box.x1 && q[1] >= r.box.y0 && q[1] <= r.box.y1;
    if (inBox && windingAt(r.paths, q) !== 0) inside.push(r);
    else outside.push(r);
  }
  // Smallest containing regions first: the face shrinks fast and later ops stay cheap.
  inside.sort((a, b) => (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0) - (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0));
  for (const r of inside) {
    A = intersectD(A, r.paths, NZ, PREC);
    if (!A.length) return null;
  }
  let box = pathsBox(A);
  for (const r of outside) {
    if (!boxesTouch(box, r.box)) continue;
    A = differenceD(A, r.paths, NZ, PREC);
    if (!A.length) return null;
    box = pathsBox(A);
  }
  let comp = pick(regionComponents(A), q);
  if (!comp) return null;
  box = pathsBox(comp);
  for (const c of arr.cuts) {
    if (!boxesTouch(box, c.box)) continue;
    const slit = inflatePathsD([c.path], arr.hair, JoinType.Miter, EndType.Square, 2, PREC);
    const next = differenceD(comp, slit, NZ, PREC);
    const parts = regionComponents(next);
    // A line that doesn't cut the piece in two (it only pokes in) leaves it whole.
    if (parts.length <= 1) continue;
    comp = pick(parts, q);
    if (!comp) return null;
    box = pathsBox(comp);
  }
  // Open (touches the universe) = outside everything: not a fillable region.
  const u = arr.ubox;
  const m = arr.tol * 4;
  if (box.x0 <= u.x0 + m || box.y0 <= u.y0 + m || box.x1 >= u.x1 - m || box.y1 >= u.y1 - m) return null;
  return { paths: comp, box, area: Math.abs(totalArea(comp)) };
}

const totalArea = (p: PathsD) => p.reduce((a, r) => a + ringArea(r), 0);

function pick(comps: PathsD[], q: P): PathsD | null {
  let best: PathsD | null = null;
  let bestArea = Infinity;
  for (const c of comps) {
    if (windingAt(c, q) === 0) continue;
    const a = Math.abs(totalArea(c));
    if (a < bestArea) {
      best = c;
      bestArea = a;
    }
  }
  return best;
}

/** Faces (deduplicated) under several points. */
export function facesAt(arr: Arrangement, pts: P[]): Face[] {
  const out: Face[] = [];
  for (const q of pts) {
    if (out.some((f) => windingAt(f.paths, q) !== 0)) continue;
    const f = faceAt(arr, q);
    if (f) out.push(f);
  }
  return out;
}

/** Faces merged into one clean region (shared edges fused). */
export function mergeFaces(arr: Arrangement, faces: Face[]): PathsD {
  if (faces.length === 1) return faces[0]!.paths;
  return fuseRegions(faces.map((f) => f.paths), arr.hair * 2);
}

/** A region (faces) as exact path data. */
export const facePath = (arr: Arrangement, region: PathsD): string => regionToExactPath(region, arr.prims);

/** Raw polygon path data (fast, for hover highlights). */
export function polyPath(region: PathsD): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  return region.map((r) => "M" + r.map((q) => `${f(q.x)} ${f(q.y)}`).join("L") + "Z").join("");
}

// ───────────────────────── a version's arrangement ─────────────────────────

/** Shapes and guides of a frame, in frame coordinates. Text needs `textOutlines` (else it is skipped). */
export function frameArrangement(
  doc: DocT,
  frameId: string,
  o: { exclude?: Set<string>; textOutlines?: Record<string, string>; construction?: ConstructionT | null; tol?: number } = {},
): Arrangement {
  const f = doc.nodes[frameId] as FrameNodeT;
  const closed: ArrangementInput["closed"] = [];
  const open: Contour[] = [];
  // Guides first: shapes whose arcs are read back from path data snap onto the exact guide circles.
  const cons = o.construction !== undefined ? o.construction : f.construction;
  for (const g of cons?.guides ?? []) {
    const c = guideContour(g);
    if (c.closed) closed.push({ contours: [c] });
    else open.push(c);
  }
  const space = worldMatrix(doc, frameId);
  for (const cid of f.children) {
    if (o.exclude?.has(cid)) continue;
    for (const l of shapeLeaves(doc, cid, space)) {
      if (o.exclude?.has(l.node.id)) continue;
      const ol: Outline | null = nodeOutline(l.node, l.M, l.node.type === "text" ? o.textOutlines?.[l.node.id] : undefined);
      if (!ol) continue;
      const filled = l.node.style.fill !== null;
      const cl = ol.contours.filter((c) => c.closed || filled);
      if (cl.length) closed.push({ contours: cl, fillRule: ol.fillRule });
      if (!filled) open.push(...ol.contours.filter((c) => !c.closed));
    }
  }
  return buildArrangement({ closed, open, bounds: { x: 0, y: 0, w: f.width, h: f.height }, tol: o.tol });
}

/** Region of a filled layer in frame coordinates (for subtracting a face from it). */
export function layerRegion(doc: DocT, frameId: string, id: string, tol: number, textOutlines?: Record<string, string>): PathsD {
  const space = worldMatrix(doc, frameId);
  const parts = shapeLeaves(doc, id, space).flatMap((l) => {
    const ol = nodeOutline(l.node, l.M, l.node.type === "text" ? textOutlines?.[l.node.id] : undefined);
    return ol ? outlineRegion(ol, tol) : [];
  });
  return parts.length ? unionD(parts, NZ) : [];
}

export { fromPathD };
