import { create } from "zustand";
import {
  detectLockupParts,
  fitArtboardToClearSpaceOps,
  LOCKUP_LABELS,
  lockupVersionsOps,
  pathDataBounds,
  planLockup,
  type ClearSpaceUnit,
  type DocT,
  type LockupArrangement,
  type LockupOptions,
  type LockupParts,
  type LockupPlan,
  type NodeT,
  type TypeMetricsFn,
} from "@brusshy/core";
import { dispatch, setActiveFrame, toast, useStore } from "./store";
import { textGlyphs, textToPath } from "./fonts";
import { topSelection } from "./actions";
import { fitFrame } from "../canvas/camera";

/** Lockup builder in the studio: real glyph metrics, live previews, one undo step per commit. */

const ratioCache = new Map<string, { cap: number; x: number }>();

/**
 * Exact type metrics from the canvas's own fonts: cap height and x-height measured on the
 * font's "H" and "x" outlines, plus the text's outline. Null until the font has loaded.
 */
export const studioTypeMetrics: TypeMetricsFn = (n) => {
  const d = textToPath(n);
  if (!d) return null;
  const k = `${n.fontFamily}|${n.fontWeight}`;
  let r = ratioCache.get(k);
  if (!r) {
    const g = textGlyphs({ text: "Hx", fontFamily: n.fontFamily, fontWeight: n.fontWeight, fontSize: 1000, letterSpacing: 0, anchor: "start" });
    const H = g?.[0] ? pathDataBounds(g[0].d) : null;
    const X = g?.[1] ? pathDataBounds(g[1].d) : null;
    if (!H || !X || H.y0 >= 0 || X.y0 >= 0) return null;
    r = { cap: -H.y0 / 1000, x: -X.y0 / 1000 };
    ratioCache.set(k, r);
  }
  return { capHeight: r.cap * n.fontSize, xHeight: r.x * n.fontSize, d };
};

/** Panel/overlay preferences: clear-space guides on the canvas and the clear-space unit. */
interface LockupUi {
  guides: boolean;
  unit: ClearSpaceUnit;
  amount: number;
}

const KEY = "brusshy:lockup-ui";
function load(): LockupUi {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<LockupUi> | null;
    if (v && (v.unit === "cap" || v.unit === "x" || v.unit === "mark")) return { guides: !!v.guides, unit: v.unit, amount: Number(v.amount) > 0 ? Number(v.amount) : 1 };
  } catch {
    /* storage unavailable */
  }
  return { guides: false, unit: "cap", amount: 1 };
}
export const useLockupUi = create<LockupUi>(() => load());
export function setLockupUi(patch: Partial<LockupUi>) {
  useLockupUi.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useLockupUi.getState()));
  } catch {
    /* storage unavailable */
  }
}

/** The mark and the wordmark of a version: from the selection when it holds both, otherwise detected. */
export function lockupParts(doc: DocT, frameId: string, selection: string[]): LockupParts {
  return detectLockupParts(doc, frameId, topSelection(doc, selection));
}

/** Doc with the live (uncommitted) patches applied — what the canvas shows. */
export function withLive(doc: DocT, live: Record<string, Partial<NodeT>>): DocT {
  const keys = Object.keys(live).filter((k) => doc.nodes[k]);
  if (!keys.length) return doc;
  return { ...doc, nodes: { ...doc.nodes, ...Object.fromEntries(keys.map((k) => [k, { ...doc.nodes[k]!, ...live[k] } as NodeT])) } };
}

let previewIds: string[] = [];

/** Show a lockup on the canvas without committing it. Returns the plan (or an error message). */
export function previewLockup(doc: DocT, frameId: string, parts: LockupParts, opts: LockupOptions): LockupPlan | string {
  try {
    const plan = planLockup(doc, frameId, parts, opts, studioTypeMetrics);
    useStore.setState((s) => {
      const live = { ...s.live };
      for (const id of previewIds) delete live[id];
      Object.assign(live, plan.patches);
      return { live };
    });
    previewIds = Object.keys(plan.patches);
    return plan;
  } catch (e) {
    clearLockupPreview();
    return (e as Error).message;
  }
}

export function clearLockupPreview() {
  if (!previewIds.length) return;
  const ids = previewIds;
  previewIds = [];
  useStore.setState((s) => {
    const live = { ...s.live };
    for (const id of ids) delete live[id];
    return { live };
  });
}

/** Apply a lockup in place — one undo step. */
export function commitLockup(doc: DocT, frameId: string, parts: LockupParts, opts: LockupOptions): LockupPlan | null {
  try {
    const plan = planLockup(doc, frameId, parts, opts, studioTypeMetrics);
    clearLockupPreview();
    if (!plan.ops.length) return plan;
    if (!dispatch(plan.ops, `Lockup: ${LOCKUP_LABELS[opts.arrangement]}`)) return null;
    const shrink = plan.notes.find((n) => n.startsWith("Scaled the lockup"));
    if (shrink) toast(shrink);
    return plan;
  } catch (e) {
    clearLockupPreview();
    toast((e as Error).message, "error");
    return null;
  }
}

/** The full lockup family as new versions next to the others (each fitted to its clear space). */
export function makeLockupVersions(
  doc: DocT,
  frameId: string,
  parts: LockupParts,
  arrangements: LockupArrangement[],
  opts: Omit<LockupOptions, "arrangement">,
  tuned?: { arrangement: LockupArrangement; ratio?: number; gap?: number },
) {
  try {
    clearLockupPreview();
    const r = lockupVersionsOps(doc, frameId, parts, arrangements, { ...opts, fit: "artboard", perArrangement: tuned ? { [tuned.arrangement]: { ratio: tuned.ratio, gap: tuned.gap } } : undefined }, studioTypeMetrics);
    if (!dispatch(r.ops, `Lockup versions (${r.frames.length})`)) return;
    toast(`${r.frames.map((f) => f.name).join(" · ")} — one undo step`);
    const first = r.frames[0];
    const next = useStore.getState().doc;
    if (first && next?.nodes[first.id]) {
      setActiveFrame(first.id);
      useStore.setState({ camera: fitFrame(next, first.id) });
    }
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

export function fitArtboardToClearSpace(doc: DocT, frameId: string, parts: LockupParts, clearSpace: { unit: ClearSpaceUnit; amount: number }) {
  try {
    const ops = fitArtboardToClearSpaceOps(doc, frameId, parts, clearSpace, studioTypeMetrics);
    dispatch(ops, "Fit artboard to clear space");
  } catch (e) {
    toast((e as Error).message, "error");
  }
}
