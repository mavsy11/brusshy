import { arcBand, circle, curvePts, ngon, Pen, polar, poly, rotateC, roundPoly, stroke, TAU, type Pt } from "../geom";
import { choice, int, maker, range, rectPts, round } from "./kit";

const S = maker("marks");

export const MARKS = [
  S(
    "venn",
    "Overlap circles",
    "venn intersection partnership collaboration union",
    (p, d) => {
      const o = 22 * p.overlap!;
      d.add(circle(50 - o, 50, 30), circle(50 + o, 50, 30)).evenodd();
    },
    [range("overlap", "Distance", 0.3, 1.2, 0.7)],
  ),
  S(
    "venn-three",
    "Three circles",
    "venn triad trinity overlap community",
    (_, d) => {
      for (const a of [0, 120, 240]) d.add(circle(...polar(50, 54, 18, a), 30));
      d.evenodd();
    },
  ),
  S(
    "linked-rings",
    "Linked rings",
    "chain link connection partnership interlocking",
    (p, d) => {
      const t = 9 * p.weight!;
      d.ring(circle(32, 50, 28), circle(32, 50, 28 - t));
      d.ring(circle(68, 50, 28), circle(68, 50, 28 - t));
      d.union();
    },
    [range("weight", "Weight", 0.5, 1.8, 1)],
  ),
  S(
    "trefoil",
    "Trefoil",
    "clover three leaf gothic lobes",
    (p, d) => {
      for (const a of [0, 120, 240]) d.add(circle(...polar(50, 52, 22 * p.spread!, a), 22));
      d.add(circle(50, 52, 22 * p.spread!));
      d.union();
    },
    [range("spread", "Spread", 0.6, 1.3, 1)],
  ),
  S(
    "quatrefoil",
    "Quatrefoil",
    "clover four leaf gothic lucky ornament",
    (p, d) => {
      for (const a of [0, 90, 180, 270]) d.add(circle(...polar(50, 50, 22 * p.spread!, a), 22));
      d.add(rotateC(poly(rectPts(31 * p.spread!, 31 * p.spread!)), 45));
      d.union();
    },
    [range("spread", "Spread", 0.6, 1.3, 1)],
  ),
  S(
    "petal-cross",
    "Petal cross",
    "flower lens four petals star ornament",
    (p, d) => {
      const n = p.petals!;
      for (let i = 0; i < n; i++) {
        const off = 46 * (1.1 - p.width!);
        const lens = new Pen([50, 50]).arcAround([50 - off, 27], [50, 4], false).arcAround([50 + off, 27], [50, 50], false).close();
        d.add(rotateC(lens, (i * 360) / n));
      }
      d.union();
    },
    [int("petals", "Petals", 3, 8, 4), range("width", "Width", 0.1, 0.9, 0.4)],
  ),
  S(
    "bauhaus",
    "Bauhaus tiles",
    "quarter circles geometric grid modernist tiles",
    (p, d) => {
      const g = 4 * p.gap!;
      const s = (92 - g) / 2;
      const pivots = [[3, 0, 2, 1], [0, 1, 3, 2], [2, 3, 1, 0], [0, 0, 0, 0]][p.variant!]!;
      const tiles: [number, number][] = [[4, 4], [4 + s + g, 4], [4, 4 + s + g], [4 + s + g, 4 + s + g]];
      tiles.forEach(([x, y], i) => {
        const corner: Pt[] = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
        const k = pivots[i]!;
        const o = corner[k]!;
        const start = [90, 180, 270, 360][k]!;
        const end = start + 90;
        d.add(new Pen(o).line(polar(o[0], o[1], s, start)).arc(o[0], o[1], s, start, end).close());
      });
    },
    [range("gap", "Gap", 0, 2, 1), choice("variant", "Layout", ["Pinwheel", "Bloom", "Circle", "Repeat"])],
  ),
  S(
    "split-circle",
    "Split circle",
    "half offset shifted divided duality",
    (p, d) => {
      const g = 3 * p.gap!;
      const o = 12 * p.shift!;
      d.add(new Pen([50 - g, 50 - 44 - o]).arc(50 - g, 50 - o, 44, 180, 360).close());
      d.part("right").add(new Pen([50 + g, 50 + 44 + o]).arc(50 + g, 50 + o, 44, 0, 180).close());
    },
    [range("gap", "Gap", 0, 2, 1), range("shift", "Shift", 0, 1.5, 0.6)],
  ),
  S(
    "sliced-circle",
    "Retro sun",
    "sliced circle stripes sunset vaporwave 80s",
    (p, d) => {
      d.add(circle(50, 50, 46));
      const n = p.stripes!;
      for (let i = 0; i < n; i++) {
        const y = 52 + (i + 0.5) * (44 / n);
        const h = 1 + (i + 1) * (6 / n) * p.gap!;
        d.hole(poly([[0, y - h / 2], [100, y - h / 2], [100, y + h / 2], [0, y + h / 2]]));
      }
      d.union();
    },
    [int("stripes", "Stripes", 2, 8, 5), range("gap", "Gap", 0.4, 2, 1)],
  ),
  S(
    "rainbow",
    "Rainbow arches",
    "arcs concentric retro rainbow bridge",
    (p, d) => {
      const n = p.count!;
      const step = 46 / n;
      for (let i = 0; i < n; i++) d.add(arcBand(50, 74, 46 - i * step - step * p.thick!, 46 - i * step, -90, 90));
    },
    [int("count", "Arches", 2, 6, 4), range("thick", "Thickness", 0.3, 1, 0.7)],
  ),
  S(
    "octagram",
    "Overlap squares",
    "two squares rotated star eight point",
    (p, d) => d.add(roundPoly(rectPts(66, 66), p.round! * 8), rotateC(roundPoly(rectPts(66, 66), p.round! * 8), 45)).evenodd(),
    [round(0)],
  ),
  S(
    "golden-spiral",
    "Golden spiral",
    "fibonacci phi nautilus ratio swirl",
    (p, d) => {
      const b = Math.log(1.618) / (Math.PI / 2);
      const turns = 2.25;
      const pts = curvePts((t) => {
        const th = t * turns * TAU;
        const r = 1.6 * Math.exp(b * th);
        return [50 + r * Math.cos(th), 50 + r * Math.sin(th)];
      }, 160);
      d.add(stroke(pts, 9 * p.weight!, "round", { profile: (t) => 0.3 + 0.7 * t }));
    },
    [range("weight", "Weight", 0.5, 2, 1)],
  ),
  S(
    "seed-of-life",
    "Circle rosette",
    "overlapping circles flower geometry pattern",
    (p, d) => {
      const n = p.count!;
      for (let i = 0; i < n; i++) d.add(circle(...polar(50, 50, 23, (i * 360) / n), 23));
      d.evenodd();
    },
    [int("count", "Circles", 3, 12, 6)],
  ),
  S(
    "slashes",
    "Slashes",
    "parallel diagonal lines speed stripes",
    (p, d) => {
      const n = p.count!;
      const step = 70 / n;
      for (let i = 0; i < n; i++) {
        const x = 15 + step * (i + 0.5);
        const w = step * p.thick!;
        d.add(poly([[x + 12 - w / 2, 8], [x + 12 + w / 2, 8], [x - 12 + w / 2, 92], [x - 12 - w / 2, 92]]));
      }
    },
    [int("count", "Count", 2, 6, 3), range("thick", "Thickness", 0.2, 0.9, 0.55)],
  ),
  S(
    "stacked-bars",
    "Stacked bars",
    "layers stack hamburger menu levels",
    (p, d) => {
      const n = p.count!;
      const h = 88 / n;
      for (let i = 0; i < n; i++) {
        const w = 88 * (1 - i * p.taper! * 0.22);
        const y = 6 + h * i;
        d.add(roundPoly([[50 - w / 2, y + h * 0.12], [50 + w / 2, y + h * 0.12], [50 + w / 2, y + h * 0.88], [50 - w / 2, y + h * 0.88]], h * 0.38 * p.round!));
      }
    },
    [int("count", "Bars", 2, 6, 3), range("taper", "Taper", -1, 1, 0.5), round(1)],
  ),
  S(
    "hex-nut",
    "Hex nut",
    "bolt hardware tool mechanic construction",
    (p, d) => d.add(roundPoly(ngon(6, 46, 30), 3)).hole(circle(50, 50, 40 * p.hole!)),
    [range("hole", "Hole", 0.2, 0.8, 0.5)],
  ),
  S(
    "framed-dot",
    "Framed dot",
    "square circle frame focus point",
    (_, d) => {
      d.add(roundPoly(rectPts(90, 90), 14)).hole(roundPoly(rectPts(72, 72), 6));
      d.add(circle(50, 50, 20));
    },
  ),
  S(
    "s-split",
    "S-split circle",
    "balance duality two halves swirl",
    (p, d) => {
      const g = 2 * p.gap!;
      const halfL = new Pen([50, 4]).arc(50, 50, 46, 0, -180).arc(50, 73, 23, 180, 360).arc(50, 27, 23, 180, 0).close();
      d.add(halfL).hole(stroke(curvePts((t) => (t < 0.5 ? polar(50, 27, 23, 180 - t * 2 * 180) : polar(50, 73, 23, (t - 0.5) * 2 * 180)), 60), g, "butt")).union();
      d.part("right").add(rotateC(halfL, 180)).union();
    },
    [range("gap", "Gap", 0.5, 4, 1.5)],
  ),
  S(
    "swirl",
    "Swirl",
    "triple spiral spin vortex motion",
    (p, d) => {
      const arms = p.arms!;
      for (let i = 0; i < arms; i++) {
        const pts = curvePts((t) => polar(50, 50, 6 + 40 * t, (i * 360) / arms + t * 200), 40);
        d.add(stroke(pts, 10 * p.weight!, "round", { profile: (t) => 0.35 + 0.65 * t }));
      }
      d.add(circle(50, 50, 9 * p.weight!));
      d.union();
    },
    [int("arms", "Arms", 2, 6, 3), range("weight", "Weight", 0.5, 1.6, 1)],
  ),
  S(
    "wave-circle",
    "Wave circle",
    "split circle water flow divided ocean",
    (p, d) => {
      d.add(circle(50, 50, 46));
      d.hole(stroke(curvePts((t) => [0 + 100 * t, 50 + 8 * Math.sin(TAU * p.waves! * t)], 60), 4 * p.gap!, "butt"));
      d.union();
    },
    [range("waves", "Waves", 0.5, 3, 1.5, 0.5), range("gap", "Gap", 0.5, 3, 1.2)],
  ),
  S(
    "loop-triangle",
    "Rounded triangle ring",
    "recycle loop tri cycle continuous",
    (p, d) => {
      const outer = roundPoly(ngon(3, 46, 0, 50, 56), 14);
      const inner = roundPoly(ngon(3, 46 - 18 * p.thick! * 2, 0, 50, 56), Math.max(1, 14 - 9 * p.thick!));
      d.add(outer).hole(inner);
    },
    [range("thick", "Thickness", 0.2, 0.9, 0.5)],
  ),
  S(
    "half-circles",
    "Facing halves",
    "two semicircles mirror pair dialogue",
    (p, d) => {
      const g = 8 * p.gap!;
      d.add(new Pen([50 - g / 2, 6]).arc(50 - g / 2, 50, 44, 0, -180).close());
      d.add(new Pen([50 + g / 2, 94]).arc(50 + g / 2, 50, 44, 180, 0).close());
    },
    [range("gap", "Gap", 0.2, 2, 1)],
  ),
  S(
    "corner-mark",
    "Folded corner",
    "page paper document fold note",
    (p, d) => {
      const f = 30 * p.fold!;
      d.add(roundPoly([[8, 6], [92 - f, 6], [92, 6 + f], [92, 94], [8, 94]], [4, 0, 0, 4, 4]));
      d.hole(poly([[92 - f - 1, 2], [96, 2], [96, 6 + f + 1]]));
      d.part("fold").add(poly([[92 - f + 3, 6], [92 - f + 3, 6 + f - 3], [92, 6 + f - 3]]));
    },
    [range("fold", "Fold", 0.3, 1.2, 0.8)],
  ),
  S(
    "dot-arc",
    "Dot and arc",
    "smile person avatar user community",
    (_, d) => {
      d.add(circle(50, 28, 18));
      d.add(arcBand(50, 96, 26, 44, -90, 90));
    },
  ),
  S(
    "quarter-stack",
    "Quarter stack",
    "pie quarters segments chart split",
    (p, d) => {
      const g = 4 * p.gap!;
      for (let i = 0; i < 4; i++) {
        const a = i * 90;
        const c = polar(50, 50, g, a + 45);
        d.add(new Pen(c).arc(c[0], c[1], 42 - g, a, a + 90).close());
      }
      d.union();
    },
    [range("gap", "Gap", 0, 2, 1)],
  ),
];
