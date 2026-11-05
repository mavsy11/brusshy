import { curvePts, polar, rng, roundPoly, stroke, TAU, type Cap, type Pt } from "../geom";
import { choice, int, maker, range, seed } from "./kit";

const S = maker("lines");
const ends = (def = 0) => choice("ends", "Ends", ["Round", "Flat"], def);
const cap = (v: number | undefined): Cap => (v ? "butt" : "round");

const wavePts = (cycles: number, amp: number, y = 50, phase = 0): Pt[] => curvePts((t) => [6 + 88 * t, y - amp * Math.sin(TAU * cycles * t + phase)], Math.round(28 * cycles));

export const LINES = [
  S(
    "wave",
    "Wave",
    "water sea sine flow sound",
    (p, d) => d.add(stroke(wavePts(p.cycles!, 40 * p.amp!), 30 * p.thick!, cap(p.ends))),
    [range("cycles", "Waves", 0.5, 6, 2, 0.5), range("amp", "Height", 0.03, 0.5, 0.2), range("thick", "Thickness", 0.05, 0.6, 0.28), ends()],
  ),
  S(
    "waves",
    "Waves",
    "water sea ocean ripple stack flow",
    (p, d) => {
      const n = p.count!;
      const gap = 70 / Math.max(1, n - 1);
      for (let i = 0; i < n; i++) d.add(stroke(wavePts(p.cycles!, 9, 15 + i * gap), gap * p.thick!, cap(p.ends)));
    },
    [int("count", "Lines", 2, 6, 3), range("cycles", "Waves", 1, 6, 2.5, 0.5), range("thick", "Thickness", 0.15, 0.7, 0.42), ends()],
  ),
  S(
    "zigzag",
    "Zigzag",
    "chevron line saw tooth jagged",
    (p, d) => {
      const n = p.peaks! * 2;
      const pts = Array.from({ length: n + 1 }, (_, i) => [6 + (88 * i) / n, 50 + (i % 2 ? -1 : 1) * 40 * p.amp!] as Pt);
      d.add(stroke(pts, 28 * p.thick!, cap(p.ends)));
    },
    [int("peaks", "Peaks", 1, 12, 4), range("amp", "Height", 0.05, 0.5, 0.22), range("thick", "Thickness", 0.05, 0.6, 0.3), ends()],
  ),
  S(
    "scallop-line",
    "Scallop line",
    "arches bumps border edge trim",
    (p, d) => d.add(stroke(curvePts((t) => [6 + 88 * t, 58 - 22 * p.amp! * Math.abs(Math.sin(Math.PI * p.count! * t))], 40 * p.count!), 20 * p.thick!, "round")),
    [int("count", "Bumps", 2, 10, 4), range("amp", "Height", 0.2, 1.5, 0.8), range("thick", "Thickness", 0.1, 0.6, 0.3)],
  ),
  S(
    "squiggle",
    "Squiggle",
    "loops scribble curly playful doodle",
    (p, d) => {
      const n = p.loops!;
      const a = 88 / (n * TAU);
      const b = a * p.size!;
      const pts = curvePts((t) => {
        const th = t * n * TAU;
        return [6 + b + a * th - b * Math.sin(th), 50 - b * Math.cos(th)];
      }, 50 * n);
      d.add(stroke(pts, 4 + 8 * p.thick!, "round")).union();
    },
    [int("loops", "Loops", 1, 8, 4), range("size", "Loop size", 1.2, 3, 2.2), range("thick", "Thickness", 0, 1, 0.4)],
  ),
  S(
    "spiral",
    "Spiral",
    "swirl coil vortex hypnotic snail",
    (p, d) => {
      const turns = p.turns!;
      const space = 44 / (turns + 0.5);
      const w = space * p.thick!;
      const r0 = w / 2 + space * 0.5;
      const pts = curvePts((t) => polar(50, 50, r0 + (46 - w / 2 - r0) * t, t * turns * 360), Math.round(70 * turns));
      d.add(stroke(pts, w, "round"));
    },
    [range("turns", "Turns", 1, 6, 3, 0.25), range("thick", "Thickness", 0.15, 0.8, 0.5)],
  ),
  S(
    "infinity",
    "Infinity",
    "forever endless loop eternal lemniscate",
    (p, d) => {
      const pts = curvePts((u) => {
        const t = u * (TAU + 0.3);
        const s = 1 + Math.sin(t) ** 2;
        return [50 + (44 * Math.cos(t)) / s, 50 + (44 * Math.sin(t) * Math.cos(t)) / s];
      }, 220);
      d.add(stroke(pts, 4 + 14 * p.thick!, "butt")).union();
    },
    [range("thick", "Thickness", 0, 1, 0.45)],
  ),
  S(
    "sound-bars",
    "Sound bars",
    "equalizer audio podcast music waveform voice",
    (p, d) => {
      const n = p.bars!;
      const r = rng(p.seed!);
      const step = 88 / n;
      const w = step * p.width!;
      for (let i = 0; i < n; i++) {
        const h = 14 + 76 * (0.3 + 0.7 * Math.abs(Math.sin(((i + 0.5) / n) * Math.PI)) * (0.55 + 0.45 * r()));
        const x = 6 + step * (i + 0.5);
        d.add(roundPoly([[x - w / 2, 50 - h / 2], [x + w / 2, 50 - h / 2], [x + w / 2, 50 + h / 2], [x - w / 2, 50 + h / 2]], w / 2));
      }
    },
    [int("bars", "Bars", 3, 15, 7), range("width", "Bar width", 0.2, 0.9, 0.55), seed(3)],
  ),
  S(
    "swoosh",
    "Swoosh",
    "swish tick motion curve dynamic speed",
    (p, d) =>
      d.add(
        stroke(
          curvePts((t) => polar(50, 6, 58, 222 - t * 118), 60),
          26 * p.thick!,
          "round",
          { profile: (t) => Math.max(0.04, Math.sin(Math.PI * t ** 0.75) ** 1.3) },
        ),
      ),
    [range("thick", "Thickness", 0.3, 1, 0.6)],
  ),
  S(
    "brush-stroke",
    "Brush stroke",
    "paint swipe highlight marker tapered",
    (p, d) => {
      const r = rng(p.seed!);
      const a = r() * 6;
      d.add(
        stroke(
          curvePts((t) => [6 + 88 * t, 50 + Math.sin(t * Math.PI * 1.3 + a) * 4], 40),
          30 * p.thick!,
          "round",
          { profile: (t) => 0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.45 },
        ),
      );
    },
    [range("thick", "Thickness", 0.2, 1, 0.6), seed(1)],
  ),
  S(
    "swash",
    "Swash",
    "underline flourish calligraphy tail elegant",
    (p, d) =>
      d.add(
        stroke(
          curvePts((t) => [6 + 88 * t, 52 + 12 * Math.sin(TAU * t * 0.9 + 0.6) * (1 - t * 0.5)], 70),
          12 * p.thick!,
          "round",
          { profile: (t) => 0.12 + 0.88 * Math.sin(Math.PI * t) ** 0.8 },
        ),
      ),
    [range("thick", "Thickness", 0.3, 1.5, 0.8)],
  ),
  S(
    "speed-lines",
    "Speed lines",
    "motion fast delivery dash movement",
    (p, d) => {
      const n = p.count!;
      const h = 70 / n;
      for (let i = 0; i < n; i++) {
        const y = 15 + h * (i + 0.5);
        const len = 88 * (1 - (Math.abs(i - (n - 1) / 2) / n) * 1.2 * p.taper!);
        const t = h * p.thick!;
        d.add(roundPoly([[94 - len, y - t / 2], [94, y - t / 2], [94, y + t / 2], [94 - len, y + t / 2]], t / 2));
      }
    },
    [int("count", "Lines", 2, 6, 3), range("thick", "Thickness", 0.2, 0.9, 0.55), range("taper", "Stagger", 0, 1, 0.6)],
  ),
  S(
    "helix",
    "Double helix",
    "dna biotech genetics science twist",
    (p, d) => {
      const c = p.turns!;
      const A = 20;
      const w = 6.5;
      const strand = (ph: number) => curvePts((t) => [50 + A * Math.sin(TAU * c * t + ph), 6 + 88 * t], Math.round(60 * c));
      d.add(stroke(strand(0), w, "round"), stroke(strand(Math.PI), w, "round"));
      const rungs = Math.round(c * 4);
      for (let k = 0; k < rungs; k++) {
        const t = (k + 0.5) / rungs;
        const x = A * Math.sin(TAU * c * t);
        if (Math.abs(x) < 7) continue;
        d.add(stroke([[50 - Math.abs(x), 6 + 88 * t], [50 + Math.abs(x), 6 + 88 * t]], 3.4, "round"));
      }
      d.union();
    },
    [range("turns", "Turns", 1, 3, 1.5, 0.5)],
  ),
  S(
    "s-curve",
    "S curve",
    "snake flow ess serpentine",
    (p, d) => {
      const r = 22;
      const pts = [...curvePts((t) => polar(50, 28, r, 90 - t * 270), 40), ...curvePts((t) => polar(50, 72, r, 0 + t * 270), 40).slice(1)];
      d.add(stroke(pts, 30 * p.thick!, cap(p.ends)));
    },
    [range("thick", "Thickness", 0.15, 0.7, 0.42), ends(1)],
  ),
];
