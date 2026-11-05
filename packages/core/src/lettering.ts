import { newId } from "./ids";
import type { OpT } from "./ops";
import { parsePath, type P } from "./pathmodel";
import { shapeToPath } from "./geometry";
import type { DocT, NodeT, TextNodeT, TransformT } from "./schema";

/**
 * Custom lettering: a text node becomes one editable path per letter inside a group
 * named after the word, and letters can be laid out on an arc, a wave, a rise or a stagger.
 */

/** One glyph outline in the text node's local coordinates (baseline at y=0, anchor applied). */
export interface GlyphOutline {
  /** The character(s) this glyph draws (ligatures may cover several). */
  text: string;
  /** SVG path data; empty for spaces. */
  d: string;
}

/** Studio request: outline a text node glyph by glyph with the fonts the canvas uses. */
export type GlyphsParams = Pick<TextNodeT, "text" | "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing" | "anchor"> &
  Partial<Pick<TextNodeT, "axes" | "features" | "alternates" | "kerning" | "kerns">>;
export interface GlyphsResponse {
  glyphs: GlyphOutline[];
}

/** The text + font a lettering group is made from (kept on the group for glyph alternates). */
export function letteringSourceOf(n: TextNodeT): Record<string, unknown> {
  const { text, fontFamily, fontWeight, fontSize, letterSpacing, anchor, axes, features, alternates, kerning, kerns } = n;
  return Object.fromEntries(Object.entries({ text, fontFamily, fontWeight, fontSize, letterSpacing, anchor, axes, features, alternates, kerning, kerns }).filter(([, v]) => v !== undefined && v !== null));
}

const siblingsOf = (doc: DocT, n: NodeT): string[] => {
  if (!n.parent) return doc.root;
  const p = doc.nodes[n.parent];
  return p && (p.type === "group" || p.type === "frame") ? p.children : doc.root;
};

/**
 * Replace a text node with a group of per-letter paths (same id, same place in the tree,
 * same transform). The group keeps the text's opacity; each letter keeps its fill, stroke
 * and 3D settings, so nothing moves or changes color. Letters sit at their exact laid-out
 * positions (kerning and letter-spacing included) with identity transforms.
 */
export function letteringOps(doc: DocT, textId: string, glyphs: GlyphOutline[]): { ops: OpT[]; groupId: string; letterIds: string[] } {
  const n = doc.nodes[textId];
  if (!n || n.type !== "text") throw new Error(`${textId} is not a text layer`);
  const drawn = glyphs.filter((g) => g.d.trim() && /[0-9]/.test(g.d));
  if (!drawn.length) throw new Error("Nothing to outline (the text is empty or only spaces)");
  const index = siblingsOf(doc, n).indexOf(textId);
  const { opacity, ...letterStyle } = n.style;
  const ops: OpT[] = [
    { op: "remove", id: textId },
    {
      op: "add",
      node: {
        id: textId,
        type: "group",
        name: n.text.trim() || n.name || "Lettering",
        transform: n.transform,
        style: { fill: null, opacity },
        visible: n.visible,
        locked: n.locked,
        aiLock: n.aiLock,
        // Type controls: remember the source so letters can later be swapped for glyph alternates.
        lettering: letteringSourceOf(n),
      },
      parent: n.parent,
      index,
    },
  ];
  const letterIds: string[] = [];
  drawn.forEach((g, i) => {
    const id = newId("n");
    letterIds.push(id);
    ops.push({
      op: "add",
      node: { id, type: "path", name: g.text, d: g.d, style: { ...letterStyle, opacity: 1 }, ...(n.extrude ? { extrude: n.extrude } : {}) },
      parent: textId,
      index: i,
    });
  });
  return { ops, groupId: textId, letterIds };
}

export const LETTER_LAYOUTS = ["straight", "arc", "wave", "rise", "stagger"] as const;
export type LetterLayout = (typeof LETTER_LAYOUTS)[number];

/** Slider range and default per layout (arc in degrees of sweep, the rest in % of letter height). */
export const LAYOUT_RANGE: Record<LetterLayout, { min: number; max: number; step: number; default: number; unit: string; hint: string }> = {
  straight: { min: 0, max: 0, step: 1, default: 0, unit: "", hint: "Back on one baseline" },
  arc: { min: -330, max: 330, step: 1, default: 120, unit: "°", hint: "Sweep of the arc — positive arches up (badge top), negative curves down (badge bottom)" },
  wave: { min: -60, max: 60, step: 1, default: 22, unit: "%", hint: "Wave height, in % of the letter height" },
  rise: { min: -200, max: 200, step: 1, default: 60, unit: "%", hint: "Total climb from the first to the last letter, in % of the letter height" },
  stagger: { min: -100, max: 100, step: 1, default: 24, unit: "%", hint: "Bounce: letters alternate up and down by this % of the letter height" },
};

interface LetterBox {
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  scaleX: number;
  scaleY: number;
}

/** Tight bounds of path data (curves sampled). */
export function pathDataBounds(d: string): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (q: P) => {
    if (q[0] < x0) x0 = q[0];
    if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1];
    if (q[1] > y1) y1 = q[1];
  };
  for (const s of parsePath(d)) {
    const a = s.anchors;
    const segs = s.closed ? a.length : a.length - 1;
    add(a[0]!.p);
    for (let i = 0; i < segs; i++) {
      const A = a[i]!, B = a[(i + 1) % a.length]!;
      if (!A.cout && !B.cin) {
        add(B.p);
        continue;
      }
      const p0 = A.p, p1 = A.cout ?? A.p, p2 = B.cin ?? B.p, p3 = B.p;
      for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        add([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
      }
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** The letters of a lettering group (paths and shapes), left to right. Empty if it doesn't look like one. */
export function letterBoxes(doc: DocT, groupId: string): LetterBox[] {
  const g = doc.nodes[groupId];
  if (!g || g.type !== "group") return [];
  const out: LetterBox[] = [];
  for (const id of g.children) {
    const n = doc.nodes[id];
    // Generated effect layers (outline, shadow…) are not letters.
    if (!n || n.effect || (n.type !== "path" && n.type !== "shape")) continue;
    const b = pathDataBounds(n.type === "path" ? n.d : shapeToPath(n));
    if (b) out.push({ id, ...b, scaleX: n.transform.scaleX, scaleY: n.transform.scaleY });
  }
  return out.sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/**
 * Place a lettering group's letters along a layout. Positions are computed from each letter's
 * own outline (its "rest" place on the baseline), so layouts never accumulate: applying a new
 * layout or amount replaces the previous one, and "straight" resets. Letters keep their own scale.
 * Returns full transforms per letter (usable as live preview patches) and the matching update ops.
 */
export function arrangeLetters(doc: DocT, groupId: string, layout: LetterLayout, amount: number): { id: string; transform: TransformT }[] {
  const letters = letterBoxes(doc, groupId);
  if (letters.length < 2) throw new Error("Arrange needs a group of two or more letter shapes (use make lettering first)");
  const baseline = median(letters.map((l) => l.y1));
  const height = Math.max(1, median(letters.map((l) => l.y1 - l.y0)));
  const centers = letters.map((l) => (l.x0 + l.x1) / 2);
  const first = centers[0]!;
  const last = centers[centers.length - 1]!;
  const span = Math.max(1e-6, last - first);
  const mid = (first + last) / 2;

  return letters.map((l, i) => {
    let c: P = [centers[i]!, baseline];
    let target: P = c;
    let rot = 0;
    const u = c[0] - mid;
    if (layout === "arc" && amount) {
      // The inner edge keeps the original spacing: the baseline for an arch, the letter tops for a smile
      // (otherwise tops would collide on a downward curve).
      if (amount < 0) c = [c[0], baseline - height];
      const k = ((amount * Math.PI) / 180) / span;
      const phi = k * u;
      target = [mid + Math.sin(phi) / k, c[1] + (1 - Math.cos(phi)) / k];
      rot = phi;
    } else if (layout === "wave" && amount) {
      const A = (amount / 100) * height;
      const w = (2 * Math.PI) / span;
      const t = c[0] - first;
      target = [c[0], baseline - A * Math.sin(w * t)];
      // Letters lean with the wave, but only half as much as its slope: easier to read.
      rot = 0.5 * Math.atan(-A * w * Math.cos(w * t));
    } else if (layout === "rise" && amount) {
      const A = (amount / 100) * height;
      target = [c[0], baseline - A * ((c[0] - first) / span - 0.5)];
    } else if (layout === "stagger" && amount) {
      const A = (amount / 100) * height;
      const up = i % 2 === 0 ? 1 : -1;
      target = [c[0], baseline - (up * A) / 2];
      rot = ((-up * Math.min(10, Math.abs(amount) * 0.12) * Math.sign(amount)) * Math.PI) / 180;
    }
    // Rotate/scale the letter about its rest point c and put that point on the target: p ↦ R·S·p + (target − R·S·c).
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const sc: P = [c[0] * l.scaleX, c[1] * l.scaleY];
    const rc: P = [cos * sc[0] - sin * sc[1], sin * sc[0] + cos * sc[1]];
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      id: l.id,
      transform: { x: r(target[0] - rc[0]), y: r(target[1] - rc[1]), rotation: r((rot * 180) / Math.PI), scaleX: l.scaleX, scaleY: l.scaleY },
    };
  });
}

export function arrangeLettersOps(doc: DocT, groupId: string, layout: LetterLayout, amount: number): OpT[] {
  return arrangeLetters(doc, groupId, layout, amount).map(({ id, transform }) => ({ op: "update", id, set: { transform } }) as OpT);
}

/** True when a group looks like lettering (two or more letter shapes). */
export const isLetteringGroup = (doc: DocT, id: string) => letterBoxes(doc, id).length >= 2;
