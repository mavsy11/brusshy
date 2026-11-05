import { describe, expect, it } from "vitest";
import {
  applyOps,
  booleanOps,
  booleanShapes,
  buildArrangement,
  circleContour,
  constructionSnapPoints,
  constructionTemplate,
  createDoc,
  deriveConstruction,
  faceAt,
  facePath,
  fillRegionOps,
  frameArrangement,
  frameDoc,
  guideContour,
  listFrames,
  outlineFromPath,
  parsePath,
  polygonContour,
  setConstructionOps,
  snapRadius,
  subtractRegionOps,
  type DocT,
  type P,
} from "../src";

const circlePath = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}Z`;
const anchors = (d: string) => parsePath(d).flatMap((s) => s.anchors.map((a) => a.p));
const onCircle = (q: P, c: P, r: number, e = 0.02) => Math.abs(Math.hypot(q[0] - c[0], q[1] - c[1]) - r) < e;

/** Area by dense sampling of the cubic path (shoelace). */
function pathArea(d: string): number {
  let a = 0;
  for (const s of parsePath(d)) {
    const pts: P[] = [];
    const n = s.anchors.length;
    for (let i = 0; i < (s.closed ? n : n - 1); i++) {
      const A = s.anchors[i]!, B = s.anchors[(i + 1) % n]!;
      const p0 = A.p, p1 = A.cout ?? A.p, p2 = B.cin ?? B.p, p3 = B.p;
      for (let k = 0; k < 64; k++) {
        const t = k / 64, u = 1 - t;
        pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
      }
    }
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
  }
  return Math.abs(a / 2);
}

const lensArea = (r: number, d: number) => 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);

describe("booleans keep curves exact", () => {
  const A = outlineFromPath(circlePath(400, 500, 200));
  const B = outlineFromPath(circlePath(600, 500, 200));

  it("recognises arc commands as true circle arcs", () => {
    const segs = A.contours[0]!.segs;
    expect(segs.every((s) => s.k === "arc")).toBe(true);
    for (const s of segs) if (s.k === "arc") {
      expect(s.c[0]).toBeCloseTo(400, 6);
      expect(s.c[1]).toBeCloseTo(500, 6);
      expect(s.r).toBeCloseTo(200, 6);
    }
  });

  it("intersect: a lens of two exact arcs with sharp tips at the true intersections", () => {
    const r = booleanShapes([[A], [B]], "intersect");
    expect(r.paths).toHaveLength(1);
    const d = r.paths[0]!;
    const pts = anchors(d);
    // Every node lies on one of the circles.
    for (const q of pts) expect(onCircle(q, [400, 500], 200) || onCircle(q, [600, 500], 200)).toBe(true);
    // The two tips are the analytic intersections (500, 500 ± √(200² − 100²)).
    const h = Math.sqrt(200 * 200 - 100 * 100);
    for (const tip of [[500, 500 - h], [500, 500 + h]] as P[]) expect(pts.some((q) => Math.hypot(q[0] - tip[0], q[1] - tip[1]) < 0.01)).toBe(true);
    expect(Math.abs(pathArea(d) / lensArea(200, 200) - 1)).toBeLessThan(4e-4);
    // Corners at the tips: no handles continuing smoothly through them.
    const tipAnchor = parsePath(d)[0]!.anchors.find((a) => Math.hypot(a.p[0] - 500, a.p[1] - (500 - h)) < 0.01)!;
    const vin = [tipAnchor.p[0] - tipAnchor.cin![0], tipAnchor.p[1] - tipAnchor.cin![1]];
    const vout = [tipAnchor.cout![0] - tipAnchor.p[0], tipAnchor.cout![1] - tipAnchor.p[1]];
    const cos = (vin[0]! * vout[0]! + vin[1]! * vout[1]!) / (Math.hypot(vin[0]!, vin[1]!) * Math.hypot(vout[0]!, vout[1]!));
    expect(cos).toBeLessThan(0.9);
  });

  it("union, subtract, exclude, divide", () => {
    const u = booleanShapes([[A], [B]], "union").paths[0]!;
    const circle = Math.PI * 200 * 200;
    const lens = lensArea(200, 200);
    // Cubic arcs are within 0.03% of true circles.
    expect(Math.abs(pathArea(u) / (2 * circle - lens) - 1)).toBeLessThan(4e-4);
    for (const q of anchors(u)) expect(onCircle(q, [400, 500], 200) || onCircle(q, [600, 500], 200)).toBe(true);
    const s = booleanShapes([[A], [B]], "subtract").paths[0]!;
    expect(Math.abs(pathArea(s) / (circle - lens) - 1)).toBeLessThan(4e-4);
    const x = booleanShapes([[A], [B]], "exclude").paths[0]!;
    expect(Math.abs(pathArea(x) / (2 * (circle - lens)) - 1)).toBeLessThan(4e-4);
    const div = booleanShapes([[A], [B]], "divide");
    expect(div.paths).toHaveLength(3);
    expect(div.owners.sort()).toEqual([0, 1, 1]);
  });

  it("straight edges stay straight and corners sharp (circle minus a square)", () => {
    const sq = outlineFromPath("M500 300H800V700H500Z");
    const d = booleanShapes([[A], [sq]], "subtract").paths[0]!;
    const sp = parsePath(d)[0]!;
    // The cut edge x = 500 is one straight segment between the two intersections.
    const onCut = sp.anchors.filter((a) => Math.abs(a.p[0] - 500) < 1e-6);
    expect(onCut).toHaveLength(2);
    for (const a of onCut) expect(onCircle(a.p, [400, 500], 200, 0.01)).toBe(true);
  });

  it("booleanOps replaces the layers in one step and keeps the first layer's style", () => {
    let doc: DocT = createDoc("t");
    const f = listFrames(doc)[0]!.id;
    doc = applyOps(doc, [
      { op: "add", node: { id: "a", type: "shape", shape: "ellipse", width: 400, height: 400, transform: { x: 200, y: 300 }, name: "Left", style: { fill: "#ff0000" } }, parent: f },
      { op: "add", node: { id: "b", type: "path", d: circlePath(600, 500, 200), name: "Right", style: { fill: "#0000ff" } }, parent: f },
    ]).doc;
    const plan = booleanOps(doc, ["b", "a"], "union", { newId: () => "u" });
    expect(plan.error).toBeUndefined();
    const next = applyOps(doc, plan.ops).doc;
    expect(next.nodes.a).toBeUndefined();
    expect(next.nodes.b).toBeUndefined();
    const u = next.nodes.u!;
    expect(u.type).toBe("path");
    expect(u.name).toBe("Right");
    expect(u.style.fill).toBe("#0000ff");
    if (u.type === "path") for (const q of anchors(u.d)) expect(onCircle(q, [400, 500], 200) || onCircle(q, [600, 500], 200)).toBe(true);
  });
});

describe("region fill on construction grids", () => {
  it("petal between two circles of a radial grid is exact", () => {
    const c = constructionTemplate("radial", { width: 1024, height: 1024 }, { sectors: 6, size: 800 });
    const circles = c.guides.filter((g) => g.kind === "circle");
    expect(circles.length).toBe(2 + 6);
    const arr = buildArrangement({ closed: c.guides.filter((g) => g.kind !== "line").map((g) => ({ contours: [guideContour(g)] })), open: c.guides.filter((g) => g.kind === "line").map(guideContour), bounds: { x: 0, y: 0, w: 1024, h: 1024 } });
    const t0 = performance.now();
    // A point inside the first petal circle near its outer tip, off the ray.
    const face = faceAt(arr, [530, 140]);
    const ms = performance.now() - t0;
    expect(face).not.toBeNull();
    expect(ms).toBeLessThan(200);
    const d = facePath(arr, face!.paths);
    const petalCs = circles.slice(2).map((g) => (g.kind === "circle" ? ([[g.cx, g.cy], g.r] as const) : null)!);
    for (const q of anchors(d)) {
      const onAny = petalCs.some(([cc, r]) => onCircle(q, cc as P, r, 0.05)) || circles.slice(0, 2).some((g) => g.kind === "circle" && onCircle(q, [g.cx, g.cy], g.r, 0.05));
      const onRay = c.guides.some((g) => {
        if (g.kind !== "line") return false;
        const ab = [g.x2 - g.x1, g.y2 - g.y1];
        const L = Math.hypot(ab[0]!, ab[1]!);
        return Math.abs(((q[0] - g.x1) * ab[1]! - (q[1] - g.y1) * ab[0]!) / L) < 0.05;
      });
      expect(onAny || onRay).toBe(true);
    }
    expect(face!.area).toBeGreaterThan(100);
  });

  it("square grid cells come out as exact squares; outside is not a region", () => {
    const c = constructionTemplate("square-grid", { width: 1024, height: 1024 }, { size: 800, divisions: 4 });
    const arr = buildArrangement({ closed: c.guides.filter((g) => g.kind !== "line").map((g) => ({ contours: [guideContour(g)] })), open: c.guides.filter((g) => g.kind === "line").map(guideContour), bounds: { x: 0, y: 0, w: 1024, h: 1024 } });
    const face = faceAt(arr, [212 + 50, 112 + 50]);
    expect(face).not.toBeNull();
    const d = facePath(arr, face!.paths);
    const pts = anchors(d).map((q) => q.map((v) => Math.round(v * 100) / 100));
    expect(pts).toHaveLength(4);
    expect(pts.map((q) => q.join(",")).sort()).toEqual(["112,112", "112,312", "312,112", "312,312"].sort());
    expect(faceAt(arr, [20, 20])).toBeNull();
  });

  it("lines that only poke into a region don't split it", () => {
    const arr = buildArrangement({ closed: [{ contours: [circleContour([500, 500], 200)] }], open: [polygonContour([[500, 500], [500, 200]], false)], bounds: { x: 0, y: 0, w: 1000, h: 1000 } });
    const face = faceAt(arr, [450, 520])!;
    expect(face).not.toBeNull();
    const d = facePath(arr, face.paths);
    expect(Math.abs(pathArea(d) / (Math.PI * 200 * 200) - 1)).toBeLessThan(4e-4);
    for (const q of anchors(d)) expect(onCircle(q, [500, 500], 200, 1e-3)).toBe(true);
  });

  it("fill_region ops: faces become paths in the brand primary; merge fuses neighbours", () => {
    let doc: DocT = createDoc("t");
    const f = listFrames(doc)[0]!.id;
    const c = constructionTemplate("circle-grid", { width: 1024, height: 1024 }, { ratio: 2, levels: 2, size: 800 });
    doc = applyOps(doc, setConstructionOps(f, c)).doc;
    expect((doc.nodes[f] as { construction?: unknown }).construction).toBeTruthy();
    // Exported SVG never contains the construction.
    const plan = fillRegionOps(doc, f, [[530, 300], [530, 724]], { color: "#123456", merge: false });
    expect(plan.error).toBeUndefined();
    expect(plan.ops).toHaveLength(2);
    const merged = fillRegionOps(doc, f, [[530, 300], [700, 530]], { merge: true });
    expect(merged.ops).toHaveLength(1);
    doc = applyOps(doc, plan.ops).doc;
    const filled = Object.values(doc.nodes).filter((n) => n.type === "path");
    expect(filled).toHaveLength(2);
    expect(filled[0]!.style.fill).toBe("#123456");
    // Subtract a region from a filled layer.
    const sub = subtractRegionOps(doc, f, [530, 300]);
    expect(sub.error).toBeUndefined();
    // Undo restores the construction exactly.
    const r = applyOps(doc, setConstructionOps(f, null));
    expect((r.doc.nodes[f] as { construction?: unknown }).construction).toBeFalsy();
    const back = applyOps(r.doc, r.inverse).doc;
    expect((back.nodes[f] as { construction?: { guides: unknown[] } }).construction?.guides.length).toBe(c.guides.length);
  });

  it("booleans on filled regions that share edges and touch at points stay clean (no stray circles)", () => {
    let doc: DocT = createDoc("t");
    const f = listFrames(doc)[0]!.id;
    doc = applyOps(doc, setConstructionOps(f, constructionTemplate("radial", { width: 1024, height: 1024 }, { sectors: 6, size: 760 }))).doc;
    const pts: P[] = [];
    for (let k = 0; k < 6; k++) {
      const a = ((-60 + 60 * k) * Math.PI) / 180;
      for (const d of [40, 120, 200, 290]) pts.push([512 + Math.cos(a) * d, 512 + Math.sin(a) * d]);
    }
    let n = 0;
    const a = fillRegionOps(doc, f, pts, { merge: true, newId: () => `a${n++}` });
    const b = fillRegionOps(doc, f, [[300, 640], [320, 700]], { merge: true, newId: () => `b${n++}` });
    doc = applyOps(doc, [...a.ops, ...b.ops]).doc;
    const ia = a.ids[0]!, ib = b.ids[0]!;
    const da = (doc.nodes[ia] as { d: string }).d, db = (doc.nodes[ib] as { d: string }).d;
    const plan = booleanOps(doc, [ia, ib], "union", { newId: () => "u" });
    const u = applyOps(doc, plan.ops).doc.nodes.u as { d: string };
    const overlap = booleanShapes([[outlineFromPath(da)], [outlineFromPath(db)]], "intersect").paths[0];
    const expected = pathArea(da) + pathArea(db) - (overlap ? pathArea(overlap) : 0);
    expect(Math.abs(pathArea(u.d) / expected - 1)).toBeLessThan(2e-3);
  });

  it("20 circles: faces are found fast", () => {
    const guides = constructionTemplate("radial", { width: 1024, height: 1024 }, { sectors: 12, size: 860 });
    const more = constructionTemplate("circle-grid", { width: 1024, height: 1024 }, { size: 700 });
    const all = [...guides.guides, ...more.guides];
    expect(all.filter((g) => g.kind === "circle").length).toBeGreaterThanOrEqual(20);
    const arr = buildArrangement({ closed: all.filter((g) => g.kind !== "line").map((g) => ({ contours: [guideContour(g)] })), open: all.filter((g) => g.kind === "line").map(guideContour), bounds: { x: 0, y: 0, w: 1024, h: 1024 } });
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      if (faceAt(arr, [512 + Math.cos(a) * (60 + i * 17), 512 + Math.sin(a) * (60 + i * 17)])) hits++;
    }
    const per = (performance.now() - t0) / 20;
    expect(hits).toBeGreaterThan(10);
    expect(per).toBeLessThan(60);
  });
});

describe("snapping and derivation", () => {
  it("snap points include centres, intersections and tangent points", () => {
    const c = constructionTemplate("circles", { width: 1000, height: 1000 }, { circles: [{ cx: 400, cy: 500, r: 200 }, { cx: 600, cy: 500, r: 200 }] });
    const pts = constructionSnapPoints(c);
    expect(pts.filter((p) => p.kind === "centre")).toHaveLength(2);
    expect(pts.filter((p) => p.kind === "intersection")).toHaveLength(2);
    const r = snapRadius(c, [500, 100], 222, 5);
    expect(r).not.toBeNull();
  });

  it("derives keylines and the circles a mark's curves follow", () => {
    let doc: DocT = createDoc("t");
    const f = listFrames(doc)[0]!.id;
    doc = applyOps(doc, [
      { op: "add", node: { id: "a", type: "path", d: circlePath(512, 512, 300) }, parent: f },
      { op: "add", node: { id: "b", type: "path", d: circlePath(512, 512, 120), style: { fill: "#ffffff" } }, parent: f },
    ]).doc;
    const c = deriveConstruction(frameDoc(doc, f));
    const circles = c.guides.filter((g) => g.kind === "circle");
    expect(circles.length).toBe(2);
    expect(circles.some((g) => g.kind === "circle" && Math.abs(g.r - 300) < 0.5)).toBe(true);
    expect(c.guides.some((g) => g.kind === "polygon")).toBe(true);
  });

  it("a frame's arrangement uses its construction and shapes", () => {
    let doc: DocT = createDoc("t");
    const f = listFrames(doc)[0]!.id;
    doc = applyOps(doc, setConstructionOps(f, constructionTemplate("keylines", { width: 1024, height: 1024 }))).doc;
    const arr = frameArrangement(doc, f);
    expect(arr.regions.length).toBeGreaterThanOrEqual(3);
    expect(faceAt(arr, [520, 505])).not.toBeNull();
  });
});
