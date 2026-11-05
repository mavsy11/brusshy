import { create } from "zustand";
import {
  addEffectOps,
  applyOps,
  currentWarp,
  describeWarp,
  effectsGroupsAround,
  effectTexts,
  envelopeFromWarp,
  identityEnvelope,
  newId,
  prepareWarp,
  regenerateEffectsOps,
  removeEffectOps,
  refineEnvelope,
  warpCommitOps,
  warpConversions,
  warpFor,
  warpResult,
  EFFECT_LABELS,
  type DocT,
  type EffectKind,
  type EffectParams,
  type EnvelopeT,
  type GlyphOutline,
  type NodeT,
  type OpT,
  type WarpSpec,
  type WarpTarget,
} from "@brusshy/core";
import { dispatch, select, toast, useStore } from "./store";
import { loadGlyphs } from "./lettering";
import { ensureFont, textToPath } from "./fonts";
import { activeFrameId } from "./store";

/**
 * Type Lab in the studio: warp (presets + free envelope) and effect layers.
 * Every gesture previews live through the store's `live` patches and commits as one undo step.
 */

const get = () => useStore.getState();

// ───────────────────────── glyphs & outlines ─────────────────────────

/** Glyph outlines for every text a warp will letter (fonts load first). */
async function glyphsFor(doc: DocT, ids: string[]): Promise<Record<string, GlyphOutline[]>> {
  const { texts } = warpConversions(doc, ids);
  const out: Record<string, GlyphOutline[]> = {};
  for (const id of texts) {
    const n = doc.nodes[id];
    if (n?.type === "text") out[id] = await loadGlyphs(n);
  }
  return out;
}

/** Whole-text outlines for texts that stay live text inside effects groups. */
export async function textOutlinesFor(doc: DocT, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of effectTexts(doc, ids)) {
    const n = doc.nodes[id];
    if (n?.type !== "text") continue;
    await ensureFont(n.fontFamily, n.fontWeight);
    const d = textToPath(n);
    if (d) out[id] = d;
  }
  return out;
}

/** Sync variant (fonts already on screen); missing outlines are simply skipped. */
function textOutlinesNow(doc: DocT, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of effectTexts(doc, ids)) {
    const n = doc.nodes[id];
    const d = n?.type === "text" ? textToPath(n) : null;
    if (d) out[id] = d;
  }
  return out;
}

// ───────────────────────── warp ─────────────────────────

/** Prepare a selection for warping (letters texts, shapes → paths — not committed yet). */
export async function beginWarp(ids: string[]): Promise<WarpTarget | null> {
  const doc = get().doc;
  if (!doc) return null;
  try {
    const glyphs = await glyphsFor(doc, ids);
    const now = get().doc;
    if (!now) return null;
    return prepareWarp(now, ids, { glyphs });
  } catch (e) {
    toast((e as Error).message, "error");
    return null;
  }
}

/** Effects groups that follow a warp: their layers are rebuilt from the warped sources. */
function effectRegenOps(after: DocT, members: string[]): OpT[] {
  const ops: OpT[] = [];
  for (const g of effectsGroupsAround(after, members)) {
    try {
      ops.push(...regenerateEffectsOps(after, g, textOutlinesNow(after, [g])));
    } catch {
      /* sources without outlines: leave the effect as it was */
    }
  }
  return ops;
}

/** Live patches for a warp result: leaves get new `d`; texts/shapes not converted yet draw as one path. */
function warpPatches(t: WarpTarget, out: Record<string, string>): Record<string, Partial<NodeT>> {
  const doc = get().doc;
  const patches: Record<string, Partial<NodeT>> = {};
  if (!doc) return patches;
  const owner = new Map<string, string>();
  for (const [o, leaves] of Object.entries(t.pending)) for (const l of leaves) owner.set(l, o);
  const merged: Record<string, string[]> = {};
  for (const l of t.leaves) {
    const d = out[l.id];
    if (d === undefined) continue;
    const o = owner.get(l.id);
    if (o && doc.nodes[o]?.type !== "path") (merged[o] ??= []).push(d);
    else patches[l.id] = { d } as Partial<NodeT>;
  }
  for (const [o, ds] of Object.entries(merged)) patches[o] = { type: "path", d: ds.join("") } as Partial<NodeT>;
  return patches;
}

/** Ids a preview may have patched (to clear them). */
function previewKeys(t: WarpTarget): string[] {
  return [...new Set([...t.leaves.map((l) => l.id), ...Object.keys(t.pending), ...effectLayerIds(t.doc, t.members)])];
}

function effectLayerIds(doc: DocT, members: string[]): string[] {
  return effectsGroupsAround(doc, members).flatMap((g) => {
    const n = doc.nodes[g];
    return n?.type === "group" ? n.children.filter((c) => doc.nodes[c]?.effect) : [];
  });
}

let effectsBudget = true;

/** Live preview of a warp (no history). Effects follow while it stays fast. */
export function previewWarp(t: WarpTarget, spec: WarpSpec) {
  const out = warpResult(t, spec);
  const patches = warpPatches(t, out);
  if (effectsBudget && !Object.keys(t.pending).length) {
    const t0 = performance.now();
    try {
      const after = applyOps(t.doc, warpCommitOps(t, spec, out)).doc;
      for (const op of effectRegenOps(after, t.members)) if (op.op === "update") patches[op.id] = { ...(patches[op.id] ?? {}), d: (op.set as { d: string }).d } as Partial<NodeT>;
    } catch {
      /* preview only */
    }
    if (performance.now() - t0 > 45) effectsBudget = false;
  }
  useStore.setState((s) => {
    const live = { ...s.live };
    for (const k of previewKeys(t)) delete live[k];
    return { live: { ...live, ...patches } };
  });
}

export function clearWarpPreview(t: WarpTarget) {
  effectsBudget = true;
  useStore.setState((s) => {
    const live = { ...s.live };
    for (const k of previewKeys(t)) delete live[k];
    return { live };
  });
}

/** Apply a warp — structural steps, geometry, record and effects in one undo step. */
export function commitWarp(t: WarpTarget, spec: WarpSpec): boolean {
  clearWarpPreview(t);
  const doc = get().doc;
  if (!doc) return false;
  try {
    const ops = warpCommitOps(t, spec);
    const after = applyOps(t.doc, ops.slice(t.structOps.length)).doc;
    ops.push(...effectRegenOps(after, t.members));
    if (!ops.length) return true;
    const label = Math.abs(spec.amount) < 1e-9 && spec.preset !== "envelope" ? "Reset warp" : `Warp: ${describeWarp(spec)}`;
    const ok = !!dispatch(ops, label);
    if (ok && t.structOps.length) select(t.members);
    return ok;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}

/** One-shot warp (preset tile, orientation flip, reset). */
export async function applyWarp(ids: string[], spec: WarpSpec): Promise<boolean> {
  const t = await beginWarp(ids);
  return t ? commitWarp(t, spec) : false;
}

export const warpOf = (doc: DocT, ids: string[]) => currentWarp(doc, ids);

// ───────────────────────── free envelope session ─────────────────────────

export interface EnvelopeSession {
  members: string[];
  rows: number;
  cols: number;
  /** Target prepared at start (texts lettered on the first commit); dropped once the doc moves on. */
  start: WarpTarget;
  /** Doc the session state belongs to; any other doc (undo, AI edit) re-reads the warp from the record. */
  doc: DocT | null;
  env: EnvelopeT;
}

export const useTypeLab = create<{ envelope: EnvelopeSession | null }>(() => ({ envelope: null }));

/** Envelope that reproduces the target's current warp (or a flat one). */
function envelopeOf(t: WarpTarget, rows: number, cols: number): EnvelopeT {
  const cur = t.current;
  if (cur?.preset === "envelope" && cur.envelope) return cur.envelope.rows === rows && cur.envelope.cols === cols ? cur.envelope : refineEnvelope(cur.envelope, rows, cols);
  if (cur) {
    // Normalised mesh sampled from the preset (unit box keeps the aspect through the real box).
    const f = warpFor(cur, t.box);
    const env = envelopeFromWarp(f, t.box, rows, cols);
    return env;
  }
  return identityEnvelope(rows, cols);
}

export async function startEnvelope(ids: string[], size: 1 | 2 = 1): Promise<void> {
  const t = await beginWarp(ids);
  if (!t) return;
  const cur = t.current?.preset === "envelope" ? t.current.envelope : null;
  const rows = cur?.rows ?? size;
  const cols = cur?.cols ?? size;
  useTypeLab.setState({ envelope: { members: t.members, rows, cols, start: t, doc: get().doc, env: envelopeOf(t, rows, cols) } });
  if (!get().selection.length) select(t.members);
}

export function endEnvelope() {
  const s = useTypeLab.getState().envelope;
  if (s) clearWarpPreview(s.start);
  useTypeLab.setState({ envelope: null });
}

/** The target to warp now: the start target while the doc is unchanged, else re-read from the document. */
export function envelopeTarget(s: EnvelopeSession): WarpTarget | null {
  const doc = get().doc;
  if (!doc) return null;
  if (s.doc === doc) return s.start;
  try {
    return prepareWarp(doc, s.members);
  } catch {
    return null;
  }
}

/** Keep the session in sync with the document (undo/redo, AI edits). */
export function syncEnvelope() {
  const s = useTypeLab.getState().envelope;
  const doc = get().doc;
  if (!s || !doc || s.doc === doc) return;
  if (!s.members.every((m) => doc.nodes[m])) return endEnvelope();
  const t = envelopeTarget(s);
  if (!t) return endEnvelope();
  const cur = t.current?.preset === "envelope" ? t.current.envelope : null;
  const rows = cur?.rows ?? s.rows;
  const cols = cur?.cols ?? s.cols;
  useTypeLab.setState({ envelope: { ...s, start: t, doc, rows, cols, env: envelopeOf(t, rows, cols) } });
}

export function setEnvelopeGrid(size: 1 | 2) {
  const s = useTypeLab.getState().envelope;
  if (!s || (s.rows === size && s.cols === size)) return;
  useTypeLab.setState({ envelope: { ...s, rows: size, cols: size, env: refineEnvelope(s.env, size, size) } });
}

/** Live preview while a handle is dragged. */
export function dragEnvelope(env: EnvelopeT) {
  const s = useTypeLab.getState().envelope;
  if (!s) return;
  const t = envelopeTarget(s);
  if (!t) return;
  useTypeLab.setState({ envelope: { ...s, env } });
  previewWarp(t, { preset: "envelope", amount: 0, orientation: "horizontal", envelope: env });
}

/** Commit the envelope (one undo step per drag). */
export function releaseEnvelope(env: EnvelopeT) {
  const s = useTypeLab.getState().envelope;
  if (!s) return;
  const t = envelopeTarget(s);
  if (!t) return endEnvelope();
  if (!commitWarp(t, { preset: "envelope", amount: 0, orientation: "horizontal", envelope: env })) return;
  const doc = get().doc;
  try {
    const next = doc ? prepareWarp(doc, t.members) : null;
    if (next) useTypeLab.setState({ envelope: { ...s, members: t.members, start: next, doc, env } });
  } catch {
    endEnvelope();
  }
}

export function resetEnvelope() {
  const s = useTypeLab.getState().envelope;
  if (!s) return;
  releaseEnvelope(identityEnvelope(s.rows, s.cols));
}

// ───────────────────────── effects ─────────────────────────

const frameBackground = (doc: DocT): string | null => {
  const f = activeFrameId(doc);
  const n = f ? doc.nodes[f] : undefined;
  return n?.type === "frame" ? n.background : null;
};

/** Add an effect (or update one with new params) — one undo step. */
export async function addEffect(ids: string[], kind: EffectKind, params: Partial<EffectParams> = {}): Promise<string | null> {
  const doc = get().doc;
  if (!doc) return null;
  try {
    const textOutlines = await textOutlinesFor(doc, ids);
    const now = get().doc!;
    const plan = addEffectOps(now, ids, kind, params, { textOutlines, newId, background: frameBackground(now) });
    const existed = !!now.nodes[plan.layerId];
    if (!dispatch(plan.ops, existed ? `${EFFECT_LABELS[kind].label} effect` : `Add ${EFFECT_LABELS[kind].label.toLowerCase()}`)) return null;
    if (!existed && !ids.includes(plan.groupId)) select([plan.groupId]);
    return plan.layerId;
  } catch (e) {
    toast((e as Error).message, "error");
    return null;
  }
}

/** Live preview of new params on an existing effect layer. */
export function previewEffect(ids: string[], kind: EffectKind, params: Partial<EffectParams>) {
  const doc = get().doc;
  if (!doc) return;
  try {
    const plan = addEffectOps(doc, ids, kind, params, { textOutlines: textOutlinesNow(doc, ids), newId, background: frameBackground(doc) });
    if (!doc.nodes[plan.layerId]) return;
    const n = doc.nodes[plan.layerId]!;
    useStore.setState((s) => ({ live: { ...s.live, [plan.layerId]: { d: plan.d, style: { ...n.style, fill: plan.params.color } } as Partial<NodeT> } }));
  } catch {
    /* keep the last good preview */
  }
}

export function clearEffectPreview(layerId: string) {
  useStore.setState((s) => {
    const live = { ...s.live };
    delete live[layerId];
    return { live };
  });
}

export function removeEffect(layerId: string) {
  const doc = get().doc;
  const n = doc?.nodes[layerId];
  if (!doc || !n?.effect) return;
  const group = n.parent;
  const ops = removeEffectOps(doc, layerId);
  if (!dispatch(ops, `Remove ${EFFECT_LABELS[n.effect.kind].label.toLowerCase()}`)) return;
  const after = get().doc;
  if (group && after && !after.nodes[group]) {
    const sources = (doc.nodes[group] as Extract<NodeT, { type: "group" }>).children.filter((c) => c !== layerId);
    select(sources);
  }
}

/** Rebuild every effect of a group from its sources — one undo step. */
export async function updateEffects(groupId: string) {
  const doc = get().doc;
  if (!doc) return;
  try {
    const textOutlines = await textOutlinesFor(doc, [groupId]);
    const ops = regenerateEffectsOps(get().doc!, groupId, textOutlines);
    if (ops.length) dispatch(ops, "Update effects");
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

export { textOutlinesNow };
