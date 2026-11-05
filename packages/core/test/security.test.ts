import { describe, expect, it } from "vitest";
import { applyOps, createDoc, targetSelector } from "../src";

// Node ids reach markup and the animated SVG's <style>; a hostile id (a shared document, a prompt-injected agent)
// must not be able to close either.
describe("hostile node ids", () => {
  const evil = 'x"]{}</style><script>alert(1)</script><style>';

  it("an add op with an unsafe id gets a fresh one", () => {
    const r = applyOps(createDoc("t"), [{ op: "add", node: { id: evil, type: "path", d: "M0 0L10 10" } }]);
    expect(r.created[0]).toMatch(/^[\w-]+$/);
    expect(r.doc.nodes[evil]).toBeUndefined();
  });

  it("keeps ordinary ids", () => {
    const r = applyOps(createDoc("t"), [{ op: "add", node: { id: "wand-top_2", type: "path", d: "M0 0L10 10" } }]);
    expect(r.created).toEqual(["wand-top_2"]);
  });

  it("escapes an id in animation selectors", () => {
    const sel = targetSelector(evil);
    expect(sel).not.toMatch(/[<>{}]/);
    expect(sel.slice(10, -2)).not.toContain('"');
    expect(targetSelector("wand-top_2")).toBe('[data-id="wand-top_2"]');
  });
});
