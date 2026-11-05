import { describe, expect, it } from "vitest";
import { applyOps, createDoc, parseDoc } from "../src";

describe("brief (doc op)", () => {
  it("sets, merges and undoes the structured brief", () => {
    const doc = createDoc("t");
    expect(doc.brief).toBeUndefined();

    const a = applyOps(doc, [{ op: "doc", set: { brief: { subject: "Coffee roaster", avoid: "beans" } } }]);
    expect(a.doc.brief).toMatchObject({ subject: "Coffee roaster", avoid: "beans", style: "" });

    // Field-by-field merge: other fields stay.
    const b = applyOps(a.doc, [{ op: "doc", set: { brief: { style: "1800s engraved" } } }]);
    expect(b.doc.brief).toMatchObject({ subject: "Coffee roaster", avoid: "beans", style: "1800s engraved" });

    // Undo the merge → previous brief exactly.
    const ub = applyOps(b.doc, b.inverse);
    expect(ub.doc.brief).toEqual(a.doc.brief);

    // Undo the first set → no brief at all.
    const ua = applyOps(a.doc, a.inverse);
    expect(ua.doc.brief).toBeUndefined();
  });

  it("clears with null and survives a save/load round trip", () => {
    const doc = applyOps(createDoc("t"), [{ op: "doc", set: { brief: { subject: "Fox", keep: "the ears" } } }]).doc;
    const loaded = parseDoc(JSON.parse(JSON.stringify(doc)));
    expect(loaded.brief?.keep).toBe("the ears");
    const cleared = applyOps(loaded, [{ op: "doc", set: { brief: null } }]);
    expect(cleared.doc.brief).toBeUndefined();
    expect(applyOps(cleared.doc, cleared.inverse).doc.brief?.subject).toBe("Fox");
  });

  it("rejects non-string brief fields and leaves the doc unchanged", () => {
    const doc = createDoc("t");
    expect(() => applyOps(doc, [{ op: "doc", set: { brief: { subject: 42 } } }])).toThrow();
    expect(doc.brief).toBeUndefined();
  });

  it("keeps name/scene behaviour alongside brief in one op", () => {
    const doc = createDoc("t");
    const r = applyOps(doc, [{ op: "doc", set: { name: "Fox Co", brief: { use: "app icon" } } }]);
    expect(r.doc.name).toBe("Fox Co");
    const u = applyOps(r.doc, r.inverse);
    expect(u.doc.name).toBe("t");
    expect(u.doc.brief).toBeUndefined();
  });
});
