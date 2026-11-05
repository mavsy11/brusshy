import { describe, expect, it } from "vitest";
import {
  applyOps,
  applySimToTransform,
  boundsIn,
  briefTagLines,
  composeSim,
  createDoc,
  exploreRequest,
  listFrames,
  listTechniques,
  parseDoc,
  reflectAcross,
  releaseRepeatOps,
  repeatGroupOf,
  repeatOps,
  rotateAbout,
  scaleAbout,
  tagSearchQuery,
  techniqueById,
  techniqueDiagramSvg,
  TECHNIQUES,
  transformMatrix,
  updateRepeatOps,
  worldMatrix,
  apply,
  multiply,
  INSPIRATION_SOURCES,
  type DocT,
  type GroupNodeT,
  type Mat,
} from "../src";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const closeMat = (a: Mat, b: Mat, eps = 1e-6) => a.forEach((v, i) => close(v, b[i]!, eps));

/** A doc with one frame (1024²) and a petal path above the centre. */
function petalDoc() {
  const doc = createDoc("t");
  const f = listFrames(doc)[0]!;
  const r = applyOps(doc, [{ op: "add", node: { id: "petal", type: "path", name: "Petal", d: "M512 512C472 440 480 340 512 280C544 340 552 440 512 512Z" }, parent: f.id }]);
  return { doc: r.doc, frame: f.id };
}

const children = (doc: DocT, id: string) => (doc.nodes[id] as GroupNodeT).children;

describe("similarities", () => {
  it("compose exactly into translate/rotate/scale transforms (with flips)", () => {
    const t = { x: 40, y: -12, rotation: 25, scaleX: 1.5, scaleY: 0.5 };
    for (const s of [rotateAbout([100, 50], 72), reflectAcross([10, 20], 90), reflectAcross([10, 20], 0), reflectAcross([0, 0], 33), composeSim(rotateAbout([5, 5], 40), reflectAcross([3, 9], 120))]) {
      const expected = multiply(s.m, transformMatrix(t));
      closeMat(transformMatrix(applySimToTransform(s, t)), expected, 1e-5);
    }
  });
});

describe("radial repeat", () => {
  it("makes N copies rotated by 360/N about the artboard centre, grouped and named", () => {
    const { doc } = petalDoc();
    const r = repeatOps(doc, ["petal"], { mode: "radial", count: 8 });
    const next = applyOps(doc, r.ops).doc;
    const g = next.nodes[r.groupId] as GroupNodeT;
    expect(g.name).toBe("Petal ×8");
    expect(g.repeat).toMatchObject({ mode: "radial", count: 8, source: "petal", pivot: [512, 512], pivotMode: "artboard" });
    expect(g.children).toHaveLength(8);
    expect(g.children[0]).toBe("petal");
    g.children.slice(1).forEach((id, i) => {
      const c = next.nodes[id]!;
      expect(c.name).toBe(`Petal ${i + 2}`);
      // Rotation about (512,512) by (i+1)·45°: the tip (512,280) lands on the circle.
      const M = worldMatrix(next, id);
      const tip = apply(M, 512, 280);
      const a = ((i + 1) * 45 * Math.PI) / 180;
      close(tip[0], 512 + 232 * Math.sin(a), 1e-3);
      close(tip[1], 512 - 232 * Math.cos(a), 1e-3);
      // Base stays on the pivot.
      const base = apply(M, 512, 512);
      close(base[0], 512, 1e-3);
      close(base[1], 512, 1e-3);
    });
  });

  it("is one undo step and keeps the source where it was", () => {
    const { doc, frame } = petalDoc();
    const r = repeatOps(doc, ["petal"], { mode: "radial", count: 6 });
    const a = applyOps(doc, r.ops);
    const undone = applyOps(a.doc, a.inverse).doc;
    expect(children(undone, frame)).toEqual(["petal"]);
    expect(Object.keys(undone.nodes).sort()).toEqual(Object.keys(doc.nodes).sort());
    closeMat(worldMatrix(a.doc, "petal"), worldMatrix(doc, "petal"));
  });

  it("supports a partial sweep, a custom pivot and upright copies", () => {
    const { doc } = petalDoc();
    const fan = applyOps(doc, repeatOps(doc, ["petal"], { mode: "radial", count: 3, angle: 90, pivot: { x: 512, y: 600 } }).ops).doc;
    const g = Object.values(fan.nodes).find((n) => n.type === "group") as GroupNodeT;
    expect(g.repeat!.pivotMode).toBe("point");
    expect(fan.nodes[g.children[2]!]!.transform.rotation).toBeCloseTo(90);
    expect(fan.nodes[g.children[1]!]!.transform.rotation).toBeCloseTo(45);

    const upright = repeatOps(doc, ["petal"], { mode: "radial", count: 4, orient: false, pivot: { x: 512, y: 700 } });
    const u = applyOps(doc, upright.ops).doc;
    for (const id of children(u, upright.groupId)) expect(u.nodes[id]!.transform.rotation).toBe(0);
  });

  it("alternates scale toward the centre and mirrors alternate copies across their radius", () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    // An asymmetric unit (a hook) above the centre.
    const d0 = applyOps(doc, [{ op: "add", node: { id: "hook", type: "path", d: "M512 500L512 300L560 340Z" }, parent: f.id }]).doc;
    const r = repeatOps(d0, ["hook"], { mode: "radial", count: 4, altScale: 0.5, altMirror: true });
    const next = applyOps(d0, r.ops).doc;
    const second = children(next, r.groupId)[1]!;
    const M = worldMatrix(next, second);
    // det < 0: mirrored; |det| = 0.25: scaled by 0.5.
    close(M[0] * M[3] - M[1] * M[2], -0.25, 1e-6);
    // Scale about the unit's centre-facing point (512,500), mirror across the radius through
    // the unit's centre (536,400), then rotate 90° about the pivot.
    const alpha = (Math.atan2(400 - 512, 536 - 512) * 180) / Math.PI;
    const expected = composeSim(rotateAbout([512, 512], 90), composeSim(reflectAcross([512, 512], alpha), scaleAbout([512, 500], 0.5)));
    closeMat(M, multiply(worldMatrix(next, r.groupId), expected.m), 1e-5);
    // Even copies are plain rotations.
    const third = worldMatrix(next, children(next, r.groupId)[2]!);
    close(third[0] * third[3] - third[1] * third[2], 1, 1e-6);
  });

  it("rebuilds from the edited source with Update repeat (and new options)", () => {
    const { doc } = petalDoc();
    const r = repeatOps(doc, ["petal"], { mode: "radial", count: 8 });
    let d = applyOps(doc, r.ops).doc;
    // Edit the source: make it longer.
    d = applyOps(d, [{ op: "update", id: "petal", set: { d: "M512 512C472 440 480 300 512 200C544 300 552 440 512 512Z" } }]).doc;
    const u = updateRepeatOps(d, r.groupId, { count: 12 });
    const a = applyOps(d, u.ops);
    const g = a.doc.nodes[r.groupId] as GroupNodeT;
    expect(g.children).toHaveLength(12);
    expect(g.name).toBe("Petal ×12");
    expect(g.children[0]).toBe("petal");
    const copy = a.doc.nodes[g.children[3]!]!;
    expect(copy.type === "path" && copy.d).toBe((a.doc.nodes.petal as { d: string }).d);
    expect(copy.transform.rotation).toBeCloseTo(90);
    // Undo returns to the 8-copy version with the edited source.
    const back = applyOps(a.doc, a.inverse).doc;
    expect(children(back, r.groupId)).toHaveLength(8);
    // repeatOps on the source (or group) is the same as an update.
    const again = repeatOps(back, ["petal"], { mode: "radial", count: 5 });
    expect(again.updated).toBe(true);
    expect(applyOps(back, again.ops).doc.nodes[r.groupId]!.name).toBe("Petal ×5");
    expect(repeatGroupOf(back, children(back, r.groupId)[2]!)?.id).toBe(r.groupId);
  });

  it("keeps a hand-given group name on update and survives save/load", () => {
    const { doc } = petalDoc();
    const r = repeatOps(doc, ["petal"], { mode: "radial", count: 8, name: "Sun" });
    const d = parseDoc(JSON.parse(JSON.stringify(applyOps(doc, r.ops).doc)));
    expect((d.nodes[r.groupId] as GroupNodeT).repeat?.count).toBe(8);
    const u = applyOps(d, updateRepeatOps(d, r.groupId, { count: 10 }).ops).doc;
    expect(u.nodes[r.groupId]!.name).toBe("Sun");
    const rel = applyOps(u, releaseRepeatOps(u, r.groupId)).doc;
    expect((rel.nodes[r.groupId] as GroupNodeT).repeat).toBeFalsy();
    expect(children(rel, r.groupId)).toHaveLength(10);
  });
});

describe("mirror and grid", () => {
  it("mirrors across a vertical axis through the artboard centre", () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    const d0 = applyOps(doc, [{ op: "add", node: { id: "half", type: "shape", shape: "rect", width: 100, height: 200, transform: { x: 300, y: 400 } }, parent: f.id }]).doc;
    const r = repeatOps(d0, ["half"], { mode: "mirror", axis: "vertical" });
    const next = applyOps(d0, r.ops).doc;
    const g = next.nodes[r.groupId] as GroupNodeT;
    expect(g.name).toBe("Rect · mirrored");
    const copy = next.nodes[g.children[1]!]!;
    expect(copy.transform).toMatchObject({ x: 724, y: 400, scaleX: -1, scaleY: 1, rotation: 0 });
    const b = boundsIn(next, copy.id, f.id)!;
    expect(b).toMatchObject({ x: 624, y: 400, w: 100, h: 200 });
  });

  it("mirrors both ways (4 instances) through the selection centre", () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    const d0 = applyOps(doc, [{ op: "add", node: { id: "q", type: "path", d: "M100 100L200 100L100 200Z" }, parent: f.id }]).doc;
    const r = repeatOps(d0, ["q"], { mode: "mirror", axis: "both", pivot: { x: 200, y: 200 } });
    const next = applyOps(d0, r.ops).doc;
    const boxes = children(next, r.groupId).map((id) => boundsIn(next, id, f.id)!);
    expect(boxes.map((b) => [Math.round(b.x), Math.round(b.y)])).toEqual([
      [100, 100],
      [200, 100],
      [100, 200],
      [200, 200],
    ]);
  });

  it("merges a mirror into one exact shape and keeps the hidden source for updates", () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    // Left half of a shape touching the axis (x = 512).
    const d0 = applyOps(doc, [{ op: "add", node: { id: "half", type: "path", name: "Crest", d: "M512 300L400 360L420 620L512 700Z" }, parent: f.id }]).doc;
    const r = repeatOps(d0, ["half"], { mode: "mirror", axis: "vertical", merge: true });
    const next = applyOps(d0, r.ops).doc;
    const g = next.nodes[r.groupId] as GroupNodeT;
    expect(g.repeat?.merged).toBe(true);
    const visible = g.children.filter((id) => next.nodes[id]!.visible);
    expect(visible).toHaveLength(1);
    const merged = next.nodes[visible[0]!]!;
    expect(merged.name).toBe("Crest (merged)");
    expect(next.nodes.half!.visible).toBe(false);
    const b = boundsIn(next, merged.id, f.id)!;
    expect(b.x).toBeCloseTo(400, 0);
    expect(b.x + b.w).toBeCloseTo(624, 0);
    // Rebuild after editing the hidden source: still one merged shape.
    const edited = applyOps(next, [{ op: "update", id: "half", set: { d: "M512 280L380 360L420 640L512 720Z" } }]).doc;
    const u = applyOps(edited, updateRepeatOps(edited, r.groupId).ops).doc;
    const kids = (u.nodes[r.groupId] as GroupNodeT).children;
    expect(kids.filter((id) => u.nodes[id]!.visible)).toHaveLength(1);
    expect(boundsIn(u, kids.find((id) => u.nodes[id]!.visible)!, f.id)!.w).toBeCloseTo(264, 0);
    // Turning merge off brings back the source and a plain copy.
    const off = applyOps(u, updateRepeatOps(u, r.groupId, { merge: false }).ops).doc;
    const offKids = (off.nodes[r.groupId] as GroupNodeT).children;
    expect(offKids).toHaveLength(2);
    expect(offKids.every((id) => off.nodes[id]!.visible)).toBe(true);
  });

  it("lays out a grid with gaps measured between bounds", () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    const d0 = applyOps(doc, [{ op: "add", node: { id: "dot", type: "shape", shape: "ellipse", width: 40, height: 40, transform: { x: 10, y: 20 } }, parent: f.id }]).doc;
    const r = repeatOps(d0, ["dot"], { mode: "grid", count: 4, rows: 3, gap: 10 });
    expect(r.copies).toBe(11);
    const next = applyOps(d0, r.ops).doc;
    const g = next.nodes[r.groupId] as GroupNodeT;
    expect(g.name).toBe("Ellipse 4×3");
    const last = next.nodes[g.children[11]!]!;
    expect(last.transform).toMatchObject({ x: 10 + 3 * 50, y: 20 + 2 * 50 });
  });

  it("repeats several layers as one unit and refuses mixed parents or frames", () => {
    const doc = createDoc("t");
    const f = listFrames(doc)[0]!;
    const d0 = applyOps(doc, [
      { op: "add", node: { id: "a", type: "shape", shape: "rect", name: "Leaf", width: 20, height: 60, transform: { x: 502, y: 300 } }, parent: f.id },
      { op: "add", node: { id: "b", type: "shape", shape: "ellipse", width: 20, height: 20, transform: { x: 502, y: 280 } }, parent: f.id },
    ]).doc;
    const r = repeatOps(d0, ["b", "a"], { mode: "radial", count: 3 });
    const next = applyOps(d0, r.ops).doc;
    const g = next.nodes[r.groupId] as GroupNodeT;
    expect(g.children).toHaveLength(3);
    const unit = next.nodes[g.children[0]!] as GroupNodeT;
    expect(unit.type).toBe("group");
    expect(unit.children).toEqual(["a", "b"]);
    expect((next.nodes[g.children[1]!] as GroupNodeT).children).toHaveLength(2);
    expect(next.nodes[g.children[2]!]!.transform.rotation).toBeCloseTo(-120);
    expect(() => repeatOps(d0, [f.id], { mode: "radial" })).toThrow(/frames/i);
    // Undo restores both layers to the frame in order.
    const a = applyOps(d0, r.ops);
    expect(children(applyOps(a.doc, a.inverse).doc, f.id)).toEqual(["a", "b"]);
  });

  it("refuses an empty selection", () => {
    expect(() => repeatOps(createDoc("t"), [], { mode: "radial" })).toThrow();
  });
});

describe("reference board", () => {
  it("is stored on the document via the doc op, with undo", () => {
    const doc = createDoc("t");
    const items = [
      { id: "i1", src: "refs/a.png", role: "style", note: "the corners" },
      { id: "i2", src: "refs/b.jpg" },
    ];
    const a = applyOps(doc, [{ op: "doc", set: { board: { items } } }]);
    expect(a.doc.board?.items).toHaveLength(2);
    expect(a.doc.board?.items[1]).toMatchObject({ role: "reference", note: "" });
    const b = applyOps(a.doc, [{ op: "doc", set: { board: { items: [items[0]] } } }]);
    expect(b.doc.board?.items.map((i) => i.id)).toEqual(["i1"]);
    expect(applyOps(b.doc, b.inverse).doc.board?.items).toHaveLength(2);
    expect(applyOps(a.doc, a.inverse).doc.board).toBeUndefined();
    const loaded = parseDoc(JSON.parse(JSON.stringify(b.doc)));
    expect(loaded.board?.items[0]?.note).toBe("the corners");
    expect(() => applyOps(doc, [{ op: "doc", set: { board: { items: [{ id: "x", src: "refs/x.png", role: "colour" }] } } }])).toThrow();
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `i${i}`, src: `refs/${i}.png` }));
    expect(() => applyOps(doc, [{ op: "doc", set: { board: { items: many } } }])).toThrow();
  });
});

describe("brief tags", () => {
  it("merge into the brief, show in the summary and build search queries", () => {
    const doc = createDoc("t");
    const a = applyOps(doc, [{ op: "doc", set: { brief: { subject: "Fox", tags: { markType: ["monogram"], style: ["geometric", "minimal"], mood: ["premium"] } } } }]);
    expect(a.doc.brief?.tags?.shape).toEqual([]);
    expect(briefTagLines(a.doc.brief?.tags)).toEqual(["  • Mark type: Monogram", "  • Style: Geometric, Minimal", "  • Mood: Premium"]);
    expect(tagSearchQuery(a.doc.brief!.tags!)).toBe("monogram geometric minimal premium");
    expect(tagSearchQuery({ markType: [], style: ["vintage"], shape: ["animal"], mood: [] })).toBe("vintage animal logo");
    expect(INSPIRATION_SOURCES[0]!.url("geometric fox logo")).toBe("https://dribbble.com/search/geometric-fox-logo");
    // Text fields stay when only tags change.
    const b = applyOps(a.doc, [{ op: "doc", set: { brief: { tags: { markType: [], style: [], shape: ["circle"], mood: [] } } } }]);
    expect(b.doc.brief?.subject).toBe("Fox");
    expect(applyOps(b.doc, b.inverse).doc.brief?.tags?.style).toEqual(["geometric", "minimal"]);
  });
});

describe("techniques", () => {
  it("catalogs letter and symbol techniques with diagrams", () => {
    expect(listTechniques("letter")).toHaveLength(13);
    expect(listTechniques("symbol")).toHaveLength(8);
    expect(new Set(TECHNIQUES.map((t) => t.id)).size).toBe(TECHNIQUES.length);
    for (const t of TECHNIQUES) {
      expect(t.summary.length).toBeGreaterThan(10);
      expect(t.watchOut.length).toBeGreaterThan(10);
      expect(t.diagram).toMatch(/^<(path|circle|rect|ellipse)/);
      expect(techniqueDiagramSvg(t)).toContain("<svg");
    }
    expect(techniqueById("Radial repeat")?.id).toBe("radial");
  });

  it("builds one precise explore request under the chat limit", () => {
    const req = exploreRequest({ mode: "letter", target: "N", techniques: ["stencil", "modular", "interlock", "fold"], count: 4 });
    expect(req).toContain("make_variants count 4, blank true");
    expect(req).toContain("A · Stencil / split");
    expect(req).toContain("D · Fold / ribbon");
    expect(req).toMatch(/V3 A · Stencil/);
    expect(req.length).toBeLessThan(4000);
    const all = exploreRequest({ mode: "subject", target: "camera", techniques: TECHNIQUES.map((t) => t.id), count: 6 });
    expect(all.length).toBeLessThan(4000);
    expect(all).toContain("use the 6 that suit");
    const few = exploreRequest({ mode: "subject", target: "fox", techniques: ["radial"], count: 3 });
    expect(few).toContain('For the other 2, pick different techniques from list_techniques (kind "symbol")');
  });
});
