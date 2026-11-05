import { normalizeColor, remapPaint, styleProfile, type StyleOptions } from "./style";
import { apply, IDENTITY, multiply, shapeToPath, transformMatrix, type Mat } from "./geometry";
import { parsePath } from "./pathmodel";
import { cloneSubtreeOps, frameDoc, nextFramePosition, nextVersionName } from "./frames";
import { applyOps, type OpT } from "./ops";
import { newId } from "./ids";
import type { DocT, NodeT, PaintT } from "./schema";
import type { PaletteEntryT, PaletteRoleT } from "./palette-schema";
import { colorDistance, contrastRatio, hexToOklch } from "./palette";

/**
 * Colorways: the active version in every usable combination of the brand
 * palette — full color on each background, and one-color versions (every ink
 * on every other color, so the inverse of each pair is there too). Parts drawn
 * as negative space (light details on a dark mark, holes painted in the
 * background color) become knock-outs in the background color so they keep
 * reading in one color.
 */

export interface ColorwayInk {
  hex: string;
  share: number;
  /** Raw colors merged into this ink. */
  members: string[];
  /** Painted in the ground color (a fake hole): takes the background color in every colorway. */
  hole: boolean;
  /** Mostly drawn on top of another ink (a star on a badge): becomes a knock-out in one-color versions. */
  onMark: boolean;
  /** Other inks are drawn on top of it (the badge under the star): it carries their contrast. */
  host: boolean;
}

export interface Colorway {
  /** Grid id: row letter (background) + column number (0 = full color, n = palette color n as the only ink). */
  id: string;
  row: number;
  col: number;
  kind: "full" | "one";
  background: string;
  /** The single ink (one-color colorways). */
  ink: string | null;
  /** Raw color → new color. */
  member: Record<string, string>;
  /** The mark's dominant color after recoloring. */
  dominant: string;
  /** WCAG contrast of the dominant color on the background. */
  contrast: number;
  /** Contrast ≥ 3:1 (graphics/large-text threshold). */
  readable: boolean;
  label: string;
}

export interface ColorwayPlan {
  inks: ColorwayInk[];
  palette: PaletteEntryT[];
  /** Column 0 = full color (null when the mark has a single ink), then one per palette color. */
  columns: ({ kind: "full" } | { kind: "one"; index: number } | null)[];
  /** rows[r][c]: null where the combination doesn't exist (ink = background). */
  grid: (Colorway | null)[][];
  all: Colorway[];
}

export const READABLE_CONTRAST = 3;

const rowLetter = (i: number) => String.fromCharCode(65 + i);
const nameOf = (e: PaletteEntryT) => e.name || e.hex.toUpperCase();

type Pt = [number, number];
interface Leaf {
  ink: string | null;
  polys: Pt[][];
  /** Bounds [x0, y0, x1, y1] for a quick reject. */
  box: [number, number, number, number];
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function polysOf(d: string, m: Mat): Pt[][] {
  let subs;
  try {
    subs = parsePath(d);
  } catch {
    return [];
  }
  const out: Pt[][] = [];
  for (const s of subs) {
    const a = s.anchors;
    if (a.length < 2) continue;
    const pts: Pt[] = [apply(m, a[0]!.p[0], a[0]!.p[1])];
    const segs = s.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const A = a[i]!;
      const B = a[(i + 1) % a.length]!;
      const steps = A.cout || B.cin ? 6 : 1;
      for (let k = 1; k <= steps; k++) {
        const q = cubic(A.p, A.cout ?? A.p, B.cin ?? B.p, B.p, k / steps);
        pts.push(apply(m, q[0], q[1]));
      }
    }
    out.push(pts);
  }
  return out;
}

function insidePoly(q: Pt, pts: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) c = !c;
  }
  return c;
}

/** Even-odd fill test over a leaf's outlines (holes punched by inner subpaths). */
const insideLeaf = (q: Pt, l: Leaf) =>
  q[0] >= l.box[0] && q[0] <= l.box[2] && q[1] >= l.box[1] && q[1] <= l.box[3] && l.polys.filter((p) => insidePoly(q, p)).length % 2 === 1;

function boxOf(polys: Pt[][]): Leaf["box"] {
  const b: Leaf["box"] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys)
    for (const [x, y] of p) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  return b;
}

const paintHex = (p: PaintT): string | null => {
  if (p === null) return null;
  const c = typeof p === "string" ? p : p.stops[0]?.color;
  return c ? normalizeColor(c) : null;
};

/** Painted leaves of a projected frame in paint order (bottom first), with outlines in artboard units. */
function paintedLeaves(fd: DocT, o: StyleOptions): Leaf[] {
  const out: Leaf[] = [];
  const walk = (id: string, m: Mat) => {
    const n = fd.nodes[id];
    if (!n || !n.visible || n.type === "sketch" || n.type === "reference") return;
    const mm = multiply(m, transformMatrix(n.transform));
    if (n.type === "group" || n.type === "frame") return n.children.forEach((c) => walk(c, mm));
    let polys: Pt[][] = [];
    if (n.type === "path") polys = polysOf(n.d, mm);
    else if (n.type === "shape") polys = polysOf(shapeToPath(n), mm);
    else if (n.type === "text") {
      const d = o.textToPath?.(n);
      if (d) polys = polysOf(d, mm);
      else {
        const w = Array.from(n.text).length * n.fontSize * 0.56;
        const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
        const top = -n.fontSize * 0.72;
        polys = [[[x, top], [x + w, top], [x + w, 0], [x, 0]].map((q) => apply(mm, q[0]!, q[1]!))];
      }
    }
    if (polys.length) out.push({ ink: paintHex(n.style.fill) ?? (n.style.strokeWidth > 0 ? paintHex(n.style.stroke) : null), polys, box: boxOf(polys) });
  };
  fd.root.forEach((id) => walk(id, IDENTITY));
  return out;
}

/** Share of a leaf's outline points (pulled slightly inward) that sit inside lower leaves of other inks. */
function coveredShare(leaf: Leaf, below: Leaf[]): number {
  const pts = leaf.polys.flat();
  if (!pts.length || !below.length) return 0;
  let cx = 0, cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  const step = Math.max(1, Math.floor(pts.length / 32));
  let hit = 0;
  let total = 0;
  for (let i = 0; i < pts.length; i += step) {
    const q: Pt = [cx + (pts[i]![0] - cx) * 0.88, cy + (pts[i]![1] - cy) * 0.88];
    total++;
    if (below.some((l) => insideLeaf(q, l))) hit++;
  }
  return hit / total;
}

/** The version's inks (clustered by area): which are fake holes and which sit on top of the mark. */
export function colorwayInks(doc: DocT, frameId: string, o: StyleOptions = {}): ColorwayInk[] {
  const fd = frameDoc(doc, frameId);
  const p = styleProfile(fd, { ...o, name: undefined });
  if (!p.palette.length) return [];
  const dom = [...p.palette].sort((a, b) => b.share - a.share)[0]!;
  const f = doc.nodes[frameId];
  const groundHex = f?.type === "frame" && f.background ? normalizeColor(f.background) : null;
  const clusterOf = (hex: string | null) => (hex ? p.palette.find((c) => c.members.includes(hex)) : undefined);
  // Which inks are drawn on top of a different ink (details on a badge, counters painted in).
  const leaves = paintedLeaves(fd, o);
  const tally = new Map<string, { on: number; all: number }>();
  /** guest ink → inks its covered leaves sit on. */
  const hosts = new Map<string, Set<string>>();
  leaves.forEach((leaf, i) => {
    const c = clusterOf(leaf.ink);
    if (!c) return;
    const [x0, y0, x1, y1] = leaf.box;
    // Only lower leaves of another ink whose bounds overlap can cover it.
    const below = leaves.slice(0, i).filter((l) => clusterOf(l.ink) !== c && l.box[0] <= x1 && l.box[2] >= x0 && l.box[1] <= y1 && l.box[3] >= y0);
    const t = tally.get(c.hex) ?? { on: 0, all: 0 };
    t.all++;
    if (coveredShare(leaf, below) >= 0.75) {
      t.on++;
      // The leaf it sits on: the topmost lower leaf under its centre.
      const q: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
      const under = [...below].reverse().find((l) => insideLeaf(q, l)) ?? below[below.length - 1];
      const h = under && clusterOf(under.ink);
      if (h) hosts.set(c.hex, (hosts.get(c.hex) ?? new Set()).add(h.hex));
    }
    tally.set(c.hex, t);
  });
  const inks = p.palette.map((c) => {
    const o2 = hexToOklch(c.hex);
    const t = tally.get(c.hex);
    const onMark = c !== dom && !!t && t.on / t.all >= 0.5;
    const hole = c !== dom && (groundHex ? colorDistance(groundHex, c.hex) < 0.03 : onMark && o2.l > 0.93 && o2.c < 0.03);
    return { hex: c.hex, share: c.share, members: c.members, hole, onMark, host: false };
  });
  // A host carries at least one ink that lives on top of it (not a stray detail).
  for (const k of inks) if (!k.onMark) k.host = inks.some((g) => g.onMark && hosts.get(g.hex)?.has(k.hex));
  return inks;
}

const ROLE_LEAD: Record<PaletteRoleT, number> = { primary: 1.2, secondary: 0.6, accent: 0.5, neutral: 0.3, background: 0 };
const ROLE_SUPPORT: Record<PaletteRoleT, number> = { secondary: 1, accent: 0.9, neutral: 0.5, primary: 0.4, background: 0.2 };

function fullMapping(inks: ColorwayInk[], palette: PaletteEntryT[], bgIdx: number): Map<ColorwayInk, string> | null {
  const bg = palette[bgIdx]!.hex;
  const cands = palette.filter((e, i) => i !== bgIdx && colorDistance(e.hex, bg) > 0.02);
  const marks = inks.filter((k) => !k.hole).sort((a, b) => b.share - a.share);
  if (!cands.length || marks.length < 2) return null;
  const out = new Map<ColorwayInk, string>();
  const used = new Set<string>();
  // A palette color that is (nearly) the ink's own color keeps it: full color on the original ground is the original logo.
  const same = (e: PaletteEntryT, ink: ColorwayInk) => (colorDistance(e.hex, ink.hex) < 0.04 ? 2 : 0);
  const leadScore = (e: PaletteEntryT) => Math.min(contrastRatio(e.hex, bg), 4.5) + ROLE_LEAD[e.role] + (contrastRatio(e.hex, bg) >= 3 ? same(e, marks[0]!) : 0);
  const lead = [...cands].sort((a, b) => leadScore(b) - leadScore(a))[0]!;
  out.set(marks[0]!, lead.hex);
  used.add(lead.hex);
  const domL = hexToOklch(marks[0]!.hex).l;
  const leadL = hexToOklch(lead.hex).l;
  for (const ink of marks.slice(1)) {
    // A detail already painted in this ground color stays a knock-out (that is the original look).
    if (ink.onMark && colorDistance(ink.hex, bg) < 0.04) {
      out.set(ink, bg);
      continue;
    }
    const rel = Math.sign(hexToOklch(ink.hex).l - domL);
    // Details on the mark must read against the mark's new color; the rest against the ground.
    const against = ink.onMark ? lead.hex : bg;
    const score = (e: PaletteEntryT) =>
      Math.min(contrastRatio(e.hex, against), 4.5) * 0.6 +
      ROLE_SUPPORT[e.role] +
      (rel !== 0 && Math.sign(hexToOklch(e.hex).l - leadL) === rel ? 0.6 : 0) +
      (contrastRatio(e.hex, against) >= 2 ? same(e, ink) : 0);
    const free = cands.filter((e) => !used.has(e.hex) && (!ink.onMark || e.hex !== lead.hex));
    const pool = free.length ? free : cands.filter((e) => e.hex !== lead.hex);
    const pick = [...(pool.length ? pool : [lead])].sort((a, b) => score(b) - score(a))[0]!;
    out.set(ink, pick.hex);
    used.add(pick.hex);
  }
  for (const ink of inks) if (ink.hole) out.set(ink, bg);
  return out;
}

/** Inks that are stops of one gradient paint (they must stay one color, or the gradient turns into a clash). */
function gradientGroups(doc: DocT, frameId: string, inks: ColorwayInk[]): ColorwayInk[][] {
  const fd = frameDoc(doc, frameId);
  const inkOf = (c: string) => {
    const hex = normalizeColor(c);
    return hex ? inks.find((k) => k.members.includes(hex) || k.hex === hex) : undefined;
  };
  const groups: ColorwayInk[][] = [];
  const add = (p: PaintT) => {
    if (p === null || typeof p === "string") return;
    const g = [...new Set(p.stops.map((s) => inkOf(s.color)).filter((k): k is ColorwayInk => !!k && !k.hole))];
    if (g.length < 2) return;
    const hit = groups.find((x) => x.some((k) => g.includes(k)));
    if (hit) for (const k of g) !hit.includes(k) && hit.push(k);
    else groups.push(g);
  };
  for (const n of Object.values(fd.nodes)) {
    if (n.type !== "path" && n.type !== "shape" && n.type !== "text") continue;
    add(n.style.fill);
    add(n.style.stroke);
  }
  return groups;
}

/** A gradient's stops follow its main ink (the lead when the gradient is the mark), so a recolored gradient reads as one surface. */
function unifyGradients(m: Map<ColorwayInk, string>, groups: ColorwayInk[][]) {
  for (const g of groups) {
    const main = [...g].sort((a, b) => b.share - a.share)[0]!;
    const to = m.get(main);
    if (!to) continue;
    // Untouched gradient (every stop keeps its own color): leave it as designed.
    if (g.every((k) => colorDistance(m.get(k) ?? k.hex, k.hex) < 0.04)) continue;
    for (const k of g) m.set(k, to);
  }
}

function toMember(m: Map<ColorwayInk, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ink, to] of m) for (const raw of ink.members) out[raw] = to;
  return out;
}

/** Every colorway of a version for a palette, as a grid (rows = backgrounds, columns = full color + each ink). */
export function planColorways(doc: DocT, frameId: string, palette: PaletteEntryT[], o: StyleOptions = {}): ColorwayPlan {
  const inks = colorwayInks(doc, frameId, o);
  const marks = inks.filter((k) => !k.hole);
  const dominant = [...marks].sort((a, b) => b.share - a.share)[0];
  const hasFull = marks.length >= 2;
  const groups = gradientGroups(doc, frameId, inks);
  const columns: ColorwayPlan["columns"] = [hasFull ? { kind: "full" } : null, ...palette.map((_, index) => ({ kind: "one" as const, index }))];
  const all: Colorway[] = [];
  const grid = palette.map((bgEntry, r) => {
    const bg = bgEntry.hex;
    const row: (Colorway | null)[] = [];
    const push = (c: number, kind: Colorway["kind"], ink: string | null, m: Map<ColorwayInk, string>, label: string) => {
      const dom = dominant ? (m.get(dominant) ?? dominant.hex) : (ink ?? bg);
      const contrast = Math.round(contrastRatio(dom, bg) * 100) / 100;
      const cw: Colorway = { id: `${rowLetter(r)}${c}`, row: r, col: c, kind, background: bg, ink, member: toMember(m), dominant: dom, contrast, readable: contrast >= READABLE_CONTRAST, label };
      row[c] = cw;
      all.push(cw);
    };
    if (!inks.length) return columns.map(() => null);
    const full = hasFull ? fullMapping(inks, palette, r) : null;
    if (full) unifyGradients(full, groups);
    if (full) push(0, "full", null, full, `Full color on ${nameOf(bgEntry)}`);
    else row[0] = null;
    palette.forEach((inkEntry, i) => {
      if (i === r || colorDistance(inkEntry.hex, bg) <= 0.02) {
        row[i + 1] = null;
        return;
      }
      const m = new Map<ColorwayInk, string>();
      // One color: details on the mark and fake holes knock out to the ground so they keep reading.
      for (const k of inks) m.set(k, k.hole || k.onMark ? bg : inkEntry.hex);
      push(i + 1, "one", inkEntry.hex, m, `${nameOf(inkEntry)} on ${nameOf(bgEntry)}`);
    });
    return columns.map((_, c) => row[c] ?? null);
  });
  return { inks, palette, columns, grid, all };
}

function recolorNode(n: NodeT, member: Map<string, string>): NodeT {
  if (n.type !== "path" && n.type !== "shape" && n.type !== "text") return n;
  const fill = remapPaint(n.style.fill, member);
  const stroke = remapPaint(n.style.stroke, member);
  if (fill === undefined && stroke === undefined) return n;
  return { ...n, style: { ...n.style, ...(fill !== undefined ? { fill } : {}), ...(stroke !== undefined ? { stroke } : {}) } } as NodeT;
}

/** The version projected as its own document, recolored for one colorway (background included). */
export function colorwayDoc(doc: DocT, frameId: string, cw: Colorway): DocT {
  const fd = frameDoc(doc, frameId);
  const member = new Map(Object.entries(cw.member));
  const nodes: Record<string, NodeT> = {};
  for (const [id, n] of Object.entries(fd.nodes)) nodes[id] = recolorNode(n, member);
  return { ...fd, nodes, artboard: { ...fd.artboard, background: cw.background } };
}

/**
 * Keep colorways as new versions (recolored copies with that background), placed
 * side by side to the right. One batch of ops → one undo step.
 */
export function keepColorwaysOps(doc: DocT, frameId: string, cws: Colorway[]): { ops: OpT[]; frames: { id: string; name: string; colorway: Colorway }[] } {
  let cur = doc;
  const ops: OpT[] = [];
  const frames: { id: string; name: string; colorway: Colorway }[] = [];
  for (const cw of cws) {
    const src = cur.nodes[frameId];
    if (!src || src.type !== "frame") throw new Error(`Frame ${frameId} not found`);
    const member = new Map(Object.entries(cw.member));
    const name = nextVersionName(cur);
    const pos = nextFramePosition(cur);
    const ids = new Map<string, string>();
    const r = cloneSubtreeOps(cur, frameId, {
      parent: null,
      idFor: (old) => {
        const id = newId(cur.nodes[old]!.type === "frame" ? "f" : "n");
        ids.set(id, old);
        return id;
      },
      patchRoot: { name, transform: { ...src.transform, x: pos.x, y: pos.y }, background: cw.background, batch: null },
    });
    const batch = r.ops.map((op) => {
      if (op.op !== "add") return op;
      const old = cur.nodes[ids.get(op.node.id as string) ?? ""];
      if (!old) return op;
      const re = recolorNode(old, member);
      return re === old ? op : { ...op, node: { ...op.node, style: re.style } };
    });
    cur = applyOps(cur, batch).doc;
    ops.push(...batch);
    frames.push({ id: r.rootId, name, colorway: cw });
  }
  return { ops, frames };
}

// ---------------------------------------------------------------- contact sheet

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Make every id in an SVG fragment unique (gradients of different tiles must not collide). */
function prefixIds(svg: string, prefix: string): string {
  const ids = new Set<string>();
  svg.replace(/\sid="([^"]+)"/g, (_, id: string) => {
    ids.add(id);
    return "";
  });
  if (!ids.size) return svg;
  return svg
    .replace(/\sid="([^"]+)"/g, (m, id: string) => (ids.has(id) ? ` id="${prefix}${id}"` : m))
    .replace(/url\(#([^)]+)\)/g, (m, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : m))
    .replace(/href="#([^"]+)"/g, (m, id: string) => (ids.has(id) ? `href="#${prefix}${id}"` : m));
}

/** Place a standalone SVG inside a box, fitted with padding. */
export function nestSvg(svg: string, x: number, y: number, w: number, h: number, prefix: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return "";
  const vb = /viewBox="([^"]+)"/.exec(open[0])?.[1] ?? `0 0 ${/width="([\d.]+)/.exec(open[0])?.[1] ?? 100} ${/height="([\d.]+)/.exec(open[0])?.[1] ?? 100}`;
  const inner = svg.slice(open.index + open[0].length, svg.lastIndexOf("</svg>"));
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${prefixIds(inner, prefix)}</svg>`;
}

const textOn = (bg: string) => (contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0b0c0e") ? "#ffffff" : "#0b0c0e");

/**
 * One contact-sheet SVG of a colorway plan. `art(cw)` returns the tile's artwork
 * as a standalone SVG without background (the studio passes outlined text).
 */
export function colorwaySheetSvg(plan: ColorwayPlan, art: (cw: Colorway) => string, o: { title?: string; tile?: number } = {}): string {
  const T = o.tile ?? 150;
  const gap = 10;
  const pad = 24;
  const head = 58;
  const colHead = 34;
  const rowHead = 112;
  const cols = plan.columns.map((c, i) => ({ c, i })).filter((x) => x.c);
  const W = pad * 2 + rowHead + cols.length * (T + gap) - gap;
  const H = head + colHead + plan.grid.length * (T + gap) - gap + pad;
  const font = `font-family="Helvetica, Arial, sans-serif"`;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#f4f5f5"/>`];
  parts.push(`<text x="${pad}" y="34" ${font} font-size="15" font-weight="700" fill="#0b0c0e">${esc(o.title ?? "Colorways")}</text>`);
  parts.push(`<text x="${W - pad}" y="34" text-anchor="end" ${font} font-size="11" fill="#8e9599">rows = background · 0 = full color, n = palette color n as the only ink · ratio = WCAG contrast of the main ink</text>`);
  cols.forEach(({ c, i }, k) => {
    const x = pad + rowHead + k * (T + gap);
    const y = head + 18;
    if (c!.kind === "full") parts.push(`<text x="${x}" y="${y}" ${font} font-size="11" font-weight="700" fill="#33373d">0 · Full color</text>`);
    else {
      const e = plan.palette[c!.index]!;
      parts.push(`<rect x="${x}" y="${y - 10}" width="12" height="12" rx="3" fill="${e.hex}" stroke="#0b0c0e" stroke-opacity=".15"/>`);
      parts.push(`<text x="${x + 18}" y="${y}" ${font} font-size="11" font-weight="700" fill="#33373d">${i} · ${esc(nameOf(e))}</text>`);
    }
  });
  plan.grid.forEach((row, r) => {
    const y = head + colHead + r * (T + gap);
    const e = plan.palette[r]!;
    parts.push(`<rect x="${pad}" y="${y + T / 2 - 22}" width="22" height="22" rx="5" fill="${e.hex}" stroke="#0b0c0e" stroke-opacity=".15"/>`);
    parts.push(`<text x="${pad + 30}" y="${y + T / 2 - 12}" ${font} font-size="13" font-weight="700" fill="#0b0c0e">${rowLetter(r)}</text>`);
    parts.push(`<text x="${pad}" y="${y + T / 2 + 14}" ${font} font-size="11" fill="#585f63">${esc(nameOf(e).slice(0, 16))}</text>`);
    cols.forEach(({ i }, k) => {
      const x = pad + rowHead + k * (T + gap);
      const cw = row[i];
      if (!cw) {
        parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${T - 1}" height="${T - 1}" rx="10" fill="none" stroke="#dfe2e3" stroke-dasharray="4 4"/>`);
        return;
      }
      const ink = textOn(cw.background);
      parts.push(`<rect x="${x}" y="${y}" width="${T}" height="${T}" rx="10" fill="${cw.background}" stroke="#0b0c0e" stroke-opacity=".1"/>`);
      const inset = T * 0.14;
      parts.push(nestSvg(art(cw), x + inset, y + inset * 0.8, T - inset * 2, T - inset * 2.2, `c${cw.id}_`));
      parts.push(`<text x="${x + 9}" y="${y + T - 9}" ${font} font-size="11" font-weight="700" fill="${ink}" fill-opacity=".8">${cw.id}</text>`);
      if (cw.readable) parts.push(`<text x="${x + T - 9}" y="${y + T - 9}" text-anchor="end" ${font} font-size="11" fill="${ink}" fill-opacity=".7">${cw.contrast.toFixed(1)}:1</text>`);
      else
        parts.push(
          `<rect x="${x + T - 62}" y="${y + T - 25}" width="55" height="19" rx="9.5" fill="#ffffff"/>`,
          `<text x="${x + T - 34.5}" y="${y + T - 11.5}" text-anchor="middle" ${font} font-size="11" font-weight="700" fill="#e5484d">! ${cw.contrast.toFixed(1)}:1</text>`,
        );
      if (!cw.readable) parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${T - 2}" height="${T - 2}" rx="9" fill="none" stroke="#e5484d" stroke-width="2" stroke-dasharray="5 4"/>`);
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** Short text list of a plan for the agent: id, label, contrast and a warning when it doesn't read. */
export function colorwayList(plan: ColorwayPlan): string[] {
  return plan.all.map((c) => `${c.id} ${c.label} — ${c.contrast.toFixed(1)}:1${c.readable ? "" : " ⚠ low contrast"}`);
}

// ---------------------------------------------------------------- studio request (MCP contact sheet)

export interface ColorwaysParams {
  /** Frame (version) id. */
  frame: string;
  /** Palette to use (default: the document's palette). */
  palette?: PaletteEntryT[];
  /** Tile size in px in the sheet (default 150). */
  tile?: number;
}

export interface ColorwaysResponse {
  /** Base64 PNG (no data: prefix). */
  png: string;
  width: number;
  height: number;
  /** One line per colorway: id, label, contrast (as listed by colorwayList). */
  list: string[];
}
