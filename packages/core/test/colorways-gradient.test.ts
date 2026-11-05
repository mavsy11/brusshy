import { describe, expect, it } from "vitest";
import { applyOps, colorwayDoc, createDoc, listFrames, planColorways, svgToOps, type PaletteEntryT } from "../src";

describe("colorways with gradients", () => {
  it("recolors a gradient as one surface instead of splitting its stops", () => {
    const doc0 = createDoc("t");
    const f = listFrames(doc0)[0]!;
    const svg = `<svg viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b6cff"/><stop offset="1" stop-color="#4f3df0"/></linearGradient></defs>
      <rect x="352" y="232" width="320" height="320" rx="90" fill="url(#g)"/><path d="M470 330 L600 400 L470 470 Z" fill="#ffffff"/>
      <rect x="300" y="680" width="420" height="90" fill="#14121f"/></svg>`;
    const doc = applyOps(doc0, svgToOps(svg, { parent: f.id }).ops).doc;
    const palette: PaletteEntryT[] = [
      { hex: "#7b6cff", name: "Iris", role: "primary", locked: false },
      { hex: "#4f3df0", name: "Cobalt", role: "secondary", locked: false },
      { hex: "#14121f", name: "Ink", role: "neutral", locked: false },
      { hex: "#ffffff", name: "White", role: "background", locked: false },
    ];
    const plan = planColorways(doc, f.id, palette);
    const onIris = plan.grid[0]![0]!;
    const out = colorwayDoc(doc, f.id, onIris);
    const grads = Object.values(out.nodes).flatMap((n) => ("style" in n && n.style.fill && typeof n.style.fill === "object" ? [n.style.fill] : []));
    expect(grads.length).toBe(1);
    const stops = new Set(grads[0]!.stops.map((s) => s.color.toLowerCase()));
    expect(stops.size).toBe(1);
    // Untouched on its own white ground: the original gradient stays.
    const onWhite = colorwayDoc(doc, f.id, plan.grid[3]![0]!);
    const g2 = Object.values(onWhite.nodes).flatMap((n) => ("style" in n && n.style.fill && typeof n.style.fill === "object" ? [n.style.fill] : []));
    expect(new Set(g2[0]!.stops.map((s) => s.color.toLowerCase())).size).toBe(2);
  });
});
