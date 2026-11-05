import { arcBand, circle, ellipse, fit, ngon, Pen, polar, roundPoly, stroke, type Pt } from "../geom";
import { choice, int, maker, range, rectPts, round } from "./kit";

const S = maker("frames");
const thickP = (def: number, max = 0.6) => range("thick", "Thickness", 0.02, max, def);

export const FRAMES = [
  S("ring", "Ring", "donut circle outline o halo loop", (p, d) => d.add(circle(50, 50, 46)).hole(circle(50, 50, 46 * (1 - p.thick!))), [thickP(0.18, 0.95)]),
  S(
    "double-ring",
    "Double ring",
    "circle border emblem outline",
    (p, d) => {
      const t = 46 * p.thick!;
      d.add(circle(50, 50, 46)).hole(circle(50, 50, 46 - t));
      d.add(circle(50, 50, 46 - t * 1.9)).hole(circle(50, 50, 46 - t * 2.4));
    },
    [thickP(0.1, 0.18)],
  ),
  S(
    "concentric",
    "Concentric rings",
    "target ripple radar signal sonar",
    (p, d) => {
      const n = p.count!;
      const step = 46 / (n + 0.5);
      for (let i = 0; i < n; i++) {
        const r = 46 - i * step;
        d.add(circle(50, 50, r)).hole(circle(50, 50, r - step * p.thick!));
      }
      if (p.dot) d.add(circle(50, 50, step * 0.5));
    },
    [int("count", "Rings", 2, 8, 3), range("thick", "Thickness", 0.2, 0.8, 0.5), choice("dot", "Centre", ["Open", "Dot"])],
  ),
  S(
    "arc",
    "Arc",
    "curve circle segment progress gauge",
    (p, d) => {
      const a = p.sweep!;
      d.add(arcBand(50, 50, 46 * (1 - p.thick!), 46, -a / 2, a / 2, !p.ends));
    },
    [range("sweep", "Sweep", 20, 350, 240, 1), thickP(0.18, 0.6), choice("ends", "Ends", ["Round", "Flat"])],
  ),
  S("half-ring", "Half ring", "arc semicircle rainbow arch horseshoe", (p, d) => d.add(arcBand(50, 50, 46 * (1 - p.thick!), 46, -90, 90)), [thickP(0.3, 0.8)]),
  S(
    "segmented-ring",
    "Segmented ring",
    "dashed circle loader progress segments",
    (p, d) => {
      const n = p.segments!;
      const step = 360 / n;
      const gap = step * p.gap!;
      for (let i = 0; i < n; i++) d.add(arcBand(50, 50, 46 * (1 - p.thick!), 46, i * step + gap / 2, (i + 1) * step - gap / 2, !!p.ends));
    },
    [int("segments", "Segments", 2, 36, 8), range("gap", "Gap", 0.05, 0.8, 0.25), thickP(0.2, 0.6), choice("ends", "Ends", ["Flat", "Round"])],
  ),
  S(
    "stencil-ring",
    "Stencil ring",
    "o broken circle gap cut letter",
    (p, d) => {
      const g = 16 * p.gap!;
      d.add(arcBand(50, 50, 46 * (1 - p.thick!), 46, g, 180 - g), arcBand(50, 50, 46 * (1 - p.thick!), 46, 180 + g, 360 - g));
    },
    [thickP(0.28, 0.7), range("gap", "Gap", 0.2, 2, 0.8)],
  ),
  S(
    "square-frame",
    "Square frame",
    "border box outline rectangle",
    (p, d) => {
      const t = 45 * p.thick!;
      const r = p.round! * 45;
      d.add(roundPoly(rectPts(90, 90 * p.ratio!), r)).hole(roundPoly(rectPts(90 - 2 * t, 90 * p.ratio! - 2 * t), Math.max(0, r - t)));
    },
    [thickP(0.14, 0.45), range("ratio", "Height", 0.3, 1, 1), round(0.1)],
  ),
  S(
    "polygon-frame",
    "Polygon frame",
    "hexagon outline border badge",
    (p, d) => {
      const n = p.sides!;
      const t = 46 * p.thick!;
      const rot = n % 2 ? 0 : 180 / n;
      d.add(roundPoly(ngon(n, 46, rot), p.round! * 10)).hole(roundPoly(ngon(n, 46 - t / Math.cos(Math.PI / n), rot), Math.max(0, p.round! * 10 - t)));
    },
    [int("sides", "Sides", 3, 12, 6), thickP(0.14, 0.5), round(0.1)],
  ),
  S("oval-frame", "Oval frame", "ellipse border cameo portrait", (p, d) => d.add(ellipse(50, 50, 36, 46)).hole(ellipse(50, 50, 36 - 46 * p.thick!, 46 - 46 * p.thick!)), [thickP(0.1, 0.4)]),
  S(
    "arch-frame",
    "Arch frame",
    "window door gate outline",
    (p, d) => {
      const t = 40 * p.thick!;
      d.add(new Pen([10, 95]).line([10, 50]).arc(50, 50, 40, 270, 450).line([90, 95]).close());
      d.hole(new Pen([10 + t, 95 - t]).line([10 + t, 50]).arc(50, 50, 40 - t, 270, 450).line([90 - t, 95 - t]).close());
    },
    [thickP(0.16, 0.4)],
  ),
  S(
    "corners",
    "Corner brackets",
    "viewfinder focus scan frame crop qr",
    (p, d) => {
      const t = 30 * p.thick!;
      const L = 40 * p.len!;
      const c: Pt[] = [[6, 6], [94, 6], [94, 94], [6, 94]];
      c.forEach(([x, y], i) => {
        const sx = i === 1 || i === 2 ? -1 : 1;
        const sy = i >= 2 ? -1 : 1;
        const o = t / 2;
        d.add(stroke([[x + o * sx, y + (L) * sy], [x + o * sx, y + o * sy], [x + L * sx, y + o * sy]], t, p.ends ? "butt" : "round"));
      });
    },
    [thickP(0.25, 0.5), range("len", "Length", 0.3, 1.1, 0.7), choice("ends", "Ends", ["Round", "Flat"])],
  ),
  S(
    "brackets",
    "Square brackets",
    "code developer frame quote",
    (p, d) => {
      const t = 30 * p.thick!;
      const o = t / 2;
      d.add(stroke([[30, 6 + o], [8 + o, 6 + o], [8 + o, 94 - o], [30, 94 - o]], t, "butt"), stroke([[70, 6 + o], [92 - o, 6 + o], [92 - o, 94 - o], [70, 94 - o]], t, "butt"));
    },
    [thickP(0.3, 0.6)],
  ),
  S(
    "parentheses",
    "Parentheses",
    "round brackets curve frame",
    (p, d) => {
      const t = 14 * p.thick!;
      d.add(arcBand(62, 50, 54 - t, 54, 236, 304, !!p.ends), arcBand(38, 50, 54 - t, 54, 56, 124, !!p.ends));
    },
    [range("thick", "Thickness", 0.3, 2, 1), choice("ends", "Ends", ["Flat", "Round"], 1)],
  ),
  S(
    "braces",
    "Curly braces",
    "code developer json bracket",
    (p, d) => {
      const w = 9 * p.thick!;
      const top: Pt[] = [...bez([44, 6], [34, 6], [30, 10], [30, 20]), ...bez([30, 38], [30, 46], [26, 50], [16, 50])];
      for (const fx of [false, true])
        for (const fy of [false, true]) d.add(stroke(top.map(([x, y]) => [fx ? 100 - x : x, fy ? 100 - y : y] as Pt), w, "round"));
      d.union();
    },
    [range("thick", "Thickness", 0.5, 2, 1)],
  ),
  S(
    "scalloped-frame",
    "Scalloped frame",
    "ornament border lace decorative vintage",
    (p, d) => {
      const n = p.scallops!;
      const pts: Pt[] = [];
      const k = 16;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < k; j++) {
          const u = j / k;
          pts.push(polar(50, 50, 46 * (1 - 0.08 * (1 - Math.sin(Math.PI * u))), ((i + u) * 360) / n));
        }
      d.add(fit(pts, 0.03));
      d.hole(circle(50, 50, 46 * (1 - p.thick!)));
    },
    [int("scallops", "Scallops", 8, 40, 20), thickP(0.18, 0.5)],
  ),
  S(
    "target",
    "Target",
    "bullseye aim goal focus archery",
    (p, d) => {
      const n = p.rings!;
      const step = 46 / (2 * n + 1);
      for (let i = 0; i < n; i++) d.add(circle(50, 50, 46 - 2 * i * step)).hole(circle(50, 50, 46 - (2 * i + 1) * step));
      d.add(circle(50, 50, step));
    },
    [int("rings", "Rings", 2, 5, 3)],
  ),
  S(
    "orbit",
    "Orbit",
    "planet satellite ring moon cycle",
    (p, d) => {
      const a = p.angle!;
      const dot = polar(50, 50, 40, a);
      d.add(circle(50, 50, 44)).hole(circle(50, 50, 36), circle(dot[0], dot[1], 13)).union();
      d.part("moon").add(circle(dot[0], dot[1], 9));
    },
    [range("angle", "Position", 0, 360, 45, 1)],
  ),
  S(
    "crosshair",
    "Crosshair",
    "aim target scope precision focus sniper",
    (_, d) => {
      d.add(circle(50, 50, 36)).hole(circle(50, 50, 30));
      for (const a of [0, 90, 180, 270]) d.add(stroke([polar(50, 50, 18, a), polar(50, 50, 47, a)], 6, "butt"));
      d.add(circle(50, 50, 4));
      d.union();
    },
  ),
];

/** Points along a cubic Bézier. */
function bez(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n = 12): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]] as Pt;
  });
}
