import svgpath from "svgpath";
import type { OpT } from "./ops";
import type { DocT, TransformT } from "./schema";
import { letterBoxes, pathDataBounds } from "./lettering";

/**
 * Letter-by-letter control on lettering groups: kerning, baseline shift, per-letter scale and
 * glyph swaps. Shared by the studio (⌥ arrows, the Letters strip) and the agent (set_type).
 *
 * How it stays consistent with arrangeLetters layouts: layouts place each letter from its own
 * outline ("rest place") and keep its scale. So kerning and baseline shifts are baked into the
 * letter's path data (they move the rest place), and scale lives in transform.scaleX/Y about the
 * letter's rest point (bottom-center on the baseline) — exactly the point layouts rotate and scale
 * about. Re-applying any layout keeps all three edits.
 */

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const translateD = (d: string, dx: number, dy: number) => svgpath(d).translate(dx, dy).round(3).toString();

/** The lettering group a letter belongs to (null if it isn't a letter of one). */
export function letteringGroupOf(doc: DocT, letterId: string): string | null {
  const n = doc.nodes[letterId];
  if (!n || !n.parent) return null;
  const letters = letterBoxes(doc, n.parent);
  return letters.length >= 2 && letters.some((l) => l.id === letterId) ? n.parent : null;
}

/** Letters of a group left→right with their index, character and rest metrics. */
export function lettersOf(doc: DocT, groupId: string) {
  const boxes = letterBoxes(doc, groupId);
  const ys = boxes.map((b) => b.y1).sort((a, b) => a - b);
  const baseline = ys.length ? ys[Math.floor(ys.length / 2)]! : 0;
  return boxes.map((b, index) => ({ ...b, index, name: doc.nodes[b.id]?.name ?? "", baseline }));
}

/**
 * Kern: move a letter and every letter after it by dx (artboard units, in the letters' own frame).
 * Positive opens the gap before the letter, negative tightens it.
 */
export function kernLetterOps(doc: DocT, letterId: string, dx: number): OpT[] {
  const g = letteringGroupOf(doc, letterId);
  if (!g || !dx) return [];
  const letters = lettersOf(doc, g);
  const from = letters.findIndex((l) => l.id === letterId);
  return letters.slice(from).map((l) => shiftOp(doc, l.id, dx, 0)).filter((o): o is OpT => !!o);
}

/** Baseline shift: move one letter up (negative dy) or down. */
export function baselineLetterOps(doc: DocT, letterId: string, dy: number): OpT[] {
  if (!letteringGroupOf(doc, letterId) || !dy) return [];
  const op = shiftOp(doc, letterId, 0, dy);
  return op ? [op] : [];
}

function shiftOp(doc: DocT, id: string, dx: number, dy: number): OpT | null {
  const n = doc.nodes[id];
  if (!n) return null;
  if (n.type === "path") return { op: "update", id, set: { d: translateD(n.d, dx, dy) } };
  // Shapes have no path data: shift their transform instead (layouts may reset it).
  return { op: "update", id, set: { transform: { x: r3(n.transform.x + dx), y: r3(n.transform.y + dy) } } };
}

/**
 * Scale one letter (absolute factor, 1 = original size) about its rest point, so it stays on the
 * baseline in place — the same point arrangeLetters scales and rotates about.
 */
export function scaleLetterOps(doc: DocT, letterId: string, scale: number): OpT[] {
  const g = letteringGroupOf(doc, letterId);
  const n = doc.nodes[letterId];
  if (!g || !n || !(scale > 0)) return [];
  const l = lettersOf(doc, g).find((x) => x.id === letterId)!;
  const c: [number, number] = [(l.x0 + l.x1) / 2, l.baseline];
  const t = n.transform;
  const rot = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const map = (sx: number, sy: number): [number, number] => {
    const p: [number, number] = [c[0] * sx, c[1] * sy];
    return [cos * p[0] - sin * p[1], sin * p[0] + cos * p[1]];
  };
  const [wx, wy] = map(t.scaleX, t.scaleY);
  const world: [number, number] = [wx + t.x, wy + t.y];
  const sx = Math.sign(t.scaleX || 1) * scale, sy = Math.sign(t.scaleY || 1) * scale;
  const [nx, ny] = map(sx, sy);
  const transform: Partial<TransformT> = { x: r3(world[0] - nx), y: r3(world[1] - ny), scaleX: r3(sx), scaleY: r3(sy) };
  return [{ op: "update", id: letterId, set: { transform } }];
}

/** Replace a letter's outline (e.g. a glyph alternate) — optionally renaming it. */
export function swapLetterOps(doc: DocT, letterId: string, d: string, name?: string): OpT[] {
  const n = doc.nodes[letterId];
  if (!n || n.type !== "path" || !pathDataBounds(d)) return [];
  return [{ op: "update", id: letterId, set: name ? { d, name } : { d } }];
}
