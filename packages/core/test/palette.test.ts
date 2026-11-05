import { describe, expect, it } from "vitest";
import {
  applyOps,
  applyPaletteOps,
  colorFormats,
  colorwayDoc,
  colorwayInks,
  colorwaySheetSvg,
  contrastLevel,
  contrastPairs,
  contrastRatio,
  createDoc,
  docToSvg,
  generatePalette,
  hexToOklch,
  imageColors,
  keepColorwaysOps,
  listFrames,
  logoColors,
  nameColor,
  namePalette,
  nudgeColor,
  oklchToHex,
  paletteBriefText,
  parseDoc,
  planColorways,
  toPaletteEntries,
  PALETTE_HARMONIES,
  type DocT,
  type OpT,
  type PaletteEntryT,
} from "../src";

function docWith(nodes: Record<string, unknown>[], frame: Record<string, unknown> = {}): { doc: DocT; fid: string } {
  let doc = createDoc("t");
  const fid = listFrames(doc)[0]!.id;
  if (Object.keys(frame).length) doc = applyOps(doc, [{ op: "update", id: fid, set: frame }]).doc;
  doc = applyOps(doc, nodes.map((node) => ({ op: "add", node, parent: fid }) as OpT)).doc;
  return { doc, fid };
}

const shape = (shape: string, x: number, y: number, w: number, h: number, fill: unknown, extra: Record<string, unknown> = {}) => ({
  type: "shape",
  shape,
  width: w,
  height: h,
  transform: { x, y },
  style: { fill },
  ...extra,
});

describe("palette (doc op)", () => {
  it("sets, merges, undoes and clears doc.palette", () => {
    const doc = createDoc("t");
    expect(doc.palette).toBeUndefined();
    const colors = toPaletteEntries([{ hex: "#E4472A" }, { hex: "rgb(20,22,26)" }, { hex: "#f6f3ec" }]);
    const a = applyOps(doc, [{ op: "doc", set: { palette: { colors, harmony: "analogous", seed: 4 } } }]);
    expect(a.doc.palette?.colors.map((c) => c.hex)).toEqual(["#e4472a", "#14161a", "#f6f3ec"]);
    expect(a.doc.palette?.colors.map((c) => c.role)).toEqual(["primary", "neutral", "background"]);

    // Key-by-key merge: changing the seed keeps the colors.
    const b = applyOps(a.doc, [{ op: "doc", set: { palette: { seed: 9 } } }]);
    expect(b.doc.palette?.seed).toBe(9);
    expect(b.doc.palette?.colors).toHaveLength(3);
    expect(applyOps(b.doc, b.inverse).doc.palette).toEqual(a.doc.palette);
    expect(applyOps(a.doc, a.inverse).doc.palette).toBeUndefined();

    const loaded = parseDoc(JSON.parse(JSON.stringify(b.doc)));
    expect(loaded.palette?.colors[0]?.name).toBe(b.doc.palette?.colors[0]?.name);
    const cleared = applyOps(loaded, [{ op: "doc", set: { palette: null } }]);
    expect(cleared.doc.palette).toBeUndefined();
    expect(applyOps(cleared.doc, cleared.inverse).doc.palette?.seed).toBe(9);
  });

  it("rejects invalid colors and leaves the doc unchanged", () => {
    const doc = createDoc("t");
    expect(() => applyOps(doc, [{ op: "doc", set: { palette: { colors: [{ hex: "red" }] } } }])).toThrow();
    expect(() => applyOps(doc, [{ op: "doc", set: { palette: { colors: [{ hex: "#123456", role: "hero" }] } } }])).toThrow();
    expect(doc.palette).toBeUndefined();
  });

  it("writes a brief-ready palette line", () => {
    const t = paletteBriefText(toPaletteEntries([{ hex: "#1b2a52", name: "Harbor" }, { hex: "#f6f3ec" }]));
    expect(t).toMatch(/^Primary Harbor #1B2A52 · Background \w+/);
  });
});

describe("color math", () => {
  it("round-trips OKLCH and gamut-maps out-of-range chroma", () => {
    for (const hex of ["#e4472a", "#1b2a52", "#f6f3ec", "#11865a", "#000000", "#ffffff"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
    const wild = oklchToHex({ l: 0.6, c: 0.5, h: 145 });
    expect(wild).toMatch(/^#[0-9a-f]{6}$/);
    expect(Math.abs(hexToOklch(wild).l - 0.6)).toBeLessThan(0.02);
    expect(Math.abs(hexToOklch(wild).h - 145)).toBeLessThan(3);
  });

  it("formats HEX/RGB/HSL/OKLCH", () => {
    const f = colorFormats("#ff0000");
    expect(f.hex).toBe("#FF0000");
    expect(f.rgb).toBe("rgb(255, 0, 0)");
    expect(f.hsl).toBe("hsl(0, 100%, 50%)");
    expect(f.oklch).toMatch(/^oklch\(62\.8% 0\.25\d? 29\.\d\)$/);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrastLevel(7.1)).toBe("AAA");
    expect(contrastLevel(4.6)).toBe("AA");
    expect(contrastLevel(3.2)).toBe("AA large");
    expect(contrastLevel(2)).toBe("fail");
    const pairs = contrastPairs(["#ffffff", "#000000", "#777777"]);
    expect(pairs[0]).toMatchObject({ a: 0, b: 1, level: "AAA" });
    expect(pairs).toHaveLength(3);
  });

  it("names colors offline, uniquely within a palette", () => {
    expect(nameColor("#1b2a52")).toBe("Navy");
    expect(nameColor("#fefefe")).toMatch(/White|Snow/);
    const names = namePalette(["#1b2a52", "#1c2b55", "#e4472a"]);
    expect(new Set(names).size).toBe(3);
  });

  it("nudges lightness, saturation and warmth", () => {
    const base = "#3a7bd5";
    const o = hexToOklch(base);
    expect(hexToOklch(nudgeColor(base, { lightness: 0.4 })).l).toBeGreaterThan(o.l + 0.08);
    expect(hexToOklch(nudgeColor(base, { saturation: -1 })).c).toBeLessThan(0.005);
    const warm = hexToOklch(nudgeColor(base, { warmth: 1 })).h;
    const cool = hexToOklch(nudgeColor(base, { warmth: -1 })).h;
    // Blue turns toward violet/red when warmed, stays near/cooler blue when cooled.
    expect(Math.abs(warm - o.h)).toBeGreaterThan(20);
    expect(Math.abs(cool - 250)).toBeLessThanOrEqual(Math.abs(o.h - 250) + 0.5);
    // A gray warms into a tint.
    expect(hexToOklch(nudgeColor("#808080", { warmth: 1 })).c).toBeGreaterThan(0.015);
  });
});

describe("generator", () => {
  it("is deterministic for a seed and varies across seeds", () => {
    const a = generatePalette({ harmony: "triadic", count: 5, seed: 42 });
    const b = generatePalette({ harmony: "triadic", count: 5, seed: 42 });
    const c = generatePalette({ harmony: "triadic", count: 5, seed: 43 });
    expect(a).toEqual(b);
    expect(a.map((x) => x.hex)).not.toEqual(c.map((x) => x.hex));
  });

  it("makes usable logo palettes for every harmony and size", () => {
    for (const harmony of PALETTE_HARMONIES) {
      for (const count of [3, 4, 5, 6]) {
        for (const seed of [1, 7, 99]) {
          const p = generatePalette({ harmony, count, seed });
          expect(p).toHaveLength(count);
          expect(new Set(p.map((x) => x.hex)).size).toBe(count);
          expect(new Set(p.map((x) => x.name)).size).toBe(count);
          const bg = p.find((x) => x.role === "background")!;
          const ink = p.find((x) => x.role === "neutral")!;
          const primary = p.find((x) => x.role === "primary")!;
          expect(hexToOklch(bg.hex).l).toBeGreaterThan(0.94);
          expect(contrastRatio(ink.hex, bg.hex)).toBeGreaterThanOrEqual(9);
          expect(contrastRatio(primary.hex, bg.hex)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("follows the harmony's hue relationships", () => {
    const hueGap = (a: string, b: string) => {
      const d = Math.abs(hexToOklch(a).h - hexToOklch(b).h) % 360;
      return d > 180 ? 360 - d : d;
    };
    const comp = generatePalette({ harmony: "complementary", count: 4, seed: 3 });
    expect(hueGap(comp[0]!.hex, comp[1]!.hex)).toBeGreaterThan(150);
    const ana = generatePalette({ harmony: "analogous", count: 4, seed: 3 });
    expect(hueGap(ana[0]!.hex, ana[1]!.hex)).toBeLessThan(45);
    const mono = generatePalette({ harmony: "monochrome", count: 5, seed: 3 });
    expect(hueGap(mono[0]!.hex, mono[1]!.hex)).toBeLessThan(8);
    expect(Math.abs(hexToOklch(mono[0]!.hex).l - hexToOklch(mono[1]!.hex).l)).toBeGreaterThan(0.12);
  });

  it("keeps locked colors in place and builds the rest around them", () => {
    const first = generatePalette({ harmony: "complementary", count: 5, seed: 1 });
    const locked: PaletteEntryT[] = first.map((c, i) => (i === 0 ? { ...c, hex: "#11865a", name: "Club Green", locked: true } : c));
    for (const seed of [2, 3, 4]) {
      const next = generatePalette({ harmony: "complementary", count: 5, seed, current: locked });
      expect(next[0]).toEqual({ hex: "#11865a", name: "Club Green", role: "primary", locked: true });
      // The complement is built around the locked primary's hue.
      const d = Math.abs(hexToOklch(next[1]!.hex).h - hexToOklch("#11865a").h);
      expect(Math.min(d, 360 - d)).toBeGreaterThan(150);
    }
    // Changing size keeps the lock; template roles fill the rest without duplicating the locked role.
    const bigger = generatePalette({ harmony: "triadic", count: 6, seed: 5, current: locked });
    expect(bigger[0]!.hex).toBe("#11865a");
    expect(bigger.filter((c) => c.role === "primary")).toHaveLength(1);
    const smaller = generatePalette({ harmony: "triadic", count: 3, seed: 5, current: [...first.slice(0, 4), { ...first[4]!, locked: true }] });
    expect(smaller).toHaveLength(3);
    expect(smaller.some((c) => c.hex === first[4]!.hex && c.locked)).toBe(true);
  });

  it("keeps the user's roles when the size is unchanged", () => {
    const p = generatePalette({ harmony: "split", count: 4, seed: 8 });
    const relabeled = p.map((c, i) => (i === 1 ? { ...c, role: "accent" as const } : c));
    const next = generatePalette({ harmony: "split", count: 4, seed: 9, current: relabeled });
    expect(next.map((c) => c.role)).toEqual(relabeled.map((c) => c.role));
  });

  it("takes colors from the logo and from image samples", () => {
    const { doc, fid } = docWith([shape("rect", 0, 0, 600, 600, "#1b2a52"), shape("ellipse", 100, 100, 200, 200, "#e4472a")]);
    const logo = logoColors(doc, fid);
    const p = generatePalette({ harmony: "logo", count: 5, seed: 1, logo });
    expect(p.map((c) => c.hex)).toContain("#1b2a52");
    expect(p.map((c) => c.hex)).toContain("#e4472a");

    // A synthetic image: 70% teal, 20% cream, 10% transparent.
    const px: number[] = [];
    for (let i = 0; i < 1000; i++) {
      if (i < 700) px.push(18, 124, 122, 255);
      else if (i < 900) px.push(246, 237, 214, 255);
      else px.push(255, 0, 0, 0);
    }
    const samples = imageColors(px, { seed: 1, k: 4 });
    expect(samples[0]!.hex).toBe("#127c7a");
    expect(samples.some((s) => s.hex === "#ff0000")).toBe(false);
    const ip = generatePalette({ harmony: "image", count: 4, seed: 1, image: samples });
    expect(ip.find((c) => c.role === "primary")!.hex).toBe("#127c7a");
    expect(ip.find((c) => c.role === "background")!.hex).toBe("#f6edd6");
  });
});

describe("apply palette to a version", () => {
  it("recolors by lightness order in one batch and sets the ground", () => {
    const { doc, fid } = docWith([shape("rect", 0, 0, 600, 600, "#000000"), shape("ellipse", 100, 100, 200, 200, "#ff8800")], { background: "#ffffff" });
    const colors = toPaletteEntries([
      { hex: "#e4472a", role: "primary" },
      { hex: "#1b2a52", role: "neutral" },
      { hex: "#f6f3ec", role: "background" },
    ]);
    const r = applyPaletteOps(doc, fid, colors);
    const next = applyOps(doc, r.ops).doc;
    const fills = Object.values(next.nodes).flatMap((n) => (n.type === "shape" ? [n.style.fill] : []));
    expect(fills).toEqual(["#1b2a52", "#e4472a"]);
    expect((next.nodes[fid] as { background: string }).background).toBe("#f6f3ec");
    // One undo step restores everything.
    const back = applyOps(next, applyOps(doc, r.ops).inverse).doc;
    expect(Object.values(back.nodes).flatMap((n) => (n.type === "shape" ? [n.style.fill] : []))).toEqual(["#000000", "#ff8800"]);
  });
});

describe("colorways", () => {
  // A navy badge with a white star on it (a detail on the mark) and an orange wordmark bar beside it.
  const badge = () =>
    docWith([
      shape("ellipse", 100, 100, 400, 400, "#1b2a52"),
      shape("star", 200, 200, 200, 200, "#ffffff"),
      shape("rect", 560, 260, 360, 80, "#f2691d"),
    ]);
  const palette = toPaletteEntries([
    { hex: "#e4472a", role: "primary", name: "Vermilion" },
    { hex: "#127c7a", role: "secondary", name: "Teal" },
    { hex: "#14161a", role: "neutral", name: "Ink" },
    { hex: "#f6f3ec", role: "background", name: "Paper" },
  ]);

  it("finds details on the mark and fake holes", () => {
    const { doc, fid } = badge();
    const inks = colorwayInks(doc, fid);
    const byHex = Object.fromEntries(inks.map((k) => [k.hex, k]));
    expect(byHex["#ffffff"]).toMatchObject({ onMark: true, hole: true, host: false });
    // The badge carries the star; the bar beside it carries nothing.
    expect(byHex["#1b2a52"]).toMatchObject({ onMark: false, hole: false, host: true });
    expect(byHex["#f2691d"]).toMatchObject({ onMark: false, hole: false, host: false });
  });

  it("plans every background × (full color + each ink) and flags low contrast", () => {
    const { doc, fid } = badge();
    const plan = planColorways(doc, fid, palette);
    expect(plan.grid).toHaveLength(4);
    expect(plan.columns).toHaveLength(5);
    expect(plan.columns[0]).toEqual({ kind: "full" });
    // Ink = background never appears.
    plan.grid.forEach((row, r) => expect(row[r + 1]).toBeNull());
    // 4 full + 4×3 one-color.
    expect(plan.all).toHaveLength(16);
    const ids = plan.all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.grid[3]![3]!.id).toBe("D3");
    // Ink on Paper reads; Ink on... Vermilion → lower.
    const inkOnPaper = plan.grid[3]![3]!;
    expect(inkOnPaper.readable).toBe(true);
    expect(inkOnPaper.contrast).toBeGreaterThan(15);
    const vermOnTeal = plan.grid[1]![1]!;
    expect(vermOnTeal.readable).toBe(false);
    // Full color on a dark ground picks a light lead ink.
    const fullOnInk = plan.grid[2]![0]!;
    expect(fullOnInk.readable).toBe(true);
    expect(contrastRatio(fullOnInk.dominant, "#14161a")).toBeGreaterThanOrEqual(3);
  });

  it("one-color keeps the star readable as a knock-out", () => {
    const { doc, fid } = badge();
    const plan = planColorways(doc, fid, palette);
    const cw = plan.grid[3]![3]!; // Ink on Paper
    const d = colorwayDoc(doc, fid, cw);
    const fills = Object.values(d.nodes).flatMap((n) => (n.type === "shape" ? [[n.shape, n.style.fill]] : []));
    expect(fills).toEqual([
      ["ellipse", "#14161a"],
      ["star", "#f6f3ec"],
      ["rect", "#14161a"],
    ]);
    expect(d.artboard.background).toBe("#f6f3ec");
    // Full color on Paper keeps the star knocked out and gives the bar a support color.
    const full = colorwayDoc(doc, fid, plan.grid[3]![0]!);
    const f2 = Object.values(full.nodes).flatMap((n) => (n.type === "shape" ? [n.style.fill] : []));
    expect(f2[1]).toBe("#f6f3ec");
    expect(f2[0]).not.toBe(f2[2]);
  });

  it("full color on the original ground is the original logo when the palette holds its colors", () => {
    const { doc, fid } = badge();
    const own = toPaletteEntries([
      { hex: "#1b2a52", role: "primary" },
      { hex: "#f2691d", role: "secondary" },
      { hex: "#14161a", role: "neutral" },
      { hex: "#ffffff", role: "background" },
    ]);
    const plan = planColorways(doc, fid, own);
    const full = colorwayDoc(doc, fid, plan.grid[3]![0]!);
    expect(Object.values(full.nodes).flatMap((n) => (n.type === "shape" ? [n.style.fill] : []))).toEqual(["#1b2a52", "#ffffff", "#f2691d"]);
  });

  it("keeps colorways as new versions side by side in one batch", () => {
    const { doc, fid } = badge();
    const plan = planColorways(doc, fid, palette);
    const picks = [plan.grid[3]![3]!, plan.grid[2]![4]!];
    const r = keepColorwaysOps(doc, fid, picks);
    const res = applyOps(doc, r.ops);
    const frames = listFrames(res.doc);
    expect(frames.map((f) => f.name)).toEqual(["V1", "V2", "V3"]);
    expect(frames[1]!.background).toBe("#f6f3ec");
    expect(frames[2]!.background).toBe("#14161a");
    expect(frames[2]!.transform.x).toBeGreaterThan(frames[1]!.transform.x);
    expect(frames[1]!.children).toHaveLength(3);
    const v2 = frames[1]!.children.map((id) => (res.doc.nodes[id] as { style: { fill: string } }).style.fill);
    expect(v2).toEqual(["#14161a", "#f6f3ec", "#14161a"]);
    // The source is untouched and a single inverse batch removes both versions.
    expect(res.doc.nodes[fid]).toEqual(doc.nodes[fid]);
    expect(listFrames(applyOps(res.doc, res.inverse).doc)).toHaveLength(1);
  });

  it("builds a contact sheet with unique gradient ids per tile", () => {
    const { doc, fid } = docWith([
      shape("ellipse", 100, 100, 400, 400, { type: "linear", angle: 0, stops: [{ offset: 0, color: "#1b2a52" }, { offset: 1, color: "#2a3f7a" }] }),
      shape("rect", 560, 260, 360, 80, "#f2691d"),
    ]);
    const plan = planColorways(doc, fid, palette);
    const svg = colorwaySheetSvg(plan, (cw) => docToSvg(colorwayDoc(doc, fid, cw), { background: null }), { title: "t" });
    expect(svg.startsWith("<svg")).toBe(true);
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(m[1]);
    expect(svg).toContain("A0");
  });
});
