import { describe, expect, it } from "vitest";
import {
  applyOps,
  arrangeLetters,
  arrangeLettersOps,
  assignPalette,
  createDoc,
  frameDoc,
  letteringOps,
  listFrames,
  matchPaletteOps,
  parseColor,
  styleBrief,
  styleProfile,
  type DocT,
  type OpT,
  type PaletteColor,
} from "../src";

/** A doc whose first frame holds the given nodes (added in order). */
function docWith(nodes: Record<string, unknown>[], frame: Record<string, unknown> = {}): { doc: DocT; fid: string } {
  let doc = createDoc("t");
  const fid = listFrames(doc)[0]!.id;
  if (Object.keys(frame).length) doc = applyOps(doc, [{ op: "update", id: fid, set: frame }]).doc;
  doc = applyOps(doc, nodes.map((node) => ({ op: "add", node, parent: fid }) as OpT)).doc;
  return { doc, fid };
}

const rect = (x: number, y: number, w: number, h: number, fill: unknown, extra: Record<string, unknown> = {}) => ({
  type: "shape",
  shape: "rect",
  width: w,
  height: h,
  transform: { x, y },
  style: { fill },
  ...extra,
});

describe("colors", () => {
  it("parses hex, rgb, hsl and names", () => {
    expect(parseColor("#fff")!.rgb).toEqual([255, 255, 255]);
    expect(parseColor("rgb(10, 20, 30)")!.rgb).toEqual([10, 20, 30]);
    expect(parseColor("rgba(10 20 30 / 0.5)")!.alpha).toBe(0.5);
    expect(parseColor("hsl(0, 100%, 50%)")!.rgb.map(Math.round)).toEqual([255, 0, 0]);
    expect(parseColor("navy")!.rgb).toEqual([0, 0, 128]);
    expect(parseColor("none")).toBeNull();
  });
});

describe("styleProfile", () => {
  it("weights the palette by painted area and merges near-identical shades", () => {
    const { doc, fid } = docWith([
      rect(312, 312, 400, 400, "#0b3d2e"),
      rect(320, 320, 10, 10, "#0c3e2f"), // same ink, a hair different
      { type: "shape", shape: "ellipse", width: 100, height: 100, transform: { x: 462, y: 462 }, style: { fill: "#e8b04a" } },
    ]);
    const p = styleProfile(frameDoc(doc, fid));
    expect(p.palette).toHaveLength(2);
    expect(p.palette[0]!.hex).toBe("#0b3d2e");
    expect(p.palette[0]!.members).toContain("#0c3e2f");
    expect(p.palette[0]!.share).toBeGreaterThan(0.9);
    expect(p.layout.centered).toBe(true);
    expect(p.layout.margins!.left).toBeCloseTo(312 / 1024, 2);
    expect(p.symmetry.vertical).toBeGreaterThan(0.9);
    expect(p.strokes.dominant).toBeNull();
    expect(p.summary).toMatch(/Palette \(2 colors/);
    expect(p.summary).toMatch(/centered/);
  });

  it("reads curve character, corner radius and stroke weight", () => {
    const round = docWith([{ type: "shape", shape: "ellipse", width: 300, height: 300, transform: { x: 362, y: 362 }, style: { fill: "#111" } }]);
    expect(styleProfile(frameDoc(round.doc, round.fid)).curves.curvedShare).toBeGreaterThan(0.95);

    const sharp = docWith([rect(100, 100, 300, 200, "#111")]);
    const ps = styleProfile(frameDoc(sharp.doc, sharp.fid));
    expect(ps.curves.curvedShare).toBe(0);
    expect(ps.curves.character).toMatch(/sharp/);

    // A rounded rectangle drawn as a path: lines joined by cubic corners of radius 40.
    const k = 40 * 0.5523;
    const d = `M140 100L360 100C${360 + k} 100 400 ${140 - k} 400 140L400 260C400 ${260 + k} ${360 + k} 300 360 300L140 300C${140 - k} 300 100 ${260 + k} 100 260L100 140C100 ${140 - k} ${140 - k} 100 140 100Z`;
    const soft = docWith([{ type: "path", d, style: { fill: null, stroke: "#222", strokeWidth: 12 } }]);
    const pr = styleProfile(frameDoc(soft.doc, soft.fid));
    expect(pr.curves.cornerRadius).toBeGreaterThan(35);
    expect(pr.curves.cornerRadius).toBeLessThan(45);
    expect(pr.curves.character).toMatch(/rounded corners/);
    expect(pr.strokes.dominant).toBe(12);
    expect(pr.strokes.relative).toBeCloseTo(12 / 200, 2);
    expect(pr.palette[0]!.roles).toEqual(["stroke"]);
  });

  it("tells asymmetric marks apart and lists type", () => {
    const { doc, fid } = docWith([
      rect(100, 100, 60, 400, "#111"),
      rect(100, 440, 300, 60, "#111"),
      { type: "text", text: "ACME", fontFamily: "Inter", fontWeight: 700, fontSize: 80, letterSpacing: 4, transform: { x: 500, y: 700 } },
    ]);
    const p = styleProfile(frameDoc(doc, fid));
    expect(p.symmetry.vertical).toBeLessThan(0.85);
    expect(p.type[0]).toMatchObject({ family: "Inter", weight: 700, tracking: 0.05, uppercase: true });
    expect(styleBrief(p)).toMatch(/Inter 700, tracking \+0.05em, all caps/);
  });

  it("uses exact text outlines when given", () => {
    const { doc, fid } = docWith([{ type: "text", text: "A", fontSize: 100, transform: { x: 100, y: 200 } }]);
    const p = styleProfile(frameDoc(doc, fid), { textToPath: () => "M0 0L50 -100L100 0Z" });
    expect(p.layout.bounds).toMatchObject({ x: 100, y: 100, w: 100, h: 100 });
  });
});

describe("palette matching", () => {
  const pc = (hex: string, share: number, lightness: number): PaletteColor => ({ hex, share, roles: ["fill"], members: [hex], lightness, name: "" });

  it("keeps lightness order and spreads ranks when the source has fewer colors", () => {
    const m = assignPalette([pc("#222222", 0.7, 13), pc("#dddddd", 0.3, 88)], [pc("#000080", 0.5, 13), pc("#4060c0", 0.3, 43), pc("#a0b8ff", 0.2, 75)]);
    expect(m.get("#000080")).toBe("#222222");
    expect(m.get("#a0b8ff")).toBe("#dddddd");
  });

  it("recolors a version with another's palette in one undoable batch, keeping white knockouts", () => {
    let doc = createDoc("t");
    const v1 = listFrames(doc)[0]!.id;
    doc = applyOps(doc, [
      { op: "update", id: v1, set: { background: "#f6f1e7" } },
      { op: "add", node: rect(200, 200, 600, 600, "#0b3d2e"), parent: v1 },
      { op: "add", node: rect(450, 450, 120, 120, "#c8932a"), parent: v1 },
    ]).doc;
    doc = applyOps(doc, [{ op: "add", node: { type: "frame", name: "V2", background: "#ffffff", transform: { x: 1200, y: 0 } }, parent: null }]).doc;
    const v2 = listFrames(doc)[1]!.id;
    doc = applyOps(doc, [
      { op: "add", node: { ...rect(100, 100, 700, 700, "#1d3b8f"), id: "big" }, parent: v2 },
      { op: "add", node: { ...rect(300, 300, 200, 200, { type: "linear", angle: 0, stops: [{ offset: 0, color: "#58a6ff" }, { offset: 1, color: "#58a6ff" }] }), id: "grad" }, parent: v2 },
      { op: "add", node: { ...rect(380, 380, 40, 40, "#ffffff"), id: "dot" }, parent: v2 },
      { op: "add", node: { ...rect(0, 0, 40, 40, "rgba(29, 59, 143, 0.5)"), id: "glass" }, parent: v2 },
    ]).doc;

    const r = matchPaletteOps(doc, v1, v2);
    const applied = applyOps(doc, r.ops);
    const out = applied.doc;
    expect((out.nodes.big as { style: { fill: string } }).style.fill).toBe("#0b3d2e");
    expect(((out.nodes.grad as { style: { fill: { stops: { color: string }[] } } }).style.fill).stops[0]!.color).toBe("#c8932a");
    expect((out.nodes.dot as { style: { fill: string } }).style.fill).toBe("#ffffff");
    expect((out.nodes.glass as { style: { fill: string } }).style.fill).toBe("rgba(11, 61, 46, 0.5)");
    expect((out.nodes[v2] as { background: string }).background).toBe("#f6f1e7");
    // One step back restores everything.
    const undone = applyOps(out, applied.inverse).doc;
    expect((undone.nodes.big as { style: { fill: string } }).style.fill).toBe("#1d3b8f");
    expect((undone.nodes[v2] as { background: string }).background).toBe("#ffffff");
  });

  it("can skip locked parts", () => {
    let doc = createDoc("t");
    const v1 = listFrames(doc)[0]!.id;
    doc = applyOps(doc, [{ op: "add", node: rect(0, 0, 100, 100, "#ff0000"), parent: v1 }]).doc;
    doc = applyOps(doc, [{ op: "add", node: { type: "frame", name: "V2", transform: { x: 1200 } }, parent: null }]).doc;
    const v2 = listFrames(doc)[1]!.id;
    doc = applyOps(doc, [{ op: "add", node: { ...rect(0, 0, 100, 100, "#0000ff"), id: "locked", aiLock: true }, parent: v2 }]).doc;
    const r = matchPaletteOps(doc, v1, v2, { skip: (n) => n.aiLock });
    expect(r.ops).toHaveLength(0);
    expect(r.skipped).toEqual(["locked"]);
  });
});

describe("lettering", () => {
  const glyphs = [
    { text: "S", d: "M0 0L40 0L40 -70L0 -70Z" },
    { text: "H", d: "M50 0L90 0L90 -70L50 -70Z" },
    { text: " ", d: "" },
    { text: "O", d: "M120 0L160 0L160 -70L120 -70Z" },
    { text: "P", d: "M170 0L210 0L210 -70L170 -70Z" },
  ];

  function lettered() {
    const { doc, fid } = docWith([
      { id: "word", type: "text", text: "SH OP", fontSize: 100, transform: { x: 300, y: 500, rotation: 5 }, style: { fill: "#c33", opacity: 0.8 }, extrude: { depth: 30 } },
    ]);
    const r = letteringOps(doc, "word", glyphs);
    return { ...r, doc: applyOps(doc, r.ops).doc, before: doc, fid };
  }

  it("turns a text into a group of named letters in its place (one batch)", () => {
    const { doc, groupId, letterIds, before, fid } = lettered();
    const g = doc.nodes[groupId]!;
    expect(g.type).toBe("group");
    expect(g.name).toBe("SH OP");
    expect(g.transform).toMatchObject({ x: 300, y: 500, rotation: 5 });
    expect(g.style.opacity).toBe(0.8);
    expect(letterIds.map((id) => doc.nodes[id]!.name)).toEqual(["S", "H", "O", "P"]);
    const s = doc.nodes[letterIds[0]!]!;
    expect(s.style).toMatchObject({ fill: "#c33", opacity: 1 });
    expect(s.extrude?.depth).toBe(30);
    expect((before.nodes[fid] as { children: string[] }).children.indexOf("word")).toBe((doc.nodes[fid] as { children: string[] }).children.indexOf("word"));
  });

  it("arcs letters symmetrically and resets with straight", () => {
    const { doc, groupId, letterIds } = lettered();
    const arc = arrangeLetters(doc, groupId, "arc", 90);
    const byId = new Map(arc.map((a) => [a.id, a.transform]));
    const first = byId.get(letterIds[0]!)!;
    const last = byId.get(letterIds[3]!)!;
    expect(first.rotation).toBeCloseTo(-45, 0);
    expect(last.rotation).toBeCloseTo(45, 0);
    // Applying a layout twice gives the same result (layouts never accumulate).
    const once = applyOps(doc, arrangeLettersOps(doc, groupId, "arc", 90)).doc;
    expect(arrangeLetters(once, groupId, "arc", 90)).toEqual(arc);
    const straight = arrangeLetters(once, groupId, "straight", 0);
    for (const s of straight) expect(s.transform).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });

  it("puts letter centers on the arc (∩ for positive, ∪ for negative)", () => {
    const { doc, groupId, letterIds } = lettered();
    for (const sign of [1, -1]) {
      const t = new Map(arrangeLetters(doc, groupId, "arc", sign * 120).map((a) => [a.id, a.transform]));
      // Rest center of S is (20, 0): its new place is the transform applied to that point.
      const tr = t.get(letterIds[0]!)!;
      const a = (tr.rotation * Math.PI) / 180;
      const y = Math.sin(a) * 20 + tr.y;
      expect(Math.sign(y)).toBe(sign); // ends drop for an arch, rise for a smile
    }
  });

  it("wave, rise and stagger move letters vertically by % of letter height", () => {
    const { doc, groupId, letterIds } = lettered();
    const rise = new Map(arrangeLetters(doc, groupId, "rise", 100).map((a) => [a.id, a.transform]));
    expect(rise.get(letterIds[0]!)!.y).toBeCloseTo(35, 0);
    expect(rise.get(letterIds[3]!)!.y).toBeCloseTo(-35, 0);
    const st = arrangeLetters(doc, groupId, "stagger", 50);
    expect(Math.sign(st[0]!.transform.y)).toBe(-Math.sign(st[1]!.transform.y));
    const wave = arrangeLetters(doc, groupId, "wave", 40);
    expect(wave.some((w) => w.transform.rotation !== 0)).toBe(true);
  });
});
