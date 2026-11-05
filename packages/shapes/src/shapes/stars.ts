import { circle, Pen, polar, poly, ringStroke, rng, roundPoly, sampled, starPts, stroke, TAU, type Pt } from "../geom";
import { int, maker, range, round, seed } from "./kit";

const S = maker("stars");

/** Concave star: tips joined by curves that pinch toward the centre. */
function sparkle(tips: number[], pinch: number, rot = 0) {
  const n = tips.length;
  const pen = new Pen(polar(50, 50, tips[0]!, rot));
  for (let i = 0; i < n; i++) {
    const a = rot + (360 * i) / n;
    const b = a + 360 / n;
    const r = Math.min(tips[i]!, tips[(i + 1) % n]!);
    pen.quad(polar(50, 50, r * pinch, (a + b) / 2), polar(50, 50, tips[(i + 1) % n]!, b));
  }
  return pen.close();
}

export const STARS = [
  S(
    "star",
    "Star",
    "favorite rating five point",
    (p, d) => d.add(roundPoly(starPts(p.points!, 46, 46 * p.inner!), Array.from({ length: p.points! * 2 }, (_, i) => (i % 2 ? 2 : 6) * p.round!))),
    [int("points", "Points", 3, 24, 5), range("inner", "Inner radius", 0.1, 0.95, 0.42), round(0)],
  ),
  S(
    "rounded-star",
    "Rounded star",
    "soft star cute favorite",
    (p, d) => d.add(roundPoly(starPts(p.points!, 46, 46 * p.inner!), Array.from({ length: p.points! * 2 }, (_, i) => (i % 2 ? 6 : 12) * p.round!))),
    [int("points", "Points", 3, 16, 5), range("inner", "Inner radius", 0.2, 0.9, 0.5), round(0.8)],
  ),
  S(
    "sparkle",
    "Sparkle",
    "shine twinkle glint ai magic four point",
    (p, d) => d.add(sparkle(Array(p.points!).fill(46), p.pinch!)),
    [int("points", "Points", 3, 12, 4), range("pinch", "Pinch", 0.02, 0.8, 0.18)],
  ),
  S(
    "twinkle",
    "Twinkle",
    "sparkle shine eight point glint",
    (p, d) => d.add(sparkle(Array.from({ length: 8 }, (_, i) => (i % 2 ? 46 * p.short! : 46)), p.pinch!)),
    [range("short", "Short rays", 0.2, 1, 0.55), range("pinch", "Pinch", 0.02, 0.6, 0.2)],
  ),
  S(
    "north-star",
    "North star",
    "polaris guiding star compass four point",
    (p, d) => {
      const r = [46, 46 * p.width!, 46, 46 * p.width!];
      const pts: Pt[] = [];
      r.forEach((ro, i) => {
        pts.push(polar(50, 50, ro, i * 90));
        pts.push(polar(50, 50, 7 * p.inner!, i * 90 + 45));
      });
      d.add(poly(pts));
    },
    [range("width", "Side rays", 0.3, 1, 0.6), range("inner", "Waist", 0.3, 2.5, 1)],
  ),
  S(
    "compass-rose",
    "Compass rose",
    "navigation north direction windrose nautical",
    (_, d) => {
      const pts: Pt[] = [];
      for (let i = 0; i < 16; i++) pts.push(polar(50, 50, i % 2 ? 7 : i % 4 === 0 ? 46 : 27, i * 22.5));
      d.add(poly(pts));
    },
  ),
  S(
    "burst",
    "Starburst",
    "seal sale badge explosion promo sticker",
    (p, d) => d.add(poly(starPts(p.points!, 46, 46 * (1 - p.depth!)))),
    [int("points", "Points", 8, 72, 24), range("depth", "Depth", 0.03, 0.45, 0.13)],
  ),
  S(
    "wavy-seal",
    "Wavy seal",
    "badge rosette scalloped soft burst sticker",
    (p, d) => d.add(sampled((t) => polar(50, 50, 46 * (1 - p.depth! * (0.5 - 0.5 * Math.cos(t * TAU * p.points!))), t * 360), 24 * p.points!, 0.03)),
    [int("points", "Waves", 5, 40, 12), range("depth", "Depth", 0.02, 0.3, 0.09)],
  ),
  S(
    "scalloped",
    "Scalloped circle",
    "cookie flower badge cloud edge",
    (p, d) => {
      const n = p.points!;
      const pts: Pt[] = [];
      const k = 18;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < k; j++) {
          const u = j / k;
          pts.push(polar(50, 50, 46 * (1 - p.depth! * (1 - Math.sin(Math.PI * u))), ((i + u) * 360) / n));
        }
      d.add(sampled((t) => pts[Math.floor(t * pts.length)]!, pts.length, 0.03));
    },
    [int("points", "Scallops", 5, 36, 14), range("depth", "Depth", 0.03, 0.35, 0.1)],
  ),
  S(
    "asterisk",
    "Asterisk",
    "star footnote spark snow",
    (p, d) => {
      const w = 46 * p.thick!;
      for (let i = 0; i < p.arms!; i++) d.add(stroke([polar(50, 50, 46 - w / 2, (i * 360) / p.arms!), polar(50, 50, 46 - w / 2, (i * 360) / p.arms! + 180)], w, p.ends ? "round" : "butt"));
      d.union();
    },
    [int("arms", "Arms", 2, 8, 3), range("thick", "Thickness", 0.06, 0.5, 0.22), { key: "ends", label: "Ends", type: "choice", options: ["Square", "Round"], default: 1 }],
  ),
  S(
    "pinwheel",
    "Pinwheel",
    "windmill spin rotation fan",
    (p, d) => {
      const n = p.blades!;
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n;
        d.add(poly([[50, 50], polar(50, 50, 46, a), polar(50, 50, 46 * p.size!, a + 360 / n / 1.35)]));
      }
    },
    [int("blades", "Blades", 3, 12, 4), range("size", "Blade", 0.3, 1, 0.72)],
  ),
  S(
    "sunburst",
    "Sunburst",
    "sun rays shine summer solar",
    (p, d) => {
      const n = p.rays!;
      d.add(circle(50, 50, 46 * p.core!));
      const r0 = 46 * p.core! + 5;
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n;
        const hw = (180 / n) * p.width!;
        d.add(poly([polar(50, 50, r0, a - hw), polar(50, 50, 46, a), polar(50, 50, r0, a + hw)]));
      }
    },
    [int("rays", "Rays", 5, 36, 12), range("core", "Core", 0.2, 0.7, 0.42), range("width", "Ray width", 0.2, 1, 0.6)],
  ),
  S(
    "rays",
    "Radiating rays",
    "sunbeams light beams retro burst background",
    (p, d) => {
      const n = p.rays!;
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n;
        const hw = (180 / n) * p.width!;
        d.add(poly([polar(50, 50, 46 * p.hole!, a - hw * p.hole!), polar(50, 50, 46, a - hw), polar(50, 50, 46, a + hw), polar(50, 50, 46 * p.hole!, a + hw * p.hole!)]));
      }
    },
    [int("rays", "Rays", 6, 48, 16), range("width", "Ray width", 0.1, 0.95, 0.5), range("hole", "Centre gap", 0, 0.6, 0.18)],
  ),
  S(
    "explosion",
    "Explosion",
    "boom bang comic burst pow impact",
    (p, d) => {
      const r = rng(p.seed!);
      const n = p.points! * 2;
      const pts = Array.from({ length: n }, (_, i) => polar(50, 50, i % 2 ? 22 + r() * 10 : 34 + r() * 12, (i * 360) / n + (r() - 0.5) * (120 / n)));
      d.add(poly(pts));
    },
    [int("points", "Spikes", 6, 24, 12), seed(3)],
  ),
  S(
    "star-outline",
    "Star outline",
    "hollow star line favorite",
    (p, d) => {
      const [o, i] = ringStroke(starPts(p.points!, 44, 44 * p.inner!), 44 * p.thick!);
      d.add(o).hole(i);
    },
    [int("points", "Points", 4, 12, 5), range("inner", "Inner radius", 0.3, 0.8, 0.45), range("thick", "Thickness", 0.04, 0.2, 0.1)],
  ),
  S(
    "sparkles",
    "Sparkles",
    "ai magic new shine trio glitter",
    (p, d) => {
      const one = (cx: number, cy: number, r: number) =>
        new Pen([cx, cy - r])
          .quad([cx + r * p.pinch!, cy - r * p.pinch!], [cx + r, cy])
          .quad([cx + r * p.pinch!, cy + r * p.pinch!], [cx, cy + r])
          .quad([cx - r * p.pinch!, cy + r * p.pinch!], [cx - r, cy])
          .quad([cx - r * p.pinch!, cy - r * p.pinch!], [cx, cy - r])
          .close();
      d.add(one(40, 58, 34), one(78, 22, 16), one(80, 78, 10));
    },
    [range("pinch", "Pinch", 0.05, 0.5, 0.16)],
  ),
];
