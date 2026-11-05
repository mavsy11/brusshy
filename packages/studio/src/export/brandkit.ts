import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { Font, PathCommand } from "opentype.js";
import { hexToOklch, normalizeColor, oklchToHex, type DocT } from "@brusshy/core";
import { ensureFont, FONT_FAMILIES, safeAdvance, safeGetPath } from "../lib/fonts";
import { render3D } from "../three/api";
import { logoFonts } from "./brandmd";
import { svgToPng, svgViewBox } from "./raster";
import { donts, kitRules, unitLabel } from "./rules";
import { buildSvg, prepareFonts } from "./svg";
import { extractPalette, luminance, parseColor, slug, toCmyk, type PaletteGradient } from "./util";
import { colorOn, GROUND_LABEL, GROUNDS, INK_LABEL, logoVariants, variantName, type LogoVariant } from "./variants";

/* A4 landscape, in PDF points. */
const W = 841.89;
const H = 595.28;
const M = 40;

const hex = (h: string): RGB => {
  const c = parseColor(h);
  return c ? rgb(c.r / 255, c.g / 255, c.b / 255) : rgb(0, 0, 0);
};
const C = {
  ink: hex("#0b0c0e"),
  ink2: hex("#585f63"),
  ink3: hex("#8e9599"),
  ink4: hex("#b9bec1"),
  rule: hex("#dfe2e3"),
  paper: hex("#f4f5f5"),
  pure: rgb(1, 1, 1),
  accent: hex("#ff4d1f"),
};

type Weight = 400 | 500 | 600;
type Align = "left" | "center" | "right";

interface TextOpts {
  size: number;
  weight?: Weight;
  color?: RGB;
  /** Letter spacing in em. */
  tracking?: number;
  align?: Align;
  upper?: boolean;
}

/**
 * Sets labels in Geist as vector outlines (exactly the studio's typeface, no font
 * embedding needed). Falls back to Helvetica if Geist can't be fetched.
 */
class Type {
  constructor(
    private geist: Partial<Record<Weight, Font>>,
    private helv: PDFFont,
    private helvBold: PDFFont,
  ) {}

  private font(w: Weight): Font | undefined {
    return this.geist[w] ?? this.geist[500] ?? this.geist[400];
  }

  width(text: string, o: TextOpts): number {
    const t = o.upper ? text.toUpperCase() : text;
    const f = this.font(o.weight ?? 400);
    if (f) return safeAdvance(f, t, o.size, o.tracking ?? 0);
    const pf = (o.weight ?? 400) >= 600 ? this.helvBold : this.helv;
    const safe = latin(t);
    return pf.widthOfTextAtSize(safe, o.size) + (o.tracking ?? 0) * o.size * Math.max(0, safe.length - 1);
  }

  draw(page: PDFPage, text: string, x: number, y: number, o: TextOpts): number {
    const t = o.upper ? text.toUpperCase() : text;
    const w = this.width(t, { ...o, upper: false });
    const x0 = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    const color = o.color ?? C.ink;
    const f = this.font(o.weight ?? 400);
    if (f) {
      const d = pdfPath(safeGetPath(f, t, 0, 0, o.size, o.tracking ?? 0));
      if (d) page.drawSvgPath(d, { x: x0, y, color });
      return w;
    }
    const pf = (o.weight ?? 400) >= 600 ? this.helvBold : this.helv;
    const safe = latin(t);
    if (!o.tracking) page.drawText(safe, { x: x0, y, size: o.size, font: pf, color });
    else {
      let cx = x0;
      for (const ch of safe) {
        page.drawText(ch, { x: cx, y, size: o.size, font: pf, color });
        cx += pf.widthOfTextAtSize(ch, o.size) + o.tracking * o.size;
      }
    }
    return w;
  }
}

/**
 * opentype's toPathData() emits compact numbers ("1-2", implicit commands) that
 * pdf-lib's SVG path parser mis-reads, so serialize the commands explicitly.
 */
function pdfPath(p: { commands: PathCommand[] }): string {
  const n = (v: number) => (Math.round(v * 100) / 100).toString();
  let d = "";
  for (const c of p.commands) {
    if (c.type === "M" || c.type === "L") d += `${c.type} ${n(c.x)} ${n(c.y)} `;
    else if (c.type === "Q") d += `Q ${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)} `;
    else if (c.type === "C") d += `C ${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)} `;
    else if (c.type === "Z") d += "Z ";
  }
  return d.trim();
}

/** Helvetica (WinAnsi) can't encode everything: keep it printable. */
const latin = (s: string) => s.replace(/[—–]/g, "-").replace(/[→]/g, "->").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

/** Draw text from any opentype font as vector outlines. Returns the drawn width. */
function drawOutlined(page: PDFPage, font: Font, text: string, x: number, y: number, size: number, color: RGB, maxWidth?: number): { width: number; size: number } {
  let s = size;
  let w = safeAdvance(font, text, s);
  if (maxWidth && w > maxWidth) {
    s = (s * maxWidth) / w;
    w = maxWidth;
  }
  const d = pdfPath(safeGetPath(font, text, 0, 0, s));
  if (d) page.drawSvgPath(d, { x, y, color });
  return { width: w, size: s };
}

const fit = (aspect: number, bw: number, bh: number) => (bw / bh > aspect ? { w: bh * aspect, h: bh } : { w: bw, h: bw / aspect });

interface Art {
  image: PDFImage;
  aspect: number;
}

export interface BrandKitOptions {
  /** A 3D render to include (else one is attempted, and skipped on failure). */
  render3d?: Blob;
  onProgress?: (p: number) => void;
  /** Skip trying to produce a 3D render (e.g. when WebGL is unavailable). */
  no3d?: boolean;
  /** Mockup renders (4:3) for an "In use" page. */
  mockups?: { label: string; png: Blob }[];
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

/** A4-landscape brand kit: cover, variants, clear space, palette, typography. */
export async function buildBrandKit(doc: DocT, o: BrandKitOptions = {}): Promise<Blob> {
  const progress = (p: number) => o.onProgress?.(Math.min(1, p));
  await prepareFonts(doc);

  const pdf = await PDFDocument.create();
  const name = doc.name.trim() || "Logo";
  pdf.setTitle(`${name} — Brand kit`);
  pdf.setSubject("Logo and brand guidelines");
  pdf.setCreator("Brusshy");
  pdf.setProducer("Brusshy");
  pdf.setCreationDate(new Date());

  const [g400, g500, g600] = await Promise.all([ensureFont("Geist", 400), ensureFont("Geist", 500), ensureFont("Geist", 600)]);
  const type = new Type(
    { ...(g400 ? { 400: g400 } : {}), ...(g500 ? { 500: g500 } : {}), ...(g600 ? { 600: g600 } : {}) },
    await pdf.embedFont(StandardFonts.Helvetica),
    await pdf.embedFont(StandardFonts.HelveticaBold),
  );
  progress(0.08);

  // ---- artwork (cropped to the mark so it fills each frame) ----
  const art = async (svg: string, px = 2400): Promise<Art> => {
    const vb = svgViewBox(svg);
    const aspect = vb.width / vb.height;
    const width = aspect >= 1 ? px : Math.round(px * aspect);
    const png = await svgToPng(svg, width);
    return { image: await pdf.embedPng(new Uint8Array(await png.arrayBuffer())), aspect };
  };
  const base = slug(doc.name);
  const variants = logoVariants(doc, { trim: { pad: 0 } }).filter((v) => v.part === "logo");
  const master = variants[0]!;
  const primary = await art(master.svg, 3000);
  progress(0.25);
  const variantArt: { v: LogoVariant; art: Art }[] = [{ v: master, art: primary }];
  for (const v of variants.slice(1)) variantArt.push({ v, art: await art(v.svg) });
  // The pages are light: they show the logo as it goes on light grounds (the primary, unless it is drawn for dark).
  const lightV = variantArt.find((a) => a.v.ink === "color" && a.v.ground === "light")!;
  const onLight = lightV.v === master ? primary : await art(lightV.v.svg, 3000);
  progress(0.4);

  let shot: Art | null = null;
  try {
    const blob = o.render3d ?? (o.no3d ? null : await render3D(doc, { width: 1600, transparent: true }));
    if (blob) {
      const img = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
      shot = { image: img, aspect: img.width / img.height };
    }
  } catch (e) {
    console.info("[brand kit] 3D render skipped:", (e as Error).message);
  }
  progress(0.55);

  const { colors, gradients } = extractPalette(doc);
  const fonts = await typefaces(doc);
  progress(0.7);

  const rules = kitRules(doc);
  const sections = ["Logo", "Variants", "Clear space", "Don'ts", ...(colors.length || gradients.length ? ["Color"] : []), ...(fonts.length ? ["Typography"] : []), ...(o.mockups?.length ? ["In use"] : [])];
  const total = sections.length;
  const date = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const chrome = (page: PDFPage, index: number, title: string) => {
    type.draw(page, name, M, H - M - 6, { size: 7.5, weight: 500, tracking: 0.16, upper: true, color: C.ink });
    type.draw(page, "Brand guidelines", W / 2, H - M - 6, { size: 7.5, weight: 400, tracking: 0.16, upper: true, color: C.ink3, align: "center" });
    type.draw(page, `${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, W - M, H - M - 6, {
      size: 7.5,
      weight: 400,
      tracking: 0.12,
      color: C.ink3,
      align: "right",
    });
    page.drawLine({ start: { x: M, y: H - M - 16 }, end: { x: W - M, y: H - M - 16 }, thickness: 0.5, color: C.rule });
    page.drawLine({ start: { x: M, y: M + 14 }, end: { x: W - M, y: M + 14 }, thickness: 0.5, color: C.rule });
    type.draw(page, date, M, M, { size: 7, color: C.ink3, tracking: 0.04 });
    type.draw(page, title, W - M, M, { size: 7, color: C.ink3, tracking: 0.04, align: "right" });
    if (index > 1) {
      type.draw(page, String(index).padStart(2, "0"), M, H - M - 58, { size: 9, weight: 500, color: C.accent, tracking: 0.08 });
      type.draw(page, title, M + 26, H - M - 62, { size: 24, weight: 600, color: C.ink, tracking: -0.02 });
    }
  };
  /** Content frame below the title block. */
  const top = H - M - 92;
  const bottom = M + 34;

  const placeArt = (page: PDFPage, a: Art, cx: number, cy: number, bw: number, bh: number) => {
    const s = fit(a.aspect, bw, bh);
    page.drawImage(a.image, { x: cx - s.w / 2, y: cy - s.h / 2, width: s.w, height: s.h });
    return { x: cx - s.w / 2, y: cy - s.h / 2, ...s };
  };

  // ---------- 01 cover ----------
  {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.paper });
    chrome(page, 1, "Logo");
    if (primary) placeArt(page, onLight, W / 2, H / 2 + 34, W * 0.5, H * 0.46);
    else type.draw(page, "No artwork yet", W / 2, H / 2, { size: 14, color: C.ink3, align: "center" });
    const nameSize = Math.min(38, (W * 0.55) / Math.max(1, type.width(name, { size: 1, weight: 600, tracking: -0.02 })));
    type.draw(page, name, M, M + 58, { size: nameSize, weight: 600, tracking: -0.02 });
    type.draw(page, "Logo & brand guidelines", M, M + 36, { size: 11, color: C.ink2 });
    type.draw(page, "Version 1.0", W - M, M + 36, { size: 9, color: C.ink3, align: "right", tracking: 0.04 });
  }

  // ---------- 02 variants ----------
  {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pure });
    chrome(page, 2, "Variants");
    const NOTES: Record<string, string> = {
      "color-light": "On white and light backgrounds",
      "color-dark": "On dark and photographic backgrounds",
      "black-light": "One-color print, stamps, engraving",
      "white-dark": "One color, reversed out of dark",
    };
    const tiles: { art: Art | null; bg: RGB; border?: boolean; label: string; note: string; file?: string }[] = [
      ...variantArt.map(({ v, art: a }, i) => ({
        art: a,
        bg: v.ground === "dark" ? C.ink : C.pure,
        border: v.ground === "light",
        label: i === 0 ? "Primary" : v.ink === "color" ? `Full color on ${v.ground}` : `${INK_LABEL[v.ink]}`,
        note: NOTES[`${v.ink}-${v.ground}`] ?? GROUND_LABEL[v.ground],
        file: `${variantName(base, v)}.svg`,
      })),
      ...(shot ? [{ art: shot, bg: C.paper, label: "3D", note: "Rendered mark for screens and motion" }] : []),
    ];
    const gap = 14;
    const caption = 30;
    const cols = tiles.length <= 4 ? 2 : 3;
    const rows = Math.ceil(tiles.length / cols);
    const tw = (W - 2 * M - gap * (cols - 1)) / cols;
    const th = (top - bottom - (rows - 1) * gap - rows * caption) / rows;
    tiles.forEach((t, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = M + c * (tw + gap);
      const y = top - (r + 1) * th - r * (gap + caption);
      page.drawRectangle({ x, y, width: tw, height: th, color: t.bg, ...(t.border ? { borderColor: C.rule, borderWidth: 0.6 } : {}) });
      if (t.art) placeArt(page, t.art, x + tw / 2, y + th / 2, tw * (t.label === "3D" ? 0.78 : 0.56), th * (t.label === "3D" ? 0.84 : 0.56));
      type.draw(page, String(i + 1).padStart(2, "0"), x, y - 14, { size: 7.5, weight: 500, color: C.accent, tracking: 0.08 });
      type.draw(page, t.label, x + 18, y - 14, { size: 9, weight: 600 });
      type.draw(page, t.note, x + 18, y - 25, { size: 7.5, color: C.ink3 });
      if (t.file) type.draw(page, t.file, x + tw, y - 14, { size: 7, color: C.ink3, align: "right", tracking: 0.02 });
    });
  }
  progress(0.78);

  // ---------- 03 clear space ----------
  {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pure });
    chrome(page, 3, "Clear space");
    const colW = 210;
    const fx = M;
    const fw = W - 2 * M - colW - 28;
    const fy = bottom;
    const fh = top - bottom;
    page.drawRectangle({ x: fx, y: fy, width: fw, height: fh, color: C.paper });
    const vb = primaryBounds(doc);
    // x in artboard px: measured on the mark (cap height / symbol height), else ¼ of the shorter side.
    const xv = rules.clear?.value ?? Math.min(vb.width, vb.height) * 0.25;
    {
      // Size the logo so logo + clear space fills ~72% of the frame.
      const scale = Math.min((fw * 0.72) / (vb.width + 2 * xv), (fh * 0.72) / (vb.height + 2 * xv));
      const lw = vb.width * scale;
      const lh = vb.height * scale;
      const x = xv * scale;
      const lx = fx + (fw - lw) / 2;
      const ly = fy + (fh - lh) / 2;
      // Clear-space zone: tinted, with the logo's own box cut back to paper.
      page.drawRectangle({ x: lx - x, y: ly - x, width: lw + 2 * x, height: lh + 2 * x, color: C.accent, opacity: 0.06 });
      page.drawRectangle({ x: lx, y: ly, width: lw, height: lh, color: C.paper });
      // One x module in each corner of the zone.
      for (const [cx0, cy0] of [[lx - x, ly - x], [lx + lw, ly - x], [lx - x, ly + lh], [lx + lw, ly + lh]] as const)
        page.drawRectangle({ x: cx0, y: cy0, width: x, height: x, color: C.accent, opacity: 0.1, borderColor: C.accent, borderWidth: 0.4, borderOpacity: 0.5 });
      page.drawImage(onLight.image, { x: lx, y: ly, width: lw, height: lh });
      page.drawRectangle({ x: lx, y: ly, width: lw, height: lh, borderColor: C.ink4, borderWidth: 0.5 });
      page.drawRectangle({
        x: lx - x,
        y: ly - x,
        width: lw + 2 * x,
        height: lh + 2 * x,
        borderColor: C.accent,
        borderWidth: 0.8,
        borderDashArray: [4, 3],
      });
      const tick = (x1: number, y1: number, x2: number, y2: number) => {
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.6, color: C.accent });
        const vertical = x1 === x2;
        const t = 2.5;
        for (const [px, py] of [[x1, y1], [x2, y2]] as const)
          page.drawLine({
            start: vertical ? { x: px - t, y: py } : { x: px, y: py - t },
            end: vertical ? { x: px + t, y: py } : { x: px, y: py + t },
            thickness: 0.6,
            color: C.accent,
          });
      };
      // "x" dimension marks on all four sides.
      const mark = (x1: number, y1: number, x2: number, y2: number, lxp: number, lyp: number) => {
        tick(x1, y1, x2, y2);
        type.draw(page, "x", lxp, lyp, { size: 9, weight: 500, color: C.accent, align: "center" });
      };
      const cx = lx + lw / 2;
      // Where x comes from: the cap height (or the symbol's height) measured on the logo itself,
      // drawn just outside the clear zone with guides running to the letters.
      const span = rules.clear?.span;
      const toPdfY = (ay: number) => ly + lh - (ay - vb.y) * scale;
      const sy0 = span ? toPdfY(span.y1) : 0;
      const sy1 = span ? toPdfY(span.y0) : 0;
      if (span) {
        const sx = lx - x - 12;
        const reach = lx + (span.x - vb.x) * scale + 10;
        tick(sx, sy0, sx, sy1);
        for (const yy of [sy0, sy1]) page.drawLine({ start: { x: sx + 3, y: yy }, end: { x: reach, y: yy }, thickness: 0.4, color: C.accent, dashArray: [1.5, 1.5] });
        type.draw(page, unitLabel(rules.clear!.amount), sx - 5, (sy0 + sy1) / 2 - 3, { size: 9, weight: 600, color: C.accent, align: "right" });
      }
      // "x" dimension marks on all four sides; the side ones away from the measured unit.
      const sideY = span && Math.abs((sy0 + sy1) / 2 - (ly + lh * 0.15)) < Math.abs((sy0 + sy1) / 2 - (ly + lh * 0.85)) ? ly + lh * 0.85 : ly + lh * 0.15;
      mark(cx, ly + lh, cx, ly + lh + x, cx + 7, ly + lh + x / 2 - 3);
      mark(cx, ly - x, cx, ly, cx + 7, ly - x / 2 - 3);
      mark(lx - x, sideY, lx, sideY, lx - x / 2, sideY + 5);
      mark(lx + lw, sideY, lx + lw + x, sideY, lx + lw + x / 2, sideY + 5);
    }
    const tx = W - M - colW;
    let ty = top - 6;
    const para = (text: string, size: number, o: Partial<TextOpts> = {}, lead = size * 1.36) => {
      for (const line of wrap(type, text, colW, size)) {
        type.draw(page, line, tx, ty, { size, ...o });
        ty -= lead;
      }
    };
    const head = (text: string) => {
      type.draw(page, text, tx, ty, { size: 7.5, weight: 500, tracking: 0.16, upper: true, color: C.ink3 });
      ty -= 18;
    };
    head("Rule");
    ty -= 4;
    para("Keep a minimum clear space of x on every side of the logo.", 11, { weight: 500 }, 15);
    para(rules.clear ? `${rules.clear.definition}.` : "x = 25% of the logo's shorter side.", 11, { weight: 500, color: C.accent }, 15);
    ty -= 10;
    para("No text, graphics or edges of the page may enter this area. x is measured on the logo, so it scales with it: never a fixed size.", 8.5, { color: C.ink2 }, 12);
    ty -= 16;
    head("At the master size");
    type.draw(page, `Logo  ${Math.round(vb.width)} × ${Math.round(vb.height)} px`, tx, ty, { size: 9 });
    ty -= 13;
    type.draw(page, `x = ${Math.round(xv)} px`, tx, ty, { size: 9, color: C.accent, weight: 500 });
    ty -= 26;
    const min = rules.minSize;
    if (min) {
      head("Minimum size");
      type.draw(page, `${min.px} px wide on screen`, tx, ty, { size: 11, weight: 500 });
      ty -= 15;
      if (min.mm) {
        type.draw(page, `${min.mm} mm wide in print`, tx, ty, { size: 11, weight: 500 });
        ty -= 15;
      }
      ty -= 2;
      para(
        min.limitedBy === "cap height" ? "Set by the wordmark: below it the letters stop reading." : min.limitedBy === "stroke" ? "Set by the mark's thinnest strokes: below it they break up." : "Set by the symbol: it needs 16 px on its longer side.",
        8.5,
        { color: C.ink2 },
        12,
      );
      // The logo at that size: the print size is physical (mm), the screen size at 96 dpi.
      const wPt = min.mm ? (min.mm * 72) / 25.4 : min.px * 0.75;
      ty -= 10;
      if (ty - wPt / primary.aspect > bottom + 12) {
        page.drawImage(onLight.image, { x: tx, y: ty - wPt / primary.aspect, width: wPt, height: wPt / primary.aspect });
        type.draw(page, min.mm ? "Actual size in print" : "Actual size at 96 dpi", tx + wPt + 10, ty - wPt / primary.aspect / 2 - 3, { size: 7, color: C.ink3 });
      }
    }
  }

  // ---------- 04 don'ts ----------
  {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pure });
    chrome(page, 4, "Don'ts");
    const list = donts(rules);
    const cols = 3;
    const gap = 14;
    const caption = 32;
    const tw = (W - 2 * M - gap * (cols - 1)) / cols;
    const th = (top - bottom - gap - 2 * caption) / 2;
    const recolored = await art(recolor(lightV.v.svg), 1600);
    const effects = await art(withEffects(buildSvg(lightV.v === master ? doc : colorOn(doc, GROUNDS.light), { trim: { pad: 0.16 }, background: null })), 1600);
    const NO = hex("#e5484d");
    list.forEach((d, i) => {
      const x = M + (i % cols) * (tw + gap);
      const y = top - (Math.floor(i / cols) + 1) * th - Math.floor(i / cols) * (gap + caption);
      page.drawRectangle({ x, y, width: tw, height: th, color: C.paper });
      const cx = x + tw / 2;
      const cy = y + th / 2;
      const bw = tw * 0.52;
      const bh = th * 0.52;
      const s = fit(primary.aspect, bw, bh);
      if (i === 0) {
        // Stretched wide and squashed.
        const k = Math.min(1.55, (tw * 0.82) / s.w);
        page.drawImage(onLight.image, { x: cx - (s.w * k) / 2, y: cy - (s.h * 0.62) / 2, width: s.w * k, height: s.h * 0.62 });
      } else if (i === 1) placeArt(page, recolored, cx, cy, bw, bh);
      else if (i === 2) placeArt(page, effects, cx, cy, bw * 1.25, bh * 1.25);
      else if (i === 3) {
        busy(page, x, y, tw, th);
        placeArt(page, onLight, cx, cy, bw, bh);
      } else if (i === 4) {
        // Far below the minimum size, next to the minimum size's outline.
        const minW = rules.minSize ? rules.minSize.px * 0.75 : s.w * 0.25;
        const tiny = Math.max(4, minW * 0.4);
        const big = Math.min(minW, tw * 0.5);
        page.drawRectangle({ x: cx + 6, y: cy - big / primary.aspect / 2, width: big, height: big / primary.aspect, borderColor: C.ink4, borderWidth: 0.5, borderDashArray: [2, 2] });
        page.drawImage(onLight.image, { x: cx - 6 - tiny, y: cy - tiny / primary.aspect / 2, width: tiny, height: tiny / primary.aspect });
        if (rules.minSize) type.draw(page, `min. ${rules.minSize.px} px`, cx + 6, cy - big / primary.aspect / 2 - 10, { size: 6.5, color: C.ink3 });
      } else {
        // Rotated (pdf-lib turns an image about its lower-left corner: move it so it stays centred).
        const a = (-14 * Math.PI) / 180;
        const w2 = s.w / 2;
        const h2 = s.h / 2;
        page.drawImage(onLight.image, { x: cx - (w2 * Math.cos(a) - h2 * Math.sin(a)), y: cy - (w2 * Math.sin(a) + h2 * Math.cos(a)), width: s.w, height: s.h, rotate: degrees(-14) });
      }
      // The "no" badge.
      const bx = x + 16;
      const by = y + th - 16;
      page.drawCircle({ x: bx, y: by, size: 7, color: NO });
      page.drawLine({ start: { x: bx - 2.6, y: by - 2.6 }, end: { x: bx + 2.6, y: by + 2.6 }, thickness: 1.2, color: C.pure });
      page.drawLine({ start: { x: bx - 2.6, y: by + 2.6 }, end: { x: bx + 2.6, y: by - 2.6 }, thickness: 1.2, color: C.pure });
      type.draw(page, d.title, x, y - 14, { size: 9, weight: 600 });
      type.draw(page, d.note, x, y - 26, { size: 7.5, color: C.ink3 });
    });
  }

  // ---------- color ----------
  let index = 5;
  if (colors.length || gradients.length) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pure });
    chrome(page, index, "Color");
    const list = colors.slice(0, 8);
    const gradH = gradients.length ? Math.min(gradients.length, 3) * 44 + 16 : 0;
    const area = top - bottom - gradH;
    const cols = Math.min(4, Math.max(1, list.length));
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const gap = 14;
    const info = 46;
    const sw = (W - 2 * M - gap * (cols - 1)) / cols;
    const sh = Math.min(170, (area - rows * info - (rows - 1) * gap) / rows);
    list.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = M + col * (sw + gap);
      const y = top - (row + 1) * sh - row * (info + gap);
      const light = luminance(c.r, c.g, c.b) > 0.85;
      page.drawRectangle({ x, y, width: sw, height: sh, color: rgb(c.r / 255, c.g / 255, c.b / 255), ...(light ? { borderColor: C.rule, borderWidth: 0.6 } : {}) });
      if (i === 0) type.draw(page, "Primary", x + 10, y + sh - 18, { size: 7, weight: 500, tracking: 0.16, upper: true, color: luminance(c.r, c.g, c.b) > 0.4 ? C.ink : C.pure });
      type.draw(page, c.hex, x, y - 15, { size: 10, weight: 600 });
      type.draw(page, `RGB  ${c.r}  ${c.g}  ${c.b}`, x, y - 28, { size: 7.5, color: C.ink2, tracking: 0.02 });
      const [cc, mm, yy, kk] = toCmyk(c.r, c.g, c.b);
      type.draw(page, `CMYK  ${cc}  ${mm}  ${yy}  ${kk}`, x, y - 39, { size: 7.5, color: C.ink3, tracking: 0.02 });
    });
    let gy = bottom + gradH - 16;
    for (const g of gradients.slice(0, 3)) {
      const img = await pdf.embedPng(await gradientPng(g));
      const bw = W - 2 * M - 230;
      page.drawImage(img, { x: M, y: gy - 22, width: bw, height: 22 });
      type.draw(page, g.type === "linear" ? `Linear gradient · ${Math.round(g.angle)}°` : "Radial gradient", M + bw + 16, gy - 8, { size: 8.5, weight: 600 });
      type.draw(page, g.stops.map((s) => `${s.hex} ${Math.round(s.offset * 100)}%`).join("   "), M + bw + 16, gy - 20, { size: 7, color: C.ink2 });
      gy -= 44;
    }
    index++;
  }

  // ---------- typography ----------
  if (fonts.length) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pure });
    chrome(page, index, "Typography");
    const rows = fonts.slice(0, 3);
    const rh = (top - bottom) / rows.length;
    rows.forEach((f, i) => {
      // A single typeface sits optically centered in the frame instead of hugging the top.
      const y0 = top - i * rh - (rows.length === 1 ? Math.max(0, (rh - 300) / 2) : 0);
      if (i > 0) page.drawLine({ start: { x: M, y: top - i * rh }, end: { x: W - M, y: top - i * rh }, thickness: 0.5, color: C.rule });
      const pad = rows.length === 1 ? 10 : 16;
      const big = Math.min(rh * (rows.length === 1 ? 0.55 : 0.62), 170);
      type.draw(page, "Typeface", M, y0 - pad - 8, { size: 7.5, weight: 500, tracking: 0.16, upper: true, color: C.ink3 });
      const tx = M + 250;
      const tw = W - M - tx;
      if (f.font) {
        drawOutlined(page, f.font, "Aa", M, y0 - pad - 20 - big * 0.78, big, C.ink, 220);
        const n = drawOutlined(page, f.font, f.family, tx, y0 - pad - 30, Math.min(30, rh * 0.18), C.ink, tw);
        let ly = y0 - pad - 30 - n.size * 0.45 - 16;
        type.draw(page, `${WEIGHT_NAMES[f.weight] ?? "Weight"} · ${f.weight}${f.free ? "  ·  Google Fonts, SIL Open Font License" : ""}`, tx, ly, {
          size: 8,
          color: C.ink2,
        });
        const lines = rows.length === 1 ? ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 & ! ? @ ( ) —"] : ["ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789"];
        const ls = rows.length === 1 ? 18 : 11;
        ly -= ls + 14;
        for (const l of lines) {
          drawOutlined(page, f.font, l, tx, ly, ls, C.ink, tw);
          ly -= ls * 1.45;
        }
        if (f.samples.length && ly - bottom > 24) {
          ly -= 8;
          type.draw(page, "In the logo", tx, ly, { size: 7.5, weight: 500, tracking: 0.16, upper: true, color: C.ink3 });
          type.draw(page, f.samples.map((s) => `“${s}”`).join("   "), tx + 70, ly, { size: 8, color: C.ink2 });
        }
      } else {
        type.draw(page, f.family, tx, y0 - pad - 30, { size: 26, weight: 600 });
        type.draw(page, `${WEIGHT_NAMES[f.weight] ?? ""} · ${f.weight} — specimen unavailable (font could not be loaded)`, tx, y0 - pad - 50, { size: 8, color: C.ink3 });
      }
    });
  }

  // ---------- in use (mockups) ----------
  if (o.mockups?.length) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.pure });
    chrome(page, sections.length, "In use");
    const shots = o.mockups.slice(0, 6);
    const cols = 3;
    const rows = Math.ceil(shots.length / cols);
    const gap = 12;
    const cap = 16;
    const th = Math.min((top - bottom - (rows - 1) * gap - rows * cap) / rows, ((W - 2 * M - (cols - 1) * gap) / cols) * 0.75);
    const tw = th / 0.75;
    const x0 = (W - (cols * tw + (cols - 1) * gap)) / 2;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i]!;
      const bytes = new Uint8Array(await s.png.arrayBuffer());
      const img = s.png.type === "image/jpeg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const x = x0 + (i % cols) * (tw + gap);
      const y = top - (Math.floor(i / cols) + 1) * th - Math.floor(i / cols) * (gap + cap);
      page.drawImage(img, { x, y, width: tw, height: th });
      type.draw(page, s.label, x, y - 11, { size: 7.5, weight: 500, color: C.ink2 });
    }
  }

  progress(0.95);
  const bytes = await pdf.save();
  progress(1);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/** Greedy word wrap with the label typesetter. */
function wrap(type: Type, text: string, width: number, size: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && type.width(next, { size }) > width) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function primaryBounds(doc: DocT) {
  return svgViewBox(buildSvg(doc, { trim: { pad: 0 }, background: null }));
}

async function typefaces(doc: DocT) {
  return Promise.all(
    logoFonts(doc).map(async (g) => ({
      ...g,
      font: await ensureFont(g.family, g.weight),
      free: FONT_FAMILIES.some((f) => f.toLowerCase() === g.family.toLowerCase()),
    })),
  );
}

async function gradientPng(g: PaletteGradient): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 44;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  for (const s of g.stops) grad.addColorStop(Math.min(1, Math.max(0, s.offset)), s.hex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error("gradient"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** The logo in the wrong colors: every color turned to another hue (neutrals get one too). */
function recolor(svg: string): string {
  return svg.replace(/\b(fill|stroke|stop-color)="([^"]+)"/g, (m, attr: string, v: string) => {
    const hex = v === "none" || v.startsWith("url(") ? null : normalizeColor(v);
    if (!hex) return m;
    const c = hexToOklch(hex);
    return `${attr}="${oklchToHex({ l: Math.min(0.82, Math.max(0.45, c.l)), c: Math.max(c.c, 0.16), h: ((c.c < 0.04 ? 300 : c.h) + 150) % 360 })}"`;
  });
}

/** The logo with the effects it should never get: drop shadow, glow and an outline. */
function withEffects(svg: string): string {
  const open = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!open) return svg;
  const vb = svgViewBox(svg);
  const u = Math.max(vb.width, vb.height) / 100;
  const defs = `<defs><filter id="bk-fx" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="${u * 0.6}" result="o"/><feFlood flood-color="#f5c400"/><feComposite in2="o" operator="in" result="line"/><feGaussianBlur in="SourceAlpha" stdDeviation="${u * 2.4}" result="b"/><feOffset in="b" dx="${u * 1.8}" dy="${u * 2.6}" result="sh"/><feFlood flood-color="#000" flood-opacity="0.55"/><feComposite in2="sh" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="line"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  const i = svg.indexOf(open) + open.length;
  const j = svg.lastIndexOf("</svg>");
  return `${svg.slice(0, i)}${defs}<g filter="url(#bk-fx)">${svg.slice(i, j)}</g>${svg.slice(j)}`;
}

/** A loud, many-colored pattern filling a tile (the background a logo should not sit on). */
function busy(page: PDFPage, x: number, y: number, w: number, h: number) {
  const colors = ["#ff5a36", "#ffd23f", "#3bceac", "#0ead69", "#540d6e", "#ee4266", "#1f6feb", "#f4f5f5"].map(hex);
  const n = 14;
  const cw = w / n;
  const rows = Math.ceil(h / cw);
  const chh = h / rows;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < n; c++) page.drawRectangle({ x: x + c * cw, y: y + r * chh, width: cw, height: chh, color: colors[Math.floor(rnd() * colors.length)]! });
  for (let k = 0; k < 18; k++) {
    const rad = Math.min(cw * (0.6 + rnd() * 1.6), h / 4);
    const px = x + rad + rnd() * (w - 2 * rad);
    const py = y + rad + rnd() * (h - 2 * rad);
    page.drawCircle({ x: px, y: py, size: rad, color: colors[Math.floor(rnd() * colors.length)]!, opacity: 0.85 });
  }
}
