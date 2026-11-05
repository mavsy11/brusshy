import svgpath from "svgpath";

/** Editable anchor/handle model of SVG path data (all segments as lines or cubics). */

export type P = [number, number];

export interface Anchor {
  p: P;
  /** Control point arriving at this anchor (from the previous segment). */
  cin: P | null;
  /** Control point leaving this anchor (toward the next segment). */
  cout: P | null;
}

export interface SubPath {
  anchors: Anchor[];
  closed: boolean;
}

const eq = (a: P, b: P) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

export function parsePath(d: string): SubPath[] {
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let pen: P = [0, 0];
  let start: P = [0, 0];
  const segs: (string | number)[][] = [];
  svgpath(d)
    .abs()
    .unarc()
    .unshort()
    .iterate((seg) => {
      segs.push([...seg]);
    });
  for (const seg of segs) {
    const cmd = seg[0] as string;
    const n = seg.slice(1) as number[];
    switch (cmd) {
      case "M":
        cur = { anchors: [{ p: [n[0]!, n[1]!], cin: null, cout: null }], closed: false };
        subs.push(cur);
        pen = [n[0]!, n[1]!];
        start = pen;
        break;
      case "L":
      case "H":
      case "V": {
        const p: P = cmd === "L" ? [n[0]!, n[1]!] : cmd === "H" ? [n[0]!, pen[1]] : [pen[0], n[0]!];
        cur?.anchors.push({ p, cin: null, cout: null });
        pen = p;
        break;
      }
      case "C": {
        if (!cur) break;
        cur.anchors[cur.anchors.length - 1]!.cout = [n[0]!, n[1]!];
        const p: P = [n[4]!, n[5]!];
        cur.anchors.push({ p, cin: [n[2]!, n[3]!], cout: null });
        pen = p;
        break;
      }
      case "Q": {
        if (!cur) break;
        // Elevate quadratic to cubic.
        const q: P = [n[0]!, n[1]!];
        const p: P = [n[2]!, n[3]!];
        const last = cur.anchors[cur.anchors.length - 1]!;
        last.cout = [pen[0] + (2 / 3) * (q[0] - pen[0]), pen[1] + (2 / 3) * (q[1] - pen[1])];
        cur.anchors.push({ p, cin: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], cout: null });
        pen = p;
        break;
      }
      case "Z":
      case "z":
        if (cur) {
          cur.closed = true;
          // A closing segment that ends on the start point merges into the first anchor.
          const a = cur.anchors;
          if (a.length > 1 && eq(a[a.length - 1]!.p, a[0]!.p)) {
            const last = a.pop()!;
            a[0]!.cin = last.cin;
          }
        }
        pen = start;
        break;
    }
  }
  return subs.filter((s) => s.anchors.length > 0);
}

const f = (n: number) => String(Math.round(n * 100) / 100);
const pt = (p: P) => `${f(p[0])} ${f(p[1])}`;

function segment(a: Anchor, b: Anchor): string {
  if (!a.cout && !b.cin) return `L${pt(b.p)}`;
  return `C${pt(a.cout ?? a.p)} ${pt(b.cin ?? b.p)} ${pt(b.p)}`;
}

export function serializePath(subs: SubPath[]): string {
  let d = "";
  for (const s of subs) {
    const a = s.anchors;
    if (!a.length) continue;
    d += `M${pt(a[0]!.p)}`;
    for (let i = 1; i < a.length; i++) d += segment(a[i - 1]!, a[i]!);
    if (s.closed) {
      if (a.length > 1 && (a[a.length - 1]!.cout || a[0]!.cin)) d += segment(a[a.length - 1]!, a[0]!);
      d += "Z";
    }
  }
  return d;
}

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Cubic point at t for a segment between two anchors. */
export function segmentPoint(a: Anchor, b: Anchor, t: number): P {
  const p0 = a.p;
  const p1 = a.cout ?? a.p;
  const p2 = b.cin ?? b.p;
  const p3 = b.p;
  const ab = lerp(p0, p1, t),
    bc = lerp(p1, p2, t),
    cd = lerp(p2, p3, t);
  return lerp(lerp(ab, bc, t), lerp(bc, cd, t), t);
}

/** Insert an anchor at t on the segment that starts at anchor index i (de Casteljau split). */
export function splitSegment(s: SubPath, i: number, t: number): SubPath {
  const a = s.anchors;
  const j = (i + 1) % a.length;
  const A = a[i]!;
  const B = a[j]!;
  const anchors = a.map((x) => ({ ...x }));
  if (!A.cout && !B.cin) {
    anchors.splice(i + 1, 0, { p: lerp(A.p, B.p, t), cin: null, cout: null });
    return { ...s, anchors };
  }
  const p0 = A.p,
    p1 = A.cout ?? A.p,
    p2 = B.cin ?? B.p,
    p3 = B.p;
  const ab = lerp(p0, p1, t),
    bc = lerp(p1, p2, t),
    cd = lerp(p2, p3, t);
  const abc = lerp(ab, bc, t),
    bcd = lerp(bc, cd, t);
  const m = lerp(abc, bcd, t);
  anchors[i] = { ...anchors[i]!, cout: ab };
  anchors[j] = { ...anchors[j]!, cin: cd };
  anchors.splice(i + 1, 0, { p: m, cin: abc, cout: bcd });
  return { ...s, anchors };
}

/** Nearest point on the path to q: returns subpath, segment start index, t and distance. */
export function nearestOnPath(subs: SubPath[], q: P): { s: number; i: number; t: number; d: number } | null {
  let best: { s: number; i: number; t: number; d: number } | null = null;
  subs.forEach((sp, si) => {
    const n = sp.anchors.length;
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const A = sp.anchors[i]!;
      const B = sp.anchors[(i + 1) % n]!;
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        const p = segmentPoint(A, B, t);
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (!best || d < best.d) best = { s: si, i, t, d };
      }
    }
  });
  return best;
}

/** True when the anchor's handles are colinear (a smooth node). */
export function isSmooth(a: Anchor): boolean {
  if (!a.cin || !a.cout) return false;
  const v1: P = [a.p[0] - a.cin[0], a.p[1] - a.cin[1]];
  const v2: P = [a.cout[0] - a.p[0], a.cout[1] - a.p[1]];
  const cross = v1[0] * v2[1] - v1[1] * v2[0];
  return Math.abs(cross) / (Math.hypot(...v1) * Math.hypot(...v2) || 1) < 0.02;
}

/** Toggle an anchor between corner (no handles) and smooth (symmetric handles along the neighbors' tangent). */
export function toggleSmooth(s: SubPath, i: number): SubPath {
  const a = s.anchors;
  const n = a.length;
  const anchors = a.map((x) => ({ ...x }));
  const cur = anchors[i]!;
  if (cur.cin || cur.cout) {
    anchors[i] = { ...cur, cin: null, cout: null };
    return { ...s, anchors };
  }
  const prev = a[(i - 1 + n) % n]!;
  const next = a[(i + 1) % n]!;
  const hasPrev = s.closed || i > 0;
  const hasNext = s.closed || i < n - 1;
  const from = hasPrev ? prev.p : cur.p;
  const to = hasNext ? next.p : cur.p;
  const dir: P = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(...dir) || 1;
  const k = len / 6;
  const u: P = [(dir[0] / len) * k, (dir[1] / len) * k];
  anchors[i] = { ...cur, cin: hasPrev ? [cur.p[0] - u[0], cur.p[1] - u[1]] : null, cout: hasNext ? [cur.p[0] + u[0], cur.p[1] + u[1]] : null };
  return { ...s, anchors };
}
