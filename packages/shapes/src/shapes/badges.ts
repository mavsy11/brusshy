import { arcBand, circle, curvePts, ellipse, offset, Pen, poly, polar, rotateC, roundPoly, sampled, starPts, stroke, TAU, type Contour, type Pt } from "../geom";
import { choice, int, maker, range, round } from "./kit";
import { leaf } from "./organic";

const S = maker("badges");

const shield = (style: number): Contour => {
  switch (style) {
    case 1: // heater
      return new Pen([10, 8]).line([90, 8], [90, 42]).curve([90, 68], [74, 86], [50, 96]).curve([26, 86], [10, 68], [10, 42]).close();
    case 2: // rounded
      return new Pen([50, 4]).curve([64, 12], [78, 15], [90, 15]).line([90, 46]).curve([90, 72], [72, 88], [50, 96]).curve([28, 88], [10, 72], [10, 46]).line([10, 15]).curve([22, 15], [36, 12], [50, 4]).close();
    case 3: // pointed base
      return new Pen([10, 8]).line([90, 8], [90, 54]).line([50, 96]).line([10, 54]).close();
    case 4: // crest (scalloped top)
      return new Pen([10, 10]).curve([22, 16], [38, 16], [50, 6]).curve([62, 16], [78, 16], [90, 10]).line([90, 50]).curve([90, 74], [72, 88], [50, 96]).curve([28, 88], [10, 74], [10, 50]).close();
    default: // classic
      return new Pen([10, 8]).line([90, 8], [90, 46]).curve([90, 72], [72, 88], [50, 96]).curve([28, 88], [10, 72], [10, 46]).close();
  }
};

/** Laurel branch: leaves along an arc (compass degrees), on the right side of the circle. */
function laurelBranch(d: { add: (c: Contour) => unknown }, a0: number, a1: number, r: number, leaves: number, size: number, mirror: boolean) {
  const pt = (a: number) => {
    const p = polar(50, 50, r, a);
    return mirror ? ([100 - p[0], p[1]] as Pt) : p;
  };
  d.add(stroke(curvePts((t) => pt(a0 + (a1 - a0) * t), 40), 2.6, "round"));
  for (let i = 0; i < leaves; i++) {
    const t = (i + 0.6) / leaves;
    const a = a0 + (a1 - a0) * t;
    const base = pt(a);
    const tangent = (mirror ? -1 : 1) * (a + (a1 > a0 ? 90 : -90));
    for (const side of [-1, 1]) {
      const L = size * (0.75 + 0.25 * t);
      const lf = leaf(L * 0.36, base[0], base[1] - L, base[1]);
      d.add(rotateC(lf, tangent + side * 34, base[0], base[1]));
    }
  }
  const tip = pt(a1);
  const tipDir = (mirror ? -1 : 1) * (a1 + (a1 > a0 ? 90 : -90));
  d.add(rotateC(leaf(size * 0.3, tip[0], tip[1] - size, tip[1]), tipDir, tip[0], tip[1]));
}

const bubbleTail = (base: Pt, tip: Pt, w: number): Contour => poly([[base[0] - w / 2, base[1]], tip, [base[0] + w / 2, base[1]]]);

export const BADGES = [
  S("shield", "Shield", "security protection guard crest defense badge", (p, d) => d.add(shield(p.style!)), [choice("style", "Style", ["Classic", "Heater", "Rounded", "Pointed", "Crest"])]),
  S(
    "shield-outline",
    "Shield outline",
    "security badge frame crest emblem",
    (p, d) => {
      const s = shield(p.style!);
      d.add(s).hole(offset(s, -46 * p.thick!)).union();
    },
    [choice("style", "Style", ["Classic", "Heater", "Rounded", "Pointed", "Crest"]), range("thick", "Thickness", 0.04, 0.3, 0.12)],
  ),
  S(
    "seal",
    "Seal",
    "badge certified stamp quality approved burst",
    (p, d) => {
      d.add(poly(starPts(p.points!, 46, 42)));
      d.hole(circle(50, 50, 34));
      d.part("center").add(circle(50, 50, 30));
    },
    [int("points", "Points", 12, 48, 28)],
  ),
  S(
    "emblem",
    "Round emblem",
    "badge medal coin circle double ring stamp",
    (p, d) => {
      d.add(circle(50, 50, 46)).hole(circle(50, 50, 46 - 6 * p.thick!)).union();
      d.part("inner").add(circle(50, 50, 46 - 10 * p.thick!)).hole(circle(50, 50, 46 - 13 * p.thick!)).union();
    },
    [range("thick", "Thickness", 0.4, 2, 1)],
  ),
  S(
    "rosette",
    "Award rosette",
    "prize ribbon medal winner first place",
    (_, d) => {
      d.add(poly([[34, 50], [24, 95], [36, 88], [44, 96], [50, 58]]), poly([[66, 50], [76, 95], [64, 88], [56, 96], [50, 58]]));
      d.add(sampled((t) => polar(50, 38, 34 * (1 - 0.07 * (0.5 - 0.5 * Math.cos(t * TAU * 16))), t * 360), 320, 0.03));
      d.hole(circle(50, 38, 24));
      d.union();
      d.part("center").add(circle(50, 38, 20));
    },
  ),
  S(
    "medal",
    "Medal",
    "award olympic winner prize sport",
    (_, d) => {
      d.add(poly([[22, 4], [40, 4], [58, 48], [44, 52]]), poly([[78, 4], [60, 4], [42, 48], [56, 52]]));
      d.hole(circle(50, 66, 30));
      d.union();
      d.part("medal").add(circle(50, 66, 28)).hole(poly(starPts(5, 13, 5.5, 0, 50, 67)));
    },
  ),
  S(
    "ribbon-banner",
    "Ribbon banner",
    "scroll label title band sash",
    (p, d) => {
      const h = 26;
      const top = 50 - h / 2;
      const drop = 9;
      const notch = 7 * p.notch!;
      d.part("tails");
      d.add(poly([[4, top + drop], [24, top + drop], [24, top + drop + h], [4, top + drop + h], [4 + notch, top + drop + h / 2]]));
      d.add(poly([[96, top + drop], [76, top + drop], [76, top + drop + h], [96, top + drop + h], [96 - notch, top + drop + h / 2]]));
      d.part("folds");
      d.add(poly([[16, top + h], [24, top + h], [24, top + h + drop]]), poly([[84, top + h], [76, top + h], [76, top + h + drop]]));
      d.part("band");
      d.add(poly([[16, top], [84, top], [84, top + h], [16, top + h]]));
    },
    [range("notch", "Notch", 0, 1.5, 1)],
  ),
  S(
    "arched-banner",
    "Arched banner",
    "curved ribbon scroll badge title",
    (p, d) => {
      const R = 70;
      const cy = 100;
      const span = 34 * p.span!;
      d.part("tails");
      for (const s of [-1, 1]) {
        const a0 = s * (span - 6);
        const a1 = s * (span + 12);
        const band = arcBand(50, cy + 6, R - 12, R + 2, Math.min(a0, a1), Math.max(a0, a1));
        d.add(band);
        d.hole(poly([polar(50, cy + 6, R - 12, a1), polar(50, cy + 6, R - 5, a1 - s * 5), polar(50, cy + 6, R + 2, a1), polar(50, cy + 6, R + 10, a1 + s * 5), polar(50, cy + 6, R - 20, a1 + s * 5)]));
      }
      d.union();
      d.part("band").add(arcBand(50, cy, R - 12, R + 4, -span, span));
    },
    [range("span", "Span", 0.6, 1.4, 1)],
  ),
  S(
    "bookmark",
    "Bookmark",
    "ribbon save tag flag label",
    (p, d) => d.add(roundPoly([[22, 4], [78, 4], [78, 96], [50, 96 - 26 * p.notch!], [22, 96]], [p.round! * 8, p.round! * 8, 0, 0, 0])),
    [range("notch", "Notch", 0, 1, 0.8), round(0.4)],
  ),
  S(
    "pennant",
    "Pennant",
    "flag sports team triangle bunting",
    (p, d) => d.add(roundPoly([[8, 18], [94, 50], [8, 82]], p.round! * 6)),
    [round(0.15)],
  ),
  S(
    "swallowtail",
    "Swallowtail flag",
    "pennant flag notched forked guidon",
    (p, d) => d.add(poly([[8, 18], [92, 18], [92 - 34 * p.notch!, 50], [92, 82], [8, 82]])),
    [range("notch", "Notch", 0.2, 1.2, 0.6)],
  ),
  S(
    "flag",
    "Waving flag",
    "country banner wind finish milestone",
    (p, d) => {
      const wav = (x: number) => Math.sin((x - 18) / 76 * TAU * p.waves! * 0.5) * 7;
      const top = curvePts((t) => [18 + 76 * t, 12 + wav(18 + 76 * t)], 30);
      const bottom = curvePts((t) => [94 - 76 * t, 62 + wav(94 - 76 * t)], 30);
      d.add(sampled((t) => {
        const all = [...top, ...bottom];
        return all[Math.floor(t * all.length)]!;
      }, top.length + bottom.length, 0.05));
      d.add(roundPoly([[8, 6], [16, 6], [16, 96], [8, 96]], 3));
      d.union();
    },
    [range("waves", "Waves", 1, 4, 2, 0.5)],
  ),
  S(
    "tag",
    "Tag",
    "label price sale ticket",
    (p, d) => {
      d.add(roundPoly([[30, 18], [92, 18], [92, 82], [30, 82], [6, 50]], p.round! * 10));
      d.hole(circle(26, 50, 6));
    },
    [round(0.4)],
  ),
  S(
    "ticket",
    "Ticket",
    "admit event pass coupon cinema",
    (p, d) => {
      d.add(roundPoly([[6, 22], [94, 22], [94, 78], [6, 78]], 4));
      d.hole(circle(6, 50, 9 * p.notch!), circle(94, 50, 9 * p.notch!));
      for (let i = 0; i < 6; i++) d.hole(circle(68, 27 + i * 9.2, 1.7));
      d.union();
    },
    [range("notch", "Notch", 0.4, 1.4, 1)],
  ),
  S(
    "stamp",
    "Postage stamp",
    "perforated mail post edge",
    (p, d) => {
      d.add(poly([[8, 8], [92, 8], [92, 92], [8, 92]]));
      const n = p.holes!;
      const r = 84 / n / 2 * 0.62;
      for (let i = 0; i <= n; i++) {
        const t = 8 + (84 * i) / n;
        d.hole(circle(t, 8, r), circle(t, 92, r), circle(8, t, r), circle(92, t, r));
      }
      d.union();
    },
    [int("holes", "Perforations", 6, 16, 10)],
  ),
  S(
    "plaque",
    "Plaque",
    "concave corners label cartouche sign vintage",
    (p, d) => {
      const c = 16 * p.cut!;
      d.add(poly([[6, 18], [94, 18], [94, 82], [6, 82]]));
      d.hole(circle(6, 18, c), circle(94, 18, c), circle(94, 82, c), circle(6, 82, c));
      d.union();
    },
    [range("cut", "Corner", 0.3, 1.5, 1)],
  ),
  S(
    "label",
    "Banner label",
    "notched ends tag title ribbon",
    (p, d) => {
      const n = 12 * p.notch!;
      d.add(poly([[4, 30], [96, 30], [96 - n, 50], [96, 70], [4, 70], [4 + n, 50]]));
    },
    [range("notch", "Notch", 0, 1.5, 1)],
  ),
  S(
    "speech-bubble",
    "Speech bubble",
    "chat message talk comment conversation",
    (p, d) => {
      d.add(roundPoly([[6, 10], [94, 10], [94, 72], [6, 72]], 6 + 24 * p.round!));
      d.add(bubbleTail([28, 66], [20, 94], 20));
      d.union();
    },
    [round(0.4)],
  ),
  S(
    "round-bubble",
    "Round bubble",
    "chat message talk comment circle",
    (_, d) => {
      d.add(ellipse(50, 46, 44, 38));
      d.add(poly([[22, 66], [12, 94], [42, 80]]));
      d.union();
    },
  ),
  S(
    "thought-bubble",
    "Thought bubble",
    "think idea dream cloud",
    (_, d) => {
      d.add(roundPoly([[18, 22], [86, 22], [86, 58], [18, 58]], 16));
      d.add(circle(32, 26, 15), circle(54, 20, 18), circle(75, 30, 14), circle(80, 50, 12), circle(26, 52, 13), circle(50, 58, 12));
      d.union();
      d.part("dots").add(circle(22, 80, 6), circle(12, 93, 3.6));
    },
  ),
  S(
    "chat-bubbles",
    "Chat bubbles",
    "conversation messages forum support dialog",
    (_, d) => {
      d.add(roundPoly([[4, 8], [66, 8], [66, 52], [4, 52]], 12), poly([[14, 48], [10, 66], [28, 50]]));
      d.hole(roundPoly([[30, 34], [100, 34], [100, 84], [30, 84]], 16));
      d.union();
      d.part("reply").add(roundPoly([[36, 40], [96, 40], [96, 80], [36, 80]], 12), poly([[84, 76], [90, 94], [70, 78]])).union();
    },
  ),
  S(
    "laurel",
    "Laurel wreath",
    "award victory winner olive champion prize",
    (p, d) => {
      laurelBranch(d, 200, 200 + 125 * p.span!, 36, p.leaves!, 17, false);
      laurelBranch(d, 200, 200 + 125 * p.span!, 36, p.leaves!, 17, true);
      d.union();
    },
    [int("leaves", "Leaves", 3, 9, 6), range("span", "Span", 0.6, 1.2, 1)],
  ),
  S(
    "laurel-branch",
    "Laurel branch",
    "olive leaf sprig peace botanical",
    (p, d) => {
      laurelBranch(d, 215, 215 + 75, 70, p.leaves!, 20, false);
      d.union();
    },
    [int("leaves", "Leaves", 3, 9, 5)],
  ),
];
