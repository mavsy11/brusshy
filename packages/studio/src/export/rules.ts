import { CLEAR_SPACE_DEFAULT, FrameNode, lockupMetrics, MIN_SIZE_RULES, type ClearSpaceUnit, type DocT, type LockupMetrics, type NodeT } from "@brusshy/core";
import { studioTypeMetrics, useLockupUi } from "../lib/lockup";

/**
 * The logo's usage rules, measured on the logo itself: clear space in a unit taken from the mark
 * (the wordmark's cap height, or the symbol's height) and the minimum size. The brand-kit PDF
 * and brand.md print the same numbers.
 */

export interface ClearRule {
  unit: ClearSpaceUnit;
  /** x = amount × the unit. */
  amount: number;
  /** x in artboard px. */
  value: number;
  /** "the cap height of the wordmark". */
  what: string;
  /** "x = ¼ of the height of the symbol". */
  definition: string;
  /** What the unit measures on the logo (artboard px), to draw it: a vertical span at `at`. */
  span: { x: number; y0: number; y1: number } | null;
}

export interface KitRules {
  clear: ClearRule | null;
  minSize: LockupMetrics["minSize"];
  /** Type metrics were measured on the real font (not estimated). */
  exact: boolean;
}

const WHAT: Record<ClearSpaceUnit, string> = { cap: "the cap height of the wordmark", x: "the x-height of the wordmark", mark: "the height of the symbol" };
const FRACTIONS: Record<string, string> = { "0.25": "¼ of ", "0.5": "½ of ", "0.75": "¾ of ", "0.333": "⅓ of ", "1": "" };

const amountText = (a: number) => FRACTIONS[String(Math.round(a * 1000) / 1000)] ?? `${Math.round(a * 100) / 100} × `;

/** "x", "4x"…: how many x the measured unit is. */
export function unitLabel(amount: number): string {
  if (Math.abs(amount - 1) < 1e-6) return "x";
  const k = 1 / amount;
  return `${Math.round(k * 100) / 100}x`;
}

/** lockupMetrics measures a version: see the export document (a frame's projection) as one again. */
function asFrame(doc: DocT): { doc: DocT; id: string } {
  const id = "__brand_kit__";
  const nodes: Record<string, NodeT> = {};
  for (const [k, n] of Object.entries(doc.nodes)) nodes[k] = n.parent === null ? ({ ...n, parent: id } as NodeT) : n;
  nodes[id] = FrameNode.parse({ id, type: "frame", width: doc.artboard.width, height: doc.artboard.height, background: doc.artboard.background, children: doc.root });
  return { doc: { ...doc, root: [id], nodes }, id };
}

export function kitRules(doc: DocT): KitRules {
  let m: LockupMetrics;
  try {
    const f = asFrame(doc);
    // The unit chosen in the lockup panel (its canvas guides), when this logo has that part.
    const ui = useLockupUi.getState();
    m = lockupMetrics(f.doc, f.id, { typeMetrics: studioTypeMetrics, clearSpace: { unit: ui.unit, amount: ui.amount } });
    if (m.clearSpace && m.clearSpace.unit !== ui.unit) m = lockupMetrics(f.doc, f.id, { typeMetrics: studioTypeMetrics, clearSpace: { unit: m.clearSpace.unit, amount: CLEAR_SPACE_DEFAULT[m.clearSpace.unit] } });
  } catch (e) {
    console.info("[brand kit] lockup metrics unavailable:", (e as Error).message);
    return { clear: null, minSize: null, exact: false };
  }
  let clear: ClearRule | null = null;
  const c = m.clearSpace;
  if (c) {
    const t = m.type;
    const span =
      c.unit === "mark" && m.mark
        ? { x: m.mark.box.x, y0: m.mark.box.y, y1: m.mark.box.y + m.mark.box.h }
        : t
          ? { x: t.box.x, y0: t.baseline - (c.unit === "x" ? t.xHeight : t.capHeight), y1: t.baseline }
          : null;
    clear = { unit: c.unit, amount: c.amount, value: c.value, what: WHAT[c.unit], definition: `x = ${amountText(c.amount)}${WHAT[c.unit]}`, span };
  }
  let minSize = m.minSize;
  const bw = m.bounds?.w ?? 0;
  if (minSize?.limitedBy === "stroke" && minSize.px > bw) {
    // Hairlines (thinner than a pixel at the master size) are texture, not structure: they don't set the minimum.
    const b = m.bounds!;
    minSize =
      m.type && m.typeVisible
        ? { px: Math.ceil((bw * MIN_SIZE_RULES.capPx) / m.type.capHeight), mm: Math.round(((bw * MIN_SIZE_RULES.capMm) / m.type.capHeight) * 10) / 10, limitedBy: "cap height" }
        : { px: Math.ceil((bw * MIN_SIZE_RULES.iconPx) / Math.max(b.w, b.h)), mm: 0, limitedBy: "icon" };
  }
  return { clear, minSize, exact: m.exact };
}

export interface Dont {
  title: string;
  note: string;
}

/** The misuse list (PDF "Don'ts" page and brand.md). */
export function donts(r: KitRules): Dont[] {
  const min = r.minSize?.px;
  return [
    { title: "Don't stretch or squash", note: "Scale it proportionally: width and height together." },
    { title: "Don't recolor", note: "Use the brand colors, or the black and white versions." },
    { title: "Don't add effects", note: "No shadows, glows, outlines, bevels or textures." },
    { title: "Don't use busy backgrounds", note: "Put it on a calm, solid area; on dark ones use the on-dark files." },
    { title: "Don't go below the minimum size", note: min ? `Never narrower than ${min} px: use the symbol or the favicon instead.` : "Use the symbol or the favicon when space is tight." },
    { title: "Don't rotate or rearrange", note: "Keep it upright, its parts where and as they are." },
  ];
}
