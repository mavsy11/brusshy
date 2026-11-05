import { describe, expect, it } from "vitest";
import { applyOps, bridgeIslands, createDoc, listFrames, photoLikelihood, vectorizeOps, vectorizePhoto, type RasterImage } from "../src";
import { maskIoU, syntheticBottle, syntheticCat, syntheticMug } from "./fixtures/photos";

const subpaths = (d: string) => (d.match(/M/g) ?? []).length;
const numbers = (d: string) => [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));

const mug = syntheticMug(450, 350);
const cat = syntheticCat(400, 400);
const bottle = syntheticBottle(350, 450);

describe("vectorizePhoto: subject isolation", () => {
  it("cuts a mug out of a textured table, shadow and all, keeping the handle hole", () => {
    const r = vectorizePhoto(mug.image, { style: "silhouette" });
    expect(r.subject.source).toBe("border");
    expect(maskIoU(r.mask, mug.truth, 450, 350)).toBeGreaterThan(0.93);
    expect(r.layers).toHaveLength(1);
    const part = r.layers[0]!.parts;
    expect(part).toHaveLength(1);
    // Outline + the hole inside the handle.
    expect(subpaths(part[0]!.d)).toBe(2);
    expect(r.stats.nodes).toBeLessThan(120);
    expect(r.layers[0]!.color).toBe("#0b0c0e");
  });

  it("drops a cast shadow on a two-tone backdrop; fill holes closes light patches", () => {
    const r = vectorizePhoto(cat.image, { style: "silhouette" });
    const iou = maskIoU(r.mask, cat.truth, 400, 400);
    expect(iou).toBeGreaterThan(0.8);
    const filled = vectorizePhoto(cat.image, { style: "silhouette", fillHoles: true });
    expect(subpaths(filled.layers[0]!.parts[0]!.d)).toBe(1);
    expect(filled.subject.coverage).toBeGreaterThan(r.subject.coverage);
  });

  it("finds a light subject on a dark gradient (and the lighter hint agrees)", () => {
    const a = vectorizePhoto(bottle.image, { style: "silhouette" });
    const b = vectorizePhoto(bottle.image, { style: "silhouette", subject: "lighter" });
    expect(maskIoU(a.mask, bottle.truth, 350, 450)).toBeGreaterThan(0.88);
    expect(maskIoU(b.mask, bottle.truth, 350, 450)).toBeGreaterThan(0.88);
  });

  it("is deterministic", () => {
    const a = vectorizePhoto(mug.image, { style: "posterized", tones: 3 });
    const b = vectorizePhoto(mug.image, { style: "posterized", tones: 3 });
    expect(a.layers).toEqual(b.layers);
  });

  it("uses an external mask (the optional ML hook) and transparent cut-outs", () => {
    const m = new Uint8ClampedArray(450 * 350 * 4);
    for (let p = 0; p < 450 * 350; p++) m.set(mug.truth[p] ? [255, 255, 255, 255] : [0, 0, 0, 255], p * 4);
    const r = vectorizePhoto(mug.image, { subjectMask: { width: 450, height: 350, data: m } });
    expect(r.subject.source).toBe("mask");
    expect(maskIoU(r.mask, mug.truth, 450, 350)).toBeGreaterThan(0.97);

    const cut = new Uint8ClampedArray(mug.image.data as Uint8ClampedArray);
    for (let p = 0; p < 450 * 350; p++) if (!mug.truth[p]) cut[p * 4 + 3] = 0;
    const t = vectorizePhoto({ width: 450, height: 350, data: cut });
    expect(t.subject.source).toBe("alpha");
    expect(maskIoU(t.mask, mug.truth, 450, 350)).toBeGreaterThan(0.97);
  });

  it("crops, and maps the crop back onto the reference exactly", () => {
    const crop = { x: 0.1, y: 0.15, width: 0.6, height: 0.75 };
    const r = vectorizePhoto(mug.image, { crop, target: { width: 900, height: 700 } });
    expect(r.crop.x).toBeCloseTo(0.1, 2);
    const xs = numbers(r.layers[0]!.parts[0]!.d);
    const X = xs.filter((_, i) => i % 2 === 0);
    const Y = xs.filter((_, i) => i % 2 === 1);
    expect(Math.min(...X)).toBeGreaterThanOrEqual(0.1 * 900 - 1);
    expect(Math.max(...X)).toBeLessThanOrEqual(0.7 * 900 + 1);
    expect(Math.min(...Y)).toBeGreaterThanOrEqual(0.15 * 700 - 1);
    // Same mug as without the crop (within a few units).
    const full = vectorizePhoto(mug.image, { target: { width: 900, height: 700 } });
    const fx = numbers(full.subject.parts[0]!.d).filter((_, i) => i % 2 === 0);
    expect(Math.abs(Math.min(...fx) - Math.min(...X))).toBeLessThan(6);
  });

  it("can skip isolation and treat the whole crop as the subject", () => {
    const r = vectorizePhoto(mug.image, { isolate: false, style: "silhouette" });
    expect(r.subject.source).toBe("all");
    expect(r.subject.coverage).toBe(1);
  });
});

describe("vectorizePhoto: styles", () => {
  it("posterized: stacked tonal layers, lightest at the bottom", () => {
    const r = vectorizePhoto(mug.image, { style: "posterized", tones: 3 });
    expect(r.layers.length).toBeGreaterThanOrEqual(2);
    expect(r.layers.length).toBeLessThanOrEqual(3);
    const lum = (c: string) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
    expect(lum(r.layers[0]!.color)).toBeGreaterThan(lum(r.layers[r.layers.length - 1]!.color));
    const mono = vectorizePhoto(mug.image, { style: "posterized", tones: 4, palette: "mono" });
    for (const l of mono.layers) expect(l.color.slice(1, 3)).toBe(l.color.slice(3, 5));
  });

  it("line art: centerline strokes for the outline and the inner edges", () => {
    const r = vectorizePhoto(mug.image, { style: "lineart" });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]!.kind).toBe("stroke");
    expect(r.layers[0]!.parts.length).toBeGreaterThanOrEqual(2);
    expect(r.layers[0]!.strokeWidth).toBeGreaterThan(0);
  });

  it("stencil: every cut piece is a single outline (no islands that would fall out)", () => {
    const r = vectorizePhoto(cat.image, { style: "stencil", tones: 2 });
    expect(r.layers).toHaveLength(1);
    expect(r.bridges).toBeGreaterThan(0);
    for (const p of r.layers[0]!.parts) expect(subpaths(p.d)).toBe(1);
  });

  it("bridgeIslands ties every enclosed island to the outside", () => {
    const w = 80;
    const h = 80;
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - 40, y - 40);
        // A ring around a disc around a ring: two enclosed islands.
        if ((r > 10 && r < 18) || (r > 26 && r < 34)) m[y * w + x] = 1;
      }
    expect(bridgeIslands(m, w, h, 1.5)).toBe(2);
    // Now all background is one 4-connected region.
    const seen = new Uint8Array(w * h);
    const stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w])
        if (q >= 0 && q < w * h && !m[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
    }
    for (let p = 0; p < w * h; p++) if (!m[p]) expect(seen[p]).toBe(1);
  });

  it("lands as one group over the reference via vectorizeOps", () => {
    let doc = createDoc("t");
    const frame = listFrames(doc)[0]!;
    doc = applyOps(doc, [
      {
        op: "add",
        node: { id: "ref", type: "reference", src: "data:image/png;base64,AA", width: 900, height: 700, transform: { x: 30, y: 40, rotation: 0, scaleX: 1, scaleY: 1 } },
        parent: frame.id,
      },
    ]).doc;
    const r = vectorizePhoto(mug.image, { style: "posterized", tones: 3, target: { width: 900, height: 700 } });
    const { ops, groupId } = vectorizeOps(doc, "ref", r, { name: "Photo trace" });
    const next = applyOps(doc, ops).doc;
    expect(next.nodes[groupId]!.name).toBe("Photo trace");
    expect(next.nodes[groupId]!.transform.x).toBe(30);
  });
});

describe("photoLikelihood", () => {
  it("tells photos from flat artwork", () => {
    const flat: RasterImage = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).map((_, i) => (i % 4 === 3 ? 255 : i % 400 < 200 ? 0 : 255)) };
    expect(photoLikelihood(mug.image)).toBeGreaterThan(0.5);
    expect(photoLikelihood(flat)).toBeLessThan(0.2);
  });
});
