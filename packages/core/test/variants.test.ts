import { describe, expect, it } from "vitest";
import { applyOps, continueWithVariantOps, createDoc, keepAllVariantsOps, listFrames, makeVariantsOps, nextVersionName } from "../src";

describe("variants", () => {
  const withLogo = () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    return applyOps(doc, [{ op: "add", node: { type: "shape", shape: "ellipse", width: 100, height: 100 }, parent: f.id }]).doc;
  };

  it("lays out N copies in a row sharing a batch, then continues with one", () => {
    const doc = withLogo();
    const src = listFrames(doc)[0]!;
    const v = makeVariantsOps(doc, { count: 4, from: src.id });
    const a = applyOps(doc, v.ops).doc;
    const frames = listFrames(a);
    expect(frames).toHaveLength(5);
    const batch = frames.filter((f) => f.batch === v.batch);
    expect(batch.map((f) => f.name)).toEqual(["V2 A", "V2 B", "V2 C", "V2 D"]);
    expect(batch.every((f) => f.children.length === 1)).toBe(true);
    const xs = batch.map((f) => f.transform.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    expect(new Set(xs).size).toBe(4);
    // "V2 A".."V2 D" reserve V2.
    expect(nextVersionName(a)).toBe("V3");

    const b = applyOps(a, continueWithVariantOps(a, v.frameIds[2]!));
    const left = listFrames(b.doc);
    expect(left.map((f) => f.name)).toEqual(["V1", "V2"]);
    expect(left[1]!.batch).toBeNull();
    expect(Object.values(b.doc.nodes).filter((n) => n.type === "shape")).toHaveLength(2);
    // One undo step brings every variant back.
    expect(listFrames(applyOps(b.doc, b.inverse).doc)).toHaveLength(5);
  });

  it("makes blank variants and can keep them all", () => {
    const doc = withLogo();
    const v = makeVariantsOps(doc, { count: 2, from: listFrames(doc)[0]!.id, blank: true });
    const a = applyOps(doc, v.ops).doc;
    expect(v.frameIds.map((id) => (a.nodes[id] as { children: string[] }).children.length)).toEqual([0, 0]);
    const k = applyOps(a, keepAllVariantsOps(a, v.batch)).doc;
    expect(listFrames(k).every((f) => !f.batch)).toBe(true);
  });
});
