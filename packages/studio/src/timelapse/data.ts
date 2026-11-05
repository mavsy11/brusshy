import { frameDoc, replayTimelapse, type DocT, type FrameNodeT, type NodeT, type TimelapseData, type TimelapseStep } from "@brusshy/core";
import { api } from "../lib/socket";
import { activeFrameId, useStore } from "../lib/store";

/**
 * The studio side of the design timelapse: fetch the version's build steps from the
 * daemon (reconstructed from the undo history) and replay them into one projected
 * document per state. State 0 is the starting artboard, state k the result of step k.
 */

export interface TLState {
  frame: string;
  nodes: Record<string, NodeT>;
}

export interface TLModel {
  data: TimelapseData;
  states: TLState[];
  /** Document fields (name, palette, fonts…) the projections borrow. */
  shell: DocT;
}

export async function loadTimelapse(frame?: string | null): Promise<TLModel> {
  const doc = useStore.getState().doc;
  if (!doc) throw new Error("No document is open");
  const id = frame ?? activeFrameId(doc);
  const data = await api<TimelapseData>(`/api/timelapse?frame=${encodeURIComponent(id ?? "")}&max=300`);
  return { data, states: replayTimelapse(data), shell: doc };
}

/** Steps for state indices: state k (k ≥ 1) is the result of steps[k-1]. */
export const stepOf = (m: TLModel, k: number): TimelapseStep | null => (k >= 1 ? (m.data.steps[k - 1] ?? null) : null);

const docCache = new WeakMap<TLState, Map<string, DocT>>();

/**
 * State k as a standalone single-artboard document (like frameDoc), without reference
 * images (private photos stay out of shareable videos) and optionally without sketches.
 */
export function stateDoc(m: TLModel, k: number, sketches = true): DocT {
  const s = m.states[Math.max(0, Math.min(m.states.length - 1, k))]!;
  let byKey = docCache.get(s);
  if (!byKey) docCache.set(s, (byKey = new Map()));
  const key = sketches ? "s" : "-";
  const hit = byKey.get(key);
  if (hit) return hit;
  const drop = (n: NodeT) => n.type === "reference" || (!sketches && n.type === "sketch");
  const nodes: Record<string, NodeT> = {};
  for (const [id, n] of Object.entries(s.nodes)) {
    if (drop(n)) continue;
    nodes[id] = n.type === "group" || n.type === "frame" ? ({ ...n, children: n.children.filter((c) => s.nodes[c] && !drop(s.nodes[c]!)) } as NodeT) : n;
  }
  const out = frameDoc({ ...m.shell, root: [s.frame], nodes, annotations: {} }, s.frame);
  byKey.set(key, out);
  return out;
}

/** The final version's frame node (artboard size and background). */
export const finalFrame = (m: TLModel): FrameNodeT => {
  const s = m.states[m.states.length - 1]!;
  return s.nodes[s.frame] as FrameNodeT;
};

/** "12:45", "1:02:45", "3d 4h" — real time since the first step. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const mi = Math.floor((s % 3600) / 60);
  const se = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${p(mi)}:${p(se)}`;
  return `${p(mi)}:${p(se)}`;
}
