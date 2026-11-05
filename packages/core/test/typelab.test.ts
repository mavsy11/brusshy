import { describe, expect, it } from "vitest";
import {
  addEffectOps,
  applyOps,
  createDoc,
  effectLayers,
  effectsGroupOf,
  envelopeFromWarp,
  envelopeWarp,
  fitPolyline,
  identityEnvelope,
  listFrames,
  mappedBounds,
  newId,
  parsePath,
  prepareWarp,
  presetWarp,
  regenerateEffectsOps,
  removeEffectOps,
  segmentPoint,
  warpCommitOps,
  warpPathData,
  WARP_PRESETS,
  type DocT,
  type P,
} from "../src";

const box = { x: 0, y: 0, w: 400, h: 100 };
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}Z`;

/** Max distance from the exact warp of the original (dense samples) to the warped outline (as a fine polyline). */
function warpError(d: string, out: string, f: (p: P) => P): number {
  const sample = (subs: ReturnType<typeof parsePath>, k: number, map: (p: P) => P) =>
    subs.map((s) => {
      const n = s.anchors.length;
      const segs = s.closed ? n : n - 1;
      const pts: P[] = [];
      for (let i = 0; i < segs; i++) for (let j = 0; j < k; j++) pts.push(map(segmentPoint(s.anchors[i]!, s.anchors[(i + 1) % n]!, j / k)));
      if (s.closed) pts.push(pts[0]!);
      return pts;
    });
  const exact = sample(parsePath(d), 24, f).flat();
  const lines = sample(parsePath(out), 64, (p) => p);
  const segDist = (p: P, a: P, b: P) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  let worst = 0;
  for (const p of exact) {
    let best = Infinity;
    for (const pl of lines) for (let i = 0; i + 1 < pl.length; i++) best = Math.min(best, segDist(p, pl[i]!, pl[i + 1]!));
    worst = Math.max(worst, best);
  }
  return worst;
}

const nodeCount = (d: string) => parsePath(d).reduce((a, s) => a + s.anchors.length, 0);

function docWith(nodes: Record<string, unknown>[]): { doc: DocT; ids: string[] } {
  let doc = createDoc("t");
  const frame = listFrames(doc)[0]!.id;
  const r = applyOps(
    doc,
    nodes.map((node) => ({ op: "add", node, parent: frame })),
  );
  doc = r.doc;
  return { doc, ids: r.created };
}

describe("warp presets", () => {
  it("amount 0 is the identity for every preset", () => {
    for (const p of WARP_PRESETS) {
      const f = presetWarp(p, 0, box);
      expect(f([123, 45])).toEqual([123, 45]);
    }
  });

  it("arc bends around a circle and keeps the centre", () => {
    const f = presetWarp("arc", 50, box);
    const c = f([200, 50]);
    expect(c[0]).toBeCloseTo(200, 6);
    expect(c[1]).toBeCloseTo(50, 6);
    // Positive sweep arches up: the ends drop below the middle.
    expect(f([0, 50])[1]).toBeGreaterThan(55);
    expect(f([400, 50])[1]).toBeGreaterThan(55);
    // Mirror symmetric.
    expect(f([0, 50])[0] + f([400, 50])[0]).toBeCloseTo(400, 6);
  });

  it("vertical orientation runs the warp along y", () => {
    const fh = presetWarp("arch", 60, { x: 0, y: 0, w: 100, h: 400 }, "vertical");
    const p = fh([50, 200]);
    expect(p[1]).toBeCloseTo(200, 6);
    expect(p[0]).toBeLessThan(50);
  });

  it("perspective keeps straight lines straight", () => {
    const d = "M0 0L400 0L400 100L0 100Z M100 20L300 20L300 80L100 80Z";
    const out = warpPathData(d, presetWarp("perspective", 70, box), 0.05);
    expect(out).not.toMatch(/C/);
    expect(nodeCount(out)).toBe(8);
  });

  it("warps curves accurately with modest node counts", () => {
    const d = circle(200, 50, 40) + "M20 10L120 10L120 90L20 90Z";
    for (const p of WARP_PRESETS) {
      const f = presetWarp(p, 80, box);
      const out = warpPathData(d, f, 0.15);
      expect(warpError(d, out, f)).toBeLessThan(0.3);
      expect(nodeCount(out)).toBeLessThan(120);
    }
  });

  it("uses the transform between a layer and the warp space", () => {
    const f = presetWarp("arch", 50, box);
    const M: [number, number, number, number, number, number] = [2, 0, 0, 2, 100, 0];
    const out = warpPathData("M0 0L100 0", f, 0.05, M);
    // (0,0) local → (100,0) in warp space → arch lifts it, then back to local.
    const first = parsePath(out)[0]!.anchors[0]!.p;
    const expected = f([100, 0]);
    expect(first[0]).toBeCloseTo((expected[0] - 100) / 2, 1);
    expect(first[1]).toBeCloseTo(expected[1] / 2, 1);
  });
});

describe("free envelope", () => {
  it("a flat envelope is the identity", () => {
    for (const [r, c] of [
      [1, 1],
      [2, 2],
    ] as const) {
      const f = envelopeWarp(identityEnvelope(r, c), box);
      const q = f([137, 61]);
      expect(q[0]).toBeCloseTo(137, 6);
      expect(q[1]).toBeCloseTo(61, 6);
    }
  });

  it("sampling a preset into an envelope matches it at the mesh nodes and closely in between", () => {
    const pre = presetWarp("arch", 60, box);
    const env = envelopeFromWarp(pre, box, 2, 2);
    const f = envelopeWarp(env, box);
    for (const [u, v] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ])
      expect(Math.hypot(f([u * 400, v * 100])[0] - pre([u * 400, v * 100])[0], f([u * 400, v * 100])[1] - pre([u * 400, v * 100])[1])).toBeLessThan(1e-6);
    const a = f([100, 30]);
    const b = pre([100, 30]);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(2);
  });
});

describe("warp on a document", () => {
  it("re-edits from the original geometry, resets, and notices hand edits", () => {
    const { doc, ids } = docWith([
      { type: "path", d: "M0 0L200 0L200 50L0 50Z" },
      { type: "shape", shape: "ellipse", width: 50, height: 50, transform: { x: 220, y: 0 } },
    ]);
    const t = prepareWarp(doc, ids);
    expect(t.structOps.length).toBe(2); // the ellipse becomes a path
    const d1 = applyOps(doc, warpCommitOps(t, { preset: "arch", amount: 40, orientation: "horizontal" })).doc;
    expect(d1.nodes[ids[1]!]!.type).toBe("path");
    expect(d1.nodes[ids[0]!]!.warp?.members).toEqual(ids);
    // Re-open: same record, base = original geometry.
    const t2 = prepareWarp(d1, ids);
    expect(t2.current?.preset).toBe("arch");
    expect(t2.leaves.find((l) => l.id === ids[0])!.base).toBe("M0 0L200 0L200 50L0 50Z");
    // Reset: original geometry back, record cleared.
    const d2 = applyOps(d1, warpCommitOps(t2, { preset: "arch", amount: 0, orientation: "horizontal" })).doc;
    expect((d2.nodes[ids[0]!] as { d: string }).d).toBe("M0 0L200 0L200 50L0 50Z");
    expect(d2.nodes[ids[0]!]!.warp ?? null).toBeNull();
    // Hand edit after a warp: the next warp starts from the current shape.
    const d3 = applyOps(d1, [{ op: "update", id: ids[0]!, set: { d: "M0 0L10 0L10 10Z" } }]).doc;
    expect(prepareWarp(d3, ids).current).toBeNull();
  });

  it("letters text in the same step and needs glyphs", () => {
    const { doc, ids } = docWith([{ type: "text", text: "AB", fontSize: 64 }]);
    expect(() => prepareWarp(doc, ids)).toThrow(/glyph/);
    const glyphs = { [ids[0]!]: [{ text: "A", d: "M0 0L20 -40L40 0Z" }, { text: "B", d: "M50 0L50 -40L80 -40L80 0Z" }] };
    const t = prepareWarp(doc, ids, { glyphs });
    expect(t.leaves.length).toBe(2);
    const d1 = applyOps(doc, warpCommitOps(t, { preset: "flag", amount: 50, orientation: "horizontal" })).doc;
    expect(d1.nodes[ids[0]!]!.type).toBe("group");
    expect(d1.nodes[ids[0]!]!.warp?.preset).toBe("flag");
  });
});

describe("curve fitting", () => {
  it("fits a dense circle with a handful of smooth nodes", () => {
    const pts: P[] = Array.from({ length: 360 }, (_, i) => [100 + 50 * Math.cos((i * Math.PI) / 180), 100 + 50 * Math.sin((i * Math.PI) / 180)]);
    const s = fitPolyline(pts, true, 0.1)!;
    expect(s.anchors.length).toBeLessThanOrEqual(8);
    for (let i = 0; i < s.anchors.length; i++)
      for (let k = 0; k <= 10; k++) {
        const p = segmentPoint(s.anchors[i]!, s.anchors[(i + 1) % s.anchors.length]!, k / 10);
        expect(Math.abs(Math.hypot(p[0] - 100, p[1] - 100) - 50)).toBeLessThan(0.3);
      }
  });

  it("keeps corners and straight sides", () => {
    const s = fitPolyline(
      [
        [0, 0],
        [50, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      true,
      0.1,
    )!;
    expect(s.anchors.length).toBe(4);
    expect(s.anchors.every((a) => !a.cin && !a.cout)).toBe(true);
  });
});

describe("effects", () => {
  const square = () => docWith([{ type: "path", name: "Mark", d: "M0 0L100 0L100 100L0 100Z", style: { fill: "#225588" } }]);

  it("outline: a ring at gap..gap+width around the letters, as a sibling in an effects group", () => {
    const { doc, ids } = square();
    const plan = addEffectOps(doc, ids, "outline", { gap: 10, width: 5, corners: "miter" }, { newId });
    const d1 = applyOps(doc, plan.ops).doc;
    expect(effectsGroupOf(d1, ids[0]!)).toBe(plan.groupId);
    const layer = d1.nodes[plan.layerId]!;
    expect(layer.name).toBe("Mark outline");
    expect(layer.style.fill).toBe("#225588");
    const b = mappedBounds((layer as { d: string }).d)!;
    expect(b.x).toBeCloseTo(-15, 0);
    expect(b.w).toBeCloseTo(130, 0);
    // Under the source.
    const g = d1.nodes[plan.groupId] as { children: string[] };
    expect(g.children.indexOf(plan.layerId)).toBeLessThan(g.children.indexOf(ids[0]!));
  });

  it("long shadow sweeps the shape into one clean silhouette", () => {
    const { doc, ids } = square();
    const plan = addEffectOps(doc, ids, "shadow", { style: "long", angle: 0, distance: 50 }, { newId });
    const b = mappedBounds(plan.d)!;
    expect(b.x).toBeCloseTo(0, 0);
    expect(b.w).toBeCloseTo(150, 0);
    expect(parsePath(plan.d).length).toBe(1);
  });

  it("inline fits inside, or explains why not", () => {
    const { doc, ids } = square();
    const plan = addEffectOps(doc, ids, "inline", { inset: 10, width: 4 }, { newId });
    const b = mappedBounds(plan.d)!;
    expect(b.x).toBeCloseTo(10, 0);
    expect(() => addEffectOps(doc, ids, "inline", { inset: 60, width: 4 }, { newId })).toThrow(/inline/);
  });

  it("re-adding a kind updates it; regenerate follows the sources; removing the last unwraps", () => {
    const { doc, ids } = square();
    const p1 = addEffectOps(doc, ids, "outline", { gap: 4, width: 4 }, { newId });
    const d1 = applyOps(doc, p1.ops).doc;
    const p2 = addEffectOps(d1, [p1.groupId], "outline", { width: 12 }, { newId });
    expect(p2.layerId).toBe(p1.layerId);
    expect(p2.params.gap).toBe(4);
    const d2 = applyOps(d1, p2.ops).doc;
    expect(Object.keys(effectLayers(d2, p1.groupId))).toEqual(["outline"]);
    // The source grows: regenerate follows.
    const d3 = applyOps(d2, [{ op: "update", id: ids[0]!, set: { d: "M0 0L200 0L200 100L0 100Z" } }]).doc;
    const d4 = applyOps(d3, regenerateEffectsOps(d3, p1.groupId)).doc;
    expect(mappedBounds((d4.nodes[p1.layerId] as { d: string }).d)!.w).toBeCloseTo(232, 0);
    const d5 = applyOps(d4, removeEffectOps(d4, p1.layerId)).doc;
    expect(d5.nodes[p1.groupId]).toBeUndefined();
    expect(d5.nodes[ids[0]!]!.parent).toBe(listFrames(d5)[0]!.id);
  });
});

describe("warp + effects together", () => {
  it("re-edits a warp after the warped layers were wrapped into an effects group", () => {
    const { doc, ids } = docWith([
      { type: "path", d: "M0 0L200 0L200 50L0 50Z" },
      { type: "path", d: "M0 60L200 60L200 70L0 70Z" },
    ]);
    const d1 = applyOps(doc, warpCommitOps(prepareWarp(doc, ids), { preset: "arc", amount: 30, orientation: "horizontal" })).doc;
    const plan = addEffectOps(d1, [ids[0]!], "outline", {}, { newId });
    const d2 = applyOps(d1, plan.ops).doc;
    const t = prepareWarp(d2, [plan.groupId, ids[1]!]);
    expect(t.current?.preset).toBe("arc");
    expect(t.leaves.map((l) => l.base)).toContain("M0 0L200 0L200 50L0 50Z");
    // Committing moves the record onto the new members and clears the old copy.
    const d3 = applyOps(d2, warpCommitOps(t, { preset: "arc", amount: 50, orientation: "horizontal" })).doc;
    expect(d3.nodes[ids[0]!]!.warp ?? null).toBeNull();
    expect(d3.nodes[plan.groupId]!.warp?.amount).toBe(50);
    expect(prepareWarp(d3, [plan.groupId, ids[1]!]).current?.amount).toBe(50);
  });
});
