import { circle, ellipse, ngon, Pen, polar, poly, roundPoly, sampled, TAU, type Pt } from "../geom";
import { choice, int, maker, range, rectPts, round } from "./kit";

const S = maker("basic");

const superellipse = (n: number, rx: number, ry: number) =>
  sampled((t) => {
    const a = t * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [50 + rx * Math.sign(c) * Math.abs(c) ** (2 / n), 50 + ry * Math.sign(s) * Math.abs(s) ** (2 / n)];
  }, 160, 0.04);

/** Reuleaux polygon (odd n): every side is an arc centred on the opposite vertex. */
function reuleaux(n: number) {
  const v = ngon(n, 46, 0, 50, 52);
  const pen = new Pen(v[0]!);
  for (let i = 0; i < n; i++) pen.arcAround(v[(i + (n + 1) / 2) % n]!, v[(i + 1) % n]!);
  return pen.close();
}

export const BASIC = [
  S("circle", "Circle", "round dot disc disk ball", (_, d) => d.add(circle(50, 50, 45))),
  S("ellipse", "Ellipse", "oval egg round", (p, d) => d.add(ellipse(50, 50, 45, 45 * p.ratio!)), [range("ratio", "Height", 0.15, 1, 0.62)]),
  S("square", "Square", "box block tile rounded", (p, d) => d.add(roundPoly(rectPts(90, 90), p.round! * 45)), [round(0.12)]),
  S(
    "rectangle",
    "Rectangle",
    "box block card bar rounded",
    (p, d) => d.add(roundPoly(rectPts(90, 90 * p.ratio!), p.round! * 45 * p.ratio!)),
    [range("ratio", "Height", 0.1, 1, 0.6), round(0.1)],
  ),
  S("pill", "Pill", "capsule stadium lozenge button", (p, d) => d.add(roundPoly(rectPts(90, 90 * p.ratio!), 45 * p.ratio!)), [range("ratio", "Height", 0.1, 1, 0.42)]),
  S("triangle", "Triangle", "delta pyramid equilateral", (p, d) => d.add(roundPoly(ngon(3, 50, 0, 50, 55), p.round! * 22)), [round(0.08)]),
  S(
    "right-triangle",
    "Right triangle",
    "corner wedge half square",
    (p, d) => d.add(roundPoly([[10, 10], [10, 90], [90, 90]], p.round! * 18)),
    [round(0.06)],
  ),
  S("polygon", "Polygon", "ngon regular sides", (p, d) => d.add(roundPoly(ngon(p.sides!, 46), p.round! * 18)), [int("sides", "Sides", 3, 16, 7), round(0.05)]),
  S("pentagon", "Pentagon", "five sides polygon", (p, d) => d.add(roundPoly(ngon(5, 46), p.round! * 18)), [round(0.06)]),
  S("hexagon", "Hexagon", "six sides polygon honeycomb hex", (p, d) => d.add(roundPoly(ngon(6, 46, 90 * p.turn!), p.round! * 18)), [round(0.06), range("turn", "Rotate", 0, 1, 0)]),
  S("octagon", "Octagon", "eight sides polygon stop", (p, d) => d.add(roundPoly(ngon(8, 46, 22.5), p.round! * 16)), [round(0.04)]),
  S(
    "diamond",
    "Diamond",
    "rhombus lozenge rhombus kite",
    (p, d) =>
      d.add(
        roundPoly(
          [
            [50, 5],
            [50 + 45 * p.ratio!, 50],
            [50, 95],
            [50 - 45 * p.ratio!, 50],
          ],
          p.round! * 14,
        ),
      ),
    [range("ratio", "Width", 0.3, 1, 0.72), round(0.05)],
  ),
  S(
    "kite",
    "Kite",
    "rhombus dart quadrilateral",
    (p, d) =>
      d.add(
        roundPoly(
          [
            [50, 5],
            [84, 36],
            [50, 95],
            [16, 36],
          ],
          p.round! * 14,
        ),
      ),
    [round(0.04)],
  ),
  S(
    "parallelogram",
    "Parallelogram",
    "slanted skew italic bar rhomboid",
    (p, d) => {
      const s = p.skew! * 40;
      d.add(roundPoly([[10 + s, 25], [90, 25], [90 - s, 75], [10, 75]], p.round! * 14));
    },
    [range("skew", "Slant", 0, 0.9, 0.4), round(0.04)],
  ),
  S(
    "trapezoid",
    "Trapezoid",
    "trapezium tapered",
    (p, d) => {
      const t = 45 * p.top!;
      d.add(roundPoly([[50 - t, 22], [50 + t, 22], [95, 78], [5, 78]], p.round! * 14));
    },
    [range("top", "Top width", 0.05, 0.95, 0.55), round(0.04)],
  ),
  S("semicircle", "Semicircle", "half circle dome half moon", (_, d) => d.add(new Pen(polar(50, 70, 45, 270)).arc(50, 70, 45, 270, 450).close())),
  S("quarter-circle", "Quarter circle", "quadrant fan wedge", (_, d) => d.add(new Pen([10, 90]).line([10, 10]).arc(10, 90, 80, 0, 90).close())),
  S(
    "pie",
    "Pie",
    "sector wedge slice chart pacman",
    (p, d) => {
      const a = p.sweep!;
      d.add(new Pen([50, 50]).arc(50, 50, 45, 90 - a / 2 + 180, 90 + a / 2 + 180).close());
    },
    [range("sweep", "Angle", 20, 350, 300, 1)],
  ),
  S("squircle", "Squircle", "superellipse app icon rounded square smooth", (p, d) => d.add(superellipse(p.n!, 45, 45)), [range("n", "Squareness", 2.2, 12, 5, 0.1)]),
  S(
    "superellipse",
    "Superellipse",
    "lame curve squircle astroid",
    (p, d) => d.add(superellipse(p.n!, 45, 45 * p.ratio!)),
    [range("n", "Squareness", 0.5, 10, 3, 0.05), range("ratio", "Height", 0.3, 1, 0.75)],
  ),
  S("reuleaux", "Reuleaux triangle", "curved triangle constant width rounded", (p, d) => d.add(reuleaux([3, 5, 7][p.sides!]!)), [choice("sides", "Sides", ["3", "5", "7"])]),
  S(
    "lens",
    "Lens",
    "vesica almond eye seed mandorla",
    (p, d) => {
      const R = 50;
      const dist = R * 2 * (1 - p.full!);
      const hh = Math.sqrt(R * R - (dist / 2) ** 2);
      const T: Pt = [50, 50 - hh];
      const B: Pt = [50, 50 + hh];
      d.add(new Pen(T).arcAround([50 - dist / 2, 50], B).arcAround([50 + dist / 2, 50], T).close());
    },
    [range("full", "Fullness", 0.1, 0.9, 0.35)],
  ),
  S(
    "plus",
    "Plus",
    "cross add medical swiss",
    (p, d) => {
      const t = 45 * p.thick!;
      const a = 5;
      const b = 95;
      d.add(
        roundPoly(
          [
            [50 - t, a],
            [50 + t, a],
            [50 + t, 50 - t],
            [b, 50 - t],
            [b, 50 + t],
            [50 + t, 50 + t],
            [50 + t, b],
            [50 - t, b],
            [50 - t, 50 + t],
            [a, 50 + t],
            [a, 50 - t],
            [50 - t, 50 - t],
          ],
          [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0].map((k) => k * p.round! * t),
        ),
      );
    },
    [range("thick", "Thickness", 0.1, 0.8, 0.34), round(0)],
  ),
  S(
    "egg",
    "Egg",
    "oval ovoid easter",
    (_, d) =>
      d.add(
        sampled((t) => {
          const a = t * TAU;
          const y = Math.sin(a);
          return [50 + 37 * Math.cos(a) * (1 + 0.16 * y), 50 + 46 * y];
        }),
      ),
  ),
  S("arch", "Arch", "window door tombstone gate", (_, d) => d.add(new Pen([10, 95]).line([10, 50]).arc(50, 50, 40, 270, 450).line([90, 95]).close())),
  S(
    "chamfer-square",
    "Chamfered square",
    "cut corners octagon plate label",
    (p, d) => {
      const c = 40 * p.cut!;
      d.add(poly([[5 + c, 5], [95 - c, 5], [95, 5 + c], [95, 95 - c], [95 - c, 95], [5 + c, 95], [5, 95 - c], [5, 5 + c]]));
    },
    [range("cut", "Cut", 0.05, 1, 0.35)],
  ),
  S("tab", "Tab", "rounded top tombstone folder", (p, d) => d.add(roundPoly(rectPts(90, 70), [p.round! * 35, p.round! * 35, 0, 0])), [round(0.6)]),
  S(
    "leaf-square",
    "Leaf square",
    "opposite rounded corners petal tile",
    (p, d) => d.add(roundPoly(rectPts(90, 90), [p.round! * 45, 0, p.round! * 45, 0])),
    [round(0.85)],
  ),
  S(
    "drop-square",
    "Drop square",
    "three rounded corners one sharp speech pin",
    (p, d) => d.add(roundPoly(rectPts(90, 90), [p.round! * 45, p.round! * 45, p.round! * 45, 0])),
    [round(1)],
  ),
];
