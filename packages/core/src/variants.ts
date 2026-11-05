import type { DocT, FrameNodeT } from "./schema";
import type { OpT } from "./ops";
import { cloneSubtreeOps, listFrames, nextFramePosition, nextVersionName } from "./frames";
import { newId } from "./ids";

/**
 * Variants: N versions created together for comparison. They share a `batch`
 * id and are named "V3 A", "V3 B"…; the user picks one to continue with.
 */

const LETTERS = "ABCDEFGH";

export function variantsOf(doc: DocT, batch: string | null | undefined): FrameNodeT[] {
  if (!batch) return [];
  return listFrames(doc).filter((f) => f.batch === batch);
}

/** Name of the version the batch becomes once the user picks one ("V3 B" → "V3"). */
export function batchBaseName(name: string): string {
  return name.replace(/\s+[A-H]$/, "");
}

/**
 * Ops that lay out `count` new versions in a row to the right of the others —
 * copies of `from` (keep its 3D look and background) or blank artboards.
 */
export function makeVariantsOps(
  doc: DocT,
  opts: { count: number; from?: string | null; blank?: boolean; name?: string },
): { ops: OpT[]; frameIds: string[]; batch: string; names: string[] } {
  const count = Math.max(2, Math.min(opts.count, LETTERS.length));
  const src = opts.from ? (doc.nodes[opts.from] as FrameNodeT | undefined) : undefined;
  const base = opts.name?.trim() || nextVersionName(doc);
  const batch = newId("b");
  const start = nextFramePosition(doc);
  const width = src?.width ?? 1024;
  const height = src?.height ?? 1024;
  const gap = 120;
  const ops: OpT[] = [];
  const frameIds: string[] = [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `${base} ${LETTERS[i]}`;
    const transform = { ...(src?.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), x: start.x + i * (width + gap), y: start.y };
    if (src && !opts.blank) {
      const r = cloneSubtreeOps(doc, src.id, { parent: null, patchRoot: { name, transform, batch } });
      ops.push(...r.ops);
      frameIds.push(r.rootId);
    } else {
      const id = newId("f");
      ops.push({
        op: "add",
        node: { id, type: "frame", name, width, height, background: src?.background ?? null, transform, style: { fill: null }, batch, ...(src ? { scene: src.scene } : {}) },
        parent: null,
      });
      frameIds.push(id);
    }
    names.push(name);
  }
  return { ops, frameIds, batch, names };
}

/** Continue with one variant: the others in its batch are removed and it becomes a plain version. */
export function continueWithVariantOps(doc: DocT, frameId: string): OpT[] {
  const f = doc.nodes[frameId] as FrameNodeT | undefined;
  if (!f || f.type !== "frame" || !f.batch) return [];
  const others = variantsOf(doc, f.batch).filter((x) => x.id !== f.id);
  return [
    ...others.map((o): OpT => ({ op: "remove", id: o.id })),
    { op: "update", id: f.id, set: { batch: null, name: batchBaseName(f.name) } },
  ];
}

/** Keep every variant as its own version (just leaves the comparison). */
export function keepAllVariantsOps(doc: DocT, batch: string): OpT[] {
  return variantsOf(doc, batch).map((f): OpT => ({ op: "update", id: f.id, set: { batch: null } }));
}
