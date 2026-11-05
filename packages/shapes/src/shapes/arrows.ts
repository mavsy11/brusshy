import { arcBand, circle, curvePts, poly, polar, rotateC, roundPoly, stroke, type Contour, type Pt } from "../geom";
import { choice, int, maker, range, round } from "./kit";

const S = maker("arrows");

/** Classic block arrow pointing right. */
function blockArrow(shaft: number, headLen: number, headW: number, r: number, double = false): Contour {
  const y0 = 50 - shaft / 2;
  const y1 = 50 + shaft / 2;
  const hx = 95 - headLen;
  const pts: Pt[] = double
    ? [[5, 50], [5 + headLen, 50 - headW / 2], [5 + headLen, y0], [hx, y0], [hx, 50 - headW / 2], [95, 50], [hx, 50 + headW / 2], [hx, y1], [5 + headLen, y1], [5 + headLen, 50 + headW / 2]]
    : [[5, y0], [hx, y0], [hx, 50 - headW / 2], [95, 50], [hx, 50 + headW / 2], [hx, y1], [5, y1]];
  return roundPoly(pts, r);
}

/** Open (line) arrowhead at `tip` pointing along `dir` degrees (compass). */
const lineHead = (tip: Pt, deg: number, size: number, w: number, c: "round" | "butt" = "round") => stroke([polar(tip[0], tip[1], size, deg + 180 - 42), tip, polar(tip[0], tip[1], size, deg + 180 + 42)], w, c);

/** Solid triangular head at `tip` pointing along `deg`. */
const triHead = (tip: Pt, deg: number, len: number, w: number) => poly([tip, polar(tip[0], tip[1], Math.hypot(len, w / 2), deg + 180 - (Math.atan2(w / 2, len) * 180) / Math.PI), polar(tip[0], tip[1], Math.hypot(len, w / 2), deg + 180 + (Math.atan2(w / 2, len) * 180) / Math.PI)]);

const headStyle = choice("head", "Head", ["Solid", "Line"]);

/** Arrowhead at the end of a clockwise arc: where the shaft stops, and the solid head. */
function arcHead(cx: number, cy: number, r: number, end: number, len: number, solid: boolean) {
  const span = (len / r) * (180 / Math.PI);
  const stop = solid ? end - span + 4 : end;
  return { stop, solid: (w: number) => triHead(polar(cx, cy, r, end), end - span / 2 + 90, len, w) };
}

export const ARROWS = [
  S(
    "arrow",
    "Arrow",
    "right next forward direction pointer",
    (p, d) => d.add(blockArrow(60 * p.shaft!, 40 * p.head!, 80 * p.width!, p.round! * 6)),
    [range("shaft", "Shaft", 0.08, 0.8, 0.3), range("head", "Head length", 0.3, 1.2, 0.85), range("width", "Head width", 0.3, 1.1, 0.85), round(0.1)],
  ),
  S(
    "block-arrow",
    "Block arrow",
    "fat bold right chunky",
    (p, d) => d.add(blockArrow(46, 34, 82, p.round! * 8)),
    [round(0.35)],
  ),
  S("double-arrow", "Double arrow", "both ways swap exchange left right", (p, d) => d.add(blockArrow(60 * p.shaft!, 30, 70, p.round! * 6, true)), [range("shaft", "Shaft", 0.1, 0.7, 0.3), round(0.1)]),
  S(
    "line-arrow",
    "Line arrow",
    "thin stroke right next simple",
    (p, d) => {
      const w = 22 * p.thick!;
      d.add(stroke([[6, 50], [93, 50]], w, "round"), lineHead([93, 50], 90, 30, w));
      d.union();
    },
    [range("thick", "Thickness", 0.1, 1, 0.38)],
  ),
  S(
    "arrow-up-right",
    "Diagonal arrow",
    "up right external link growth outward",
    (p, d) => {
      const w = 22 * p.thick!;
      d.add(stroke([[14, 86], [84, 16]], w, "round"));
      d.add(stroke([[34, 16], [84, 16], [84, 66]], w, "round"));
      d.union();
    },
    [range("thick", "Thickness", 0.1, 1, 0.45)],
  ),
  S(
    "curved-arrow",
    "Curved arrow",
    "bend turn redirect forward share",
    (p, d) => {
      const w = 20 * p.thick!;
      const a0 = -70;
      const a1 = a0 + p.bend!;
      const head = arcHead(50, 80, 42, a1, 26, !p.head);
      d.add(stroke(curvePts((t) => polar(50, 80, 42, a0 + t * (head.stop - a0)), 50), w, p.head ? "round" : "butt"));
      d.add(p.head ? lineHead(polar(50, 80, 42, a1), a1 + 90, 22, w) : head.solid(w * 2.8));
      d.union();
    },
    [range("thick", "Thickness", 0.15, 1, 0.5), range("bend", "Bend", 60, 200, 120, 1), headStyle],
  ),
  S(
    "circle-arrow",
    "Circular arrow",
    "refresh reload repeat cycle sync loop rotate",
    (p, d) => {
      const w = 18 * p.thick!;
      const end = 20 + p.sweep!;
      const head = arcHead(50, 50, 38, end, 22, !p.head);
      d.add(arcBand(50, 50, 38 - w / 2, 38 + w / 2, 20, head.stop, true));
      d.add(p.head ? lineHead(polar(50, 50, 38, end), end + 90, 18, w) : head.solid(w * 2.8));
      d.union();
    },
    [range("thick", "Thickness", 0.2, 1, 0.55), range("sweep", "Sweep", 90, 330, 290, 1), headStyle],
  ),
  S(
    "u-turn",
    "U-turn arrow",
    "return back undo turn around",
    (p, d) => {
      const w = 18 * p.thick!;
      const pts: Pt[] = [[30, 92], [30, 42], ...curvePts((t) => polar(52, 42, 22, 270 + t * 180), 30).slice(1), [74, 60]];
      d.add(stroke(pts, w, "butt"));
      d.add(triHead([74, 92], 180, 26, w * 2.8));
      d.union();
    },
    [range("thick", "Thickness", 0.3, 1, 0.65)],
  ),
  S(
    "chevron",
    "Chevron",
    "caret angle next right greater than",
    (p, d) => d.add(stroke([[50 - 30 * p.depth!, 8], [50 + 30 * p.depth!, 50], [50 - 30 * p.depth!, 92]], 40 * p.thick!, p.ends ? "round" : "butt")),
    [range("thick", "Thickness", 0.1, 0.8, 0.45), range("depth", "Depth", 0.4, 1.5, 0.9), choice("ends", "Ends", ["Flat", "Round"])],
  ),
  S(
    "chevrons",
    "Chevrons",
    "double triple fast forward rank stripes",
    (p, d) => {
      const n = p.count!;
      const gap = 26;
      for (let i = 0; i < n; i++) {
        const x = 50 + (i - (n - 1) / 2) * gap;
        d.add(stroke([[x - 16, 14], [x + 16, 50], [x - 16, 86]], 26 * p.thick!, p.ends ? "round" : "butt"));
      }
    },
    [int("count", "Count", 2, 4, 2), range("thick", "Thickness", 0.2, 0.8, 0.55), choice("ends", "Ends", ["Flat", "Round"])],
  ),
  S(
    "nav-arrow",
    "Navigation arrow",
    "location gps direction cursor send pointer",
    (p, d) => d.add(roundPoly([[8, 12], [92, 50], [8, 88], [8 + 30 * p.notch!, 50]], p.round! * 6)),
    [range("notch", "Notch", 0, 1.2, 0.8), round(0.2)],
  ),
  S(
    "cursor",
    "Cursor",
    "mouse pointer click select",
    (p, d) => d.add(roundPoly([[22, 6], [80, 60], [54, 62], [68, 92], [56, 97], [42, 67], [22, 86]], p.round! * 4)),
    [round(0.25)],
  ),
  S(
    "arrow-circle",
    "Arrow in circle",
    "next button go forward round",
    (p, d) => {
      d.add(circle(50, 50, 46));
      const w = 9;
      d.hole(stroke([[28, 50], [70, 50]], w, "round"), lineHead([70, 50], 90, 18, w));
      d.union();
    },
  ),
  S(
    "trend-up",
    "Trend arrow",
    "growth chart rise increase profit stocks",
    (p, d) => {
      const w = 12 * p.thick!;
      d.add(stroke([[6, 80], [36, 50], [56, 66], [88, 30]], w, "round"));
      d.add(triHead([94, 22], 41, 22, 26));
      d.union();
    },
    [range("thick", "Thickness", 0.5, 1.5, 1)],
  ),
  S(
    "swap-arrows",
    "Swap arrows",
    "exchange transfer trade switch sync",
    (p, d) => {
      const w = 11;
      d.add(stroke([[10, 34], [86, 34]], w, "round"), lineHead([86, 34], 90, 18, w));
      d.add(stroke([[90, 66], [14, 66]], w, "round"), lineHead([14, 66], 270, 18, w));
      d.union();
    },
  ),
  S(
    "archery-arrow",
    "Feather arrow",
    "archery bow hunt aim target fletching",
    (_, d) => {
      d.add(rotateC(stroke([[10, 50], [80, 50]], 4.5, "butt"), 0));
      d.add(poly([[96, 50], [74, 40], [79, 50], [74, 60]]));
      for (const x of [8, 18]) {
        d.add(poly([[x, 50], [x - 6, 38], [x + 4, 38], [x + 12, 50]]), poly([[x, 50], [x + 12, 50], [x + 4, 62], [x - 6, 62]]));
      }
      d.union();
    },
  ),
  S(
    "expand",
    "Expand arrows",
    "fullscreen grow scale enlarge maximize",
    (_, d) => {
      const w = 9;
      for (const deg of [45, 135, 225, 315]) {
        const tip = polar(50, 50, 44, deg);
        d.add(stroke([polar(50, 50, 14, deg), tip], w, "round"), lineHead(tip, deg, 16, w));
      }
      d.union();
    },
  ),
];
