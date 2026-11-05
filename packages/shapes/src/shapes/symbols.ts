import { arcBand, arcSegs, circle, close, ellipse, moveC, ngon, Pen, polar, poly, rad, rotateC, roundPoly, scaleC, starPts, stroke, type Contour, type Pt } from "../geom";
import { int, maker, range, round } from "./kit";
import { drop, heart } from "./organic";

const S = maker("symbols");

export const SYMBOLS = [
  S(
    "bolt",
    "Lightning bolt",
    "flash energy power electric thunder fast charge",
    (p, d) => d.add(roundPoly([[60, 4], [18, 56], [46, 56], [38, 96], [82, 40], [54, 40]], p.round! * 4)),
    [round(0.15)],
  ),
  S(
    "bolt-slim",
    "Slim bolt",
    "lightning flash spark electric zap",
    (p, d) => d.add(roundPoly([[56, 2], [24, 54], [46, 54], [34, 98], [76, 42], [54, 42], [70, 2]], p.round! * 3)),
    [round(0.1)],
  ),
  S("play", "Play", "start video media go triangle music", (p, d) => d.add(roundPoly([[18, 8], [90, 50], [18, 92]], p.round! * 14)), [round(0.35)]),
  S(
    "pause",
    "Pause",
    "hold break media stop bars",
    (p, d) => d.add(roundPoly([[14, 8], [40, 8], [40, 92], [14, 92]], p.round! * 13), roundPoly([[60, 8], [86, 8], [86, 92], [60, 92]], p.round! * 13)),
    [round(0.3)],
  ),
  S("stop", "Stop", "square media end halt", (p, d) => d.add(roundPoly([[10, 10], [90, 10], [90, 90], [10, 90]], p.round! * 20)), [round(0.3)]),
  S(
    "record",
    "Record",
    "rec live dot recording broadcast",
    (_, d) => {
      d.add(circle(50, 50, 46)).hole(circle(50, 50, 38));
      d.add(circle(50, 50, 28));
    },
  ),
  S(
    "fast-forward",
    "Fast forward",
    "skip next speed media",
    (p, d) => d.add(roundPoly([[6, 18], [50, 50], [6, 82]], p.round! * 8), roundPoly([[48, 18], [92, 50], [48, 82]], p.round! * 8)),
    [round(0.3)],
  ),
  S(
    "eject",
    "Eject",
    "media open up triangle bar",
    (p, d) => d.add(roundPoly([[50, 8], [92, 62], [8, 62]], p.round! * 8), roundPoly([[8, 74], [92, 74], [92, 92], [8, 92]], p.round! * 6)),
    [round(0.3)],
  ),
  S(
    "camera",
    "Camera",
    "photo photography snapshot picture",
    (_, d) => {
      d.add(roundPoly([[4, 24], [96, 24], [96, 88], [4, 88]], 10), roundPoly([[32, 12], [68, 12], [74, 26], [26, 26]], 4));
      d.hole(circle(50, 56, 23), circle(82, 38, 4));
      d.union();
      d.part("lens").add(circle(50, 56, 15));
    },
  ),
  S(
    "aperture",
    "Aperture",
    "lens shutter camera iris photography",
    (p, d) => {
      const n = p.blades!;
      const r = 16;
      const v = ngon(n, r, 0);
      d.add(circle(50, 50, 46));
      d.hole(poly(v));
      for (let i = 0; i < n; i++) {
        const a = v[i]!;
        const b = v[(i + 1) % n]!;
        const dir: Pt = [(b[0] - a[0]) / r, (b[1] - a[1]) / r];
        d.hole(stroke([a, [a[0] - dir[0] * 60, a[1] - dir[1] * 60]], 3.2 * p.gap!, "butt"));
      }
      d.union();
    },
    [int("blades", "Blades", 5, 10, 6), range("gap", "Gap", 0.4, 2, 1)],
  ),
  S(
    "globe",
    "Globe",
    "world earth planet international web global",
    (p, d) => {
      const t = 5.5 * p.weight!;
      d.ring(circle(50, 50, 46), circle(50, 50, 46 - t));
      d.ring(ellipse(50, 50, 20, 46), ellipse(50, 50, 20 - t, 46 - t * 0.6));
      d.add(stroke([[4, 50], [96, 50]], t, "butt"));
      d.add(stroke([[10, 28], [90, 28]], t, "butt"), stroke([[10, 72], [90, 72]], t, "butt"));
      d.clipTo(circle(50, 50, 46));
    },
    [range("weight", "Weight", 0.6, 1.8, 1)],
  ),
  S(
    "eye",
    "Eye",
    "vision see view watch look optic",
    (_, d) => {
      d.add(new Pen([4, 50]).curve([22, 22], [78, 22], [96, 50]).curve([78, 78], [22, 78], [4, 50]).close());
      d.hole(circle(50, 50, 21));
      d.part("pupil").add(circle(50, 50, 14)).hole(circle(56, 44, 4.5));
    },
  ),
  S(
    "pin",
    "Location pin",
    "map marker place gps address",
    (_, d) => {
      d.add(rotateC(drop(40, 50, 62, 34), 180, 50, 50));
      d.hole(circle(50, 38, 13));
    },
  ),
  S(
    "house",
    "House",
    "home real estate building property",
    (_, d) => {
      d.add(roundPoly([[50, 6], [94, 44], [84, 44], [84, 94], [16, 94], [16, 44], [6, 44]], [3, 3, 0, 3, 3, 0, 3]));
      d.hole(roundPoly([[40, 62], [60, 62], [60, 94], [40, 94]], [4, 4, 0, 0]));
      d.union();
    },
  ),
  S(
    "key",
    "Key",
    "access unlock password security door",
    (_, d) => {
      d.add(circle(28, 50, 22)).hole(circle(28, 50, 9));
      d.add(poly([[44, 44], [96, 44], [96, 56], [44, 56]]), poly([[72, 56], [80, 56], [80, 70], [72, 70]]), poly([[86, 56], [94, 56], [94, 66], [86, 66]]));
      d.union();
    },
  ),
  S(
    "lock",
    "Padlock",
    "secure private security locked safe",
    (_, d) => {
      d.add(arcBand(50, 40, 18, 28, -90, 90), poly([[22, 40], [32, 40], [32, 48], [22, 48]]), poly([[68, 40], [78, 40], [78, 48], [68, 48]]));
      d.add(roundPoly([[12, 44], [88, 44], [88, 96], [12, 96]], 8));
      d.hole(circle(50, 64, 7), poly([[47, 66], [53, 66], [55, 82], [45, 82]]));
      d.union();
    },
  ),
  S(
    "magnifier",
    "Magnifier",
    "search zoom find lens explore",
    (p, d) => {
      d.add(circle(40, 40, 34)).hole(circle(40, 40, 34 - 10 * p.weight!));
      d.add(stroke([polar(40, 40, 30, 135), polar(40, 40, 76, 135)], 14 * p.weight!, "round"));
      d.union();
    },
    [range("weight", "Weight", 0.6, 1.6, 1)],
  ),
  S(
    "gear",
    "Gear",
    "cog settings engineering mechanical industry",
    (p, d) => {
      const n = p.teeth!;
      const pitch = 360 / n;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * pitch;
        pts.push(polar(50, 50, 36, a - pitch * 0.32), polar(50, 50, 46, a - pitch * 0.2), polar(50, 50, 46, a + pitch * 0.2), polar(50, 50, 36, a + pitch * 0.32));
      }
      d.add(roundPoly(pts, 1.2)).hole(circle(50, 50, 46 * p.hole!));
    },
    [int("teeth", "Teeth", 6, 24, 10), range("hole", "Hole", 0, 0.65, 0.34)],
  ),
  S(
    "atom",
    "Atom",
    "science physics nuclear molecule tech research",
    (_, d) => {
      for (const a of [0, 60, 120]) d.ring(ellipse(50, 50, 46, 17, a), ellipse(50, 50, 41, 12.5, a));
      d.add(circle(50, 50, 8));
      d.union();
    },
  ),
  S(
    "crown",
    "Crown",
    "king queen royal premium luxury vip",
    (p, d) => {
      const h = 32 * p.peaks!;
      d.add(roundPoly([[8, 30], [30, 30 + h * 0.75], [50, 18], [70, 30 + h * 0.75], [92, 30], [84, 80], [16, 80]], [0, 2, 0, 2, 0, 2, 2]));
      d.add(circle(8, 26, 6), circle(50, 13, 6), circle(92, 26, 6));
      d.add(roundPoly([[16, 85], [84, 85], [84, 94], [16, 94]], 2));
      d.union();
    },
    [range("peaks", "Dip", 0.4, 1.2, 0.85)],
  ),
  S(
    "mountains",
    "Mountains",
    "peak summit outdoor hiking alpine adventure",
    (_, d) => {
      d.add(roundPoly([[34, 18], [70, 86], [-2, 86]], 2), roundPoly([[68, 38], [100, 86], [36, 86]], 2));
      d.union();
    },
  ),
  S(
    "peak",
    "Snow peak",
    "mountain summit snowcap alpine ski",
    (_, d) => {
      d.add(roundPoly([[50, 8], [96, 90], [4, 90]], 2));
      d.hole(stroke([[23, 46], [36, 54], [50, 42], [64, 54], [77, 46]], 5, "butt"));
      d.union();
    },
  ),
  S(
    "sun",
    "Sun",
    "sunny summer solar day bright weather",
    (p, d) => {
      const n = p.rays!;
      d.add(circle(50, 50, 22));
      for (let i = 0; i < n; i++) d.add(stroke([polar(50, 50, 32, (i * 360) / n), polar(50, 50, 44, (i * 360) / n)], 8, "round"));
    },
    [int("rays", "Rays", 5, 16, 8)],
  ),
  S(
    "sunrise",
    "Sunrise",
    "sunset horizon dawn morning beach",
    (p, d) => {
      const n = p.rays!;
      d.add(new Pen(polar(50, 66, 24, 270)).arc(50, 66, 24, 270, 450).close());
      for (let i = 0; i < n; i++) {
        const a = -90 + (180 * (i + 0.5)) / n;
        d.add(stroke([polar(50, 66, 32, a), polar(50, 66, 44, a)], 7, "round"));
      }
      d.add(roundPoly([[4, 72], [96, 72], [96, 80], [4, 80]], 4));
    },
    [int("rays", "Rays", 3, 9, 5)],
  ),
  S(
    "snowflake",
    "Snowflake",
    "winter snow cold frozen ice christmas",
    (_, d) => {
      for (let i = 0; i < 6; i++) {
        const a = i * 60;
        d.add(stroke([[50, 50], polar(50, 50, 44, a)], 6.5, "round"));
        const m = polar(50, 50, 28, a);
        d.add(stroke([polar(m[0], m[1], 13, a - 45), m, polar(m[0], m[1], 13, a + 45)], 6, "round"));
      }
      d.union();
    },
  ),
  S(
    "heart-circle",
    "Heart in circle",
    "love like favorite badge",
    (_, d) => {
      d.add(circle(50, 50, 46));
      d.hole(moveC(scaleC(heart(), 0.52), 0, 2));
    },
  ),
  S(
    "check-circle",
    "Check in circle",
    "done success approved verified ok",
    (_, d) => {
      d.add(circle(50, 50, 46));
      d.hole(stroke([[28, 52], [43, 67], [72, 36]], 10, "round"));
      d.union();
    },
  ),
  S(
    "plus-circle",
    "Plus in circle",
    "add new create medical",
    (_, d) => {
      d.add(circle(50, 50, 46));
      d.hole(stroke([[50, 27], [50, 73]], 10, "round"), stroke([[27, 50], [73, 50]], 10, "round"));
      d.union();
    },
  ),
  S(
    "puzzle",
    "Puzzle piece",
    "jigsaw solution fit integration plugin",
    (_, d) => {
      d.add(poly([[14, 22], [80, 22], [80, 88], [14, 88]]));
      d.add(circle(47, 14, 11), circle(88, 55, 11));
      d.hole(circle(14, 55, 10), circle(47, 88, 10));
      d.union();
    },
  ),
  S(
    "gem",
    "Gem",
    "diamond jewel crystal luxury precious",
    (_, d) => {
      const outline: Pt[] = [[26, 14], [74, 14], [94, 38], [50, 90], [6, 38]];
      d.add(roundPoly(outline, 1.5));
      const g = 3;
      d.hole(stroke([[6, 38], [94, 38]], g, "butt"));
      d.hole(stroke([[38, 14], [30, 38], [50, 90]], g, "butt"), stroke([[62, 14], [70, 38], [50, 90]], g, "butt"));
      d.hole(stroke([[50, 14.5], [30, 38]], g, "butt"), stroke([[50, 14.5], [70, 38]], g, "butt"));
      d.union();
    },
  ),
  S(
    "cube",
    "Isometric cube",
    "box 3d block package blockchain",
    (p, d) => {
      const r = 44;
      const hex = ngon(6, r, 0, 50, 50);
      d.add(poly(hex));
      const g = 3.5 * p.gap!;
      d.hole(stroke([[50, 50], [50, 96]], g, "butt"), stroke([[50, 50], hex[5]!], g, "butt"), stroke([[50, 50], hex[1]!], g, "butt"));
      d.union();
    },
    [range("gap", "Gap", 0.4, 2.5, 1)],
  ),
  S(
    "planet",
    "Planet",
    "saturn space ring astronomy orbit",
    (_, d) => {
      const tilt = -18;
      const k = 0.28;
      d.add(circle(50, 50, 26)).hole(halfBand(49, 28, k, tilt)).union();
      d.part("ring").ring(ellipse(50, 50, 46, 46 * k, tilt), ellipse(50, 50, 31, 31 * k, tilt));
      d.hole(new Pen(polar(50, 50, 26.5, 270 + tilt)).arc(50, 50, 26.5, 270 + tilt, 450 + tilt).close()).union();
    },
  ),
  S(
    "anchor",
    "Anchor",
    "nautical marine sea boat port navy",
    (_, d) => {
      d.add(circle(50, 14, 10)).hole(circle(50, 14, 5));
      d.add(stroke([[50, 24], [50, 90]], 8, "butt"));
      d.add(stroke([[30, 36], [70, 36]], 8, "round"));
      d.add(arcBand(50, 52, 34, 42, 112, 248));
      d.add(poly([[6, 62], [22, 54], [14, 72]]), poly([[94, 62], [78, 54], [86, 72]]));
      d.union();
    },
  ),
  S(
    "clock",
    "Clock",
    "time hour watch schedule deadline",
    (_, d) => {
      d.ring(circle(50, 50, 46), circle(50, 50, 39));
      d.add(stroke([[50, 50], [50, 24]], 7, "round"), stroke([[50, 50], [68, 60]], 7, "round"));
      d.union();
    },
  ),
  S(
    "hourglass",
    "Hourglass",
    "time sand wait timer patience",
    (_, d) => {
      d.add(roundPoly([[14, 6], [86, 6], [86, 14], [14, 14]], 2), roundPoly([[14, 86], [86, 86], [86, 94], [14, 94]], 2));
      d.add(roundPoly([[22, 14], [78, 14], [56, 50], [78, 86], [22, 86], [44, 50]], 3));
      d.union();
    },
  ),
  S(
    "signal",
    "Signal",
    "wifi wireless broadcast connection radio",
    (_, d) => {
      d.add(circle(50, 82, 7));
      for (let i = 0; i < 3; i++) d.add(arcBand(50, 82, 18 + i * 17, 26 + i * 17, -45, 45, true));
    },
  ),
  S(
    "power",
    "Power",
    "on off button start energy switch",
    (_, d) => {
      d.add(arcBand(50, 54, 30, 40, 35, 325, true));
      d.add(stroke([[50, 8], [50, 44]], 10, "round"));
      d.union();
    },
  ),
  S(
    "music-note",
    "Music note",
    "song audio melody sound tune",
    (_, d) => {
      d.add(ellipse(30, 78, 16, 12, -20));
      d.add(poly([[40, 76], [46, 76], [46, 8], [40, 8]]));
      d.add(new Pen([46, 8]).curve([56, 22], [80, 22], [76, 50]).curve([74, 36], [60, 32], [46, 30]).close());
      d.union();
    },
  ),
  S(
    "bulb",
    "Light bulb",
    "idea innovation bright think creative",
    (_, d) => {
      d.add(new Pen([34, 62]).curve([22, 52], [16, 42], [16, 34]).arc(50, 34, 34, 270, 450).curve([84, 42], [78, 52], [66, 62]).line([66, 70], [34, 70]).close());
      d.add(roundPoly([[34, 76], [66, 76], [66, 83], [34, 83]], 3), roundPoly([[40, 88], [60, 88], [60, 95], [40, 95]], 3));
      d.union();
    },
  ),
  S(
    "star-circle",
    "Star in circle",
    "rating badge favorite award",
    (_, d) => {
      d.add(circle(50, 50, 46)).hole(poly(starPts(5, 30, 12.5, 0, 50, 52)));
    },
  ),
];

/** Lower half of an elliptic band (the part of a planet's ring that passes in front). */
function halfBand(R: number, r: number, k: number, tiltDeg: number): Contour {
  const rot = rad(tiltDeg);
  const outer = arcSegs(50, 50, R, R * k, 0, Math.PI, rot);
  const inner = arcSegs(50, 50, r, r * k, Math.PI, 0, rot);
  const start: Pt = [50 + R * Math.cos(rot), 50 + R * Math.sin(rot)];
  const innerStart: Pt = [50 - r * Math.cos(rot), 50 - r * Math.sin(rot)];
  return close({ start, segs: [...outer, { p: innerStart }, ...inner] });
}
