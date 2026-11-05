import { z } from "zod";
import { apply, fmt, invert, multiply, transformMatrix, worldMatrix, IDENTITY, type Mat } from "./geometry";
import { parsePath } from "./pathmodel";
import { docToSvg, type SvgExportOptions } from "./svg-export";
import type { DocT, NodeT, PaintT, TransformT } from "./schema";

/**
 * Logo animation: a per-version spec (entrance + optional loop) that compiles to a
 * plan of simple keyframe tracks. The same plan becomes CSS keyframes (animated SVG
 * export and the studio preview) and is sampled in JS for video/GIF frames, so the
 * preview, the SVG and the rendered video always move the same way.
 */

// ---------------------------------------------------------------- vocabulary

/** Named easing curves (cubic-bezier control points). */
export const EASINGS = {
  expo: [0.16, 1, 0.3, 1],
  quint: [0.22, 1, 0.36, 1],
  cubic: [0.33, 1, 0.68, 1],
  drafting: [0.32, 0.72, 0, 1],
  back: [0.34, 1.56, 0.64, 1],
  smooth: [0.65, 0, 0.35, 1],
  sine: [0.37, 0, 0.63, 1],
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

export type Bezier = readonly [number, number, number, number];
export type EasingName = keyof typeof EASINGS;
export const EASING_NAMES = Object.keys(EASINGS) as EasingName[];

export const ENTRANCE_KINDS = ["none", "fade", "fade-up", "scale-in", "pop", "draw", "wipe", "rotate-in", "bounce", "assemble", "cascade"] as const;
export const LOOP_KINDS = ["none", "float", "pulse", "breathe", "rotate", "wiggle", "shimmer"] as const;
export const PART_ORDERS = ["layer", "reverse", "left-right", "right-left", "top-bottom", "bottom-top", "center-out", "edges-in", "custom"] as const;

export type EntranceKind = (typeof ENTRANCE_KINDS)[number];
export type LoopKind = (typeof LOOP_KINDS)[number];
export type PartOrder = (typeof PART_ORDERS)[number];

// ---------------------------------------------------------------- schema

export const AnimEntrance = z.object({
  kind: z.enum(ENTRANCE_KINDS).default("fade-up"),
  /** Per-part duration in ms. */
  duration: z.number().min(0).max(10000).default(900),
  /** Start delay in ms. */
  delay: z.number().min(0).max(10000).default(0),
  easing: z.enum(EASING_NAMES as [EasingName, ...EasingName[]]).default("expo"),
  /** Delay between consecutive parts in ms (0 = all together). */
  stagger: z.number().min(0).max(3000).default(70),
  order: z.enum(PART_ORDERS).default("layer"),
  /** Explicit parts, in order (order "custom"). Any node ids of the version, nested ones too. */
  ids: z.array(z.string()).default([]),
  /** Travel distance as a fraction of the artboard (fade-up, assemble, bounce, cascade). */
  distance: z.number().min(0).max(1).default(0.05),
  /** Wipe direction (the edge the reveal travels toward). */
  direction: z.enum(["left", "right", "up", "down"]).default("right"),
});

export const AnimLoop = z.object({
  kind: z.enum(LOOP_KINDS).default("none"),
  /** One cycle in ms. */
  period: z.number().min(300).max(30000).default(3200),
  /** 0–1: how pronounced the motion is. Keep it low — loops should be barely noticeable. */
  intensity: z.number().min(0).max(1).default(0.5),
  /** Pause between the end of the entrance and the first cycle, in ms. */
  gap: z.number().min(0).max(10000).default(400),
  /** Move the whole logo, or each part with a slight phase offset (a wave). */
  target: z.enum(["logo", "parts"]).default("logo"),
});

export const AnimOverride = z.object({
  kind: z.enum(ENTRANCE_KINDS).optional(),
  /** Extra delay (ms, may be negative) added to this part's start. */
  delay: z.number().min(-10000).max(10000).optional(),
  duration: z.number().min(0).max(10000).optional(),
  easing: z.enum(EASING_NAMES as [EasingName, ...EasingName[]]).optional(),
  /** Leave this part still (visible from the first frame). */
  skip: z.boolean().optional(),
});

export const Animation = z.object({
  entrance: AnimEntrance.default(AnimEntrance.parse({})),
  loop: AnimLoop.default(AnimLoop.parse({})),
  /** Per-part tweaks keyed by node id. */
  overrides: z.record(z.string(), AnimOverride).default({}),
});

export type AnimEntranceT = z.infer<typeof AnimEntrance>;
export type AnimLoopT = z.infer<typeof AnimLoop>;
export type AnimOverrideT = z.infer<typeof AnimOverride>;
export type AnimationT = z.infer<typeof Animation>;

/** A spec that does nothing (used when a version has no animation yet). */
export const NO_ANIMATION: AnimationT = Animation.parse({ entrance: { kind: "none" } });

/** Recommended timing per entrance; picking a preset applies these. */
export const ENTRANCE_PRESETS: Record<EntranceKind, { label: string; hint: string; duration: number; easing: EasingName; stagger: number; distance?: number; order?: PartOrder }> = {
  none: { label: "None", hint: "Static", duration: 0, easing: "expo", stagger: 0 },
  fade: { label: "Fade", hint: "Quiet, classic", duration: 700, easing: "cubic", stagger: 60 },
  "fade-up": { label: "Fade up", hint: "Rises into place", duration: 900, easing: "expo", stagger: 70, distance: 0.05 },
  "scale-in": { label: "Scale in", hint: "Grows from its center", duration: 900, easing: "expo", stagger: 60 },
  pop: { label: "Pop", hint: "Springy, playful", duration: 700, easing: "cubic", stagger: 70 },
  draw: { label: "Draw", hint: "Outline draws, fill flows in", duration: 1400, easing: "smooth", stagger: 120 },
  wipe: { label: "Wipe", hint: "Revealed by a moving edge", duration: 900, easing: "quint", stagger: 60, order: "left-right" },
  "rotate-in": { label: "Rotate in", hint: "Turns into place", duration: 1000, easing: "expo", stagger: 60 },
  bounce: { label: "Bounce", hint: "Drops and settles", duration: 1100, easing: "linear", stagger: 80, distance: 0.06 },
  assemble: { label: "Assemble", hint: "Parts gather to the center", duration: 1100, easing: "expo", stagger: 50, distance: 0.12, order: "center-out" },
  cascade: { label: "Cascade", hint: "Part by part, like type", duration: 650, easing: "quint", stagger: 55, distance: 0.04, order: "left-right" },
};

export const LOOP_PRESETS: Record<LoopKind, { label: string; hint: string; period: number; intensity: number }> = {
  none: { label: "None", hint: "Plays once", period: 3200, intensity: 0.5 },
  float: { label: "Float", hint: "Hovers gently", period: 4200, intensity: 0.45 },
  pulse: { label: "Pulse", hint: "A soft heartbeat", period: 2400, intensity: 0.4 },
  breathe: { label: "Breathe", hint: "Slow swell and dim", period: 4800, intensity: 0.5 },
  rotate: { label: "Rotate", hint: "Continuous spin (round marks)", period: 12000, intensity: 0.5 },
  wiggle: { label: "Wiggle", hint: "A quick nudge, then rest", period: 3600, intensity: 0.4 },
  shimmer: { label: "Shimmer", hint: "A light sweep across", period: 3600, intensity: 0.5 },
};

/** Parse a stored (possibly partial or missing) animation into a full spec. */
export function animationOf(raw: unknown): AnimationT {
  if (!raw || typeof raw !== "object") return NO_ANIMATION;
  const r = Animation.safeParse(raw);
  return r.success ? r.data : NO_ANIMATION;
}

export const hasAnimation = (a: AnimationT) => a.entrance.kind !== "none" || a.loop.kind !== "none" || Object.values(a.overrides).some((o) => o.kind && o.kind !== "none");

// ---------------------------------------------------------------- easing

/** cubic-bezier(x1,y1,x2,y2) as a function of progress 0–1. */
export function bezier([x1, y1, x2, y2]: Bezier): (u: number) => number {
  if (x1 === y1 && x2 === y2) return (u) => u;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - u;
      if (Math.abs(e) < 1e-6) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = u;
    for (let i = 0; i < 40; i++) {
      const x = X(t);
      if (Math.abs(x - u) < 1e-6) break;
      if (x < u) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

const cssBezier = (b: Bezier) => (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 1 ? "linear" : `cubic-bezier(${b.map((v) => fmt(v)).join(",")})`);
const EASE_IN: Bezier = [0.55, 0.06, 0.68, 0.19];
const EASE_OUT: Bezier = [0.22, 0.61, 0.36, 1];

// ---------------------------------------------------------------- plan

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Animated values (numbers only, so CSS and the JS sampler interpolate identically). */
export interface AnimValues {
  opacity?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  /** stroke-dashoffset on a path with pathLength=1 (1 = hidden, 0 = fully drawn). */
  dash?: number;
  tx?: number;
  ty?: number;
  scale?: number;
  rot?: number;
  /** clip-path: inset(top right bottom left) in %. */
  clip?: [number, number, number, number];
}

export interface AnimKey {
  at: number;
  v: AnimValues;
  /** Easing from this key to the next. */
  ease: Bezier;
}

export interface AnimTrack {
  /** Target: a node id, "@loop" (whole-logo wrapper) or "@shine" (shimmer band). */
  sel: string;
  delay: number;
  duration: number;
  iterations: number;
  /** "both" for entrances (hold first/last frame), "none" for loops (start after their delay). */
  fill: "both" | "none";
  keys: AnimKey[];
  /** Transform pivot in the element's parent coordinates. */
  pivot: [number, number];
  /** The element's own transform (CSS syntax), kept after the animated part. */
  base: string;
}

export interface AnimPart {
  id: string;
  name: string;
  kind: EntranceKind;
  start: number;
  end: number;
}

export interface AnimPlan {
  width: number;
  height: number;
  parts: AnimPart[];
  tracks: AnimTrack[];
  /** Static CSS per target (draw-on strokes…). */
  statics: Record<string, Record<string, string>>;
  /** Paths that need pathLength="1" for draw-on. */
  drawIds: string[];
  entranceEnd: number;
  loop: { kind: LoopKind; start: number; period: number } | null;
  /** Shimmer band geometry (artboard coords). */
  shine: { box: Box; intensity: number } | null;
  /** Suggested timeline length (entrance + hold, or + two loop cycles), ms. */
  total: number;
}

export interface PlanOptions {
  /** Accurate bounds in artboard coordinates (the studio measures them); defaults to an estimate. */
  boundsOf?: (id: string) => Box | null;
  /** Whether a node renders as a <path> (draw-on needs it). Default: path/shape/text nodes. */
  isPath?: (id: string) => boolean;
}

const EXPORTABLE = new Set(["path", "shape", "text", "group"]);
const visibleNode = (doc: DocT, id: string): NodeT | null => {
  const n = doc.nodes[id];
  return n && n.visible && EXPORTABLE.has(n.type) ? n : null;
};

function cornersOf(b: Box): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
}

function boxOf(pts: [number, number][]): Box | null {
  if (!pts.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const unionBoxes = (boxes: (Box | null)[]) => boxOf(boxes.flatMap((b) => (b ? cornersOf(b) : [])));

/** Rough artboard-space bounds without a browser (control-point hull, text estimate). */
export function estimateBounds(doc: DocT, id: string): Box | null {
  const n = doc.nodes[id];
  if (!n || !n.visible) return null;
  const m = worldMatrix(doc, id);
  let local: Box | null = null;
  switch (n.type) {
    case "path": {
      const pts: [number, number][] = [];
      try {
        for (const s of parsePath(n.d)) for (const a of s.anchors) pts.push(a.p, ...(a.cin ? [a.cin] : []), ...(a.cout ? [a.cout] : []));
      } catch {
        /* invalid data */
      }
      local = boxOf(pts);
      break;
    }
    case "shape":
      local = { x: 0, y: 0, w: n.width, h: n.height };
      break;
    case "text": {
      const w = n.text.length * n.fontSize * 0.56 + Math.max(0, n.text.length - 1) * n.letterSpacing;
      const x = n.anchor === "middle" ? -w / 2 : n.anchor === "end" ? -w : 0;
      local = { x, y: -n.fontSize * 0.74, w, h: n.fontSize * 0.98 };
      break;
    }
    case "group":
      return unionBoxes(n.children.map((c) => estimateBounds(doc, c)));
    default:
      return null;
  }
  return local ? boxOf(cornersOf(local).map(([x, y]) => apply(m, x, y))) : null;
}

/**
 * The parts that animate, in order. Default parts are the top-level layers (a single
 * top-level group is opened up so its children animate one by one).
 */
export function animationParts(doc: DocT, spec: AnimationT, boundsOf: (id: string) => Box | null = (id) => estimateBounds(doc, id)): string[] {
  const e = spec.entrance;
  let roots = doc.root.filter((id) => visibleNode(doc, id));
  while (roots.length === 1) {
    const only = doc.nodes[roots[0]!]!;
    if (only.type !== "group") break;
    const kids = only.children.filter((id) => visibleNode(doc, id));
    if (kids.length < 2) break;
    roots = kids;
  }
  let parts = roots;
  if (e.order === "custom" && e.ids.length) {
    const listed = e.ids.filter((id, i) => visibleNode(doc, id) && e.ids.indexOf(id) === i);
    // Drop ids nested inside another listed id (the ancestor already animates them).
    const isUnder = (id: string, anc: string) => {
      for (let p = doc.nodes[id]?.parent; p; p = doc.nodes[p]?.parent) if (p === anc) return true;
      return false;
    };
    const chosen = listed.filter((id) => !listed.some((o) => o !== id && isUnder(id, o)));
    const rest: string[] = [];
    const visit = (id: string) => {
      if (chosen.includes(id) || chosen.some((c) => isUnder(id, c))) return;
      const n = doc.nodes[id]!;
      if (chosen.some((c) => isUnder(c, id)) && n.type === "group") n.children.filter((c) => visibleNode(doc, c)).forEach(visit);
      else rest.push(id);
    };
    doc.root.filter((id) => visibleNode(doc, id)).forEach(visit);
    return [...chosen, ...rest];
  }
  if (e.order === "layer" || e.order === "custom") return parts;
  if (e.order === "reverse") return [...parts].reverse();
  const centers = new Map(parts.map((id) => {
    const b = boxOf(cornersOf(boundsOf(id) ?? { x: 0, y: 0, w: 0, h: 0 }))!;
    return [id, [b.x + b.w / 2, b.y + b.h / 2] as [number, number]];
  }));
  const all = unionBoxes(parts.map(boundsOf));
  const c: [number, number] = all ? [all.x + all.w / 2, all.y + all.h / 2] : [doc.artboard.width / 2, doc.artboard.height / 2];
  const key: Record<Exclude<PartOrder, "layer" | "reverse" | "custom">, (p: [number, number]) => number> = {
    "left-right": (p) => p[0] + p[1] * 0.001,
    "right-left": (p) => -p[0] + p[1] * 0.001,
    "top-bottom": (p) => p[1] + p[0] * 0.001,
    "bottom-top": (p) => -p[1] + p[0] * 0.001,
    "center-out": (p) => Math.hypot(p[0] - c[0], p[1] - c[1]),
    "edges-in": (p) => -Math.hypot(p[0] - c[0], p[1] - c[1]),
  };
  const k = key[e.order];
  parts = [...parts].sort((a, b) => k(centers.get(a)!) - k(centers.get(b)!));
  return parts;
}

/** CSS transform functions for a node's own transform (matches the SVG transform attribute). */
export function cssTransform(t: TransformT): string {
  const parts: string[] = [];
  if (t.x || t.y) parts.push(`translate(${fmt(t.x)}px, ${fmt(t.y)}px)`);
  if (t.rotation) parts.push(`rotate(${fmt(t.rotation)}deg)`);
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${fmt(t.scaleX)}, ${fmt(t.scaleY)})`);
  return parts.join(" ");
}

/** Leaf geometry under a node (the node itself if it is one). */
function leaves(doc: DocT, id: string): string[] {
  const n = visibleNode(doc, id);
  if (!n) return [];
  if (n.type === "group") return n.children.flatMap((c) => leaves(doc, c));
  return [id];
}

const solidOf = (p: PaintT): string | null => (p === null ? null : typeof p === "string" ? p : p.stops[Math.floor(p.stops.length / 2)]!.color);

/** Compile a spec for one projected version into tracks. */
export function planAnimation(doc: DocT, spec: AnimationT, o: PlanOptions = {}): AnimPlan {
  const W = doc.artboard.width;
  const H = doc.artboard.height;
  const S = Math.max(W, H);
  const boundsOf = o.boundsOf ?? ((id: string) => estimateBounds(doc, id));
  const isPath = o.isPath ?? ((id: string) => ["path", "shape", "text"].includes(doc.nodes[id]?.type ?? ""));
  const e = spec.entrance;
  const tracks: AnimTrack[] = [];
  const statics: AnimPlan["statics"] = {};
  const drawIds: string[] = [];
  const parts: AnimPart[] = [];

  const ids = animationParts(doc, spec, boundsOf);
  const logo = unionBoxes(ids.map(boundsOf)) ?? { x: 0, y: 0, w: W, h: H };
  const logoC: [number, number] = [logo.x + logo.w / 2, logo.y + logo.h / 2];

  /** Parent-space helpers for a node: pivot point and vector conversion from artboard space. */
  const frameFor = (id: string) => {
    const n = doc.nodes[id]!;
    const parent: Mat = n.parent ? worldMatrix(doc, n.parent) : IDENTITY;
    const inv = invert(parent);
    const b = boundsOf(id) ?? { x: 0, y: 0, w: 0, h: 0 };
    const center = apply(inv, b.x + b.w / 2, b.y + b.h / 2);
    const vec = (dx: number, dy: number): [number, number] => {
      const a = apply(inv, 0, 0);
      const p = apply(inv, dx, dy);
      return [p[0] - a[0], p[1] - a[1]];
    };
    const m = multiply(parent, transformMatrix(n.transform));
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    return { n, b, center, vec, scale, base: cssTransform(n.transform), op: n.style.opacity };
  };

  const add = (t: Omit<AnimTrack, "iterations" | "fill"> & Partial<Pick<AnimTrack, "iterations" | "fill">>) => {
    if (t.duration <= 0) return;
    tracks.push({ iterations: 1, fill: "both", ...t });
  };
  const k = (at: number, v: AnimValues, ease: Bezier = EASINGS.linear): AnimKey => ({ at, v, ease });

  ids.forEach((id, i) => {
    const ov = spec.overrides[id] ?? {};
    const kind: EntranceKind = ov.skip ? "none" : (ov.kind ?? e.kind);
    const D = ov.duration ?? e.duration;
    const start = Math.max(0, e.delay + i * e.stagger + (ov.delay ?? 0));
    const E: Bezier = EASINGS[ov.easing ?? e.easing];
    const f = frameFor(id);
    parts.push({ id, name: f.n.name, kind, start, end: kind === "none" ? 0 : start + D });
    if (kind === "none" || D <= 0) return;
    const T = (sel: string, at0: number, at1: number, keys: AnimKey[], pivot = f.center, base = f.base) =>
      add({ sel, delay: start + at0 * D, duration: (at1 - at0) * D, keys, pivot, base });
    const fade = (at1: number, ease: Bezier = EASINGS.cubic, sel = id, op = f.op) => T(sel, 0, at1, [k(0, { opacity: 0 }, ease), k(1, { opacity: op })]);
    const dist = e.distance * S;

    switch (kind) {
      case "fade":
        T(id, 0, 1, [k(0, { opacity: 0 }, E), k(1, { opacity: f.op })]);
        break;
      case "fade-up": {
        const [vx, vy] = f.vec(0, dist);
        fade(0.6);
        T(id, 0, 1, [k(0, { tx: vx, ty: vy }, E), k(1, { tx: 0, ty: 0 })]);
        break;
      }
      case "scale-in":
        fade(0.5);
        T(id, 0, 1, [k(0, { scale: 0.86 }, E), k(1, { scale: 1 })]);
        break;
      case "pop":
        fade(0.3);
        T(id, 0, 1, [k(0, { scale: 0.4 }, EASINGS.cubic), k(0.58, { scale: 1.06 }, EASINGS.smooth), k(1, { scale: 1 })]);
        break;
      case "rotate-in":
        fade(0.45);
        T(id, 0, 1, [k(0, { rot: -28, scale: 0.86 }, E), k(1, { rot: 0, scale: 1 })]);
        break;
      case "bounce": {
        const h = dist * 2.2;
        const up = (a: number) => f.vec(0, -h * a);
        const v = (a: number): AnimValues => {
          const [tx, ty] = up(a);
          return { tx, ty };
        };
        fade(0.18, EASINGS.linear);
        T(id, 0, 1, [k(0, v(1), EASE_IN), k(0.46, v(0), EASE_OUT), k(0.66, v(0.2), EASE_IN), k(0.82, v(0), EASE_OUT), k(0.92, v(0.05), EASE_IN), k(1, v(0))]);
        break;
      }
      case "assemble": {
        const pc: [number, number] = [f.b.x + f.b.w / 2, f.b.y + f.b.h / 2];
        let dx = pc[0] - logoC[0];
        let dy = pc[1] - logoC[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-3) [dx, dy] = [0, 1];
        else [dx, dy] = [dx / len, dy / len];
        const [vx, vy] = f.vec(dx * dist, dy * dist);
        fade(0.5);
        T(id, 0, 1, [k(0, { tx: vx, ty: vy, scale: 0.92 }, E), k(1, { tx: 0, ty: 0, scale: 1 })]);
        break;
      }
      case "cascade": {
        const [vx, vy] = f.vec(0, dist);
        // Pivot at the bottom-left of the part, so it tips up into place.
        const pivot = apply(invert(doc.nodes[id]!.parent ? worldMatrix(doc, doc.nodes[id]!.parent!) : IDENTITY), f.b.x, f.b.y + f.b.h);
        fade(0.5);
        T(id, 0, 1, [k(0, { tx: vx, ty: vy, rot: 7 }, E), k(1, { tx: 0, ty: 0, rot: 0 })], pivot);
        break;
      }
      case "wipe": {
        const M = -20; // negative inset: never clip strokes or antialiasing at rest
        const from: Record<string, [number, number, number, number]> = {
          right: [M, 120, M, M],
          left: [M, M, M, 120],
          down: [M, M, 120, M],
          up: [120, M, M, M],
        };
        T(id, 0, 1, [k(0, { clip: from[e.direction]! }, E), k(1, { clip: [M, M, M, M] })]);
        fade(0.2, EASINGS.linear);
        break;
      }
      case "draw": {
        for (const leaf of leaves(doc, id)) {
          const ln = doc.nodes[leaf]!;
          const lf = frameFor(leaf);
          if (!isPath(leaf)) {
            // Live text / images can't be stroked along a path: fade them in.
            T(leaf, 0.35, 1, [k(0, { opacity: 0 }, EASINGS.cubic), k(1, { opacity: lf.op })], lf.center, lf.base);
            continue;
          }
          const st = ln.style;
          const stroked = st.stroke !== null && st.strokeWidth > 0;
          const filled = st.fill !== null;
          drawIds.push(leaf);
          const css: Record<string, string> = { "stroke-dasharray": "1px 1px" };
          if (!stroked) {
            const color = solidOf(st.fill);
            if (!color) continue;
            const w = Math.max(0.75, (S * 0.0032) / lf.scale);
            Object.assign(css, { stroke: color, "stroke-width": `${fmt(w)}px`, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-opacity": "0" });
          }
          statics[leaf] = css;
          T(leaf, 0, 0.06, [k(0, { opacity: 0 }), k(1, { opacity: lf.op })], lf.center, lf.base);
          T(leaf, 0, stroked && !filled ? 1 : 0.72, [k(0, { dash: 1 }, EASINGS.smooth), k(1, { dash: 0 })], lf.center, lf.base);
          if (filled) T(leaf, 0.46, 1, [k(0, { fillOpacity: 0 }, EASINGS.cubic), k(1, { fillOpacity: 1 })], lf.center, lf.base);
          if (!stroked) T(leaf, 0, 1, [k(0, { strokeOpacity: 1 }), k(0.66, { strokeOpacity: 1 }, EASINGS.smooth), k(1, { strokeOpacity: filled ? 0 : 1 })], lf.center, lf.base);
        }
        break;
      }
    }
  });

  const entranceEnd = parts.reduce((m, p) => Math.max(m, p.end), 0);

  // Loop
  const L = spec.loop;
  let loop: AnimPlan["loop"] = null;
  let shine: AnimPlan["shine"] = null;
  if (L.kind !== "none") {
    const start = entranceEnd > 0 ? entranceEnd + L.gap : 0;
    loop = { kind: L.kind, start, period: L.period };
    const I = L.intensity;
    const targets =
      L.kind === "shimmer" || L.target === "logo"
        ? [{ sel: "@loop", pivot: logoC, base: "", op: 1, vec: (x: number, y: number): [number, number] => [x, y], phase: 0 }]
        : ids.map((id, i) => {
            const f = frameFor(id);
            return { sel: id, pivot: f.center, base: f.base, op: f.op, vec: f.vec, phase: i * Math.min(260, L.period * 0.07) };
          });
    for (const t of targets) {
      const LT = (keys: AnimKey[]) => add({ sel: t.sel, delay: start + t.phase, duration: L.period, iterations: Infinity, fill: "none", keys, pivot: t.pivot, base: t.base });
      const sine = EASINGS.sine;
      switch (L.kind) {
        case "float": {
          const [vx, vy] = t.vec(0, -H * 0.028 * I);
          LT([k(0, { tx: 0, ty: 0 }, sine), k(0.5, { tx: vx, ty: vy }, sine), k(1, { tx: 0, ty: 0 })]);
          break;
        }
        case "pulse":
          LT([k(0, { scale: 1 }, EASINGS.cubic), k(0.14, { scale: 1 + 0.07 * I }, EASINGS.smooth), k(0.42, { scale: 1 }), k(1, { scale: 1 })]);
          break;
        case "breathe":
          LT([k(0, { scale: 1 }, sine), k(0.5, { scale: 1 + 0.03 * I }, sine), k(1, { scale: 1 })]);
          LT([k(0, { opacity: t.op }, sine), k(0.5, { opacity: t.op * (1 - 0.2 * I) }, sine), k(1, { opacity: t.op })]);
          break;
        case "rotate":
          LT([k(0, { rot: 0 }), k(1, { rot: 360 })]);
          break;
        case "wiggle": {
          const a = 2 + 6 * I;
          const s = EASINGS.smooth;
          LT([k(0, { rot: 0 }, s), k(0.06, { rot: a }, s), k(0.14, { rot: -a * 0.8 }, s), k(0.22, { rot: a * 0.5 }, s), k(0.3, { rot: -a * 0.2 }, s), k(0.36, { rot: 0 }), k(1, { rot: 0 })]);
          break;
        }
        case "shimmer": {
          const band = Math.max(logo.w, logo.h) * 0.32;
          shine = { box: logo, intensity: I };
          const travel = logo.w + band * 3.2;
          add({ sel: "@shine", delay: start, duration: L.period, iterations: Infinity, fill: "none", keys: [k(0, { tx: 0 }, EASINGS.smooth), k(0.5, { tx: travel }), k(1, { tx: travel })], pivot: [0, 0], base: "" });
          break;
        }
      }
    }
  }

  const total = Math.round(loop ? loop.start + loop.period * 2 : entranceEnd > 0 ? entranceEnd + 1000 : 0);
  return { width: W, height: H, parts, tracks, statics, drawIds, entranceEnd, loop, shine, total };
}

// ---------------------------------------------------------------- values → CSS

const hasTransform = (v: AnimValues) => v.tx !== undefined || v.ty !== undefined || v.scale !== undefined || v.rot !== undefined;

function transformCss(v: AnimValues, pivot: [number, number], base: string): string {
  const [px, py] = pivot;
  return [
    `translate(${fmt(px + (v.tx ?? 0))}px, ${fmt(py + (v.ty ?? 0))}px)`,
    `rotate(${fmt(v.rot ?? 0)}deg)`,
    `scale(${fmt(v.scale ?? 1)})`,
    `translate(${fmt(-px)}px, ${fmt(-py)}px)`,
    base,
  ]
    .join(" ")
    .trim();
}

/** CSS declarations for one set of values. */
export function valuesCss(v: AnimValues, pivot: [number, number] = [0, 0], base = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.opacity !== undefined) out.opacity = fmt(v.opacity);
  if (v.fillOpacity !== undefined) out["fill-opacity"] = fmt(v.fillOpacity);
  if (v.strokeOpacity !== undefined) out["stroke-opacity"] = fmt(v.strokeOpacity);
  if (v.dash !== undefined) out["stroke-dashoffset"] = `${fmt(v.dash)}px`;
  if (hasTransform(v)) out.transform = transformCss(v, pivot, base);
  if (v.clip) {
    const c = `inset(${v.clip.map((x) => `${fmt(x)}%`).join(" ")})`;
    out["-webkit-clip-path"] = c;
    out["clip-path"] = c;
  }
  return out;
}

const declString = (d: Record<string, string>) =>
  Object.entries(d)
    .map(([p, v]) => `${p}:${v}`)
    .join(";");

/** CSS selector for a track target inside the scoped SVG. */
// Everything outside [\w-] becomes a CSS hex escape: the selector lands in a raw <style>, so a node id must never
// be able to close it (`</style>`) or the rule.
const cssEsc = (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c.codePointAt(0)!.toString(16)} `);
export const targetSelector = (sel: string) => (sel === "@loop" ? '[data-bx="loop"]' : sel === "@shine" ? '[data-bx="shine"]' : `[data-id="${cssEsc(sel)}"]`);

/**
 * CSS for a plan, scoped under `scope` (e.g. ".bx-a1"): `staticCss` holds rules that also
 * apply to sampled still frames; `css` adds the keyframes and animation bindings.
 */
export function animationCss(plan: AnimPlan, scope: string): { css: string; staticCss: string; ids: string[] } {
  const name = scope.replace(/[^a-z0-9_-]/gi, "") || "bx";
  const bySel = new Map<string, string[]>();
  const keyframes: string[] = [];
  const transformed = new Set<string>();
  plan.tracks.forEach((t, i) => {
    const kf = `${name}-${i}`;
    const blocks = t.keys.map((key, j) => {
      const decl = valuesCss(key.v, t.pivot, t.base);
      if (j < t.keys.length - 1) decl["animation-timing-function"] = cssBezier(key.ease);
      return `${fmt(key.at * 100)}%{${declString(decl)}}`;
    });
    keyframes.push(`@keyframes ${kf}{${blocks.join("")}}`);
    if (t.keys.some((key) => hasTransform(key.v))) transformed.add(t.sel);
    const iter = Number.isFinite(t.iterations) ? fmt(t.iterations) : "infinite";
    const list = bySel.get(t.sel) ?? [];
    list.push(`${kf} ${fmt(Math.round(t.duration))}ms linear ${fmt(Math.round(t.delay))}ms ${iter} normal ${t.fill}`);
    bySel.set(t.sel, list);
  });
  const rules: string[] = [];
  const statics: string[] = [];
  if (transformed.size) statics.push(`${[...transformed].map((s) => `${scope} ${targetSelector(s)}`).join(",")}{transform-box:view-box;transform-origin:0 0}`);
  for (const [sel, decl] of Object.entries(plan.statics)) statics.push(`${scope} ${targetSelector(sel)}{${declString(decl)}}`);
  // The shimmer mask is a white copy of the artwork (paint only what is painted: "none" stays none).
  statics.push(`${scope} [data-bx="mask"] [fill]:not([fill="none"]){fill:#fff!important}${scope} [data-bx="mask"] [stroke]:not([stroke="none"]){stroke:#fff!important}`);
  for (const [sel, list] of bySel) rules.push(`${scope} ${targetSelector(sel)}{animation:${list.join(",")}}`);
  rules.push(`@media (prefers-reduced-motion:reduce){${scope} *{animation:none!important}}`);
  return { staticCss: statics.join("\n"), css: [...keyframes, ...rules].join("\n"), ids: [...bySel.keys()] };
}

// ---------------------------------------------------------------- sampling

function lerpValues(a: AnimValues, b: AnimValues, u: number): AnimValues {
  const out: AnimValues = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof AnimValues>;
  for (const key of keys) {
    if (key === "clip") {
      const ca = a.clip ?? b.clip!;
      const cb = b.clip ?? a.clip!;
      out.clip = ca.map((v, i) => v + (cb[i]! - v) * u) as [number, number, number, number];
    } else {
      const va = (a[key] ?? b[key]) as number;
      const vb = (b[key] ?? a[key]) as number;
      (out as Record<string, number>)[key] = va + (vb - va) * u;
    }
  }
  return out;
}

/** Values of a track at local progress p (0–1). */
export function trackValuesAt(t: AnimTrack, p: number): AnimValues {
  const keys = t.keys;
  if (p <= keys[0]!.at) return { ...keys[0]!.v };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (p <= b.at) {
      const u = b.at > a.at ? (p - a.at) / (b.at - a.at) : 1;
      return lerpValues(a.v, b.v, bezier(a.ease)(u));
    }
  }
  return { ...keys[keys.length - 1]!.v };
}

/** Progress of a track at time t (ms), or null when it has no effect (CSS animation semantics). */
export function trackProgress(t: AnimTrack, time: number): number | null {
  const local = time - t.delay;
  if (local < 0) return t.fill === "both" ? 0 : null;
  if (!Number.isFinite(t.iterations)) return (local % t.duration) / t.duration;
  if (local >= t.duration * t.iterations) return t.fill === "both" ? 1 : null;
  return (local % t.duration) / t.duration;
}

/**
 * Inline CSS for every target at time t (ms). Later tracks override earlier ones per
 * property, exactly like a CSS animation list.
 */
export function sampleAnimation(plan: AnimPlan, time: number): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const t of plan.tracks) {
    const p = trackProgress(t, time);
    if (p === null) continue;
    Object.assign((out[t.sel] ??= {}), valuesCss(trackValuesAt(t, p), t.pivot, t.base));
  }
  return out;
}

// ---------------------------------------------------------------- animated SVG

export interface AnimatedSvgOptions extends Omit<SvgExportOptions, "dataIds" | "background"> {
  /** Unique class for scoping (several inline SVGs can share a page). */
  scope?: string;
  boundsOf?: PlanOptions["boundsOf"];
  /** Embed the keyframes (default true). False = static CSS only, for sampled frames. */
  animate?: boolean;
}

let scopeSeq = 0;

/**
 * A self-contained animated SVG (CSS keyframes) of one projected version, plus its plan.
 * Root gets `class="<scope>"`; parts keep `data-id`, the logo is wrapped in
 * `<g data-bx="loop">` for whole-logo loops.
 */
export function animatedSvg(doc: DocT, spec: AnimationT, o: AnimatedSvgOptions = {}): { svg: string; plan: AnimPlan; scope: string } {
  const scope = o.scope ?? `bx-${(++scopeSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let svg = docToSvg(doc, { ...o, dataIds: true, background: null, pretty: false });
  // Scope gradient ids so several inline copies never collide.
  svg = svg.replace(/id="g(\d+)"/g, `id="${scope}-g$1"`).replace(/url\(#g(\d+)\)/g, `url(#${scope}-g$1)`);
  const isPath = (id: string) => new RegExp(`<path data-id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(svg);
  const plan = planAnimation(doc, spec, { boundsOf: o.boundsOf, isPath });
  for (const id of plan.drawIds) svg = svg.split(`<path data-id="${id}"`).join(`<path data-id="${id}" pathLength="1"`);

  const open = svg.match(/<svg\b[^>]*>/)!;
  let at = open.index! + open[0].length;
  let defs = "";
  if (svg.startsWith("<defs>", at)) {
    const end = svg.indexOf("</defs>", at) + "</defs>".length;
    defs = svg.slice(at + "<defs>".length, end - "</defs>".length);
    at = end;
  }
  const body = svg.slice(at, svg.lastIndexOf("</svg>"));
  const W = plan.width;
  const H = plan.height;
  let shine = "";
  if (plan.shine) {
    const b = plan.shine.box;
    const band = Math.max(b.w, b.h) * 0.32;
    const x = b.x - band * 2.1;
    const y = b.y - b.h * 0.6;
    const h = b.h * 2.2;
    const a = fmt(Math.min(0.9, 0.3 + 0.6 * plan.shine.intensity));
    defs +=
      `<mask id="${scope}-m" maskUnits="userSpaceOnUse" x="${fmt(-W)}" y="${fmt(-H)}" width="${fmt(W * 3)}" height="${fmt(H * 3)}"><g data-bx="mask">${body}</g></mask>` +
      `<linearGradient id="${scope}-s"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="${a}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
    shine = `<g mask="url(#${scope}-m)" pointer-events="none"><g data-bx="shine"><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(band)}" height="${fmt(h)}" fill="url(#${scope}-s)" transform="rotate(16 ${fmt(x + band / 2)} ${fmt(y + h / 2)})"/></g></g>`;
  }
  const { css, staticCss } = animationCss(plan, `.${scope}`);
  const style = `<style data-bx="static">${staticCss}</style>` + (o.animate === false ? "" : `<style data-bx="anim">${css}</style>`);
  const root = open[0].replace(/^<svg/, `<svg class="${scope}"`);
  const out = `${root}${style}${defs ? `<defs>${defs}</defs>` : ""}<g data-bx="loop">${body}${shine}</g></svg>`;
  return { svg: out, plan, scope };
}

/** Moments worth looking at (ms): across the entrance, its end, and into the loop. */
export function previewTimes(plan: AnimPlan, count = 6): number[] {
  const n = Math.max(2, Math.min(16, Math.round(count)));
  const end = plan.entranceEnd;
  if (!plan.loop) return Array.from({ length: n }, (_, i) => Math.round((end * i) / (n - 1)));
  const loopFrames = end > 0 ? Math.max(2, Math.round(n / 3)) : n;
  const enter = n - loopFrames;
  const out = enter > 0 ? Array.from({ length: enter }, (_, i) => Math.round((end * i) / Math.max(1, enter - 1))) : [];
  for (let i = 0; i < loopFrames; i++) out.push(Math.round(plan.loop.start + (plan.loop.period * (i + 1)) / (loopFrames + 1)));
  return out;
}

/** One-line summary of a spec for agents and the UI. */
export function describeAnimation(spec: AnimationT, plan?: AnimPlan): string {
  const e = spec.entrance;
  const l = spec.loop;
  const bits: string[] = [];
  if (e.kind === "none") bits.push("no entrance");
  else bits.push(`entrance ${e.kind} ${e.duration}ms ${e.easing}${e.delay ? `, delay ${e.delay}ms` : ""}${e.stagger ? `, stagger ${e.stagger}ms by ${e.order}` : ""}`);
  bits.push(l.kind === "none" ? "no loop" : `loop ${l.kind} every ${l.period}ms (intensity ${l.intensity}, ${l.target})`);
  const ov = Object.keys(spec.overrides).length;
  if (ov) bits.push(`${ov} override${ov === 1 ? "" : "s"}`);
  if (plan) bits.push(`entrance ends at ${Math.round(plan.entranceEnd)}ms`);
  return bits.join("; ");
}
