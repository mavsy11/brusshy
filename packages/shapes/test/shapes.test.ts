import { describe, expect, it } from "vitest";
import svgpath from "svgpath";
import {
  catalog,
  cleanParams,
  getShape,
  loadIcons,
  loadIconWeight,
  placeGeometry,
  renderShape,
  searchShapes,
  SHAPE_CATEGORIES,
  SHAPES,
  type ParamValues,
  type ShapeGeometry,
} from "../src/index";

/** Every coordinate of every path (anchors and control points), absolute. */
function coords(d: string): number[][] {
  const pts: number[][] = [];
  svgpath(d)
    .abs()
    .unarc()
    .iterate((seg) => {
      const nums = seg.slice(1) as number[];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
    });
  return pts;
}

/** Points on the drawn outline itself (cubics sampled), absolute. */
function onCurve(d: string): number[][] {
  const pts: number[][] = [];
  let cur = [0, 0];
  svgpath(d)
    .abs()
    .unarc()
    .unshort()
    .iterate((seg, _i, x, y) => {
      cur = [x, y];
      const n = seg.slice(1) as number[];
      if (seg[0] === "C")
        for (let k = 1; k <= 16; k++) {
          const t = k / 16;
          const u = 1 - t;
          pts.push([u * u * u * cur[0]! + 3 * u * u * t * n[0]! + 3 * u * t * t * n[2]! + t * t * t * n[4]!, u * u * u * cur[1]! + 3 * u * u * t * n[1]! + 3 * u * t * t * n[3]! + t * t * t * n[5]!]);
        }
      else if (n.length >= 2) pts.push([n[n.length - 2]!, n[n.length - 1]!]);
    });
  return pts;
}

function expectValid(g: ShapeGeometry, label: string) {
  expect(g.paths.length, label).toBeGreaterThan(0);
  for (const p of g.paths) {
    expect(p.d, label).toMatch(/^M/);
    expect(p.d, label).not.toMatch(/NaN|Infinity|undefined/);
    const pts = coords(p.d);
    expect(pts.length, label).toBeGreaterThan(2);
    for (const [x, y] of pts) expect(Number.isFinite(x) && Number.isFinite(y), `${label}: finite`).toBe(true);
    // The outline stays inside the 100 box (with its 6-unit margin, give or take rounding).
    for (const [x, y] of onCurve(p.d)) {
      expect(x, `${label}: x in box`).toBeGreaterThanOrEqual(5);
      expect(x, `${label}: x in box`).toBeLessThanOrEqual(95);
      expect(y, `${label}: y in box`).toBeGreaterThanOrEqual(5);
      expect(y, `${label}: y in box`).toBeLessThanOrEqual(95);
    }
  }
  const b = g.bounds;
  expect(b.width, label).toBeGreaterThan(1);
  expect(b.height, label).toBeGreaterThan(1);
  expect(Math.max(b.width, b.height), label).toBeGreaterThan(80);
  expect(b.x + b.width / 2, label).toBeCloseTo(50, 0);
  expect(b.y + b.height / 2, label).toBeCloseTo(50, 0);
}

describe("generated shapes", () => {
  it("has 150+ shapes with unique ids in every category", () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(SHAPES.length);
    for (const c of SHAPE_CATEGORIES) expect(SHAPES.some((s) => s.category === c.id), c.id).toBe(true);
    for (const s of SHAPES) {
      expect(s.name.length, s.id).toBeGreaterThan(1);
      expect(s.tags.length, s.id).toBeGreaterThan(0);
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it.each(SHAPES.map((s) => [s.id]))("%s draws a valid path inside its box at default, min and max params", (id) => {
    const def = getShape(id)!;
    expectValid(renderShape(id), `${id} default`);
    for (const p of def.params ?? []) {
      const ends: number[] = p.type === "choice" ? p.options.map((_, i) => i) : p.type === "seed" ? [1, 99] : [p.min, p.max];
      for (const v of ends) expectValid(renderShape(id, { [p.key]: v }), `${id} ${p.key}=${v}`);
    }
  });

  it("is deterministic (seeded shapes too)", () => {
    for (const id of ["blob", "splash", "explosion", "sound-bars"]) {
      expect(renderShape(id, { seed: 42 })).toEqual(renderShape(id, { seed: 42 }));
      expect(renderShape(id, { seed: 42 }).paths[0]!.d).not.toBe(renderShape(id, { seed: 43 }).paths[0]!.d);
    }
  });

  it("clamps parameters to their ranges", () => {
    const def = getShape("star")!;
    const v: ParamValues = cleanParams(def.params, { points: 999, inner: -4, nope: 3 });
    expect(v.points).toBe(24);
    expect(v.inner).toBe(0.1);
    expect(v).not.toHaveProperty("nope");
  });

  it("places geometry at a size and centre", () => {
    const g = renderShape("square", { round: 0 });
    const [p] = placeGeometry(g, 200, 300, 400);
    const xs = coords(p!.d).map((q) => q[0]!);
    const ys = coords(p!.d).map((q) => q[1]!);
    expect(Math.min(...xs)).toBeCloseTo(200, 0);
    expect(Math.max(...xs)).toBeCloseTo(400, 0);
    expect(Math.min(...ys)).toBeCloseTo(300, 0);
    expect(Math.max(...ys)).toBeCloseTo(500, 0);
  });
});

describe("search", () => {
  it("ranks exact names first", () => {
    expect(searchShapes("heart")[0]!.entry.id).toBe("heart");
    expect(searchShapes("star")[0]!.entry.id).toBe("star");
  });
  it("finds by tag and synonym", () => {
    expect(searchShapes("lightning").map((h) => h.entry.id)).toContain("bolt");
    expect(searchShapes("love").map((h) => h.entry.id)).toContain("heart");
    expect(searchShapes("world").map((h) => h.entry.id)).toContain("globe");
    expect(searchShapes("hearts").map((h) => h.entry.id)).toContain("heart");
  });
  it("requires every word and filters by category", () => {
    const hits = searchShapes("rounded star");
    expect(hits[0]!.entry.id).toBe("rounded-star");
    expect(searchShapes("", { category: "arrows" }).every((h) => h.entry.category === "arrows")).toBe(true);
    expect(searchShapes("zzzqqq")).toHaveLength(0);
    expect(searchShapes("", { limit: 5 })).toHaveLength(5);
  });
});

describe("icon set", () => {
  it("loads lazily, excludes brand marks and renders both styles", async () => {
    const icons = await loadIcons();
    expect(icons.catalog.length).toBeGreaterThan(1000);
    expect(icons.catalog.some(([n]) => /-logo$/.test(n))).toBe(false);
    const all = catalog(icons);
    expect(all.length).toBe(SHAPES.length + icons.catalog.length);
    const coffee = searchShapes("coffee", { icons, category: "icons" });
    expect(coffee[0]!.entry.id).toBe("icon:coffee");
    expectIcon(renderShape("icon:coffee", { weight: 0 }, icons));
    await loadIconWeight("bold");
    expectIcon(renderShape("icon:coffee", { weight: 1 }, icons));
    expect(() => renderShape("icon:not-an-icon", {}, icons)).toThrow();
  });
});

function expectIcon(g: ShapeGeometry) {
  expect(g.paths).toHaveLength(1);
  expect(coords(g.paths[0]!.d).length).toBeGreaterThan(4);
  for (const [x, y] of onCurve(g.paths[0]!.d)) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(100);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(100);
  }
}
