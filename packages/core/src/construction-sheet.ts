import type { ConstructionT, GuideT } from "./construction-schema";
import { docToSvg, luminance } from "./svg-export";
import { fmt, shapeToPath, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { flattenContour, nodeOutline, shapeLeaves } from "./boolean";
import type { DocT, NodeT, PaintT } from "./schema";

/**
 * Construction sheet: a presentation image of one version — the mark on paper with its
 * construction drawn as thin lines, filled regions hatched with fine diagonals (like classic
 * grid sheets), dimension and ratio labels, and the clean final mark beside it.
 * Pure SVG; the studio outlines the label text and rasterizes it (PNG 2048).
 */

export interface SheetText {
  (s: string, x: number, y: number, o: { size: number; weight?: number; mono?: boolean; anchor?: "start" | "middle" | "end"; color: string; tracking?: number; halo?: string }): string;
}

export interface SheetOptions {
  /** Dark paper variant. */
  dark?: boolean;
  /** Version/document title shown on the sheet. */
  title?: string;
  subtitle?: string;
  /** True when the construction was derived automatically (says so in the caption). */
  derived?: boolean;
  /** Text renderer (the studio passes one that outlines with the UI font). Default: <text>. */
  text?: SheetText;
  /** Outlined path data per text node (local coordinates). */
  textOutlines?: Record<string, string>;
  /** Clean production SVG of the mark (outlined text). Default: docToSvg of the version. */
  markSvg?: string;
  /** Sheet size in px (default 2048 × 1280). */
  width?: number;
  height?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const defaultText: SheetText = (s, x, y, o) =>
  `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${o.mono ? "'Geist Mono', 'SF Mono', Menlo, monospace" : "Geist, Helvetica, Arial, sans-serif"}" font-size="${fmt(o.size)}" font-weight="${o.weight ?? 400}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}${o.tracking ? ` letter-spacing="${fmt(o.tracking * o.size)}"` : ""} fill="${o.color}"${o.halo ? ` stroke="${o.halo}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"` : ""}>${esc(s)}</text>`;

interface Theme {
  paper: string;
  card: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  line: string;
  lineSoft: string;
  hatch: string;
  dot: string;
}

const LIGHT: Theme = { paper: "#f3f2ee", card: "#fbfaf7", ink: "#0b0c0e", ink2: "#4a5054", ink3: "#8a9094", rule: "#dcdad3", line: "#ff4d1f", lineSoft: "rgba(255,77,31,0.42)", hatch: "#0b0c0e", dot: "rgba(11,12,14,0.10)" };
const DARK: Theme = { paper: "#0e0f11", card: "#16181b", ink: "#f2f1ec", ink2: "#b4b8bb", ink3: "#7d8387", rule: "#2a2d31", line: "#ff6a3d", lineSoft: "rgba(255,106,61,0.45)", hatch: "#f2f1ec", dot: "rgba(255,255,255,0.07)" };

const matAttr = (m: Mat) => `matrix(${m.map((v) => fmt(Math.round(v * 1e6) / 1e6)).join(" ")})`;

function leafPath(n: NodeT, outlines?: Record<string, string>): string | null {
  if (n.type === "path") return n.d;
  if (n.type === "shape") return shapeToPath(n);
  if (n.type === "text") return outlines?.[n.id] ?? null;
  return null;
}

const solid = (p: PaintT): string | null => (typeof p === "string" ? p : p ? (p.stops[0]?.color ?? null) : null);

/** Bounds of the guides. */
function guidesBox(c: ConstructionT | null | undefined) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const g of c?.guides ?? []) {
    if (g.kind === "circle") {
      grow(g.cx - g.r, g.cy - g.r);
      grow(g.cx + g.r, g.cy + g.r);
    } else if (g.kind === "line") {
      grow(g.x1, g.y1);
      grow(g.x2, g.y2);
    } else for (const q of g.points) grow(q[0], q[1]);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Bounds of the mark (exact outlines, flattened coarsely). */
function markBox(doc: DocT, outlines?: Record<string, string>) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of doc.root)
    for (const l of shapeLeaves(doc, id, IDENTITY)) {
      const ol = nodeOutline(l.node, l.M, l.node.type === "text" ? outlines?.[l.node.id] : undefined);
      for (const c of ol?.contours ?? [])
        for (const q of flattenContour(c, 0.5)) {
          x0 = Math.min(x0, q[0]);
          y0 = Math.min(y0, q[1]);
          x1 = Math.max(x1, q[0]);
          y1 = Math.max(y1, q[1]);
        }
    }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function guideEl(g: GuideT, th: Theme, k: number): string {
  const soft = g.role === "grid" || g.role === "radial";
  const w = (soft ? 0.75 : g.role === "keyline" ? 1.1 : 1.15) / k;
  const stroke = soft ? th.lineSoft : th.line;
  const dash = g.role === "keyline" ? ` stroke-dasharray="${fmt(6 / k)} ${fmt(4 / k)}"` : "";
  const a = `fill="none" stroke="${stroke}" stroke-width="${fmt(w)}"${dash}`;
  if (g.kind === "circle") return `<circle cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt(g.r)}" ${a}/>`;
  if (g.kind === "line") return `<line x1="${fmt(g.x1)}" y1="${fmt(g.y1)}" x2="${fmt(g.x2)}" y2="${fmt(g.y2)}" ${a}/>`;
  return `<polygon points="${g.points.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join(" ")}" ${a}/>`;
}

/** Embed a standalone SVG as a nested <svg> placed in a box. */
function nest(svg: string, x: number, y: number, w: number, h: number): string {
  const body = svg.replace(/<\?xml[^>]*>\s*/g, "").replace(/<!--[\s\S]*?-->\s*/g, "");
  return body.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const clean = attrs.replace(/\s(width|height|x|y|preserveAspectRatio)="[^"]*"/g, "");
    return `<svg${clean} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="xMidYMid meet">`;
  });
}

/**
 * The construction sheet SVG for a version (fdoc = frameDoc projection, construction in its
 * artboard coordinates).
 */
export function constructionSheetSvg(fdoc: DocT, construction: ConstructionT, o: SheetOptions = {}): string {
  const W = o.width ?? 2048;
  const H = o.height ?? 1280;
  const th = o.dark ? DARK : LIGHT;
  const T = o.text ?? defaultText;
  const out: string[] = [];
  const M = 72; // outer margin
  // ── layout: construction panel (left, square) and the clean mark + specs (right).
  const panel = { x: M, y: M + 64, s: H - M * 2 - 64 - 40 };
  const right = { x: panel.x + panel.s + 72, y: panel.y, w: W - (panel.x + panel.s + 72) - M };

  out.push(`<rect width="${W}" height="${H}" fill="${th.paper}"/>`);
  // Fine dot grid on the paper.
  out.push(`<defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${th.dot}"/></pattern></defs>`);
  out.push(`<rect x="${panel.x}" y="${panel.y}" width="${panel.s}" height="${panel.s}" fill="url(#dots)"/>`);
  out.push(`<rect x="${panel.x + 0.5}" y="${panel.y + 0.5}" width="${panel.s - 1}" height="${panel.s - 1}" fill="none" stroke="${th.rule}"/>`);

  // Header.
  out.push(T("CONSTRUCTION", M, M + 4, { size: 15, weight: 500, color: th.line, tracking: 0.22 }));
  out.push(T(o.title ?? fdoc.name, M, M + 44, { size: 34, weight: 600, color: th.ink, tracking: -0.01 }));
  if (o.subtitle) out.push(T(o.subtitle, W - M, M + 44, { size: 17, weight: 400, color: th.ink3, anchor: "end" }));

  // ── fit guides + mark into the panel.
  const gb = guidesBox(construction);
  const mb = markBox(fdoc, o.textOutlines);
  const boxes = [gb, mb].filter((b): b is NonNullable<typeof b> => !!b);
  const bx0 = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0;
  const by0 = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  const bx1 = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : fdoc.artboard.width;
  const by1 = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : fdoc.artboard.height;
  const inner = panel.s * 0.8;
  const k = inner / Math.max(bx1 - bx0, by1 - by0, 1);
  const tx = panel.x + panel.s / 2 - ((bx0 + bx1) / 2) * k;
  const ty = panel.y + panel.s / 2 - ((by0 + by1) / 2) * k;
  const toS = (x: number, y: number): [number, number] => [tx + x * k, ty + y * k];

  // Hatch pattern in sheet space (constant spacing whatever the mark's scale).
  const hs = 7;
  out.push(
    `<defs><pattern id="hatch" width="${fmt(hs / k)}" height="${fmt(hs / k)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${fmt(hs / k)}" stroke="${th.hatch}" stroke-opacity="0.62" stroke-width="${fmt(1.05 / k)}"/></pattern></defs>`,
  );
  const g: string[] = [];
  // Mark: hatched fills with an ink outline; light fills act as knockouts.
  const visit = (id: string) => {
    const n = fdoc.nodes[id];
    if (!n || !n.visible || n.type === "sketch" || n.type === "reference") return;
    if (n.type === "group") return n.children.forEach(visit);
    const d = leafPath(n, o.textOutlines);
    if (!d) return;
    const fill = solid(n.style.fill);
    const rule = n.style.fillRule === "evenodd" ? ` fill-rule="evenodd"` : "";
    const knock = fill !== null && luminance(fill) > 0.72;
    const stroke = n.style.strokeWidth > 0 && n.style.stroke !== null;
    const fillAttr = fill === null ? "none" : knock ? th.paper : "url(#hatch)";
    const wm = worldMatrix(fdoc, id);
    const sw = 1.4 / (k * (Math.sqrt(Math.abs(wm[0] * wm[3] - wm[1] * wm[2])) || 1));
    const m = matAttr(wm);
    g.push(`<path d="${d}" transform="${m}" fill="${fillAttr}"${rule} stroke="${th.ink}" stroke-width="${fmt(sw)}" stroke-linejoin="round"/>`);
    if (stroke && fill === null) g.push(`<path d="${d}" transform="${m}" fill="none" stroke="${th.ink}" stroke-opacity="0.35" stroke-width="${fmt(n.style.strokeWidth)}" stroke-linecap="${n.style.strokeLinecap}" stroke-linejoin="${n.style.strokeLinejoin}"/>`);
  };
  fdoc.root.forEach(visit);
  // Construction above the mark (thin lines read through the hatching).
  const guides = construction.guides;
  const lines = [...guides].sort((a, b) => (a.role === "grid" || a.role === "radial" ? -1 : 0) - (b.role === "grid" || b.role === "radial" ? -1 : 0));
  out.push(`<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(k)})">${g.join("")}${lines.map((x) => guideEl(x, th, k)).join("")}</g>`);

  // Centres of key circles: small crosses (screen space, constant size).
  const centres = new Set<string>();
  for (const x of guides) {
    if (x.kind !== "circle") continue;
    const key = `${Math.round(x.cx * 10)},${Math.round(x.cy * 10)}`;
    if (centres.has(key)) continue;
    centres.add(key);
    const [cx, cy] = toS(x.cx, x.cy);
    out.push(`<path d="M${fmt(cx - 4)} ${fmt(cy)}H${fmt(cx + 4)}M${fmt(cx)} ${fmt(cy - 4)}V${fmt(cy + 4)}" stroke="${th.line}" stroke-width="1"/>`);
  }

  // ── dimension labels: radius leaders for labelled circles (fanned to avoid collisions).
  const labelled = guides.filter((x): x is Extract<GuideT, { kind: "circle" }> => x.kind === "circle" && !!x.label);
  const angles = [-38, -62, -14, -86, 12, 36];
  labelled.slice(0, 6).forEach((c, i) => {
    const a = (angles[i % angles.length]! * Math.PI) / 180;
    const [cx, cy] = toS(c.cx, c.cy);
    const R = c.r * k;
    const ex = cx + Math.cos(a) * R, ey = cy + Math.sin(a) * R;
    const lx = ex + Math.cos(a) * 26, ly = ey + Math.sin(a) * 26;
    out.push(`<path d="M${fmt(cx)} ${fmt(cy)}L${fmt(ex)} ${fmt(ey)}" stroke="${th.line}" stroke-width="1" stroke-dasharray="3 3"/>`);
    out.push(`<circle cx="${fmt(ex)}" cy="${fmt(ey)}" r="2.6" fill="${th.line}"/>`);
    out.push(`<path d="M${fmt(ex)} ${fmt(ey)}L${fmt(lx)} ${fmt(ly)}H${fmt(lx + 10)}" fill="none" stroke="${th.line}" stroke-width="1"/>`);
    const pill = c.label!;
    out.push(T(pill, lx + 14, ly + 5, { size: 15, mono: true, color: th.line, halo: th.paper }));
  });
  // Polygon labels (keylines, grid size) above their top-left corner.
  for (const x of guides) {
    if (x.kind !== "polygon" || !x.label) continue;
    const top = x.points.reduce((a, q) => (q[1] < a[1] || (q[1] === a[1] && q[0] < a[0]) ? q : a));
    const [px, py] = toS(top[0], top[1]);
    out.push(T(x.label, px, py - 9, { size: 13, mono: true, color: th.ink3, halo: th.paper }));
  }
  // Grid unit: a dimension line over one cell along the top of the bounding square.
  if (construction.unit && gb) {
    const u = construction.unit * k;
    const [x0, y0] = toS(gb.x, gb.y);
    if (u > 14 && u < panel.s * 0.6) {
      const y = y0 - 26;
      out.push(`<path d="M${fmt(x0)} ${fmt(y - 5)}V${fmt(y + 5)}M${fmt(x0 + u)} ${fmt(y - 5)}V${fmt(y + 5)}M${fmt(x0)} ${fmt(y)}H${fmt(x0 + u)}" stroke="${th.ink2}" stroke-width="1"/>`);
      out.push(T(`u = ${fmt(Math.round(construction.unit * 100) / 100)}`, x0 + u + 10, y + 5, { size: 14, mono: true, color: th.ink2 }));
    }
  }
  // Panel caption: the grid's name.
  out.push(T((construction.title ?? (o.derived ? "Derived construction" : "Construction")).toUpperCase(), panel.x + 20, panel.y + 34, { size: 13, weight: 500, color: th.ink2, tracking: 0.16 }));

  // ── right column: the clean mark, then the specs.
  const card = { x: right.x, y: right.y, w: right.w, h: Math.min(right.w, panel.s * 0.56) };
  out.push(`<rect x="${fmt(card.x)}" y="${fmt(card.y)}" width="${fmt(card.w)}" height="${fmt(card.h)}" rx="10" fill="${fdoc.artboard.background ?? th.card}" stroke="${th.rule}"/>`);
  const mark = o.markSvg ?? docToSvg(fdoc, { background: null, textToPath: (n) => o.textOutlines?.[n.id] ?? null });
  const pad = card.h * 0.14;
  out.push(nest(mark, card.x + pad, card.y + pad, card.w - pad * 2, card.h - pad * 2));
  out.push(T("FINAL MARK", card.x + 18, card.y + card.h + 30, { size: 12, weight: 500, color: th.ink3, tracking: 0.16 }));

  // Specs.
  const circles = guides.filter((x): x is Extract<GuideT, { kind: "circle" }> => x.kind === "circle");
  const radii: number[] = [];
  for (const r of circles.map((c) => c.r).sort((a, b) => b - a)) if (!radii.some((x) => Math.abs(x - r) < x * 0.005)) radii.push(Math.round(r * 100) / 100);
  const unitR = radii.length ? radii[radii.length - 1]! : 0;
  const rows: [string, string][] = [];
  rows.push(["Grid", construction.title ?? (o.derived ? "Derived from the mark" : "Custom")]);
  if (construction.ratio) rows.push(["Ratio", Math.abs(construction.ratio - 1.6180339887) < 1e-3 ? "1 : 1.618 (golden)" : `1 : ${fmt(Math.round(construction.ratio * 1000) / 1000)}`]);
  if (circles.length) rows.push(["Circles", `${circles.length} · ${radii.length} radi${radii.length === 1 ? "us" : "i"}`]);
  if (radii.length > 1 && unitR > 0) rows.push(["Radii", radii.slice(0, 5).map((r) => fmt(Math.round((r / unitR) * 1000) / 1000)).join(" : ")]);
  if (construction.unit) rows.push(["Unit", `${fmt(Math.round(construction.unit * 100) / 100)} (artboard ${fdoc.artboard.width} × ${fdoc.artboard.height})`]);
  let y = card.y + card.h + 86;
  for (const [kk, v] of rows) {
    out.push(`<line x1="${fmt(right.x)}" y1="${fmt(y - 26)}" x2="${fmt(right.x + right.w)}" y2="${fmt(y - 26)}" stroke="${th.rule}"/>`);
    out.push(T(kk.toUpperCase(), right.x, y, { size: 12, weight: 500, color: th.ink3, tracking: 0.14 }));
    out.push(T(v, right.x + 120, y, { size: 16, weight: 400, color: th.ink, mono: kk === "Radii" || kk === "Ratio" }));
    y += 46;
  }
  // Caption.
  const caption = o.derived
    ? "No construction was drawn for this version: keylines, centre lines and the circles that best fit its curves were derived automatically."
    : "Every curve is an arc of the grid's circles; filled regions are hatched.";
  const words = caption.split(" ");
  const linesTxt: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > Math.floor(right.w / 8.6)) {
      linesTxt.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) linesTxt.push(cur.trim());
  const capY = H - M - 4 - (linesTxt.length - 1) * 22;
  linesTxt.forEach((l, i) => out.push(T(l, right.x, capY + i * 22, { size: 14.5, color: o.derived ? th.line : th.ink2 })));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
}
