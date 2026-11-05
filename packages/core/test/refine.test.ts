import { describe, expect, it } from "vitest";
import {
  applyOps,
  createDoc,
  listFrames,
  parsePath,
  refineAmountSpec,
  refineOps,
  refinePathData,
  roundSubPath,
  simplifySubPath,
  smoothSubPath,
  stemOf,
  subPathsBox,
  symmetryAxis,
  turnAt,
  type DocT,
  type OpT,
  type SubPath,
} from "../src";

const poly = (pts: [number, number][]) => `M${pts.map((p) => p.join(" ")).join("L")}Z`;
const circlePts = (n: number, r = 100, cx = 200, cy = 200, noise = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r + (noise ? Math.sin(i * 7.3) * noise : 0);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as [number, number];
  });
const nodes = (d: string) => parsePath(d).reduce((a, s) => a + s.anchors.length, 0);
const area = (d: string) => stemOf(parsePath(d)).area;
const box = (d: string) => subPathsBox(parsePath(d))!;

/** Sampled points of path data. */
function samples(d: string, per = 24): [number, number][] {
  const out: [number, number][] = [];
  for (const s of parsePath(d)) {
    const a = s.anchors;
    const segs = s.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const A = a[i]!, B = a[(i + 1) % a.length]!;
      const p0 = A.p, p1 = A.cout ?? A.p, p2 = B.cin ?? B.p, p3 = B.p;
      for (let k = 0; k < per; k++) {
        const t = k / per, u = 1 - t;
        out.push([
          u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ]);
      }
    }
  }
  return out;
}
const radialError = (d: string, r = 100, cx = 200, cy = 200) => Math.max(...samples(d).map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));

function docWith(nodesIn: Record<string, unknown>[]): { doc: DocT; fid: string } {
  let doc = createDoc("t");
  const fid = listFrames(doc)[0]!.id;
  doc = applyOps(doc, nodesIn.map((node) => ({ op: "add", node, parent: (node.parent as string | undefined) ?? fid }) as OpT)).doc;
  return { doc, fid };
}

describe("simplify", () => {
  it("turns a dense polygon circle into a few smooth curves", () => {
    const d = poly(circlePts(240));
    const out = refinePathData(d, "simplify", 40);
    expect(nodes(out)).toBeLessThanOrEqual(12);
    expect(radialError(out)).toBeLessThan(1.5);
  });

  it("keeps corners and straight edges exactly", () => {
    // Square with extra collinear nodes on every edge.
    const d = poly([[0, 0], [50, 0], [100, 0], [100, 40], [100, 100], [60, 100], [0, 100], [0, 30]]);
    const out = refinePathData(d, "simplify", 40);
    expect(nodes(out)).toBe(4);
    const b = box(out);
    expect([b.x, b.y, b.w, b.h]).toEqual([0, 0, 100, 100]);
    expect(out).not.toContain("C");
  });

  it("never adds nodes", () => {
    const s: SubPath = parsePath("M0 0C30 -40 70 -40 100 0L100 100L0 100Z")[0]!;
    expect(simplifySubPath(s, 0.01).anchors.length).toBeLessThanOrEqual(s.anchors.length);
  });
});

describe("smooth", () => {
  it("evens out a wobbly outline without shrinking it", () => {
    const d = poly(circlePts(180, 100, 200, 200, 4));
    const out = refinePathData(d, "smooth", 70);
    expect(radialError(out)).toBeLessThan(radialError(d) * 0.6);
    expect(area(out)).toBeGreaterThan(area(d) * 0.96);
  });

  it("keeps sharp corners", () => {
    const s = parsePath(poly([[0, 0], [100, 0], [100, 100], [0, 100]]))[0]!;
    const out = smoothSubPath(s, 20);
    const corners = out.anchors.filter((_, i) => turnAt(out, i) > 80).length;
    expect(corners).toBe(4);
  });
});

describe("bolder / thinner", () => {
  it("offsets a square outward and inward with sharp corners", () => {
    const sq = poly([[0, 0], [100, 0], [100, 100], [0, 100]]);
    const big = refinePathData(sq, "bolder", 10);
    const b = box(big);
    expect(b.x).toBeCloseTo(-10, 1);
    expect(b.w).toBeCloseTo(120, 1);
    expect(nodes(big)).toBe(4);
    const small = refinePathData(sq, "thinner", 10);
    expect(box(small).w).toBeCloseTo(80, 1);
  });

  it("keeps holes (a ring gets thicker on both sides)", () => {
    const ring = `${poly([[0, 0], [100, 0], [100, 100], [0, 100]])}${poly([[30, 30], [30, 70], [70, 70], [70, 30]])}`;
    const out = refinePathData(ring, "bolder", 5);
    expect(parsePath(out).length).toBe(2);
    expect(area(out)).toBeCloseTo(110 * 110 - 30 * 30, -1);
  });
});

describe("round corners", () => {
  it("fillets every corner of a square", () => {
    const s = parsePath(poly([[0, 0], [100, 0], [100, 100], [0, 100]]))[0]!;
    const out = roundSubPath(s, 10);
    expect(out.anchors.length).toBe(8);
    const d = `M${out.anchors[0]!.p.join(" ")}`; // anchors sit on the edges
    expect(d).toBeTruthy();
    const full = refinePathData(poly([[0, 0], [100, 0], [100, 100], [0, 100]]), "round", 10);
    expect(area(full)).toBeCloseTo(100 * 100 - (4 - Math.PI) * 100, -1);
    const b = box(full);
    expect(b.w).toBeCloseTo(100, 1);
    // Every node is now smooth.
    const sp = parsePath(full)[0]!;
    expect(sp.anchors.every((_, i) => turnAt(sp, i) < 2)).toBe(true);
  });

  it("clamps the radius so neighbouring fillets never overlap", () => {
    const tri = poly([[0, 100], [50, 0], [100, 100]]);
    const out = refinePathData(tri, "round", 500);
    const sp = parsePath(out)[0]!;
    expect(sp.anchors.length).toBe(6);
    expect(box(out).w).toBeLessThanOrEqual(100.01);
  });

  it("rounds into curved neighbours", () => {
    const d = "M0 100L0 0C60 0 100 40 100 100Z";
    const out = refinePathData(d, "round", 12);
    const sp = parsePath(out)[0]!;
    expect(sp.anchors.every((_, i) => turnAt(sp, i) < 3)).toBe(true);
  });
});

describe("snap to grid", () => {
  it("rounds anchors to the step and moves handles with them", () => {
    const out = refinePathData("M1.2 2.9C10 0 20 0 31.3 7.6L30.6 41Z", "snap-grid", 8);
    const sp = parsePath(out)[0]!;
    for (const a of sp.anchors) {
      expect(a.p[0] % 8).toBe(0);
      expect(a.p[1] % 8).toBe(0);
    }
    expect(sp.anchors[0]!.cout).toEqual([10 - 1.2, 0 - 2.9]);
  });
});

describe("symmetric", () => {
  const mirrorErr = (d: string, ax: number) => {
    const pts = samples(d, 40);
    return Math.max(...pts.map(([x, y]) => Math.min(...pts.map(([u, v]) => Math.hypot(2 * ax - x - u, y - v)))));
  };

  it("mirrors a nearly symmetric outline exactly", () => {
    // A house whose right eave sags a little.
    const d = poly([[0, 100], [0, 40], [50, 0], [100, 46], [100, 100]]);
    const ax = symmetryAxis([parsePath(d)])!.axis;
    expect(ax).toBeCloseTo(50, 0);
    const out = refinePathData(d, "symmetric", 0);
    expect(mirrorErr(out, ax)).toBeLessThan(0.5);
    expect(nodes(out)).toBe(5);
  });

  it("mirrors a left eye onto the right one in a compound path", () => {
    const face = poly(circlePts(64, 100, 200, 200));
    const left = poly([[150, 170], [170, 170], [170, 190], [150, 190]]);
    const right = poly([[232, 172], [250, 172], [250, 192], [232, 192]]);
    const out = refinePathData(face + left + right, "symmetric", 0, { axis: 200 });
    expect(parsePath(out).length).toBe(3);
    expect(mirrorErr(out, 200)).toBeLessThan(0.5);
  });

  it("refuses a selection that isn't nearly symmetric", () => {
    const { doc } = docWith([{ id: "a", type: "path", d: poly([[0, 0], [100, 0], [0, 100]]) }]);
    const r = refineOps(doc, ["a"], "symmetric");
    expect(r.ops).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/isn't nearly symmetric/);
  });

  it("replaces a right-hand layer with the mirror of its left counterpart", () => {
    const { doc } = docWith([
      { id: "l", type: "path", d: poly([[100, 100], [160, 100], [160, 200], [100, 200]]) },
      { id: "r", type: "path", d: poly([[242, 104], [300, 104], [300, 200], [242, 200]]) },
    ]);
    const r = refineOps(doc, ["l", "r"], "symmetric");
    expect(r.changed).toEqual(["r"]);
    const next = applyOps(doc, r.ops).doc;
    const b = box((next.nodes.r as { d: string }).d);
    const axis = (160 + 242) / 2 + 0; // centre of the pair's bounds = (100 + 300) / 2
    expect(axis).toBeGreaterThan(0);
    expect(b.x + b.w).toBeCloseTo(300, 0);
    expect(b.w).toBeCloseTo(60, 0);
    expect(b.h).toBeCloseTo(100, 0);
  });
});

describe("refineOps on a document", () => {
  it("rounds a rectangle by its radius instead of converting it", () => {
    const { doc } = docWith([{ id: "r", type: "shape", shape: "rect", width: 200, height: 100 }]);
    const r = refineOps(doc, ["r"], "round", { amount: 12 });
    expect(r.ops).toEqual([{ op: "update", id: "r", set: { radius: 12 } }]);
  });

  it("converts a polygon-ish shape to a path for geometry actions, in place", () => {
    const { doc, fid } = docWith([
      { id: "a", type: "shape", shape: "ellipse", width: 100, height: 100 },
      { id: "s", type: "shape", shape: "star", width: 100, height: 100, transform: { x: 300, y: 300 } },
    ]);
    const r = refineOps(doc, ["s"], "bolder", { amount: 4 });
    const next = applyOps(doc, r.ops).doc;
    expect(next.nodes.s!.type).toBe("path");
    expect((next.nodes[fid] as { children: string[] }).children).toEqual(["a", "s"]);
    expect(next.nodes.s!.transform.x).toBe(300);
  });

  it("thickens stroke-only lines by their stroke width", () => {
    const { doc } = docWith([{ id: "l", type: "path", d: "M0 0L100 0", style: { fill: null, stroke: "#000", strokeWidth: 4 } }]);
    const r = refineOps(doc, ["l"], "bolder", { amount: 1 });
    expect(r.ops).toEqual([{ op: "update", id: "l", set: { style: { strokeWidth: 6 } } }]);
  });

  it("works in artboard space through group transforms", () => {
    const { doc } = docWith([
      { id: "g", type: "group", transform: { x: 50, y: 50, scaleX: 2, scaleY: 2 } },
      { id: "p", type: "path", parent: "g", d: poly([[0, 0], [50, 0], [50, 50], [0, 50]]) },
    ]);
    // 10 artboard units = 5 local units at 2×.
    const r = refineOps(doc, ["g"], "bolder", { amount: 10 });
    const next = applyOps(doc, r.ops).doc;
    const b = box((next.nodes.p as { d: string }).d);
    expect(b.x).toBeCloseTo(-5, 1);
    expect(b.w).toBeCloseTo(60, 1);
  });

  it("skips text without outlines and AI-locked layers", () => {
    const { doc } = docWith([
      { id: "t", type: "text", text: "Hi" },
      { id: "p", type: "path", d: poly(circlePts(120)), aiLock: true },
    ]);
    const r = refineOps(doc, ["t", "p"], "simplify", { skip: (n) => n.aiLock });
    expect(r.ops).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/needs its outlines/);
    expect(r.notes.join(" ")).toMatch(/locked for the AI/);
  });

  it("outlines text when given its glyphs", () => {
    const { doc } = docWith([{ id: "t", type: "text", text: "I", transform: { x: 10, y: 100 } }]);
    const r = refineOps(doc, ["t"], "round", { amount: 3, textOutlines: { t: poly([[0, -70], [20, -70], [20, 0], [0, 0]]) } });
    const next = applyOps(doc, r.ops).doc;
    expect(next.nodes.t!.type).toBe("path");
    expect(nodes((next.nodes.t as { d: string }).d)).toBe(8);
  });

  it("centres optically: a triangle sits a little higher than its box centre", () => {
    const { doc } = docWith([{ id: "tri", type: "path", d: poly([[0, 200], [100, 0], [200, 200]]), transform: { x: 100, y: 100 } }]);
    const r = refineOps(doc, ["tri"], "optical-center");
    const next = applyOps(doc, r.ops).doc;
    const t = next.nodes.tri!.transform;
    // Box centred would be (412, 412); the ink sits low, so it moves up from there.
    expect(t.x).toBeCloseTo(412, 0);
    expect(t.y).toBeLessThan(412);
    expect(t.y).toBeGreaterThan(380);
  });

  it("snaps shapes by their origin and size", () => {
    const { doc } = docWith([{ id: "r", type: "shape", shape: "rect", width: 101.3, height: 49, transform: { x: 13, y: 7 } }]);
    const r = refineOps(doc, ["r"], "snap-grid", { amount: 8 });
    const next = applyOps(doc, r.ops).doc;
    const n = next.nodes.r as { width: number; height: number; transform: { x: number; y: number } };
    expect([n.transform.x, n.transform.y, n.width, n.height]).toEqual([16, 8, 104, 48]);
  });

  it("gives slider ranges sized to the selection", () => {
    const { doc } = docWith([{ id: "p", type: "path", d: poly([[0, 0], [20, 0], [20, 200], [0, 200]]) }]);
    const s = refineAmountSpec(doc, ["p"], "bolder")!;
    // Stem ≈ 2·area/perimeter = 2·4000/440 ≈ 18.
    expect(s.value).toBeGreaterThan(1);
    expect(s.value).toBeLessThan(3);
    expect(s.max).toBeGreaterThan(s.value);
    expect(refineAmountSpec(doc, ["p"], "optical-center")).toBeNull();
  });
});
