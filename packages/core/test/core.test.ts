import { describe, expect, it } from "vitest";
import {
  deformPathData,
  moveNodes,
  parsePath,
  softField,
  Doc,
  frameDoc,
  listFrames,
  parseDoc,
  applyOps,
  createDoc,
  docToSvg,
  History,
  shapeToPath,
  svgToOps,
  worldMatrix,
  apply,
  type OpT,
} from "../src";

/** A document without frames, to test ops in isolation. */
const rawDoc = (name: string) => Doc.parse({ id: "d_t", name, createdAt: 0, updatedAt: 0 });

describe("frames", () => {
  it("new documents start with one frame and content goes into it", () => {
    const doc = createDoc("t");
    const [f] = listFrames(doc);
    expect(f!.name).toBe("V1");
    const r = applyOps(doc, [{ op: "add", node: { type: "path", d: "M0 0L10 10" } }]);
    expect(r.doc.root).toEqual([f!.id]);
    expect((r.doc.nodes[f!.id] as { children: string[] }).children).toEqual(r.created);
  });

  it("migrates single-artboard documents into a frame", () => {
    const old = applyOps(rawDoc("t"), [
      { op: "add", node: { id: "p", type: "path", d: "M0 0" } },
      { op: "annotate", annotation: { x: 1, y: 2, note: "x" } },
    ]).doc;
    old.artboard = { width: 800, height: 600, background: "#fff" };
    const doc = parseDoc(old);
    const [f] = listFrames(doc);
    expect(doc.root).toEqual([f!.id]);
    expect(f!.width).toBe(800);
    expect(doc.nodes.p!.parent).toBe(f!.id);
    expect(Object.values(doc.annotations)[0]!.frameId).toBe(f!.id);
  });

  it("projects one frame as a standalone document", () => {
    const doc = createDoc("Acme");
    const f1 = listFrames(doc)[0]!;
    const r = applyOps(doc, [
      { op: "add", node: { id: "f2", type: "frame", name: "V2", width: 512, height: 512, transform: { x: 1200 } } },
      { op: "add", node: { id: "a", type: "path", d: "M0 0" }, parent: f1.id },
      { op: "add", node: { id: "b", type: "path", d: "M1 1" }, parent: "f2" },
    ]);
    const v2 = frameDoc(r.doc, "f2");
    expect(v2.root).toEqual(["b"]);
    expect(v2.nodes.b!.parent).toBeNull();
    expect(v2.nodes.a).toBeUndefined();
    expect(v2.artboard.width).toBe(512);
    expect(docToSvg(v2)).toContain('viewBox="0 0 512 512"');
    expect(() => applyOps(r.doc, [{ op: "move", id: "f2", parent: f1.id }])).toThrow(/top-level/);
  });
});

describe("deform", () => {
  it("bends a petal around its base: base stays, tip swings clockwise", () => {
    const petal = "M100 200C60 150 80 60 100 0C120 60 140 150 100 200Z";
    const subs = parsePath(deformPathData(petal, "bend", 45, "bottom"));
    const pts = subs[0]!.anchors.map((a) => a.p);
    const base = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const tip = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(base[0]).toBeCloseTo(100, 0);
    expect(base[1]).toBeCloseTo(200, 0);
    // tip moved right (clockwise on screen) and down
    expect(tip[0]).toBeGreaterThan(160);
    expect(pts.length).toBeGreaterThan(4);
  });

  it("soft field moves the selection fully and fades neighbours", () => {
    const subs = parsePath("M0 0L100 0L200 0L300 0");
    const moved = moveNodes(subs, softField(subs, new Set(["0:0"]), 250), 0, 10);
    const ys = moved[0]!.anchors.map((a) => Math.round(a.p[1] * 10) / 10);
    expect(ys[0]).toBe(10);
    expect(ys[1]!).toBeGreaterThan(ys[2]!);
    expect(ys[3]).toBe(0);
  });
});

describe("ops", () => {
  it("adds, updates and undoes", () => {
    const doc = rawDoc("t");
    const r1 = applyOps(doc, [{ op: "add", node: { type: "shape", shape: "rect", width: 100, height: 50 } }]);
    const id = r1.created[0]!;
    expect(r1.doc.root).toEqual([id]);
    const r2 = applyOps(r1.doc, [{ op: "update", id, set: { style: { fill: "#f00" }, transform: { x: 10 } } }]);
    const n = r2.doc.nodes[id]!;
    expect(n.style.fill).toBe("#f00");
    expect(n.style.opacity).toBe(1);
    expect(n.transform.x).toBe(10);
    const back = applyOps(r2.doc, r2.inverse).doc;
    expect(back.nodes[id]!.style.fill).toBe("#0b0c0e");
    expect(back.nodes[id]!.transform.x).toBe(0);
  });

  it("is atomic on error", () => {
    const doc = rawDoc("t");
    expect(() =>
      applyOps(doc, [
        { op: "add", node: { type: "path", d: "M0 0L1 1" } },
        { op: "update", id: "missing", set: {} },
      ]),
    ).toThrow(/missing/);
    expect(doc.root).toEqual([]);
  });

  it("removes and restores a subtree in place", () => {
    let doc = rawDoc("t");
    const a = applyOps(doc, [
      { op: "add", node: { id: "g", type: "group" } },
      { op: "add", node: { id: "p1", type: "path", d: "M0 0" }, parent: "g" },
      { op: "add", node: { id: "p2", type: "path", d: "M0 0" }, parent: "g" },
      { op: "add", node: { id: "top", type: "path", d: "M0 0" } },
    ]);
    doc = a.doc;
    const r = applyOps(doc, [{ op: "remove", id: "g" }]);
    expect(Object.keys(r.doc.nodes)).toEqual(["top"]);
    const back = applyOps(r.doc, r.inverse).doc;
    expect(back.root).toEqual(["g", "top"]);
    expect((back.nodes.g as { children: string[] }).children).toEqual(["p1", "p2"]);
  });

  it("moves between parents and back", () => {
    const a = applyOps(rawDoc("t"), [
      { op: "add", node: { id: "g", type: "group" } },
      { op: "add", node: { id: "p", type: "path", d: "M0 0" } },
    ]);
    const m = applyOps(a.doc, [{ op: "move", id: "p", parent: "g" }]);
    expect(m.doc.root).toEqual(["g"]);
    expect(m.doc.nodes.p!.parent).toBe("g");
    const back = applyOps(m.doc, m.inverse).doc;
    expect(back.root).toEqual(["g", "p"]);
    expect(() => applyOps(a.doc, [{ op: "move", id: "g", parent: "g" }])).toThrow();
  });

  it("adds and removes extrude", () => {
    const a = applyOps(rawDoc("t"), [{ op: "add", node: { id: "p", type: "path", d: "M0 0" } }]);
    const b = applyOps(a.doc, [{ op: "update", id: "p", set: { extrude: { depth: 40 } } }]);
    expect(b.doc.nodes.p!.extrude!.depth).toBe(40);
    expect(b.doc.nodes.p!.extrude!.bevel).toBe(3);
    const c = applyOps(b.doc, b.inverse);
    expect(c.doc.nodes.p!.extrude).toBeUndefined();
  });

  it("replaces gradients atomically", () => {
    const a = applyOps(rawDoc("t"), [{ op: "add", node: { id: "p", type: "path", d: "M0 0" } }]);
    const g = { type: "linear", angle: 90, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const b = applyOps(a.doc, [{ op: "update", id: "p", set: { style: { fill: g } } }]);
    expect(b.doc.nodes.p!.style.fill).toEqual(g);
    const c = applyOps(b.doc, [{ op: "update", id: "p", set: { style: { fill: "#123" } } }]);
    expect(c.doc.nodes.p!.style.fill).toBe("#123");
  });

  it("history round-trip with exact redo", () => {
    const h = new History();
    let doc = rawDoc("t");
    const r = applyOps(doc, [{ op: "add", node: { type: "path", d: "M0 0" } }]);
    h.push({ ops: r.doc ? ([{ op: "add", node: { type: "path", d: "M0 0" } }] as OpT[]) : [], inverse: r.inverse, author: "user", label: "add", at: 0 });
    doc = r.doc;
    const e = h.undo()!;
    const u = applyOps(doc, e.inverse);
    e.redo = u.inverse;
    doc = u.doc;
    expect(doc.root).toEqual([]);
    const e2 = h.redo()!;
    const rr = applyOps(doc, e2.redo!);
    expect(rr.doc.root).toEqual(r.doc.root);
  });

  it("annotations", () => {
    const a = applyOps(rawDoc("t"), [{ op: "annotate", annotation: { x: 1, y: 2, note: "rounder" } }]);
    const id = a.created[0]!;
    expect(a.doc.annotations[id]!.status).toBe("pending");
    const b = applyOps(a.doc, [{ op: "annotation", id, set: { status: "resolved", reply: "done" } }]);
    expect(b.doc.annotations[id]!.reply).toBe("done");
  });
});

describe("svg", () => {
  it("exports shapes, gradients and skips working layers", () => {
    const a = applyOps(rawDoc("t"), [
      {
        op: "add",
        node: {
          type: "shape",
          shape: "rect",
          width: 100,
          height: 100,
          radius: 20,
          style: { fill: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] } },
        },
      },
      { op: "add", node: { type: "sketch", strokes: [{ points: [[0, 0, 0.5], [10, 10, 0.5]] }] } },
    ]);
    const svg = docToSvg(a.doc);
    expect(svg).toContain("linearGradient");
    expect(svg).toContain("A20 20");
    expect(svg).not.toContain("stroke-linecap=\"round\" opacity");
    expect(docToSvg(a.doc, { includeWorking: true })).toContain("<g");
  });

  it("imports common SVG elements", () => {
    const svg = `<svg viewBox="0 0 100 100"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></linearGradient></defs>
      <g transform="translate(10 20)" fill="#333"><circle cx="50" cy="50" r="10"/><rect x="5" y="5" width="20" height="10" rx="2" fill="url(#a)"/></g>
      <path d="M0 0L10 10" stroke="#000" stroke-width="2" fill="none"/><text x="5" y="90" font-size="12" font-family="Inter, sans-serif">Hi</text></svg>`;
    const { ops, ids } = svgToOps(svg);
    const r = applyOps(rawDoc("t"), ops);
    expect(ids.length).toBe(3);
    const g = r.doc.nodes[ids[0]!]!;
    expect(g.type).toBe("group");
    const [circleId, rectId] = (g as { children: string[] }).children;
    const circle = r.doc.nodes[circleId!]!;
    expect(circle.type).toBe("shape");
    expect(circle.transform.x).toBe(40);
    expect(circle.style.fill).toBe("#333");
    expect((r.doc.nodes[rectId!]!.style.fill as { type: string }).type).toBe("linear");
    const path = r.doc.nodes[ids[1]!]!;
    expect(path.style.fill).toBeNull();
    expect(path.style.strokeWidth).toBe(2);
    const text = r.doc.nodes[ids[2]!]!;
    expect(text.type === "text" && text.fontFamily).toBe("Inter");
    // world matrix composes the group translate
    const [x, y] = apply(worldMatrix(r.doc, circleId!), 0, 0);
    expect([x, y]).toEqual([50, 60]);
  });

  it("monochrome keeps light details as knockouts", () => {
    const a = applyOps(rawDoc("t"), [
      { op: "add", node: { type: "shape", shape: "ellipse", width: 100, height: 100, style: { fill: "#c8102e" } } },
      { op: "add", node: { type: "shape", shape: "ellipse", width: 20, height: 20, style: { fill: "#fff" } } },
    ]);
    const black = docToSvg(a.doc, { monochrome: "#000000" });
    expect(black).toContain('fill="#000000"');
    expect(black).toContain('fill="#ffffff"');
    const white = docToSvg(a.doc, { monochrome: "#ffffff" });
    expect(white).toContain('fill="#0b0c0e"');
  });

  it("round-trips shapes through SVG", () => {
    expect(shapeToPath({ shape: "ellipse", width: 10, height: 10, radius: 0, sides: 5, innerRatio: 0.5 })).toContain("A5 5");
    const a = applyOps(rawDoc("t"), [{ op: "add", node: { type: "shape", shape: "star", width: 100, height: 100, sides: 5 } }]);
    const back = svgToOps(docToSvg(a.doc));
    expect(back.ops.length).toBe(1);
  });
});
