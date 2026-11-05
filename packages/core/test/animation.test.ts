import { describe, expect, it } from "vitest";
import {
  Animation,
  animatedSvg,
  animationCss,
  animationOf,
  animationParts,
  applyOps,
  bezier,
  createDoc,
  frameDoc,
  listFrames,
  planAnimation,
  sampleAnimation,
  EASINGS,
  type DocT,
} from "../src";

function logo(): { doc: DocT; fid: string } {
  let doc = createDoc("anim");
  const fid = listFrames(doc)[0]!.id;
  doc = applyOps(doc, [
    { op: "add", node: { id: "ring", type: "shape", shape: "ellipse", width: 400, height: 400, transform: { x: 312, y: 312 }, style: { fill: null, stroke: "#111", strokeWidth: 24 } } },
    { op: "add", node: { id: "dot", type: "shape", shape: "ellipse", width: 100, height: 100, transform: { x: 100, y: 462 }, style: { fill: "#ff4d1f" } } },
    { op: "add", node: { id: "bar", type: "path", d: "M800 450H900V550H800Z", style: { fill: "#0b0c0e", opacity: 0.5 } } },
  ]).doc;
  return { doc, fid };
}

describe("animation spec", () => {
  it("is editable through update ops and undoes cleanly", () => {
    const { doc, fid } = logo();
    const r = applyOps(doc, [{ op: "update", id: fid, set: { animation: { entrance: { kind: "draw", duration: 1200 } } } }]);
    const f = r.doc.nodes[fid] as Extract<DocT["nodes"][string], { type: "frame" }>;
    expect(f.animation?.entrance.kind).toBe("draw");
    expect(f.animation?.entrance.easing).toBe("expo"); // defaults filled in
    expect(f.animation?.loop.kind).toBe("none");
    // partial updates deep-merge
    const r2 = applyOps(r.doc, [{ op: "update", id: fid, set: { animation: { loop: { kind: "float" } } } }]);
    const f2 = r2.doc.nodes[fid] as typeof f;
    expect(f2.animation?.entrance.kind).toBe("draw");
    expect(f2.animation?.loop.kind).toBe("float");
    // the inverse of the first set restores "no animation"
    const back = applyOps(r.doc, r.inverse).doc.nodes[fid] as typeof f;
    expect(back.animation ?? null).toBeNull();
  });

  it("animationOf tolerates missing data", () => {
    expect(animationOf(undefined).entrance.kind).toBe("none");
    expect(animationOf({ entrance: { kind: "pop" } }).entrance.kind).toBe("pop");
  });
});

describe("easing", () => {
  it("matches cubic-bezier endpoints and is monotonic for ease-out curves", () => {
    const f = bezier(EASINGS.expo);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(0.5)).toBeGreaterThan(0.85);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = f(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(bezier(EASINGS.linear)(0.37)).toBeCloseTo(0.37, 6);
    // back overshoots
    const back = bezier(EASINGS.back);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => back(i / 49)))).toBeGreaterThan(1);
  });
});

describe("parts and plan", () => {
  it("orders parts left→right and center-out", () => {
    const { doc, fid } = logo();
    const one = frameDoc(doc, fid);
    const spec = Animation.parse({ entrance: { kind: "fade", order: "left-right" } });
    expect(animationParts(one, spec)).toEqual(["dot", "ring", "bar"]);
    const co = Animation.parse({ entrance: { kind: "fade", order: "center-out" } });
    expect(animationParts(one, co)[0]).toBe("ring");
    const custom = Animation.parse({ entrance: { kind: "fade", order: "custom", ids: ["bar"] } });
    expect(animationParts(one, custom)).toEqual(["bar", "ring", "dot"]);
  });

  it("staggers parts and holds the final state", () => {
    const { doc, fid } = logo();
    const one = frameDoc(doc, fid);
    const plan = planAnimation(one, Animation.parse({ entrance: { kind: "fade-up", duration: 800, stagger: 100, delay: 50 } }));
    expect(plan.parts.map((p) => p.start)).toEqual([50, 150, 250]);
    expect(plan.entranceEnd).toBe(1050);
    const before = sampleAnimation(plan, 0);
    expect(before.ring!.opacity).toBe("0");
    const after = sampleAnimation(plan, 5000);
    expect(after.ring!.opacity).toBe("1");
    // base opacity is respected (bar is 50% opaque)
    expect(after.bar!.opacity).toBe("0.5");
    // the final transform is the identity + the node's own transform
    expect(after.ring!.transform).toContain("translate(312px, 312px)");
    expect(after.ring!.transform).toMatch(/^translate\(512px, 512px\) rotate\(0deg\) scale\(1\) translate\(-512px, -512px\)/);
  });

  it("draw-on outlines filled shapes, then fills them", () => {
    const { doc, fid } = logo();
    const one = frameDoc(doc, fid);
    const plan = planAnimation(one, Animation.parse({ entrance: { kind: "draw", duration: 1000, stagger: 0 } }));
    expect(plan.drawIds.sort()).toEqual(["bar", "dot", "ring"]);
    expect(plan.statics.dot!.stroke).toBe("#ff4d1f");
    expect(plan.statics.ring!.stroke).toBeUndefined(); // already stroked
    const mid = sampleAnimation(plan, 300);
    expect(Number(mid.dot!["stroke-dashoffset"]!.replace("px", ""))).toBeLessThan(1);
    expect(mid.dot!["fill-opacity"]).toBe("0");
    const end = sampleAnimation(plan, 2000);
    expect(end.dot!["stroke-dashoffset"]).toBe("0px");
    expect(end.dot!["fill-opacity"]).toBe("1");
    expect(end.dot!["stroke-opacity"]).toBe("0");
  });

  it("loops start after the entrance and repeat seamlessly", () => {
    const { doc, fid } = logo();
    const one = frameDoc(doc, fid);
    const plan = planAnimation(one, Animation.parse({ entrance: { kind: "fade", duration: 500, stagger: 0 }, loop: { kind: "float", period: 2000, gap: 100 } }));
    expect(plan.loop).toEqual({ kind: "float", start: 600, period: 2000 });
    expect(sampleAnimation(plan, 500)["@loop"]).toBeUndefined();
    const a = sampleAnimation(plan, 600 + 500)["@loop"]!.transform;
    const b = sampleAnimation(plan, 600 + 2500)["@loop"]!.transform;
    expect(a).toBe(b);
    expect(plan.total).toBe(600 + 4000);
  });
});

describe("animated SVG", () => {
  it("emits scoped keyframes, pathLength for draw-on and a loop wrapper", () => {
    const { doc, fid } = logo();
    const one = frameDoc(doc, fid);
    const spec = Animation.parse({ entrance: { kind: "draw" }, loop: { kind: "shimmer" } });
    const { svg, scope } = animatedSvg(one, spec, { scope: "bx-test" });
    expect(svg).toMatch(/^<svg class="bx-test"/);
    expect(svg).toContain('pathLength="1"');
    expect(svg).toContain('<g data-bx="loop">');
    expect(svg).toContain("@keyframes bx-test-0");
    expect(svg).toContain('mask="url(#bx-test-m)"');
    expect(scope).toBe("bx-test");
    const still = animatedSvg(one, spec, { scope: "bx-test", animate: false }).svg;
    expect(still).not.toContain("@keyframes");
    const { css } = animationCss(planAnimation(one, spec), ".x");
    expect(css).toContain("prefers-reduced-motion");
  });
});
