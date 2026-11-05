import type { Author, HistoryEntry } from "./history";
import type { DocT, FrameNodeT, NodeT } from "./schema";
import { applyOps, subtreeIds } from "./ops";
import { listFrames } from "./frames";

/**
 * Design timelapse: how one version (frame) was built, step by step, reconstructed
 * from the document's undo history. The daemon walks the history backwards with the
 * inverse ops (the canonical record of every state), keeps only the version's own
 * subtree, drops steps that change nothing visible (renames, locks, 3D settings,
 * palette/brief edits, other versions), folds repeated drags into one step, samples
 * long histories down to `max` steps and sends node-level diffs. The studio replays
 * them by patching a node map — no op semantics needed on the client.
 *
 * Versions made by duplicating another one (duplicate_frame, variants) keep their
 * lineage: when the version first appears with content, the walk continues on the
 * version it was copied from, so a V3 timelapse starts at V1's blank artboard.
 */

export interface TimelapseStep {
  /** History position this step ends on (number of applied entries). */
  index: number;
  at: number;
  author: Author;
  /** The history label (e.g. "Bend", "Draw compass rose"). */
  label: string;
  /** Short caption for the overlay ("Refining shapes", or the label when it says more). */
  caption: string;
  /** History entries folded into this step (dragging, sampling). */
  merged: number;
  /** Frame id that holds the version in this state (changes when the lineage forks). */
  frame: string;
  /** Nodes created or changed since the previous step. */
  set: Record<string, NodeT>;
  /** Node ids gone since the previous step. */
  removed: string[];
  /** Leaf layers that are genuinely new (not just re-id'd by a copy): drawn in with the red pencil. */
  added: string[];
}

export interface TimelapseData {
  docId: string;
  docName: string;
  frameId: string;
  frameName: string;
  /** Starting state: the version's subtree (frame node included). */
  base: { frame: string; nodes: Record<string, NodeT> };
  steps: TimelapseStep[];
  /** History entries scanned / visible steps before sampling. */
  entries: number;
  visible: number;
  /** The version started from an empty artboard (false when the saved history was capped). */
  startsBlank: boolean;
  startedAt: number;
  endedAt: number;
}

export interface TimelapseOptions {
  /** Max steps returned (sampled evenly beyond it). Default 300. */
  max?: number;
}

/** Export options for the "timelapse" (video) and "timelapse-gif" formats. */
export interface TimelapseExportOptions {
  /** square = 1080×1080, vertical = 1080×1920 (social). Default ["square"]. */
  aspects?: ("square" | "vertical")[];
  /** Length of the build part, before the final hold and end card (default 12 s). */
  seconds?: number;
  /** Video width in px (default 1080). */
  size?: number;
  /** GIF width in px (default 540). */
  gifSize?: number;
  /** Show sketch layers (default true), captions (default true), elapsed-time clock (default true). */
  sketches?: boolean;
  captions?: boolean;
  clock?: boolean;
}

type Snap = { frame: string; nodes: Record<string, NodeT> } | null;

const LEAF = new Set(["path", "shape", "text", "sketch", "reference"]);
/** Fields that never change what the version looks like in 2D. */
const SILENT = new Set(["id", "parent", "name", "locked", "aiLock", "extrude", "warp", "effect", "lettering"]);
const SILENT_FRAME = new Set([...SILENT, "transform", "scene", "animation", "batch"]);

function visualKey(n: NodeT, withChildren: boolean): string {
  const skip = n.type === "frame" ? SILENT_FRAME : SILENT;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (skip.has(k) || (!withChildren && k === "children")) continue;
    o[k] = v;
  }
  return JSON.stringify(o);
}

/** Geometry identity of a leaf, ignoring its id (a copied layer is the same layer). */
const geomKey = (n: NodeT) => visualKey(n, false);

/** Outline identity (no paint): a copied layer that was only recolored is not new either. */
const SHAPE_FIELDS = ["type", "d", "shape", "width", "height", "radius", "sides", "innerRatio", "text", "fontFamily", "fontSize", "fontWeight", "transform", "strokes", "src"];
const shapeKey = (n: NodeT) => JSON.stringify(SHAPE_FIELDS.map((k) => (n as Record<string, unknown>)[k] ?? null));

/** Id-free signature of a whole version: equal signatures look identical. */
function signature(s: Snap): string {
  if (!s) return "";
  const walk = (id: string): string => {
    const n = s.nodes[id];
    if (!n) return "";
    const kids = n.type === "group" || n.type === "frame" ? n.children.map(walk).join(",") : "";
    return `${visualKey(n, false)}[${kids}]`;
  };
  return walk(s.frame);
}

function snap(doc: DocT, frame: string): Snap {
  const f = doc.nodes[frame];
  if (!f || f.type !== "frame") return null;
  const nodes: Record<string, NodeT> = {};
  for (const id of subtreeIds(doc, frame)) nodes[id] = doc.nodes[id]!;
  return { frame, nodes };
}

/** Multiset of leaf geometry keys inside a frame. */
function leafBag(doc: DocT, frame: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const id of subtreeIds(doc, frame)) {
    const n = doc.nodes[id]!;
    if (!LEAF.has(n.type)) continue;
    const k = geomKey(n);
    bag.set(k, (bag.get(k) ?? 0) + 1);
  }
  return bag;
}

/** The frame in `prev` this version was copied from (same layers), if any. */
function lineageSource(prev: DocT, cur: DocT, frame: string): string | null {
  const mine = leafBag(cur, frame);
  const size = [...mine.values()].reduce((a, b) => a + b, 0);
  if (!size) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const f of listFrames(prev)) {
    const theirs = leafBag(prev, f.id);
    let common = 0;
    let total = 0;
    for (const [k, c] of theirs) {
      total += c;
      common += Math.min(c, mine.get(k) ?? 0);
    }
    const score = common / Math.max(size, total, 1);
    if (score > bestScore) {
      bestScore = score;
      best = f.id;
    }
  }
  return bestScore >= 0.3 ? best : null;
}

const GENERIC = /^(agent (edit|drawing)|ai edit|edit|edits|update|change|changes|ops|batch)$/i;

/** What a step did, in a few words. */
function describe(prev: Snap, next: Snap, added: string[], removed: string[]): string {
  const nodes = next?.nodes ?? {};
  if (added.length) {
    const named = added.map((id) => nodes[id]).find((n) => n && n.name && !/^(path|shape|group|text)\s*\d*$/i.test(n.name));
    const sketch = added.every((id) => nodes[id]?.type === "sketch");
    if (sketch) return "Sketching";
    if (added.every((id) => nodes[id]?.type === "text")) return "Setting type";
    if (named && added.length === 1) return `Drawing ${named.name.length > 28 ? named.name.slice(0, 27) + "…" : named.name}`;
    return added.length > 2 ? "Drawing shapes" : "Drawing";
  }
  const leaves = removed.filter((id) => prev?.nodes[id] && LEAF.has(prev.nodes[id]!.type));
  if (leaves.length) return leaves.length > 1 ? "Removing parts" : "Removing a part";
  const changed = new Set<string>();
  for (const [id, n] of Object.entries(nodes)) {
    const p = prev?.nodes[id];
    if (!p) continue;
    for (const k of Object.keys(n)) {
      if (JSON.stringify((n as Record<string, unknown>)[k]) !== JSON.stringify((p as Record<string, unknown>)[k])) changed.add(n.type === "frame" ? `frame.${k}` : k);
    }
  }
  if (changed.has("d") || changed.has("width") || changed.has("height") || changed.has("radius") || changed.has("sides") || changed.has("innerRatio")) return "Refining shapes";
  if (["text", "fontFamily", "fontWeight", "fontSize", "letterSpacing", "axes", "features", "alternates", "kerning", "kerns"].some((k) => changed.has(k))) return "Setting type";
  if (changed.has("style")) return "Adjusting color";
  if (changed.has("transform")) return "Arranging";
  if (changed.has("children")) return "Arranging layers";
  if (changed.has("visible")) return "Showing and hiding layers";
  if (changed.has("frame.background") || changed.has("frame.width") || changed.has("frame.height")) return "Setting the artboard";
  if (changed.has("strokes")) return "Sketching";
  return "Refining";
}

function diff(prev: Snap, next: Snap): { set: Record<string, NodeT>; removed: string[]; added: string[]; changed: string[]; onlyUpdates: boolean } {
  const set: Record<string, NodeT> = {};
  const removed: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  const pn = prev?.nodes ?? {};
  const nn = next?.nodes ?? {};
  const prevLeaves = Object.values(pn).filter((n) => LEAF.has(n.type));
  const prevGeom = new Set([...prevLeaves.map(geomKey), ...prevLeaves.map(shapeKey)]);
  let onlyUpdates = true;
  for (const [id, n] of Object.entries(nn)) {
    const p = pn[id];
    if (!p) {
      set[id] = n;
      onlyUpdates = false;
      if (LEAF.has(n.type) && !prevGeom.has(geomKey(n)) && !prevGeom.has(shapeKey(n))) added.push(id);
      continue;
    }
    if (JSON.stringify(p) !== JSON.stringify(n)) {
      set[id] = n;
      if (visualKey(p, true) !== visualKey(n, true)) changed.push(id);
    }
  }
  for (const id of Object.keys(pn)) {
    if (!nn[id]) {
      removed.push(id);
      onlyUpdates = false;
    }
  }
  return { set, removed, added, changed, onlyUpdates };
}

/** Reconstruct the visible build steps of one version from the applied history (oldest first). */
export function buildTimelapse(doc: DocT, past: readonly HistoryEntry[], frameId: string, o: TimelapseOptions = {}): TimelapseData {
  const max = Math.max(2, Math.min(1000, Math.round(o.max ?? 300)));
  const n = past.length;
  const final = doc.nodes[frameId] as FrameNodeT | undefined;
  if (!final || final.type !== "frame") throw new Error(`Frame ${frameId} not found`);

  // Pass 1 — walk back from the current state with the inverse ops.
  const snaps: Snap[] = new Array(n + 1).fill(null);
  snaps[n] = snap(doc, frameId);
  let cur = doc;
  let tracked: string | null = frameId;
  let reached = n;
  for (let i = n - 1; i >= 0 && tracked; i--) {
    let prev: DocT;
    try {
      prev = applyOps(cur, past[i]!.inverse).doc;
    } catch {
      break; // inconsistent record: start the timelapse here
    }
    if (prev.nodes[tracked]?.type !== "frame") tracked = lineageSource(prev, cur, tracked);
    snaps[i] = tracked ? snap(prev, tracked) : null;
    cur = prev;
    reached = i;
  }

  // The version's starting state (a blank artboard if it didn't exist yet).
  const firstFrame = snaps.slice(reached).find((s) => s)!;
  const blankFrame = (s: NonNullable<Snap>): Snap => {
    const f = s.nodes[s.frame] as FrameNodeT;
    return { frame: f.id, nodes: { [f.id]: { ...f, children: [] } } };
  };
  const base: NonNullable<Snap> = snaps[reached] ?? blankFrame(firstFrame)!;

  // Pass 2 — keep steps that change what the version looks like; fold repeated drags.
  interface Kept {
    i: number;
    snap: NonNullable<Snap>;
    author: Author;
    label: string;
    merged: number;
    score: number;
    sig: string;
    changedKey: string;
    onlyUpdates: boolean;
  }
  const kept: Kept[] = [];
  let lastSnap: NonNullable<Snap> = base;
  let lastSig = signature(base);
  let pendingMerge = 0;
  for (let i = reached + 1; i <= n; i++) {
    const s = snaps[i] ?? blankFrame(firstFrame)!;
    const e = past[i - 1]!;
    const sig = signature(s);
    if (sig === lastSig) {
      pendingMerge++;
      continue;
    }
    const d = diff(lastSnap, s);
    const changedKey = [...d.changed].sort().join(",");
    const prevKept = kept[kept.length - 1];
    const sameDrag =
      prevKept &&
      d.onlyUpdates &&
      prevKept.onlyUpdates &&
      prevKept.author === e.author &&
      prevKept.label === e.label &&
      prevKept.changedKey === changedKey &&
      e.at - past[prevKept.i - 1]!.at < 15_000;
    if (sameDrag) {
      prevKept.i = i;
      prevKept.snap = s;
      prevKept.sig = sig;
      prevKept.merged += 1 + pendingMerge;
    } else {
      kept.push({
        i,
        snap: s,
        author: e.author,
        label: e.label,
        merged: 1 + pendingMerge,
        score: d.added.length * 3 + d.removed.length + d.changed.length,
        sig,
        changedKey,
        onlyUpdates: d.onlyUpdates,
      });
    }
    pendingMerge = 0;
    lastSnap = s;
    lastSig = sig;
  }

  // Sample long histories evenly; each bucket ends on its last state and is named after its biggest step.
  let picked = kept;
  if (kept.length > max) {
    picked = [];
    for (let b = 0; b < max; b++) {
      const from = Math.floor((b * kept.length) / max);
      const to = Math.floor(((b + 1) * kept.length) / max);
      const bucket = kept.slice(from, to);
      if (!bucket.length) continue;
      const main = bucket.reduce((a, c) => (c.score > a.score ? c : a), bucket[0]!);
      const last = bucket[bucket.length - 1]!;
      picked.push({ ...last, author: main.author, label: main.label, merged: bucket.reduce((s, c) => s + c.merged, 0) });
    }
  }

  const steps: TimelapseStep[] = [];
  let prev: NonNullable<Snap> = base;
  for (const k of picked) {
    const d = diff(prev, k.snap);
    const derived = describe(prev, k.snap, d.added, d.removed);
    const label = k.label.trim() || derived;
    steps.push({
      index: k.i,
      at: past[k.i - 1]!.at,
      author: k.author,
      label,
      // Terse UI labels ("Fill", "Move") read better as what happened ("Adjusting color").
      caption: GENERIC.test(label) || !/\s/.test(label) || label.length > 40 ? derived : label,
      merged: k.merged,
      frame: k.snap.frame,
      set: d.set,
      removed: d.removed,
      added: d.added,
    });
    prev = k.snap;
  }

  const startsBlank = !Object.values(base.nodes).some((x) => x.type !== "frame" && x.visible);
  return {
    docId: doc.id,
    docName: doc.name,
    frameId,
    frameName: final.name,
    base,
    steps,
    entries: n - reached,
    visible: kept.length,
    startsBlank,
    startedAt: past[reached]?.at ?? doc.createdAt,
    endedAt: past[n - 1]?.at ?? doc.updatedAt,
  };
}

/** Replay helper (client side): the node map after each step, starting from the base. */
export function replayTimelapse(data: TimelapseData): { frame: string; nodes: Record<string, NodeT> }[] {
  const out: { frame: string; nodes: Record<string, NodeT> }[] = [{ frame: data.base.frame, nodes: data.base.nodes }];
  let nodes = data.base.nodes;
  for (const s of data.steps) {
    nodes = { ...nodes, ...s.set };
    for (const id of s.removed) delete nodes[id];
    out.push({ frame: s.frame, nodes });
  }
  return out;
}
