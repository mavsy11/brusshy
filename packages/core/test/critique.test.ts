import { describe, expect, it } from "vitest";
import {
  applyOps,
  contrastRatio,
  createDoc,
  critique,
  critiqueFixPrompt,
  critiqueNoteOps,
  critiqueText,
  frameDoc,
  listFrames,
  type CritiqueCategoryId,
  type CritiqueReport,
  type DocT,
  type GlyphOutline,
  type OpT,
  type TextNodeT,
} from "../src";

/** A doc whose first frame (1024², white unless given) holds the given nodes. */
function docWith(nodes: Record<string, unknown>[], frame: Record<string, unknown> = { background: "#ffffff" }): { doc: DocT; fid: string } {
  let doc = createDoc("t");
  const fid = listFrames(doc)[0]!.id;
  if (Object.keys(frame).length) doc = applyOps(doc, [{ op: "update", id: fid, set: frame }]).doc;
  doc = applyOps(doc, nodes.map((node) => ({ op: "add", node, parent: (node.parent as string | undefined) ?? fid }) as OpT)).doc;
  return { doc, fid };
}

const rect = (id: string, x: number, y: number, w: number, h: number, fill = "#111111", extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "shape",
  shape: "rect",
  width: w,
  height: h,
  transform: { x, y },
  style: { fill },
  ...extra,
});
const disc = (id: string, cx: number, cy: number, r: number, fill = "#111111") => ({ id, name: id, type: "shape", shape: "ellipse", width: 2 * r, height: 2 * r, transform: { x: cx - r, y: cy - r }, style: { fill } });
const line = (id: string, d: string, width: number, extra: Record<string, unknown> = {}) => ({ id, name: id, type: "path", d, style: { fill: null, stroke: "#111111", strokeWidth: width, ...extra } });

const run = (doc: DocT, fid: string, o: Parameters<typeof critique>[1] = {}) => critique(frameDoc(doc, fid), o);
const cat = (r: CritiqueReport, id: CritiqueCategoryId) => r.categories.find((c) => c.id === id)!;

describe("critique", () => {
  it("says so when the version is empty", () => {
    const { doc, fid } = docWith([]);
    const r = run(doc, fid);
    expect(r.empty).toBe(true);
    expect(r.overall).toBeNull();
    expect(r.findings).toEqual([]);
  });

  it("scores a simple, centred, high-contrast mark highly", () => {
    const { doc, fid } = docWith([disc("dot", 512, 500, 320)]);
    const r = run(doc, fid);
    expect(cat(r, "legibility").findings).toEqual([]);
    expect(cat(r, "balance").findings).toEqual([]);
    expect(cat(r, "contrast").findings).toEqual([]);
    expect(cat(r, "spacing").score).toBeNull();
    expect(r.overall).toBeGreaterThanOrEqual(90);
    for (const c of r.categories) expect(c.verdict.length).toBeGreaterThan(5);
  });

  it("flags a hairline that disappears at 16 px, on its layer", () => {
    const { doc, fid } = docWith([disc("body", 512, 440, 260), rect("hair", 212, 820, 600, 5)]);
    const r = run(doc, fid);
    const f = cat(r, "legibility").findings.find((x) => x.nodeId === "hair");
    expect(f).toBeTruthy();
    expect(f!.severity).toBe("high");
    expect(f!.title).toMatch(/disappears at 16 px/);
    // Anchored on the hairline itself.
    expect(f!.y).toBeGreaterThan(810);
    expect(f!.y).toBeLessThan(835);
    expect(f!.fix).toMatch(/64 units/);
  });

  it("measures stroke contrast and asks for a small-size cut when it is high", () => {
    // Monoline: a ring of even weight.
    const even = docWith([line("ring", "M512 312A200 200 0 1 1 511.9 312Z", 100)]);
    const ev = cat(run(even.doc, even.fid), "legibility");
    expect(ev.metrics.strokeContrast as number).toBeGreaterThan(0.7);
    expect(ev.findings.some((f) => f.title.includes("stroke contrast"))).toBe(false);
    // Didone-like: two heavy stems joined by hairlines (an N).
    const high = docWith([rect("left", 300, 200, 130, 620), rect("right", 600, 200, 130, 620), line("diag", "M365 210L665 810", 14), line("top", "M300 206H730", 12)]);
    const hi = cat(run(high.doc, high.fid), "legibility");
    expect(hi.metrics.strokeContrast as number).toBeLessThan(0.3);
    expect(hi.findings.some((f) => f.title.includes("needs a small-size cut"))).toBe(true);
  });

  it("flags a gap that closes at 16 px, between the two parts", () => {
    const { doc, fid } = docWith([rect("left", 212, 262, 290, 500), rect("right", 522, 262, 290, 500)]);
    const r = run(doc, fid);
    const f = cat(r, "legibility").findings.find((x) => /^Gap/.test(x.title));
    expect(f).toBeTruthy();
    expect(["high", "medium"]).toContain(f!.severity);
    expect(f!.title).toMatch(/"left"|"right"/);
    expect(f!.x).toBeGreaterThan(500);
    expect(f!.x).toBeLessThan(525);
    // A comfortable gap is fine.
    const ok = docWith([rect("left", 162, 262, 290, 500), rect("right", 572, 262, 290, 500)]);
    expect(cat(run(ok.doc, ok.fid), "legibility").findings.filter((x) => /^Gap/.test(x.title))).toEqual([]);
  });

  it("measures balance against the optical centre", () => {
    const off = docWith([disc("dot", 680, 512, 220)]);
    const b = cat(run(off.doc, off.fid), "balance");
    expect(b.findings[0]!.title).toMatch(/right/);
    expect(b.findings[0]!.fix).toMatch(/168 units left/);
    expect(b.score!).toBeLessThan(80);
    // Slightly high reads as centred; low does not.
    const high = docWith([disc("dot", 512, 490, 300)]);
    expect(cat(run(high.doc, high.fid), "balance").findings).toEqual([]);
    const low = docWith([disc("dot", 512, 560, 300)]);
    expect(cat(run(low.doc, low.fid), "balance").findings[0]!.title).toMatch(/low/);
  });

  it("flags faint colours with a same-hue fix that passes 3:1", () => {
    const { doc, fid } = docWith([disc("sun", 512, 500, 300, "#f7e26b")]);
    const c = cat(run(doc, fid), "contrast");
    const f = c.findings[0]!;
    expect(f.nodeId).toBe("sun");
    expect(f.severity).toBe("high");
    const fix = /#[0-9A-F]{6}/.exec(f.fix)![0];
    expect(contrastRatio(fix, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(c.score!).toBeLessThan(50);
  });

  it("judges colours against what surrounds them (knockouts and badges are fine)", () => {
    const { doc, fid } = docWith([
      disc("seal", 512, 420, 260, "#1f3d2b"),
      disc("knockout", 512, 420, 120, "#f4f1ea"),
      { id: "tag", name: "tag", type: "text", text: "EST 1998", fontSize: 30, anchor: "middle", transform: { x: 512, y: 600 }, style: { fill: "#f4f1ea" } },
    ]);
    const c = cat(run(doc, fid), "contrast");
    expect(c.findings).toEqual([]);
    expect(c.score!).toBeGreaterThan(90);
  });

  it("flags neighbouring colours separated only by hue", () => {
    const { doc, fid } = docWith([rect("red", 212, 262, 300, 500, "#ff0000"), rect("green", 512, 262, 300, 500, "#00a000")]);
    const f = cat(run(doc, fid), "contrast").findings.find((x) => /Only hue/.test(x.title));
    expect(f).toBeTruthy();
    expect(f!.x).toBeGreaterThan(490);
    expect(f!.x).toBeLessThan(530);
  });

  it("treats a light mark on a transparent artboard as made for dark backgrounds", () => {
    const { doc, fid } = docWith([disc("dot", 512, 500, 300, "#ffffff")], { background: null });
    const r = run(doc, fid);
    expect(cat(r, "contrast").findings).toEqual([]);
    expect(cat(r, "balance").findings).toEqual([]);
  });

  it("counts nodes, colours and tiny details", () => {
    const pts = Array.from({ length: 150 }, (_, i) => {
      const a = (i / 150) * Math.PI * 2;
      return `${(512 + Math.cos(a) * 300).toFixed(1)} ${(512 + Math.sin(a) * 300).toFixed(1)}`;
    });
    const fills = ["#111111", "#d62828", "#f77f00", "#2a9d8f", "#264653", "#6a4c93"];
    const { doc, fid } = docWith([
      { id: "blob", name: "blob", type: "path", d: `M${pts.join("L")}Z`, style: { fill: fills[0] } },
      ...fills.slice(1).map((c, i) => rect(`c${i}`, 300 + i * 90, 470, 60, 60, c)),
      disc("speck", 900, 900, 4),
    ]);
    const c = cat(run(doc, fid), "complexity");
    expect(c.findings.some((f) => f.nodeId === "blob" && /150 nodes/.test(f.title))).toBe(true);
    expect(c.findings.some((f) => /6 colours/.test(f.title))).toBe(true);
    expect(c.findings.some((f) => f.nodeId === "speck" && /Tiny detail/.test(f.title))).toBe(true);
  });

  it("finds near-equal stroke weights and corner radii", () => {
    const { doc, fid } = docWith([
      line("a", "M200 300H820", 48),
      line("b", "M200 500H820", 48),
      line("c", "M200 700H820", 44),
      rect("r1", 100, 100, 200, 120, "#111111", { radius: 24 }),
      rect("r2", 700, 100, 200, 120, "#111111", { radius: 24 }),
      rect("r3", 400, 800, 200, 120, "#111111", { radius: 27 }),
    ]);
    const c = cat(run(doc, fid), "consistency");
    const sw = c.findings.find((f) => /Stroke weights/.test(f.title));
    expect(sw?.nodeId).toBe("c");
    expect(sw?.fix).toMatch(/48/);
    const cr = c.findings.find((f) => /Corner radii/.test(f.title));
    expect(cr?.nodeId).toBe("r3");
  });

  it("finds alignment near-misses but leaves round overshoot alone", () => {
    const { doc, fid } = docWith([rect("top", 200, 200, 400, 200), rect("bottom", 202, 500, 400, 200), rect("third", 200, 760, 300, 100)]);
    const a = cat(run(doc, fid), "alignment");
    const f = a.findings.find((x) => x.nodeId === "bottom");
    expect(f).toBeTruthy();
    expect(f!.title).toMatch(/left edge|centre line/);
    expect(f!.fix).toMatch(/2 units left/);
    // A circle overshooting a square's top by 1% is optical, not a mistake.
    const o = docWith([rect("sq", 200, 300, 300, 300), disc("o", 700, 450, 153)]);
    expect(cat(run(o.doc, o.fid), "alignment").findings.filter((x) => /top edge|bottom edge/.test(x.title))).toEqual([]);
  });

  it("measures optical letter gaps on real glyphs and suggests kerning", () => {
    // Fake font: every glyph a 0.5 em stem box; "C" gap is 3× wider than the rest.
    const word: TextNodeT = { id: "word", name: "word", type: "text", text: "ABCD" } as TextNodeT;
    const textGlyphs = (n: TextNodeT): GlyphOutline[] => {
      const em = n.fontSize;
      let x = 0;
      return Array.from(n.text).map((ch) => {
        if (ch === "C") x += 0.12 * em;
        const d = `M${x} ${-0.7 * em}H${x + 0.5 * em}V0H${x}Z`;
        x += 0.56 * em;
        return { text: ch, d };
      });
    };
    void word;
    const { doc, fid } = docWith([{ id: "word", name: "word", type: "text", text: "ABCD", fontSize: 160, transform: { x: 120, y: 600 }, style: { fill: "#111111" } }]);
    const r = run(doc, fid, { textGlyphs });
    expect(r.exactType).toBe(true);
    const s = cat(r, "spacing");
    expect(s.score).not.toBeNull();
    const f = s.findings.find((x) => /"BC"/.test(x.title));
    expect(f).toBeTruthy();
    expect(f!.title).toMatch(/looser/);
    expect(f!.fix).toMatch(/Kern BC by -1\d\d\/1000 em/);
    // Without outlines the report says text was estimated.
    const est = run(doc, fid);
    expect(est.exactType).toBe(false);
    expect(cat(est, "spacing").score).toBeNull();
  });

  it("pins findings as notes in one batch and skips duplicates", () => {
    const { doc, fid } = docWith([disc("sun", 680, 512, 220, "#f7e26b")]);
    const r = run(doc, fid);
    const ops = critiqueNoteOps(fid, r.findings, doc);
    expect(ops.length).toBe(r.findings.length);
    const next = applyOps(doc, ops).doc;
    const notes = Object.values(next.annotations);
    expect(notes.length).toBe(r.findings.length);
    expect(notes.every((a) => a.frameId === fid && a.note.startsWith("Critique · "))).toBe(true);
    expect(notes.some((a) => a.nodeId === "sun")).toBe(true);
    expect(critiqueNoteOps(fid, r.findings, next)).toEqual([]);
    expect(critiqueText(r)).toMatch(/\/100/);
    expect(critiqueFixPrompt(r, r.findings)).toMatch(/run critique again/);
  });
});
