import { arcBand, circle, ngon, Pen, polar, poly, roundPoly, stroke, type Pt } from "../geom";
import { choice, int, maker, range, rectPts } from "./kit";

const S = maker("patterns");

const grid = (n: number, m = n) => {
  const out: [number, number, number, number][] = [];
  const s = 92 / Math.max(n, m);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) out.push([50 + (i - (n - 1) / 2) * s, 50 + (j - (m - 1) / 2) * s, i, j]);
  return { cells: out, step: s };
};

const PIXEL_HEART = ["0110110", "1111111", "1111111", "1111111", "0111110", "0011100", "0001000"];

export const PATTERNS = [
  S(
    "dot-grid",
    "Dot grid",
    "dots polka matrix grid texture",
    (p, d) => {
      const { cells, step } = grid(p.cols!, p.rows!);
      for (const [x, y] of cells) d.add(p.shape ? roundPoly(rectPts(step * p.size!, step * p.size!, x, y), 0) : circle(x, y, (step * p.size!) / 2));
    },
    [int("cols", "Columns", 2, 12, 5), int("rows", "Rows", 1, 12, 5), range("size", "Dot size", 0.15, 0.95, 0.55), choice("shape", "Dot", ["Round", "Square"])],
  ),
  S(
    "halftone",
    "Halftone",
    "dots gradient fade print texture retro comic",
    (p, d) => {
      const n = p.count!;
      const { cells, step } = grid(n);
      for (const [x, y, i, j] of cells) {
        const t = (i + j) / (2 * (n - 1));
        const r = (step / 2) * 0.95 * (1 - t) ** p.curve!;
        if (r > 0.6) d.add(circle(x, y, r));
      }
    },
    [int("count", "Grid", 4, 14, 8), range("curve", "Falloff", 0.4, 2.5, 1)],
  ),
  S(
    "radial-halftone",
    "Radial halftone",
    "dots burst fade circle texture",
    (p, d) => {
      const rings = p.rings!;
      const step = 46 / (rings + 0.5);
      d.add(circle(50, 50, step * 0.48));
      for (let k = 1; k <= rings; k++) {
        const r = k * step;
        const n = Math.max(6, Math.round((r * Math.PI * 2) / step));
        const size = (step / 2) * 0.95 * (1 - k / (rings + 1)) ** p.curve!;
        if (size < 0.6) continue;
        for (let i = 0; i < n; i++) d.add(circle(...polar(50, 50, r, (i * 360) / n), size));
      }
    },
    [int("rings", "Rings", 3, 10, 6), range("curve", "Falloff", 0.3, 2, 0.8)],
  ),
  S(
    "dot-ring",
    "Dot ring",
    "dots circle wreath loader dotted",
    (p, d) => {
      const n = p.count!;
      const r = Math.min(10, ((Math.PI * 40) / n) * p.size!);
      for (let i = 0; i < n; i++) d.add(circle(...polar(50, 50, 46 - r, (i * 360) / n), r));
    },
    [int("count", "Dots", 6, 48, 16), range("size", "Dot size", 0.2, 0.95, 0.6)],
  ),
  S(
    "checkerboard",
    "Checkerboard",
    "checker chess grid squares racing",
    (p, d) => {
      const { cells, step } = grid(p.count!);
      for (const [x, y, i, j] of cells) if ((i + j) % 2 === 0) d.add(poly(rectPts(step, step, x, y)));
      d.union();
    },
    [int("count", "Squares", 2, 10, 4)],
  ),
  S(
    "stripes",
    "Stripes",
    "lines bars horizontal striped flag",
    (p, d) => {
      const n = p.count!;
      const h = 92 / n;
      for (let i = 0; i < n; i++) {
        const y = 4 + h * (i + 0.5);
        const t = h * p.thick!;
        d.add(roundPoly(rectPts(92, t, 50, y), p.ends ? t / 2 : 0));
      }
    },
    [int("count", "Stripes", 2, 12, 5), range("thick", "Thickness", 0.15, 0.9, 0.55), choice("ends", "Ends", ["Flat", "Round"])],
  ),
  S(
    "diagonal-stripes",
    "Diagonal stripes",
    "hatching lines warning texture tile",
    (p, d) => {
      const n = p.count!;
      const step = 184 / n;
      for (let i = 0; i <= n; i++) {
        const o = -92 + step * i;
        d.add(stroke([[4 + o, 96], [96 + o, 4]], step * p.thick! * 0.707, "butt"));
      }
      d.clipTo(p.frame ? circle(50, 50, 46) : poly(rectPts(92, 92)));
    },
    [int("count", "Stripes", 3, 16, 8), range("thick", "Thickness", 0.2, 0.9, 0.5), choice("frame", "Shape", ["Square", "Circle"])],
  ),
  S(
    "lined-circle",
    "Lined circle",
    "striped ball stripes sphere globe retro",
    (p, d) => {
      const n = p.count!;
      const h = 92 / n;
      for (let i = 0; i < n; i++) d.add(poly(rectPts(100, h * p.thick!, 50, 4 + h * (i + 0.5))));
      d.clipTo(circle(50, 50, 46));
    },
    [int("count", "Lines", 3, 14, 7), range("thick", "Thickness", 0.2, 0.9, 0.55)],
  ),
  S(
    "concentric-squares",
    "Concentric squares",
    "nested squares tunnel depth frames",
    (p, d) => {
      const n = p.count!;
      const step = 46 / (n + 0.3);
      for (let i = 0; i < n; i++) {
        const s = 92 - 2 * i * step;
        const r = p.round! * s * 0.3;
        d.add(roundPoly(rectPts(s, s), r)).hole(roundPoly(rectPts(s - 2 * step * p.thick!, s - 2 * step * p.thick!), Math.max(0, r - step * p.thick!)));
      }
    },
    [int("count", "Squares", 2, 7, 4), range("thick", "Thickness", 0.2, 0.8, 0.5), range("round", "Roundness", 0, 1, 0)],
  ),
  S(
    "grid-lines",
    "Grid",
    "hash lattice tic tac toe matrix window",
    (p, d) => {
      const n = p.cells!;
      const t = 30 * p.thick! / n;
      for (let i = 0; i <= n; i++) {
        const v = 4 + (92 * i) / n;
        d.add(poly([[v - t / 2, 4 - t / 2], [v + t / 2, 4 - t / 2], [v + t / 2, 96 + t / 2], [v - t / 2, 96 + t / 2]]));
        d.add(poly([[4 - t / 2, v - t / 2], [96 + t / 2, v - t / 2], [96 + t / 2, v + t / 2], [4 - t / 2, v + t / 2]]));
      }
      d.union();
    },
    [int("cells", "Cells", 2, 8, 3), range("thick", "Thickness", 0.1, 1, 0.4)],
  ),
  S(
    "honeycomb",
    "Honeycomb",
    "hexagons bee hive cells network",
    (p, d) => {
      const r = 15;
      const g = 2.4 * p.gap!;
      const w = Math.sqrt(3) * r;
      for (const [q, s] of [[0, 0], [1, 0], [-1, 0], [0.5, -1], [-0.5, -1], [0.5, 1], [-0.5, 1]] as [number, number][]) d.add(poly(ngon(6, r - g / 2, 0, 50 + q * w, 50 + s * r * 1.5)));
    },
    [range("gap", "Gap", 0, 2.5, 1)],
  ),
  S(
    "triangle-tiles",
    "Triangle tiles",
    "triangles geometric mosaic tessellation",
    (p, d) => {
      const rows = p.rows!;
      const h = 88 / rows;
      const s = (h * 2) / Math.sqrt(3);
      const g = 1.6 * p.gap!;
      for (let r = 0; r < rows; r++) {
        const y0 = 6 + r * h;
        const count = r + 1;
        for (let i = 0; i < count; i++) {
          const cx = 50 + (i - r / 2) * s;
          d.add(poly(shrink([[cx, y0], [cx + s / 2, y0 + h], [cx - s / 2, y0 + h]], g)));
          if (i < r) d.add(poly(shrink([[cx, y0], [cx + s, y0], [cx + s / 2, y0 + h]], g)));
        }
      }
    },
    [int("rows", "Rows", 2, 6, 3), range("gap", "Gap", 0, 2.5, 1)],
  ),
  S(
    "sunburst-wedges",
    "Sunburst wedges",
    "rays retro background circus starburst stripes",
    (p, d) => {
      const n = p.count! * 2;
      for (let i = 0; i < n; i += 2) d.add(new Pen([50, 50]).arc(50, 50, 46, (i * 360) / n, ((i + 1) * 360) / n).close());
    },
    [int("count", "Wedges", 4, 24, 12)],
  ),
  S(
    "zigzag-stack",
    "Zigzag stack",
    "chevron pattern stripes zig zag waves",
    (p, d) => {
      const rows = p.rows!;
      const gap = 80 / rows;
      for (let r = 0; r < rows; r++) {
        const y = 10 + gap * (r + 0.5);
        const n = p.peaks! * 2;
        const pts = Array.from({ length: n + 1 }, (_, i) => [6 + (88 * i) / n, y + (i % 2 ? -1 : 1) * gap * 0.3] as Pt);
        d.add(stroke(pts, gap * 0.38, "butt"));
      }
    },
    [int("rows", "Rows", 2, 7, 4), int("peaks", "Peaks", 2, 10, 4)],
  ),
  S(
    "plus-grid",
    "Plus grid",
    "crosses pattern medical texture swiss",
    (p, d) => {
      const { cells, step } = grid(p.count!);
      const a = step * 0.32;
      const t = step * 0.12;
      for (const [x, y] of cells) d.add(stroke([[x - a, y], [x + a, y]], t, "butt"), stroke([[x, y - a], [x, y + a]], t, "butt"));
      d.union();
    },
    [int("count", "Grid", 2, 8, 4)],
  ),
  S(
    "pixel-heart",
    "Pixel heart",
    "8 bit retro game love pixel art",
    (p, d) => {
      const s = 92 / 7;
      const g = s * 0.12 * p.gap!;
      PIXEL_HEART.forEach((row, j) => [...row].forEach((c, i) => c === "1" && d.add(poly(rectPts(s - g, s - g, 4 + s * (i + 0.5), 4 + s * (j + 0.5))))));
      if (!g) d.union();
    },
    [range("gap", "Gap", 0, 2, 1)],
  ),
  S(
    "mosaic-circle",
    "Mosaic circle",
    "pixel circle tiles squares digital",
    (p, d) => {
      const n = p.count!;
      const { cells, step } = grid(n);
      for (const [x, y] of cells) if (Math.hypot(x - 50, y - 50) <= 46 - step * 0.2) d.add(poly(rectPts(step * 0.82, step * 0.82, x, y)));
    },
    [int("count", "Grid", 5, 16, 9)],
  ),
  S(
    "dotted-line",
    "Dotted line",
    "dots row ellipsis divider separator",
    (p, d) => {
      const n = p.count!;
      const step = 88 / (n - 1);
      for (let i = 0; i < n; i++) d.add(circle(6 + step * i, 50, (step / 2) * p.size!));
    },
    [int("count", "Dots", 3, 14, 7), range("size", "Size", 0.2, 0.95, 0.5)],
  ),
  S(
    "dashed-line",
    "Dashed line",
    "dashes divider separator stitch",
    (p, d) => {
      const n = p.count!;
      const step = 88 / n;
      const h = 4 + 8 * p.thick!;
      for (let i = 0; i < n; i++) {
        const x0 = 6 + step * i;
        d.add(roundPoly([[x0, 50 - h / 2], [x0 + step * 0.62, 50 - h / 2], [x0 + step * 0.62, 50 + h / 2], [x0, 50 + h / 2]], p.ends ? h / 2 : 0));
      }
    },
    [int("count", "Dashes", 3, 12, 6), range("thick", "Thickness", 0, 1, 0.4), choice("ends", "Ends", ["Flat", "Round"])],
  ),
  S(
    "dash-ring",
    "Tick ring",
    "clock ticks dial marks gauge",
    (p, d) => {
      const n = p.count!;
      for (let i = 0; i < n; i++) {
        const major = i % (p.major! || 1) === 0;
        d.add(stroke([polar(50, 50, major ? 30 : 36, (i * 360) / n), polar(50, 50, 46, (i * 360) / n)], major ? 4.5 : 2.5, "butt"));
      }
    },
    [int("count", "Ticks", 12, 72, 60), int("major", "Major every", 1, 15, 5)],
  ),
  S(
    "arc-steps",
    "Arc steps",
    "progress loader rings gauge levels",
    (p, d) => {
      const n = p.count!;
      const step = 42 / n;
      for (let i = 0; i < n; i++) d.add(arcBand(50, 50, 46 - i * step - step * 0.6, 46 - i * step, 0, 360 * (1 - i / (n + 1)) * p.sweep!, true));
    },
    [int("count", "Rings", 2, 5, 3), range("sweep", "Sweep", 0.3, 0.95, 0.8)],
  ),
];

/** Inset a triangle uniformly by g (toward its incentre). */
function shrink(t: Pt[], g: number): Pt[] {
  if (!g) return t;
  const [a, b, c] = t as [Pt, Pt, Pt];
  const la = Math.hypot(b[0] - c[0], b[1] - c[1]);
  const lb = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const lc = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const P = la + lb + lc;
  const I: Pt = [(la * a[0] + lb * b[0] + lc * c[0]) / P, (la * a[1] + lb * b[1] + lc * c[1]) / P];
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  const r = (2 * area) / P;
  const k = Math.max(0, (r - g / 2) / r);
  return t.map(([x, y]) => [I[0] + (x - I[0]) * k, I[1] + (y - I[1]) * k] as Pt);
}
