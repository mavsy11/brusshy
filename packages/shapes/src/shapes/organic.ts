import { circle, curvePts, ellipse, Pen, polar, poly, rng, rotateC, roundPoly, sampled, smooth, stroke, TAU, type Contour, type Pt } from "../geom";
import { int, maker, range, seed } from "./kit";

const S = maker("organic");

const blob = (seedV: number, n: number, wobble: number, ratio = 1) => {
  const r = rng(seedV);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i * 360) / n + (r() - 0.5) * (180 / n) * wobble;
    const rr = 44 * (1 - wobble * 0.5 + wobble * r());
    const [x, y] = polar(50, 50, rr, a);
    return [x, 50 + (y - 50) * ratio] as Pt;
  });
  return smooth(pts);
};

/** Leaf: pointed tip at top, base at the bottom, `w` = half width. */
export const leaf = (w: number, cx = 50, top = 5, bottom = 95): Contour => {
  const h = bottom - top;
  return new Pen([cx, top])
    .curve([cx + w * 0.9, top + h * 0.2], [cx + w * 1.1, top + h * 0.62], [cx, bottom])
    .curve([cx - w * 1.1, top + h * 0.62], [cx - w * 0.9, top + h * 0.2], [cx, top])
    .close();
};

export const heart = (): Contour =>
  new Pen([50, 90])
    .curve([30, 76], [6, 58], [6, 34])
    .curve([6, 19], [17, 9], [30, 9])
    .curve([40, 9], [47, 15], [50, 23])
    .curve([53, 15], [60, 9], [70, 9])
    .curve([83, 9], [94, 19], [94, 34])
    .curve([94, 58], [70, 76], [50, 90])
    .close();

/** Teardrop with its point up; `len` = how far the tip rises above the round body. */
export const drop = (len: number, cx = 50, cy = 62, r = 32): Contour => {
  const D = r + len;
  const a = (Math.acos(r / D) * 180) / Math.PI;
  const tip: Pt = [cx, cy - D];
  const k = 0.55;
  const p1 = polar(cx, cy, r, a);
  const p2 = polar(cx, cy, r, 360 - a);
  // Gently curved shoulders instead of straight tangents.
  return new Pen(tip)
    .quad([cx + (p1[0] - cx) * k + 2, tip[1] + (p1[1] - tip[1]) * 0.55], p1)
    .arc(cx, cy, r, a, 360 - a)
    .quad([cx - (cx - p2[0]) * k - 2, tip[1] + (p2[1] - tip[1]) * 0.55], tip)
    .close();
};

export const ORGANIC = [
  S("blob", "Blob", "organic fluid amoeba abstract random", (p, d) => d.add(blob(p.seed!, p.points!, p.wobble!)), [seed(7), int("points", "Points", 3, 14, 6), range("wobble", "Wobble", 0, 0.8, 0.38)]),
  S("pebble", "Pebble", "stone rock smooth organic", (p, d) => d.add(blob(p.seed!, 7, p.wobble!, 0.72)), [seed(4), range("wobble", "Wobble", 0, 0.4, 0.14)]),
  S(
    "splash",
    "Splash",
    "splat ink paint drip spill",
    (p, d) => {
      const r = rng(p.seed!);
      const n = 11;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n;
        pts.push(polar(50, 50, 30 + r() * 6, a));
        pts.push(polar(50, 50, 36 + r() * 12, a + 360 / n / 2));
      }
      d.add(smooth(pts));
      for (let i = 0; i < 4; i++) {
        const a = r() * 360;
        d.add(circle(...polar(50, 50, 44 + r() * 4, a), 2 + r() * 3));
      }
    },
    [seed(5)],
  ),
  S(
    "cloud",
    "Cloud",
    "weather sky storage soft puffy",
    (_, d) => {
      d.add(roundPoly([[12, 52], [88, 52], [88, 78], [12, 78]], 13));
      d.add(circle(34, 54, 18), circle(58, 44, 22), circle(77, 60, 13));
      d.union();
    },
  ),
  S("drop", "Drop", "water droplet rain teardrop liquid oil", (p, d) => d.add(drop(56 * p.len!)), [range("len", "Point", 0.2, 1, 0.62)]),
  S("heart", "Heart", "love like valentine romance", (_, d) => d.add(heart())),
  S(
    "heart-curve",
    "Full heart",
    "love valentine round plump",
    (_, d) =>
      d.add(
        sampled((t) => {
          const a = t * TAU;
          const x = 16 * Math.sin(a) ** 3;
          const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
          return [50 + x * 2.7, 46 - y * 2.7];
        }, 160),
      ),
  ),
  S("leaf", "Leaf", "nature eco plant green botanical", (p, d) => d.add(leaf(40 * p.width!)), [range("width", "Width", 0.3, 1.2, 0.72)]),
  S(
    "leaf-vein",
    "Leaf with vein",
    "nature eco plant botanical midrib",
    (p, d) => {
      d.add(leaf(40 * p.width!));
      d.hole(stroke(curvePts((t) => [50 + Math.sin(t * Math.PI) * 1.5, 22 + t * 73], 20), 3.2, "round", { profile: (t) => 0.4 + 0.6 * t }));
      d.union();
    },
    [range("width", "Width", 0.5, 1.2, 0.8)],
  ),
  S(
    "petal",
    "Petal",
    "flower bloom soft round leaf",
    (_, d) => d.add(new Pen([50, 96]).curve([26, 82], [20, 56], [22, 40]).arc(50, 40, 28, 270, 450).curve([80, 56], [74, 82], [50, 96]).close()),
  ),
  S(
    "flower",
    "Flower",
    "bloom blossom floral petals garden",
    (p, d) => {
      const n = p.petals!;
      const len = 23;
      const w = len * p.width!;
      for (let i = 0; i < n; i++) d.add(rotateC(ellipse(50, 50 - len, w, len), (i * 360) / n));
      if (p.center! > 0) d.hole(circle(50, 50, 30 * p.center!));
      d.union();
    },
    [int("petals", "Petals", 3, 16, 6), range("width", "Petal width", 0.25, 1, 0.55), range("center", "Centre hole", 0, 0.5, 0)],
  ),
  S(
    "daisy",
    "Daisy",
    "flower bloom spring floral",
    (p, d) => {
      const n = p.petals!;
      for (let i = 0; i < n; i++) d.add(rotateC(ellipse(50, 27, 6.5, 21), (i * 360) / n));
      d.hole(circle(50, 50, 18)).union();
      d.part("center").add(circle(50, 50, 14));
    },
    [int("petals", "Petals", 8, 24, 14)],
  ),
  S(
    "tulip",
    "Tulip",
    "flower spring bloom garden",
    (_, d) => {
      d.add(new Pen([20, 12]).line([35, 26], [50, 6], [65, 26], [80, 12]).curve([88, 42], [76, 62], [50, 62]).curve([24, 62], [12, 42], [20, 12]).close());
      d.add(stroke([[50, 58], [50, 96]], 5, "round"));
      d.add(rotateC(leaf(8, 50, 60, 94), -42, 50, 94));
      d.union();
    },
  ),
  S(
    "sprout",
    "Sprout",
    "seedling grow plant growth eco startup",
    (_, d) => {
      d.add(stroke(curvePts((t) => [50 + Math.sin(t * 2) * 1.5, 95 - t * 45], 16), 6, "round"));
      d.add(rotateC(leaf(14, 50, 14, 52), -55, 50, 52), rotateC(leaf(11, 50, 22, 52), 55, 50, 52));
      d.union();
    },
  ),
  S(
    "tree",
    "Round tree",
    "nature park oak forest",
    (_, d) => {
      d.add(circle(50, 38, 33));
      d.add(roundPoly([[45, 50], [55, 50], [55, 95], [45, 95]], 2));
      d.union();
    },
  ),
  S(
    "pine",
    "Pine tree",
    "forest evergreen christmas fir nature outdoor",
    (p, d) => {
      const tiers = p.tiers!;
      for (let i = 0; i < tiers; i++) {
        const top = 5 + (i * 62) / tiers;
        const w = 18 + (i + 1) * (26 / tiers);
        d.add(roundPoly([[50, top], [50 + w, top + 34], [50 - w, top + 34]], 2));
      }
      d.add(poly([[45, 70], [55, 70], [55, 95], [45, 95]]));
      d.union();
    },
    [int("tiers", "Tiers", 1, 5, 3)],
  ),
  S(
    "flame",
    "Flame",
    "fire hot burn torch spicy energy",
    (_, d) =>
      d.add(
        new Pen([50, 4])
          .curve([62, 22], [82, 36], [82, 62])
          .curve([82, 82], [67, 96], [50, 96])
          .curve([33, 96], [18, 82], [18, 64])
          .curve([18, 48], [27, 38], [34, 28])
          .curve([36, 40], [40, 46], [46, 48])
          .curve([43, 32], [45, 16], [50, 4])
          .close(),
      ),
  ),
  S(
    "crescent",
    "Crescent",
    "moon night lunar islamic sleep",
    (p, d) => {
      d.add(circle(50, 50, 45));
      d.hole(circle(50 + 45 * p.thick! * 1.2, 50 - 45 * p.thick! * 0.5, 42));
      d.union();
    },
    [range("thick", "Thickness", 0.15, 0.9, 0.42)],
  ),
  S(
    "bean",
    "Bean",
    "kidney seed coffee organic",
    (_, d) =>
      d.add(
        smooth([
          [22, 26],
          [50, 12],
          [80, 18],
          [92, 46],
          [82, 76],
          [54, 90],
          [26, 84],
          [13, 64],
          [24, 50],
          [14, 38],
        ]),
      ),
  ),
  S(
    "paw",
    "Paw",
    "pet dog cat animal vet",
    (_, d) => {
      d.add(smooth([[50, 52], [70, 64], [76, 82], [62, 92], [50, 88], [38, 92], [24, 82], [30, 64]]));
      d.add(rotateC(ellipse(20, 46, 8.5, 11), -25, 20, 46), rotateC(ellipse(38, 26, 9, 12), -8, 38, 26), rotateC(ellipse(62, 26, 9, 12), 8, 62, 26), rotateC(ellipse(80, 46, 8.5, 11), 25, 80, 46));
    },
  ),
  S(
    "wave-blob",
    "Liquid",
    "melt drip fluid goo slime",
    (p, d) => {
      const r = rng(p.seed!);
      const n = 4;
      d.add(roundPoly([[8, 14], [92, 14], [92, 46], [8, 46]], [8, 8, 0, 0]));
      for (let i = 0; i < n; i++) {
        const x = 92 - ((i + 0.5) * 84) / n;
        const len = 56 + r() * 34;
        d.add(roundPoly([[x - 6.5, 40], [x + 6.5, 40], [x + 6.5, len], [x - 6.5, len]], [0, 0, 6.5, 6.5]));
      }
      d.union();
    },
    [seed(2)],
  ),
];
