import { describe, expect, it } from "vitest";
import { applyOps, createDoc, listFrames, vectorize, vectorizeOps, vectorizeSvg, type RasterImage } from "../src";

/** Paint a W×H RGBA image: paper, then `ink(x, y)` returning a color or null. */
function raster(W: number, H: number, ink: (x: number, y: number) => [number, number, number] | null, paper: [number, number, number] = [246, 244, 238]): RasterImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = ink(x + 0.5, y + 0.5) ?? paper;
      data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    }
  return { width: W, height: H, data };
}

const subpaths = (d: string) => (d.match(/M/g) ?? []).length;

describe("vectorize: shapes", () => {
  it("traces a ring as one part with its hole, and drops specks", () => {
    const img = raster(200, 200, (x, y) => {
      const r = Math.hypot(x - 100, y - 100);
      if (r < 70 && r > 35) return [20, 20, 24];
      if (Math.hypot(x - 10, y - 10) < 1.2) return [20, 20, 24]; // speck
      return null;
    });
    const r = vectorize(img, { mode: "shapes" });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]!.kind).toBe("fill");
    expect(r.layers[0]!.parts).toHaveLength(1);
    expect(subpaths(r.layers[0]!.parts[0]!.d)).toBe(2);
    // Circles fit with few curve nodes.
    expect(r.layers[0]!.parts[0]!.nodes).toBeLessThan(24);
    expect(r.threshold).toBeGreaterThan(0);
  });

  it("keeps square corners sharp and straight edges as lines", () => {
    const img = raster(160, 160, (x, y) => (x > 30 && x < 130 && y > 40 && y < 120 ? [200, 30, 40] : null));
    const r = vectorize(img, { mode: "shapes" });
    const d = r.layers[0]!.parts[0]!.d;
    expect(d).not.toContain("C");
    expect((d.match(/L/g) ?? []).length).toBeLessThanOrEqual(4);
    expect(r.layers[0]!.color).toMatch(/^#c[89a-f]/i);
    // Corner lands on the pixel corner.
    expect(d.startsWith("M30 40") || /[ML]30 40/.test(d) || /[ML]130 40/.test(d)).toBe(true);
  });

  it("separates colors into stacked layers", () => {
    const img = raster(200, 120, (x, y) => {
      if (x > 20 && x < 90 && y > 20 && y < 100) return [230, 70, 30];
      if (x > 110 && x < 180 && y > 20 && y < 100) return [30, 60, 200];
      return null;
    });
    const r = vectorize(img, { mode: "shapes", colors: 2 });
    expect(r.layers).toHaveLength(2);
    const colors = r.layers.map((l) => l.color);
    expect(colors.some((c) => parseInt(c.slice(1, 3), 16) > 200)).toBe(true);
    expect(colors.some((c) => parseInt(c.slice(5, 7), 16) > 180)).toBe(true);
  });

  it("is deterministic and maps to the target size", () => {
    const img = raster(120, 80, (x, y) => (Math.hypot(x - 60, y - 40) < 30 ? [0, 0, 0] : null));
    const a = vectorize(img, { target: { width: 600, height: 400 } });
    const b = vectorize(img, { target: { width: 600, height: 400 } });
    expect(a.layers).toEqual(b.layers);
    expect(a.width).toBe(600);
    const xs = [...a.layers[0]!.parts[0]!.d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
    expect(Math.max(...xs)).toBeGreaterThan(400);
    expect(a.layers[0]!.color).toBe("#000000");
  });
});

describe("vectorize: lines", () => {
  it("turns thick pencil strokes into centerline strokes", () => {
    // A cross of two 9px-wide bars + a separate arc.
    const img = raster(240, 240, (x, y) => {
      if (Math.abs(x - 80) < 4.5 && y > 20 && y < 140) return [70, 70, 75];
      if (Math.abs(y - 80) < 4.5 && x > 20 && x < 140) return [70, 70, 75];
      const r = Math.hypot(x - 170, y - 170);
      if (Math.abs(r - 45) < 4 && y > 170) return [60, 60, 66];
      return null;
    });
    const r = vectorize(img, { mode: "lines" });
    expect(r.layers).toHaveLength(1);
    const l = r.layers[0]!;
    expect(l.kind).toBe("stroke");
    expect(l.color).toBe("#0b0c0e");
    // The cross joins straight through the junction: 2 strokes, plus the arc.
    expect(l.parts).toHaveLength(3);
    expect(l.strokeWidth).toBeGreaterThan(6);
    expect(l.strokeWidth).toBeLessThan(12);
  });
});

describe("vectorizeOps", () => {
  it("adds one group over the reference with the same transform", () => {
    let doc = createDoc("t");
    const frame = listFrames(doc)[0]!;
    doc = applyOps(doc, [
      { op: "add", node: { id: "ref1", type: "reference", src: "refs/a.png", width: 400, height: 300, transform: { x: 50, y: 60, rotation: 5, scaleX: 1.2, scaleY: 1.2 } }, parent: frame.id },
    ]).doc;
    const img = raster(100, 75, (x, y) => (x > 20 && x < 80 && y > 20 && y < 55 ? [0, 0, 0] : null));
    const r = vectorize(img, { target: { width: 400, height: 300 } });
    const { ops, groupId } = vectorizeOps(doc, "ref1", r);
    const after = applyOps(doc, ops).doc;
    const g = after.nodes[groupId]!;
    expect(g.type).toBe("group");
    expect(g.transform).toEqual(doc.nodes.ref1!.transform);
    expect(g.parent).toBe(frame.id);
    const kids = (after.nodes[frame.id] as { children: string[] }).children;
    expect(kids.indexOf(groupId)).toBe(kids.indexOf("ref1") + 1);
    expect(vectorizeSvg(r)).toContain("<path");
  });
});
