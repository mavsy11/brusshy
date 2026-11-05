import { describe, expect, it } from "vitest";
import {
  applyOps,
  createDoc,
  detectLockupParts,
  fitArtboardToClearSpaceOps,
  listFrames,
  lockupMetrics,
  lockupVersionsOps,
  planLockup,
  visualCentreOf,
  type DocT,
  type OpT,
  type TextNodeT,
  type TypeMetricsFn,
} from "../src";

/** Fake "real font": cap 0.7 em, x 0.5 em, every glyph a 0.6 em wide box from the cap line to the baseline. */
const tm: TypeMetricsFn = (n: TextNodeT) => {
  const w = Array.from(n.text).length * n.fontSize * 0.6;
  const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
  const cap = n.fontSize * 0.7;
  return { capHeight: cap, xHeight: n.fontSize * 0.5, d: `M${x} ${-cap}H${x + w}V0H${x}Z` };
};

function docWith(nodes: Record<string, unknown>[], frame: Record<string, unknown> = {}): { doc: DocT; fid: string } {
  let doc = createDoc("t");
  const fid = listFrames(doc)[0]!.id;
  if (Object.keys(frame).length) doc = applyOps(doc, [{ op: "update", id: fid, set: frame }]).doc;
  doc = applyOps(doc, nodes.map((node) => ({ op: "add", node, parent: (node.parent as string | undefined) ?? fid }) as OpT)).doc;
  return { doc, fid };
}

const icon = (x = 100, y = 100, size = 200, extra: Record<string, unknown> = {}) => ({ id: "icon", type: "shape", shape: "rect", name: "icon", width: size, height: size, transform: { x, y }, style: { fill: "#111111" }, ...extra });
const word = (x = 400, y = 300, extra: Record<string, unknown> = {}) => ({ id: "word", type: "text", text: "ACME", fontSize: 100, transform: { x, y }, style: { fill: "#111111" }, ...extra });

const plan = (doc: DocT, fid: string, o: Parameters<typeof planLockup>[3]) => {
  const parts = detectLockupParts(doc, fid);
  const p = planLockup(doc, fid, parts, o, tm);
  return applyOps(doc, p.ops).doc;
};

describe("lockup parts", () => {
  it("finds the mark by name and the wordmark by type", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const p = detectLockupParts(doc, fid);
    expect(p.mark).toEqual(["icon"]);
    expect(p.wordmark).toEqual(["word"]);
  });

  it("looks inside a single wrapper group and ignores backdrops", () => {
    const { doc, fid } = docWith([
      { id: "bg", type: "shape", shape: "rect", width: 1024, height: 1024, style: { fill: "#f4f1ea" } },
      { id: "logo", type: "group", name: "logo" },
      { ...icon(), parent: "logo", name: "circle" },
      { ...word(), parent: "logo" },
    ]);
    const p = detectLockupParts(doc, fid);
    expect(p.mark).toEqual(["icon"]);
    expect(p.wordmark).toEqual(["word"]);
  });

  it("uses the selection (mark + text) when given", () => {
    const { doc, fid } = docWith([icon(), word(), { id: "other", type: "shape", shape: "ellipse", width: 40, height: 40, transform: { x: 900, y: 900 } }]);
    const p = detectLockupParts(doc, fid, ["other", "word"]);
    expect(p.source).toBe("selection");
    expect(p.mark).toEqual(["other"]);
    expect(p.wordmark).toEqual(["word"]);
  });
});

describe("visual centre", () => {
  it("weights a triangle toward its base, damped halfway", () => {
    const { doc, fid } = docWith([{ id: "tri", type: "path", name: "icon", d: "M100 0L200 300L0 300Z" }, word()]);
    const m = lockupMetrics(doc, fid, { typeMetrics: tm });
    // Centroid of the triangle is at 2/3 of its height.
    expect(m.mark!.mass[1]).toBeCloseTo(200, -0.5);
    expect(visualCentreOf(m.mark!)[1]).toBeCloseTo(175, -0.5);
  });

  it("knockouts weigh nothing", () => {
    const { doc, fid } = docWith([
      { id: "g", type: "group", name: "icon" },
      { id: "disc", type: "shape", shape: "rect", width: 200, height: 200, style: { fill: "#000000" }, parent: "g" },
      { id: "knock", type: "shape", shape: "rect", width: 100, height: 200, style: { fill: "#ffffff" }, parent: "g" },
      word(),
    ]);
    const m = lockupMetrics(doc, fid, { typeMetrics: tm });
    expect(m.mark!.mass[0]).toBeCloseTo(150, -0.5);
  });
});

describe("planLockup", () => {
  it("horizontal: ratio, gap and cap-centre alignment are exact, and the lockup is centred", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const out = plan(doc, fid, { arrangement: "horizontal", ratio: 1.8, gap: 0.75, align: "cap", centre: "bbox" });
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.arrangement).toBe("horizontal");
    expect(m.ratio).toBeCloseTo(1.8, 3);
    expect(m.gapCap).toBeCloseTo(0.75, 3);
    expect(m.align!.cap).toBeCloseTo(0, 3);
    expect(m.centreOffset!.bbox[0]).toBeCloseTo(0, 1);
    expect(m.centreOffset!.bbox[1]).toBeCloseTo(0, 1);
    // The wordmark keeps its size; the mark was scaled.
    expect((out.nodes.word as TextNodeT).fontSize).toBe(100);
    expect(m.mark!.box.h).toBeCloseTo(126, 1);
  });

  it("baseline alignment sits the mark on the baseline; optical centring uses the visual centre", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const out = plan(doc, fid, { arrangement: "horizontal", ratio: 2, gap: 0.5, align: "baseline", centre: "optical" });
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.align!.baseline).toBeCloseTo(0, 3);
    expect(m.centreOffset!.optical[0]).toBeCloseTo(0, 1);
    expect(m.centreOffset!.optical[1]).toBeCloseTo(0, 1);
  });

  it("mark right mirrors the horizontal lockup", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const out = plan(doc, fid, { arrangement: "mark-right", ratio: 1.5, gap: 1 });
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.arrangement).toBe("mark-right");
    expect(m.gapCap).toBeCloseTo(1, 3);
  });

  it("stacked: mark centred over the wordmark at the requested gap", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const out = plan(doc, fid, { arrangement: "stacked", ratio: 3, gap: 0.9 });
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.arrangement).toBe("stacked");
    expect(m.ratio).toBeCloseTo(3, 3);
    expect(m.gapCap).toBeCloseTo(0.9, 3);
    expect(m.stackOffset).toBeCloseTo(0, 3);
  });

  it("wordmark only hides the mark and horizontal brings it back", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const wm = plan(doc, fid, { arrangement: "wordmark-only" });
    expect(wm.nodes.icon!.visible).toBe(false);
    expect(lockupMetrics(wm, fid, { typeMetrics: tm }).arrangement).toBe("wordmark-only");
    // The hidden mark is still found.
    expect(detectLockupParts(wm, fid).mark).toEqual(["icon"]);
    const back = plan(wm, fid, { arrangement: "horizontal" });
    expect(back.nodes.icon!.visible).toBe(true);
    expect(lockupMetrics(back, fid, { typeMetrics: tm }).arrangement).toBe("horizontal");
  });

  it("shrinks a lockup that would break the clear space", () => {
    const { doc, fid } = docWith([icon(), word(400, 300, { text: "ACME INDUSTRIES" })]);
    const out = plan(doc, fid, { arrangement: "horizontal", ratio: 1.8, clearSpace: { unit: "cap", amount: 1 } });
    const m = lockupMetrics(out, fid, { typeMetrics: tm, clearSpace: { unit: "cap", amount: 1 } });
    expect(m.clearSpace!.ok).toBe(true);
    expect(m.ratio).toBeCloseTo(1.8, 3);
    expect((out.nodes.word as TextNodeT).fontSize).toBeLessThan(100);
  });

  it("works through transformed parent groups", () => {
    const { doc, fid } = docWith([
      { id: "logo", type: "group", name: "logo", transform: { x: 40, y: 30, scaleX: 1.5, scaleY: 1.5 } },
      { ...icon(10, 10, 120), parent: "logo" },
      { ...word(200, 150, { fontSize: 60 }), parent: "logo" },
    ]);
    const out = plan(doc, fid, { arrangement: "horizontal", ratio: 2.2, gap: 0.6, align: "cap" });
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.ratio).toBeCloseTo(2.2, 3);
    expect(m.gapCap).toBeCloseTo(0.6, 3);
    expect(m.align!.cap).toBeCloseTo(0, 3);
  });

  it("a fixed (AI-locked) mark keeps its size and place; the wordmark is scaled instead", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const parts = detectLockupParts(doc, fid);
    const p = planLockup(doc, fid, parts, { arrangement: "horizontal", ratio: 2.5, fixed: "mark" }, tm);
    expect(p.ops.some((o) => o.op === "update" && o.id === "icon")).toBe(false);
    const out = applyOps(doc, p.ops).doc;
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.ratio).toBeCloseTo(2.5, 3);
    expect((out.nodes.word as TextNodeT).fontSize).toBeCloseTo(200 / (2.5 * 0.7), 1);
    expect(() => planLockup(doc, fid, parts, { arrangement: "wordmark-only", fixed: "mark" }, tm)).toThrow(/locked/);
  });

  it("gap in mark strokes", () => {
    const { doc, fid } = docWith([
      { id: "ring", type: "shape", shape: "ellipse", name: "icon", width: 200, height: 200, transform: { x: 100, y: 100 }, style: { fill: null, stroke: "#000", strokeWidth: 20 } },
      word(),
    ]);
    const out = plan(doc, fid, { arrangement: "horizontal", ratio: 2, gap: 3, gapUnit: "stroke" });
    const m = lockupMetrics(out, fid, { typeMetrics: tm });
    expect(m.mark!.strokeExplicit).toBe(true);
    expect(m.gapStroke).toBeCloseTo(3, 2);
  });
});

describe("clear space, minimum size and versions", () => {
  it("fits the artboard to the clear space", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const h = plan(doc, fid, { arrangement: "horizontal", ratio: 1.8, gap: 0.75 });
    const parts = detectLockupParts(h, fid);
    const out = applyOps(h, fitArtboardToClearSpaceOps(h, fid, parts, { unit: "x", amount: 2 }, tm)).doc;
    const m = lockupMetrics(out, fid, { typeMetrics: tm, clearSpace: { unit: "x", amount: 2 } });
    expect(m.clearSpace!.value).toBeCloseTo(100, 1);
    expect(m.clearSpace!.ok).toBe(true);
    for (const v of Object.values(m.clearSpace!.margins)) expect(Math.abs(v - 100)).toBeLessThan(0.6);
  });

  it("suggests a minimum size from the cap height", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const m = lockupMetrics(doc, fid, { typeMetrics: tm });
    expect(m.minSize!.limitedBy).toBe("cap height");
    expect(m.minSize!.px).toBe(Math.ceil((m.bounds!.w * 6) / 70));
  });

  it("makes one fitted version per arrangement, side by side", () => {
    const { doc, fid } = docWith([icon(), word()]);
    const parts = detectLockupParts(doc, fid);
    const r = lockupVersionsOps(doc, fid, parts, ["horizontal", "stacked", "wordmark-only", "icon-only"], {}, tm);
    const out = applyOps(doc, r.ops).doc;
    const frames = listFrames(out);
    expect(frames.map((f) => f.name)).toEqual(["V1", "V1 Horizontal", "V1 Stacked", "V1 Wordmark", "V1 Icon"]);
    for (const f of r.frames) {
      const m = lockupMetrics(out, f.id, { typeMetrics: tm });
      expect(m.arrangement).toBe(f.arrangement);
      expect(m.clearSpace!.ok).toBe(true);
    }
    // Versions sit left to right without overlapping.
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.transform.x).toBeGreaterThan(frames[i - 1]!.transform.x + frames[i - 1]!.width);
    // The source version is untouched.
    expect(out.nodes.icon).toEqual(doc.nodes.icon);
  });
});
