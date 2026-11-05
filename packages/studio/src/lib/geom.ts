import {
  apply,
  multiply,
  shapeToPath,
  transformMatrix,
  worldMatrix,
  IDENTITY,
  type DocT,
  type Mat,
  type NodeT,
} from "@brusshy/core";
import { textToPath, textWidth } from "./fonts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Pt = [number, number];

let measureSvg: SVGSVGElement | null = null;
let measurePath: SVGPathElement | null = null;
const bboxCache = new Map<string, Box>();

/** Geometric bounds of path data, measured by the browser (cached). */
export function pathBBox(d: string): Box {
  const hit = bboxCache.get(d);
  if (hit) return hit;
  if (!measureSvg) {
    measureSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    measureSvg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden");
    measurePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    measureSvg.appendChild(measurePath);
    document.body.appendChild(measureSvg);
  }
  measurePath!.setAttribute("d", d);
  let b: Box = { x: 0, y: 0, w: 0, h: 0 };
  try {
    const r = measurePath!.getBBox();
    b = { x: r.x, y: r.y, w: r.width, h: r.height };
  } catch {
    /* invalid path data */
  }
  if (bboxCache.size > 2000) bboxCache.clear();
  bboxCache.set(d, b);
  return b;
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function boxOfPoints(pts: Pt[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const corners = (b: Box): Pt[] => [
  [b.x, b.y],
  [b.x + b.w, b.y],
  [b.x + b.w, b.y + b.h],
  [b.x, b.y + b.h],
];

/** Path data a node draws in its local space (null for non-geometric nodes). */
export function nodePath(n: NodeT): string | null {
  if (n.type === "path") return n.d;
  if (n.type === "shape") return shapeToPath(n);
  if (n.type === "text") return textToPath(n);
  return null;
}

/** Bounds in the node's own local coordinates. */
export function localBBox(doc: DocT, n: NodeT): Box {
  switch (n.type) {
    case "path":
      return pathBBox(n.d);
    case "shape":
      return { x: 0, y: 0, w: n.width, h: n.height };
    case "reference":
    case "frame":
      return { x: 0, y: 0, w: n.width, h: n.height };
    case "text": {
      const d = textToPath(n);
      if (d) {
        const b = pathBBox(d);
        if (b.w > 0) return b;
      }
      const w = textWidth(n);
      const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
      return { x, y: -n.fontSize * 0.74, w, h: n.fontSize * 0.98 };
    }
    case "sketch": {
      const pts: Pt[] = [];
      let pad = 0;
      for (const s of n.strokes) {
        pad = Math.max(pad, s.size / 2);
        for (const p of s.points) pts.push([p[0], p[1]]);
      }
      if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
      const b = boxOfPoints(pts);
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    case "group": {
      const boxes: Box[] = [];
      for (const cid of n.children) {
        const c = doc.nodes[cid];
        if (!c || !c.visible) continue;
        const m = transformMatrix(c.transform);
        boxes.push(boxOfPoints(corners(localBBox(doc, c)).map((p) => apply(m, p[0], p[1]))));
      }
      return union(boxes) ?? { x: 0, y: 0, w: 0, h: 0 };
    }
  }
}

/** Matrix of the node's parent chain (excluding the node's own transform). */
export function parentMatrix(doc: DocT, n: NodeT): Mat {
  return n.parent ? worldMatrix(doc, n.parent) : IDENTITY;
}

/** The node's local bbox corners in artboard space (an oriented quad). */
export function worldQuad(doc: DocT, n: NodeT): Pt[] {
  const m = multiply(parentMatrix(doc, n), transformMatrix(n.transform));
  return corners(localBBox(doc, n)).map((p) => apply(m, p[0], p[1]));
}

export function worldBox(doc: DocT, n: NodeT): Box {
  return boxOfPoints(worldQuad(doc, n));
}

export function selectionBox(doc: DocT, ids: string[]): Box | null {
  return union(ids.map((id) => doc.nodes[id]).filter(Boolean).map((n) => worldBox(doc, n!)));
}

/** All visible content bounds (exportable nodes only). */
export function contentBox(doc: DocT): Box | null {
  return union(
    doc.root
      .map((id) => doc.nodes[id])
      .filter((n): n is NodeT => !!n && n.visible && n.type !== "sketch" && n.type !== "reference")
      .map((n) => worldBox(doc, n)),
  );
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
