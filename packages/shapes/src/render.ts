import { booleanOpD, ClipType, differenceD, FillRule, intersectD, type PathD, type PathsD } from "@countertype/clipper2-ts";
import { fitPolyline } from "@brusshy/core/fitcurve";
import { area, bounds, close, contourD, flatten, mapC, reverse, type Contour, type Pt, type Seg } from "./geom";
import { Draw, type DrawPart, type ParamValues, type ShapeDef, type ShapeGeometry, type ShapeParam, type ShapePath } from "./types";

/** Longest side of every generated shape inside its 100 box. */
export const FIT = 88;

const PREC = 3;
const toPath = (c: Contour): PathD => flatten(c, 24).map(([x, y]) => ({ x, y }));
const orient = (c: Contour, positive: boolean) => ((area(c) > 0) === positive ? c : reverse(c));

function fromPath(p: PathD): Contour | null {
  const pts: Pt[] = p.map((q) => [q.x, q.y]);
  if (pts.length < 3) return null;
  const sp = fitPolyline(pts, true, 0.035, 32);
  if (!sp || sp.anchors.length < 2) return null;
  const a = sp.anchors;
  const segs: Seg[] = a.map((A, i) => {
    const B = a[(i + 1) % a.length]!;
    return A.cout || B.cin ? { c1: (A.cout ?? A.p) as Pt, c2: (B.cin ?? B.p) as Pt, p: B.p as Pt } : { p: B.p as Pt };
  });
  return close({ start: a[0]!.p as Pt, segs });
}

/** Boolean-merge a part: solids ∪ bands (inside of a band stays open), ∩ clip, − holes. */
function merged(part: DrawPart): Contour[] {
  const subject: PathsD = [
    ...part.solids.map((c) => toPath(orient(c, true))),
    ...part.bands.flatMap(([o, i]) => [toPath(orient(o, true)), toPath(orient(i, false))]),
  ];
  let out = booleanOpD(ClipType.Union, subject, null, FillRule.Positive, PREC);
  if (part.clip.length) out = intersectD(out, part.clip.map((c) => toPath(orient(c, true))), FillRule.NonZero, PREC);
  if (part.holes.length) out = differenceD(out, part.holes.map((c) => toPath(orient(c, true))), FillRule.NonZero, PREC);
  return out.filter((p) => p.length > 2).map(fromPath).filter((c): c is Contour => !!c && Math.abs(area(c)) > 0.05);
}

/** Contours of each part in final form (oriented, or merged). */
function partContours(part: DrawPart): { contours: Contour[]; evenodd: boolean } {
  if (part.merge) return { contours: merged(part), evenodd: true };
  if (part.evenodd) return { contours: [...part.solids, ...part.bands.flat(), ...part.holes], evenodd: true };
  return {
    contours: [
      ...part.solids.map((c) => orient(c, true)),
      ...part.bands.flatMap(([o, i]) => [orient(o, true), orient(i, false)]),
      ...part.holes.map((c) => orient(c, false)),
    ],
    evenodd: false,
  };
}

export function defaults(params: ShapeParam[] | undefined): ParamValues {
  return Object.fromEntries((params ?? []).map((p) => [p.key, p.default]));
}

/** Clamp/round incoming values to the shape's parameter ranges (unknown keys are dropped). */
export function cleanParams(params: ShapeParam[] | undefined, values: ParamValues | undefined): ParamValues {
  const out = defaults(params);
  for (const p of params ?? []) {
    const v = values?.[p.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (p.type === "range") out[p.key] = Math.min(p.max, Math.max(p.min, v));
    else if (p.type === "int") out[p.key] = Math.round(Math.min(p.max, Math.max(p.min, v)));
    else if (p.type === "choice") out[p.key] = Math.round(Math.min(p.options.length - 1, Math.max(0, v)));
    else out[p.key] = Math.round(Math.abs(v)) % 100000;
  }
  return out;
}

/** Run a generator and normalise its drawing: centred in the 100 box, longest side = FIT. */
export function renderDef(def: ShapeDef, values?: ParamValues): ShapeGeometry {
  const p = cleanParams(def.params, values);
  const d = new Draw();
  def.draw(p, d);
  const parts = d.parts.map((part) => ({ name: part.name, ...partContours(part) })).filter((x) => x.contours.length);
  const all = parts.flatMap((x) => x.contours);
  if (!all.length) throw new Error(`Shape ${def.id} drew nothing`);
  const b = bounds(all);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const k = FIT / Math.max(w, h, 1e-6);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const tf = ([x, y]: Pt): Pt => [50 + (x - cx) * k, 50 + (y - cy) * k];
  const paths: ShapePath[] = parts.map((x) => ({
    d: x.contours.map((c) => contourD(mapC(c, tf))).join(""),
    fillRule: x.evenodd ? "evenodd" : "nonzero",
    ...(parts.length > 1 && x.name ? { name: x.name } : {}),
  }));
  return { id: def.id, name: def.name, paths, box: 100, bounds: { x: 50 - (w * k) / 2, y: 50 - (h * k) / 2, width: w * k, height: h * k } };
}
