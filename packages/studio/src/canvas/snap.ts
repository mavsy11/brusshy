import { constructionSnapAxes, type DocT } from "@brusshy/core";
import { useConstruct } from "../construct/state";
import { useStore } from "../lib/store";
import { worldBox, type Box } from "../lib/geom";

export interface Guide {
  axis: "x" | "y";
  /** World coordinate of the guide line. */
  at: number;
}

/** Candidate snap lines: artboard edges/center and other top-level nodes' edges/centers. */
export function snapLines(doc: DocT, exclude: Set<string>, guides: Guide[] = []): { xs: number[]; ys: number[] } {
  const xs = [...guides.filter((g) => g.axis === "x").map((g) => g.at)];
  const ys = [...guides.filter((g) => g.axis === "y").map((g) => g.at)];
  // Other versions' edges and the parts inside every version.
  for (const f of doc.root.map((id) => doc.nodes[id])) {
    if (f?.type !== "frame" || exclude.has(f.id)) continue;
    const { x, y } = f.transform;
    xs.push(x, x + f.width / 2, x + f.width);
    ys.push(y, y + f.height / 2, y + f.height);
  }
  // Construction: circle centres, tangent lines (circle extremes), intersections.
  if (useConstruct.getState().visible || useStore.getState().tool === "builder")
    for (const f of doc.root.map((id) => doc.nodes[id])) {
      if (f?.type !== "frame" || !f.construction) continue;
      const a = constructionSnapAxes(f.construction);
      for (const v of a.xs) xs.push(v + f.transform.x);
      for (const v of a.ys) ys.push(v + f.transform.y);
    }
  const contents = doc.root.flatMap((id) => {
    const n = doc.nodes[id];
    return n?.type === "frame" ? n.children : [id];
  });
  for (const id of contents) {
    if (exclude.has(id)) continue;
    const n = doc.nodes[id];
    if (!n || !n.visible || n.type === "reference") continue;
    const b = worldBox(doc, n);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

/** Snap a moving box: returns the correction to add and the guides to draw. */
export function snapBox(box: Box, lines: { xs: number[]; ys: number[] }, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const probe = (vals: number[], targets: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const v of vals)
      for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
      }
    return best;
  };
  const sx = probe([box.x, box.x + box.w / 2, box.x + box.w], lines.xs);
  const sy = probe([box.y, box.y + box.h / 2, box.y + box.h], lines.ys);
  const guides: Guide[] = [];
  if (sx) guides.push({ axis: "x", at: sx.at });
  if (sy) guides.push({ axis: "y", at: sy.at });
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, guides };
}
