import { describe, expect, it } from "vitest";
import {
  applyOps,
  arrangeLetters,
  baselineLetterOps,
  createDoc,
  featureOn,
  fontTraits,
  hasTypeControls,
  kernLetterOps,
  letterBoxes,
  letteringOps,
  lettersOf,
  parseDoc,
  scaleLetterOps,
  scorePairing,
  suggestPairings,
  swapLetterOps,
  toggleFeature,
  type DocT,
} from "../src";

const frameOf = (doc: DocT) => doc.root[0]!;

function textDoc(extra: Record<string, unknown> = {}) {
  const doc = createDoc("Type");
  return applyOps(doc, [{ op: "add", node: { id: "t", type: "text", text: "Brand", fontFamily: "Inter", ...extra }, parent: frameOf(doc) }]).doc;
}

/** A lettering group with three square "letters" 40 wide, 10 apart, baseline at y=0. */
function letteringDoc() {
  const doc = textDoc({ fontWeight: 700, axes: { wght: 640 }, features: ["ss01"] });
  const sq = (x: number) => `M${x} 0L${x} -50L${x + 40} -50L${x + 40} 0Z`;
  const glyphs = [
    { text: "A", d: sq(0) },
    { text: "B", d: sq(50) },
    { text: "C", d: sq(100) },
  ];
  return applyOps(doc, letteringOps(doc, "t", glyphs).ops).doc;
}

describe("type controls on text nodes", () => {
  it("accepts axes, features, alternates and kerning, and keeps old nodes untouched", () => {
    const doc = textDoc({ axes: { wght: 640, wdth: 87.5, GRAD: -20 }, features: ["ss01", "-liga"], alternates: { "2": "salt:2" }, kerning: "optical", kerns: [0, 20, -10] });
    const t = doc.nodes.t!;
    expect(t.type === "text" && t.axes).toEqual({ wght: 640, wdth: 87.5, GRAD: -20 });
    const plain = textDoc().nodes.t!;
    expect(plain.type === "text" && plain.axes).toBeUndefined();
    expect(hasTypeControls(plain as never)).toBe(false);
    expect(hasTypeControls(t as never)).toBe(true);
    // Survives a save/load round trip.
    expect(parseDoc(JSON.parse(JSON.stringify(doc))).nodes.t).toEqual(t);
  });

  it("rejects malformed tags", () => {
    expect(() => textDoc({ features: ["stylistic"] })).toThrow();
    expect(() => textDoc({ axes: { weight: 700 } })).toThrow();
    expect(() => textDoc({ alternates: { a: "salt" } })).toThrow();
    expect(() => textDoc({ kerning: "auto" })).toThrow();
  });

  it("updates with undo in one step", () => {
    const doc = textDoc();
    const r = applyOps(doc, [{ op: "update", id: "t", set: { axes: { wght: 300 }, features: ["swsh"] } }]);
    const back = applyOps(r.doc, r.inverse).doc.nodes.t!;
    expect(back.type === "text" && back.axes).toBeFalsy();
    expect(back.type === "text" && back.features).toBeFalsy();
  });

  it("feature on/off keeps the list minimal", () => {
    expect(featureOn(undefined, "liga")).toBe(true);
    expect(featureOn(undefined, "ss01")).toBe(false);
    expect(toggleFeature([], "liga", false)).toEqual(["-liga"]);
    expect(toggleFeature(["-liga"], "liga", true)).toEqual([]);
    expect(toggleFeature(["ss01"], "ss02", true)).toEqual(["ss01", "ss02"]);
    expect(toggleFeature(["ss01", "ss02"], "ss01", false)).toEqual(["ss02"]);
  });
});

describe("type system (doc op)", () => {
  it("sets, merges, undoes and clears", () => {
    const doc = createDoc("t");
    const a = applyOps(doc, [{ op: "doc", set: { typeSystem: { heading: { family: "Fraunces", weight: 600, axes: { SOFT: 50 } }, sample: "Northwind" } } }]);
    expect(a.doc.typeSystem).toMatchObject({ heading: { family: "Fraunces", weight: 600 }, sample: "Northwind", note: "" });
    const b = applyOps(a.doc, [{ op: "doc", set: { typeSystem: { body: { family: "Inter" } } } }]);
    expect(b.doc.typeSystem?.heading.family).toBe("Fraunces");
    expect(b.doc.typeSystem?.body).toMatchObject({ family: "Inter", weight: 400 });
    expect(applyOps(b.doc, b.inverse).doc.typeSystem).toEqual(a.doc.typeSystem);
    expect(applyOps(a.doc, a.inverse).doc.typeSystem).toBeUndefined();
    const cleared = applyOps(b.doc, [{ op: "doc", set: { typeSystem: null } }]);
    expect(cleared.doc.typeSystem).toBeUndefined();
    expect(applyOps(cleared.doc, cleared.inverse).doc.typeSystem?.body?.family).toBe("Inter");
  });

  it("needs a heading the first time", () => {
    expect(() => applyOps(createDoc("t"), [{ op: "doc", set: { typeSystem: { body: { family: "Inter" } } } }])).toThrow();
  });
});

describe("pairing rules", () => {
  it("prefers contrast of classification and readable bodies", () => {
    const tops = suggestPairings("Playfair Display", { limit: 5 });
    expect(tops).toHaveLength(5);
    for (const p of tops) {
      expect(["sans", "slab"]).toContain(["sans-serif"].includes(fontTraits(p.body).category) ? "sans" : fontTraits(p.body).cls === "slab" ? "slab" : "serif");
      expect(fontTraits(p.body).body).toBe(true);
    }
    // A proven pair ranks near the top.
    expect(suggestPairings("Playfair Display", { limit: 10 }).map((p) => p.body)).toContain("Source Sans 3");
  });

  it("explains itself and warns about bad bodies", () => {
    const good = scorePairing(fontTraits("Fraunces"), fontTraits("Inter"));
    const bad = scorePairing(fontTraits("Inter"), fontTraits("Pacifico"));
    const twins = scorePairing(fontTraits("Inter"), fontTraits("Public Sans"));
    expect(good.score).toBeGreaterThan(twins.score);
    expect(twins.score).toBeGreaterThan(bad.score);
    expect(good.reasons.join(" ")).toMatch(/contrast/i);
    expect(bad.warnings.join(" ")).toMatch(/paragraph/i);
    expect(twins.warnings.join(" ")).toMatch(/neo-grotesque/);
  });

  it("rewards superfamilies and handles unknown families from their category", () => {
    expect(scorePairing(fontTraits("IBM Plex Serif"), fontTraits("IBM Plex Sans")).reasons[0]).toMatch(/superfamily/i);
    const unknown = fontTraits("Some New Serif", { category: "serif", xh: 0.5 });
    expect(unknown.cls).toBe("transitional");
    expect(suggestPairings("Some New Serif", { traits: { category: "serif", xh: 0.5 }, limit: 3 })).toHaveLength(3);
    // Body role: suggest headings for a body face.
    expect(suggestPairings("Inter", { role: "body", limit: 3 }).every((p) => p.body === "Inter")).toBe(true);
  });
});

describe("lettering letters", () => {
  it("lettering groups remember their source text and font", () => {
    const doc = letteringDoc();
    const g = doc.nodes.t!;
    expect(g.type).toBe("group");
    expect(g.type === "group" && g.lettering).toMatchObject({ text: "Brand", fontFamily: "Inter", fontWeight: 700, axes: { wght: 640 }, features: ["ss01"] });
  });

  it("kerning moves the letter and everything after it", () => {
    const doc = letteringDoc();
    const [a, b, c] = lettersOf(doc, "t");
    const next = applyOps(doc, kernLetterOps(doc, b!.id, -6)).doc;
    const boxes = letterBoxes(next, "t");
    expect(boxes[0]!.x0).toBeCloseTo(a!.x0);
    expect(boxes[1]!.x0).toBeCloseTo(b!.x0 - 6);
    expect(boxes[2]!.x0).toBeCloseTo(c!.x0 - 6);
  });

  it("baseline shift and scale survive re-applying a layout", () => {
    let doc = letteringDoc();
    const [, b] = lettersOf(doc, "t");
    doc = applyOps(doc, baselineLetterOps(doc, b!.id, -10)).doc;
    doc = applyOps(doc, scaleLetterOps(doc, b!.id, 1.5)).doc;
    const tb = doc.nodes[b!.id]!.transform;
    expect(tb.scaleX).toBe(1.5);
    // Scaled about its bottom-center rest point: center x stays, bottom stays on the shifted baseline.
    const rest = lettersOf(doc, "t")[1]!;
    const cx = (rest.x0 + rest.x1) / 2;
    expect(cx * tb.scaleX + tb.x).toBeCloseTo(cx);
    // Straight layout keeps the letter's scale and its raised outline.
    const placed = arrangeLetters(doc, "t", "straight", 0).find((p) => p.id === b!.id)!;
    expect(placed.transform.scaleX).toBe(1.5);
    expect(letterBoxes(doc, "t")[1]!.y1).toBeCloseTo(-10);
  });

  it("swaps a letter's outline in one op", () => {
    const doc = letteringDoc();
    const [a] = lettersOf(doc, "t");
    const ops = swapLetterOps(doc, a!.id, "M0 0L20 -50L40 0Z", "A.salt");
    expect(ops).toHaveLength(1);
    const next = applyOps(doc, ops).doc.nodes[a!.id]!;
    expect(next.type === "path" && next.d).toBe("M0 0L20 -50L40 0Z");
    expect(swapLetterOps(doc, a!.id, "")).toEqual([]);
  });
});
