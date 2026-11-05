import { arcBand, curvePts, ellipse, Pen, polar, poly, roundPoly, stroke, type Pt } from "../geom";
import { choice, maker, range } from "./kit";

const S = maker("letterforms");
const ends = choice("ends", "Ends", ["Flat", "Round"]);
const W = (p: Record<string, number>) => 60 * p.weight!;
const weight = (def = 0.32) => range("weight", "Weight", 0.08, 0.7, def);

/** Bar from a to b with the given width (flat or round ends). */
const bar = (a: Pt, b: Pt, w: number, round: number | undefined) => stroke([a, b], w, round ? "round" : "butt");

export const LETTERFORMS = [
  S("stem", "Stem", "vertical bar i l letter stroke pillar", (p, d) => d.add(bar([50, 6 + (p.ends ? W(p) / 2 : 0)], [50, 94 - (p.ends ? W(p) / 2 : 0)], W(p), p.ends)), [weight(0.3), ends]),
  S("crossbar", "Crossbar", "horizontal bar dash hyphen rule minus", (p, d) => d.add(bar([6 + (p.ends ? W(p) / 2 : 0), 50], [94 - (p.ends ? W(p) / 2 : 0), 50], W(p), p.ends)), [weight(0.3), ends]),
  S(
    "diagonal",
    "Diagonal bar",
    "slash stroke oblique v leg",
    (p, d) => {
      const s = 30 * p.slant!;
      d.add(poly([[50 + s - W(p) / 2, 6], [50 + s + W(p) / 2, 6], [50 - s + W(p) / 2, 94], [50 - s - W(p) / 2, 94]]));
    },
    [weight(0.3), range("slant", "Slant", 0.1, 1.2, 0.6)],
  ),
  S(
    "bowl",
    "Bowl",
    "d b p letter counter half round",
    (p, d) => {
      const t = W(p);
      d.add(new Pen([20, 6]).line([50, 6]).arc(50, 50, 44, 0, 180).line([20, 94]).close());
      d.hole(new Pen([20 + t, 6 + t * 0.85]).line([50, 6 + t * 0.85]).arc(50, 50, 44 - t * 0.85, 0, 180, 44 - t * 0.85).line([20 + t, 94 - t * 0.85]).close());
    },
    [weight(0.28)],
  ),
  S(
    "open-bowl",
    "Open bowl",
    "c letter curve aperture horseshoe",
    (p, d) => d.add(arcBand(50, 50, 46 - W(p) * 0.8, 46, 90 + 40 * p.aperture!, 450 - 40 * p.aperture!, !!p.ends)),
    [weight(0.32), range("aperture", "Aperture", 0.2, 1.5, 0.9), ends],
  ),
  S(
    "o-ring",
    "O ring",
    "letter o counter contrast stress oval",
    (p, d) => {
      const t = W(p) * 0.7;
      d.add(ellipse(50, 50, 40, 46)).hole(ellipse(50, 50, 40 - t, 46 - t * p.contrast!, p.stress!));
    },
    [weight(0.3), range("contrast", "Contrast", 0.2, 1, 0.45), range("stress", "Stress", -30, 30, -12, 1)],
  ),
  S(
    "arch-n",
    "Arch",
    "n letter hump bridge",
    (p, d) => {
      const t = W(p);
      const r = 40;
      d.add(new Pen([10, 94]).line([10, 50]).arc(50, 50, r, 270, 450).line([90, 94], [90 - t, 94], [90 - t, 50]).arc(50, 50, r - t, 90, -90).line([10 + t, 94]).close());
    },
    [weight(0.28)],
  ),
  S(
    "cup-u",
    "Cup",
    "u letter bowl valley",
    (p, d) => {
      const t = W(p);
      const r = 40;
      d.add(new Pen([90, 6]).line([90, 50]).arc(50, 50, r, 90, 270).line([10, 6], [10 + t, 6], [10 + t, 50]).arc(50, 50, r - t, 270, 90).line([90 - t, 6]).close());
    },
    [weight(0.28)],
  ),
  S(
    "hook",
    "Hook",
    "j letter fishing tail cane",
    (p, d) => {
      const t = W(p);
      const pts: Pt[] = [[64, 6], [64, 62], ...curvePts((u) => polar(42, 62, 22, 90 + u * 150), 30).slice(1)];
      d.add(stroke(pts, t, p.ends ? "round" : "butt"));
    },
    [weight(0.3), ends],
  ),
  S(
    "corner-l",
    "Corner",
    "l letter angle elbow bracket",
    (p, d) => {
      const t = W(p);
      d.add(poly([[14, 6], [14 + t, 6], [14 + t, 94 - t], [86, 94 - t], [86, 94], [14, 94]]));
    },
    [weight(0.3)],
  ),
  S(
    "t-junction",
    "T junction",
    "t letter cross bar",
    (p, d) => {
      const t = W(p);
      d.add(poly([[6, 6], [94, 6], [94, 6 + t], [50 + t / 2, 6 + t], [50 + t / 2, 94], [50 - t / 2, 94], [50 - t / 2, 6 + t], [6, 6 + t]]));
    },
    [weight(0.3)],
  ),
  S(
    "y-fork",
    "Fork",
    "y letter branch split junction",
    (p, d) => {
      const t = W(p) * 0.8;
      d.add(bar([16, 6], [50, 52], t, 0), bar([84, 6], [50, 52], t, 0), bar([50, 46], [50, 94], t, 0));
      d.union();
    },
    [weight(0.32)],
  ),
  S(
    "check",
    "Check mark",
    "tick done ok yes correct approved",
    (p, d) => d.add(stroke([[10, 54], [38, 82], [90, 22]], W(p) * 0.7, p.ends ? "round" : "butt")),
    [weight(0.3), choice("ends", "Ends", ["Flat", "Round"], 1)],
  ),
  S(
    "x-cross",
    "X mark",
    "close cancel times multiply cross",
    (p, d) => {
      const w = W(p) * 0.7;
      const o = p.ends ? w / 2 : 0;
      d.add(bar([10 + o, 10 + o], [90 - o, 90 - o], w, p.ends), bar([90 - o, 10 + o], [10 + o, 90 - o], w, p.ends));
      d.union();
    },
    [weight(0.3), choice("ends", "Ends", ["Flat", "Round"], 1)],
  ),
  S(
    "slab",
    "Slab serif stem",
    "serif letter i foot classic",
    (p, d) => {
      const t = W(p);
      const s = 18 * p.serif!;
      d.add(roundPoly([[50 - t / 2 - s, 6], [50 + t / 2 + s, 6], [50 + t / 2 + s, 16], [50 + t / 2, 16], [50 + t / 2, 84], [50 + t / 2 + s, 84], [50 + t / 2 + s, 94], [50 - t / 2 - s, 94], [50 - t / 2 - s, 84], [50 - t / 2, 84], [50 - t / 2, 16], [50 - t / 2 - s, 16]], [0, 0, 0, 4 * p.bracket!, 4 * p.bracket!, 0, 0, 0, 0, 4 * p.bracket!, 4 * p.bracket!, 0]));
    },
    [weight(0.24), range("serif", "Serif", 0.2, 1.5, 1), range("bracket", "Bracket", 0, 1.5, 0.8)],
  ),
  S(
    "tittle",
    "Ball terminal",
    "teardrop terminal drop comma accent hook",
    (p, d) => {
      const t = 18 * p.weight! * 2;
      d.add(stroke(curvePts((u) => polar(30, 60, 30, 20 + u * 110), 30), t * 0.5, "round", { profile: (u) => 0.4 + 0.6 * u }));
      d.add(ellipse(...polar(30, 60, 30, 130), t * 0.9, t * 0.9));
      d.union();
    },
    [weight(0.3)],
  ),
];
