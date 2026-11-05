import { describe, expect, it } from "vitest";
import { applyOps, buildTimelapse, createDoc, duplicateFrameOps, History, listFrames, replayTimelapse, type DocT, type OpT } from "../src";

/** Apply ops the way the daemon does and record them in a History. */
function session() {
  let doc = createDoc("Test");
  const h = new History();
  let t = 1_000;
  const run = (ops: OpT[], label: string, author: "user" | "agent" = "agent") => {
    const r = applyOps(doc, ops);
    let i = 0;
    const normalized = ops.map((o) => (o.op === "add" ? { ...o, node: { ...o.node, id: r.created[i++] }, parent: o.parent ?? r.doc.nodes[r.created[i - 1]!]!.parent } : o)) as OpT[];
    h.push({ ops: normalized, inverse: r.inverse, author, label, at: (t += 1000) });
    doc = r.doc;
    return r.created;
  };
  return { run, h, get doc(): DocT { return doc; } };
}

const v1 = (doc: DocT) => listFrames(doc)[0]!.id;
const sq = (id: string, x = 0) => ({ op: "add", node: { id, type: "shape", shape: "rect", width: 100, height: 100, transform: { x } } }) as OpT;

describe("buildTimelapse", () => {
  it("replays the visible steps of a version from a blank artboard", () => {
    const s = session();
    const f = v1(s.doc);
    s.run([{ ...sq("a"), parent: f } as OpT], "Agent drawing");
    s.run([{ op: "update", id: "a", set: { name: "Box" } }], "Rename", "user"); // invisible
    s.run([{ op: "doc", set: { name: "Renamed" } }], "Rename", "user"); // invisible
    s.run([{ ...sq("b", 200), parent: f } as OpT], "Add circle", "user");
    s.run([{ op: "update", id: "b", set: { style: { fill: "#ff0000" } } }], "Fill", "user");
    const data = buildTimelapse(s.doc, s.h.toJSON().past, f);
    expect(data.startsBlank).toBe(true);
    expect(data.steps.map((x) => x.label)).toEqual(["Agent drawing", "Add circle", "Fill"]);
    expect(data.steps[0]!.caption).toBe("Drawing");
    expect(data.steps[0]!.added).toEqual(["a"]);
    expect(data.steps[2]!.caption).toBe("Adjusting color");
    expect(data.steps[2]!.added).toEqual([]);
    const states = replayTimelapse(data);
    const last = states[states.length - 1]!;
    expect(Object.keys(last.nodes).sort()).toEqual(Object.keys(s.doc.nodes).filter((k) => k !== undefined).sort());
    expect(last.nodes.b).toEqual(s.doc.nodes.b);
  });

  it("folds repeated drags and samples long histories", () => {
    const s = session();
    const f = v1(s.doc);
    s.run([{ ...sq("a"), parent: f } as OpT], "Agent drawing");
    for (let i = 1; i <= 20; i++) s.run([{ op: "update", id: "a", set: { transform: { x: i } } }], "Move", "user");
    const folded = buildTimelapse(s.doc, s.h.toJSON().past, f);
    expect(folded.steps.length).toBe(2);
    expect(folded.steps[1]!.merged).toBe(20);
    for (let i = 0; i < 30; i++) s.run([{ ...sq(`n${i}`, i * 10), parent: f } as OpT], `Add ${i}`);
    const sampled = buildTimelapse(s.doc, s.h.toJSON().past, f, { max: 8 });
    expect(sampled.steps.length).toBe(8);
    const states = replayTimelapse(sampled);
    expect(Object.keys(states[states.length - 1]!.nodes).length).toBe(Object.keys(s.doc.nodes).length);
  });

  it("follows a duplicated version back to the version it was copied from", () => {
    const s = session();
    const f = v1(s.doc);
    s.run([{ ...sq("a"), parent: f } as OpT], "Agent drawing");
    s.run([{ ...sq("b", 300), parent: f } as OpT], "Second shape");
    const dup = duplicateFrameOps(s.doc, f, "V2");
    s.run(dup.ops, "Duplicate version", "user");
    const v2 = listFrames(s.doc)[1]!.id;
    const kid = (s.doc.nodes[v2] as { children: string[] }).children[0]!;
    s.run([{ op: "update", id: kid, set: { style: { fill: "#00ff00" } } }], "Recolor", "agent");
    const data = buildTimelapse(s.doc, s.h.toJSON().past, v2);
    expect(data.startsBlank).toBe(true);
    expect(data.steps.map((x) => x.label)).toEqual(["Agent drawing", "Second shape", "Recolor"]);
    // The copy is not drawn in again.
    expect(data.steps[2]!.added).toEqual([]);
    expect(data.steps[2]!.frame).toBe(v2);
  });
});
