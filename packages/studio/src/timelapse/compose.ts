import { worldMatrix, type DocT, type TimelapseStep } from "@brusshy/core";
import { nodePath } from "../lib/geom";
import { buildSvg, prepareFonts } from "../export/svg";
import { svgToCanvas } from "../export/raster";
import { BRAND_WORD } from "../panels/BrandWord";
import { finalFrame, formatElapsed, stateDoc, stepOf, type TLModel } from "./data";

/**
 * One renderer for the live player and the exported video/GIF (what you see is what you
 * export): a composition (square, vertical or a bare stage) drawn on a 2D canvas at time t.
 * States are rasterized once (cached, opaque on the artboard color) and cross-faded; layers
 * that are genuinely new are traced first with the studio's red pencil, then fill in.
 */

export type Aspect = "square" | "vertical";

export interface TLLook {
  aspect: Aspect;
  captions: boolean;
  clock: boolean;
  sketches: boolean;
}

export const DEFAULT_LOOK: TLLook = { aspect: "square", captions: true, clock: true, sketches: true };

export const ASPECT_SIZE: Record<Aspect, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  vertical: { w: 1080, h: 1920 },
};

export interface TLPlan {
  intro: number;
  starts: number[];
  durs: number[];
  buildEnd: number;
  hold: number;
  cardAt: number;
  cardFade: number;
  total: number;
}

const INTRO = 700;
const HOLD = 1800;
const CARD = 2600;
const CARD_FADE = 650;

/** Build length when none is asked for: ~0.6 s a step, between 3.5 and 18 s. */
export const autoBuildMs = (m: TLModel) => Math.max(3500, Math.min(18_000, m.data.steps.length * 600));

/** Timing: drawing steps get more time than tweaks; repeated drags a little more. */
export function makePlan(m: TLModel, buildMs = autoBuildMs(m)): TLPlan {
  const steps = m.data.steps;
  const w = steps.map((s) => 1 + (s.added.length ? 0.9 : 0) + Math.min(0.6, (s.merged - 1) * 0.05));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const build = steps.length ? buildMs : 0;
  const durs = w.map((x) => (x / sum) * build);
  const starts: number[] = [];
  let t = INTRO;
  for (const d of durs) {
    starts.push(t);
    t += d;
  }
  const buildEnd = INTRO + build;
  const cardAt = buildEnd + HOLD;
  return { intro: INTRO, starts, durs, buildEnd, hold: HOLD, cardAt, cardFade: CARD_FADE, total: cardAt + CARD };
}

/** Index of the step playing at t (0-based), -1 during the intro, steps.length after the build. */
export function stepAt(plan: TLPlan, t: number): number {
  if (t < plan.intro || !plan.starts.length) return -1;
  if (t >= plan.buildEnd) return plan.starts.length;
  let lo = 0;
  let hi = plan.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (plan.starts[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

const PENCIL = "#ff4d1f";
const INK = "#0b0c0e";
const INK2 = "#585f63";
const INK3 = "#8e9599";
const PAPER = "#f4f5f5";
const FONT = '"Geist Variable", Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", "Geist Mono", Menlo, monospace';

interface Stroke {
  path: Path2D;
  /** Length in artboard units and evenly spaced points along it (for the pencil tip). */
  length: number;
  pts: [number, number][];
}

let measurer: SVGPathElement | null = null;
function measure(d: string): { length: number; pts: [number, number][] } {
  if (!measurer) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden";
    measurer = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(measurer);
    document.body.appendChild(svg);
  }
  measurer.setAttribute("d", d);
  let length = 0;
  try {
    length = measurer.getTotalLength();
  } catch {
    return { length: 0, pts: [] };
  }
  const n = 48;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = measurer.getPointAtLength((length * i) / n);
    pts.push([p.x, p.y]);
  }
  return { length, pts };
}

const isLight = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function setFont(ctx: CanvasRenderingContext2D, weight: number, px: number, family = FONT, tracking = 0) {
  ctx.font = `${weight} ${px}px ${family}`;
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tracking}px`;
}

interface Layout {
  W: number;
  H: number;
  u: number;
  /** Text scale (vertical videos are watched on phones: a little larger). */
  t: number;
  board: { x: number; y: number; w: number; h: number; r: number };
  /** Caption baseline, progress bar y. */
  captionY: number;
  barY: number;
  header?: { titleY: number; subY: number };
  footerY?: number;
}

function layout(W: number, H: number, aspect: Aspect | "stage", artW: number, artH: number): Layout {
  const u = W / 1080;
  let region: { x: number; y: number; w: number; h: number };
  let header: Layout["header"];
  let footerY: number | undefined;
  if (aspect === "vertical") {
    // Header, sheet and caption as one group, centred on the screen; the credit sits at the bottom.
    const side = W - 120 * u;
    const top = (H - (130 * u + side + 150 * u)) / 2;
    header = { titleY: top + 56 * u, subY: top + 108 * u };
    region = { x: 60 * u, y: top + 150 * u, w: side, h: side };
    footerY = H - 96 * u;
  } else if (aspect === "square") {
    region = { x: 150 * u, y: 100 * u, w: W - 300 * u, h: H - 100 * u - 178 * u };
  } else {
    region = { x: 40 * u, y: 40 * u, w: W - 80 * u, h: H - 40 * u - 150 * u };
  }
  const k = Math.min(region.w / artW, region.h / artH);
  const bw = artW * k;
  const bh = artH * k;
  const board = { x: region.x + (region.w - bw) / 2, y: region.y + (region.h - bh) / 2, w: bw, h: bh, r: Math.min(bw, bh) * 0.025 };
  const below = board.y + bh;
  const t = aspect === "vertical" ? 1.18 : 1;
  return { W, H, u, t, board, barY: below + 30 * u, captionY: below + 80 * u * t, header, footerY };
}

export class TimelapseCompositor {
  readonly plan: TLPlan;
  private L: Layout;
  private rasters = new Map<number, Promise<HTMLCanvasElement>>();
  private strokes = new Map<number, Promise<Stroke[]>>();
  private card: Promise<HTMLCanvasElement> | null = null;
  private bg: string;
  private artW: number;
  private artH: number;
  private wordmark = new Path2D(BRAND_WORD.d);

  constructor(
    readonly model: TLModel,
    readonly look: TLLook & { stage?: boolean },
    readonly W: number,
    readonly H: number,
    plan?: TLPlan,
    private cacheLimit = 16,
  ) {
    this.plan = plan ?? makePlan(model);
    const f = finalFrame(model);
    this.bg = f.background ?? "#ffffff";
    this.artW = f.width;
    this.artH = f.height;
    this.L = layout(W, H, look.stage ? "stage" : look.aspect, f.width, f.height);
  }

  get states() {
    return this.model.states.length;
  }

  private doc(k: number): DocT {
    return stateDoc(this.model, k, this.look.sketches);
  }

  /** State k rasterized at the board's pixel size, opaque on the artboard color. */
  raster(k: number): Promise<HTMLCanvasElement> {
    let p = this.rasters.get(k);
    if (p) {
      this.rasters.delete(k);
      this.rasters.set(k, p);
      return p;
    }
    p = (async () => {
      const doc = this.doc(k);
      await prepareFonts(doc);
      const svg = buildSvg(doc, { includeWorking: this.look.sketches, background: null });
      const { w, h } = this.L.board;
      return svgToCanvas(svg, Math.max(1, Math.round(w)), { height: Math.max(1, Math.round(h)), background: doc.artboard.background ?? "#ffffff" });
    })();
    this.rasters.set(k, p);
    p.catch(() => this.rasters.delete(k));
    while (this.rasters.size > this.cacheLimit) {
      const oldest = this.rasters.keys().next().value!;
      void this.rasters.get(oldest)?.then((c) => (c.width = c.height = 0)).catch(() => undefined);
      this.rasters.delete(oldest);
    }
    return p;
  }

  /** Warm the cache for the states around k. */
  prefetch(k: number, ahead = 2) {
    for (let i = k; i <= Math.min(this.states - 1, k + ahead); i++) if (!this.rasters.has(i)) void this.raster(i).catch(() => undefined);
  }

  /** Pencil outlines of the layers new in step `s` (0-based), in artboard coordinates. */
  private pencil(s: number): Promise<Stroke[]> {
    let p = this.strokes.get(s);
    if (p) return p;
    p = (async () => {
      const step = this.model.data.steps[s];
      if (!step?.added.length) return [];
      const doc = this.doc(s + 1);
      await prepareFonts(doc);
      const out: Stroke[] = [];
      for (const id of step.added) {
        const n = doc.nodes[id];
        if (!n || !n.visible) continue;
        const d = nodePath(n);
        if (!d) continue;
        const m = worldMatrix(doc, id);
        const { length, pts } = measure(d);
        if (!length) continue;
        const path = new Path2D();
        path.addPath(new Path2D(d), new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]));
        const det = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        out.push({ path, length: length * det, pts: pts.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]) });
      }
      return out.slice(0, 40);
    })();
    this.strokes.set(s, p);
    if (this.strokes.size > 60) this.strokes.delete(this.strokes.keys().next().value!);
    return p;
  }

  /** How long a step's pencil keeps drawing (it may overlap the next steps). */
  private penDur(s: number) {
    return Math.max(480, Math.min(1100, (this.plan.durs[s] ?? 0) * 1.1));
  }

  private endCard(): Promise<HTMLCanvasElement> {
    if (this.card) return this.card;
    this.card = (async () => {
      const { W, H, u } = this.L;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = this.bg;
      ctx.fillRect(0, 0, W, H);
      const doc = stateDoc(this.model, this.states - 1, false);
      await prepareFonts(doc);
      const svg = buildSvg(doc, { trim: { pad: 0.02 }, background: null });
      const box = this.look.aspect === "vertical" && !this.look.stage ? { w: W * 0.66, h: H * 0.34 } : { w: W * 0.56, h: H * 0.5 };
      const vb = /viewBox="([\d.\-e ]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number) ?? [0, 0, this.artW, this.artH];
      const aspect = (vb[2] || 1) / (vb[3] || 1);
      const k = Math.min(box.w / aspect, box.h);
      const lw = k * aspect;
      const lh = k;
      try {
        const logo = await svgToCanvas(svg, Math.round(lw), { height: Math.round(lh) });
        ctx.drawImage(logo, (W - lw) / 2, (H - lh) / 2 - 40 * u, lw, lh);
        logo.width = logo.height = 0;
      } catch {
        /* empty version: the card is just the wordmark */
      }
      this.drawMadeWith(ctx, H - (this.look.aspect === "vertical" && !this.look.stage ? 120 : 92) * u, isLight(this.bg) ? INK : "#f4f5f5", 1);
      return c;
    })();
    return this.card;
  }

  /** "Made with Brusshy" (small wordmark), centered on baseline y. */
  private drawMadeWith(ctx: CanvasRenderingContext2D, y: number, color: string, alpha: number) {
    const { W, u } = this.L;
    const size = 22 * u;
    setFont(ctx, 500, size, FONT, 0.2 * u);
    const label = "Made with";
    const tw = ctx.measureText(label).width;
    const wh = 26 * u;
    const ww = (wh * BRAND_WORD.width) / BRAND_WORD.height;
    const gap = 10 * u;
    const x0 = (W - (tw + gap + ww)) / 2;
    ctx.save();
    ctx.globalAlpha = alpha * 0.62;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, x0, y);
    ctx.globalAlpha = alpha * 0.9;
    ctx.translate(x0 + tw + gap, y - wh * 0.86);
    ctx.scale(wh / BRAND_WORD.height, wh / BRAND_WORD.height);
    ctx.fill(this.wordmark);
    ctx.restore();
  }

  private backdrop(ctx: CanvasRenderingContext2D) {
    const { W, H, u } = this.L;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    // The drafting-table dot grid, very faint.
    const gap = 27 * u;
    const r = Math.max(0.6, 1.1 * u);
    ctx.fillStyle = "rgba(11,12,14,0.085)";
    for (let y = gap / 2; y < H; y += gap) for (let x = gap / 2; x < W; x += gap) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }

  /** Draw the composition at time t (ms). */
  async draw(ctx: CanvasRenderingContext2D, t: number): Promise<void> {
    const { plan } = this;
    const L = this.L;
    const N = this.model.data.steps.length;
    const si = stepAt(plan, t);
    // Which states are on the board and how far the transition is.
    let from = 0;
    let to = 0;
    let mix = 0;
    if (si >= N) from = to = N;
    else if (si >= 0) {
      const local = t - plan.starts[si]!;
      const dur = plan.durs[si]!;
      const step = this.model.data.steps[si]!;
      from = si;
      to = si + 1;
      if (step.added.length) {
        const pen = this.penDur(si);
        const start = Math.min(pen * 0.3, dur * 0.35);
        const len = Math.max(1, Math.min(dur * 0.95 - start, 650));
        mix = easeInOut(clamp01((local - start) / len));
      } else {
        mix = easeInOut(clamp01(local / Math.max(1, Math.min(dur * 0.9, 520))));
      }
    }
    const inCard = t >= plan.cardAt;
    const cardA = inCard ? easeInOut(clamp01((t - plan.cardAt) / plan.cardFade)) : 0;

    const [a, b, card] = await Promise.all([
      cardA < 1 ? this.raster(from) : null,
      cardA < 1 && mix > 0 && to !== from ? this.raster(to) : null,
      inCard ? this.endCard() : null,
    ]);
    const strokes = cardA < 1 && si >= 0 && si < N + 1 ? await this.activeStrokes(t, Math.min(si, N - 1)) : [];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (cardA < 1) {
      this.backdrop(ctx);
      const { x, y, w, h, r } = L.board;
      // Sheet shadow.
      ctx.save();
      ctx.shadowColor = "rgba(11,12,14,0.14)";
      ctx.shadowBlur = 48 * L.u;
      ctx.shadowOffsetY = 16 * L.u;
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = this.bg;
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, x, y, w, h, r);
      ctx.clip();
      if (a) ctx.drawImage(a, x, y, w, h);
      if (b && mix > 0) {
        ctx.globalAlpha = mix;
        ctx.drawImage(b, x, y, w, h);
        ctx.globalAlpha = 1;
      }
      this.drawStrokes(ctx, strokes);
      ctx.restore();
      ctx.save();
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
      ctx.strokeStyle = "rgba(11,12,14,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      this.overlay(ctx, t, si);
    }
    if (card && cardA > 0) {
      ctx.globalAlpha = cardA;
      ctx.drawImage(card, 0, 0, L.W, L.H);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // Keep the next states ready while this one shows.
    if (si >= 0 && si < N) this.prefetch(si + 1, 2);
  }

  private async activeStrokes(t: number, si: number): Promise<{ s: Stroke; p: number; fade: number }[]> {
    const out: { s: Stroke; p: number; fade: number }[] = [];
    const { plan } = this;
    for (let i = si; i >= 0; i--) {
      const start = plan.starts[i]!;
      if (t - start > 1600) break;
      const step = this.model.data.steps[i]!;
      if (!step.added.length) continue;
      const pen = this.penDur(i);
      const list = await this.pencil(i);
      const stagger = Math.min(110, (pen * 0.45) / Math.max(1, list.length));
      list.forEach((s, j) => {
        const local = t - start - j * stagger;
        if (local < 0 || local > pen) return;
        const x = local / pen;
        out.push({ s, p: easeOut(clamp01(x / 0.62)), fade: x < 0.62 ? 1 : 1 - clamp01((x - 0.62) / 0.38) });
      });
    }
    return out;
  }

  private drawStrokes(ctx: CanvasRenderingContext2D, list: { s: Stroke; p: number; fade: number }[]) {
    if (!list.length) return;
    const { x, y, w } = this.L.board;
    const k = w / this.artW;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.strokeStyle = PENCIL;
    ctx.fillStyle = PENCIL;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const lw = (2.4 * this.L.u) / k;
    ctx.lineWidth = lw;
    for (const { s, p, fade } of list) {
      ctx.globalAlpha = fade;
      ctx.setLineDash([s.length * p, s.length * 2 + 1]);
      ctx.stroke(s.path);
      if (p < 1 && s.pts.length) {
        const i = Math.min(s.pts.length - 1, Math.round(p * (s.pts.length - 1)));
        const [px, py] = s.pts[i]!;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px, py, lw * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private overlay(ctx: CanvasRenderingContext2D, t: number, si: number) {
    const L = this.L;
    const { board } = L;
    const u = L.u * L.t;
    const bu = L.u;
    const N = this.model.data.steps.length;
    const { plan } = this;
    const data = this.model.data;

    if (L.header) {
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      setFont(ctx, 640, 60 * u, FONT, -0.6 * u);
      const name = data.docName.length > 26 ? data.docName.slice(0, 25) + "…" : data.docName;
      ctx.fillText(name, L.W / 2, L.header.titleY);
      setFont(ctx, 600, 21 * u, FONT, 3.4 * u);
      ctx.fillStyle = INK3;
      ctx.fillText(`DESIGN TIMELAPSE · ${data.frameName.toUpperCase()}`, L.W / 2, L.header.subY);
      ctx.textAlign = "left";
    }

    // Progress: a hairline under the sheet that fills as the version is built.
    const prog = N ? clamp01((t - plan.intro) / Math.max(1, plan.buildEnd - plan.intro)) : 1;
    ctx.fillStyle = "rgba(11,12,14,0.08)";
    roundRect(ctx, board.x, L.barY, board.w, 3 * bu, 1.5 * bu);
    ctx.fill();
    ctx.fillStyle = INK;
    roundRect(ctx, board.x, L.barY, Math.max(3 * bu, board.w * prog), 3 * bu, 1.5 * bu);
    ctx.fill();

    const cur: TimelapseStep | null = si >= N ? (data.steps[N - 1] ?? null) : si >= 0 ? (data.steps[si] ?? null) : null;
    if (this.look.captions) {
      const y = L.captionY;
      let x = board.x;
      setFont(ctx, 600, 17 * u, FONT, 2.6 * u);
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK3;
      const stepTxt = si < 0 ? "START" : si >= N ? "DONE" : `STEP ${si + 1} / ${N}`;
      ctx.fillText(stepTxt, x, y);
      x += ctx.measureText(stepTxt).width + 18 * u;
      if (cur && si < N) {
        const ai = cur.author === "agent";
        setFont(ctx, 650, 17 * u, FONT, 1.2 * u);
        const tag = ai ? "AI" : "YOU";
        const tw = ctx.measureText(tag).width;
        const ph = 32 * u;
        const pw = tw + 26 * u;
        roundRect(ctx, x, y - ph / 2, pw, ph, ph / 2);
        ctx.fillStyle = ai ? PENCIL : INK;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(tag, x + 13 * u, y + 0.5 * u);
        x += pw + 16 * u;
      }
      setFont(ctx, 560, 28 * u, FONT, -0.2 * u);
      ctx.fillStyle = INK;
      const caption = si < 0 ? (data.startsBlank ? "A blank artboard" : "Where the history begins") : si >= N ? "Finished" : cur!.caption;
      const room = board.x + board.w - x - (this.look.clock ? 150 * u : 0);
      let text = caption;
      while (text.length > 3 && ctx.measureText(text).width > room) text = text.slice(0, -2);
      if (text !== caption) text = text.trimEnd() + "…";
      ctx.fillText(text, x, y + 1 * u);
    }

    if (this.look.clock && N) {
      const at = si < 0 ? data.startedAt : (cur?.at ?? data.endedAt);
      const label = formatElapsed(at - data.startedAt);
      setFont(ctx, 500, 24 * u, MONO, 0);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK2;
      const rx = board.x + board.w;
      ctx.fillText(label, rx, L.captionY + 1 * u);
      const lw = ctx.measureText(label).width;
      // A small clock glyph.
      const cx = rx - lw - 20 * u;
      const cy = L.captionY;
      ctx.strokeStyle = INK3;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, 9 * u, 0, Math.PI * 2);
      ctx.moveTo(cx, cy - 5 * u);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 4 * u, cy + 2.5 * u);
      ctx.stroke();
      ctx.textAlign = "left";
    }

    if (L.footerY !== undefined) this.drawMadeWith(ctx, L.footerY, INK, 1);
  }

  dispose() {
    for (const p of this.rasters.values()) void p.then((c) => (c.width = c.height = 0)).catch(() => undefined);
    this.rasters.clear();
    void this.card?.then((c) => (c.width = c.height = 0)).catch(() => undefined);
    this.card = null;
  }
}

/** Make sure the overlay font is ready before drawing text onto canvases. */
export async function overlayFontsReady() {
  try {
    await Promise.all([document.fonts.load(`600 24px ${FONT}`), document.fonts.load(`500 24px ${FONT}`)]);
  } catch {
    /* system font fallback */
  }
}

export { stepOf };
