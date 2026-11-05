import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  animationOf,
  deepMerge,
  frameDoc,
  hasAnimation,
  ENTRANCE_KINDS,
  ENTRANCE_PRESETS,
  LOOP_KINDS,
  LOOP_PRESETS,
  NO_ANIMATION,
  type AnimationT,
  type DocT,
  type EasingName,
  type EntranceKind,
  type FrameNodeT,
  type LoopKind,
  type PartOrder,
} from "@brusshy/core";
import { dispatch } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import { buildAnimation, type BuiltAnimation } from "../animation/engine";
import { displayTime, player, timelineLength, usePlayer } from "../animation/player";
import { AnimSvg, CanvasOverlay } from "../animation/Stage";
import { Section } from "./controls";
import "../animation/animation.css";

/* ---------------- glyphs (each hints at its motion; they move on hover) ---------------- */

const g = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const ENTRANCE_GLYPHS: Record<EntranceKind, ReactNode> = {
  none: g(<path d="M4 12 12 4" />),
  fade: g(
    <>
      <circle cx="8" cy="8" r="4.5" strokeDasharray="1.6 1.8" />
      <circle className="gl-m" cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>,
  ),
  "fade-up": g(<path className="gl-m" d="M8 12.5V4M4.8 7 8 3.8 11.2 7" />),
  "scale-in": g(
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeDasharray="1.6 1.8" />
      <rect className="gl-m" x="5.5" y="5.5" width="5" height="5" rx="1" />
    </>,
  ),
  pop: g(
    <>
      <circle className="gl-m" cx="8" cy="8" r="3" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
    </>,
  ),
  draw: g(<path className="gl-draw" d="M2.5 12.5c2-6 4.5-9 6-9s1.5 3-.5 5.5 1.5 3 5-1" pathLength="1" />),
  wipe: g(
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path className="gl-m" d="M2.5 3.5h5v9h-5z" fill="currentColor" stroke="none" />
    </>,
  ),
  "rotate-in": g(<path className="gl-m" d="M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12.5 3v2.4h-2.4" />),
  bounce: g(
    <>
      <path d="M2 13.5h12" />
      <circle className="gl-m" cx="8" cy="9.5" r="2.4" />
    </>,
  ),
  assemble: g(<path className="gl-m" d="M2.5 2.5 6 6M13.5 2.5 10 6M2.5 13.5 6 10M13.5 13.5 10 10M6 3.5V6H3.5M10 3.5V6h2.5M6 12.5V10H3.5M10 12.5V10h2.5" />),
  cascade: g(<path className="gl-m" d="M3 13V9M6.3 13V7M9.6 13V5M13 13V3" />),
};

const LOOP_GLYPHS: Record<LoopKind, ReactNode> = {
  none: g(<path d="M4 12 12 4" />),
  float: g(<path className="gl-m" d="M2 9c2-3 4-3 6 0s4 3 6 0" />),
  pulse: g(<path className="gl-m" d="M1.5 8.5h3l1.5-4 2.5 7 1.5-3h4.5" />),
  breathe: g(
    <>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="1.6 1.8" />
      <circle className="gl-m" cx="8" cy="8" r="3" />
    </>,
  ),
  rotate: g(<path className="gl-m" d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.6h-2.6" />),
  wiggle: g(<path className="gl-m" d="M8 2.5v3M5 13.5h6M8 5.5l-2.5 8M8 5.5l2.5 8" />),
  shimmer: g(
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path className="gl-m" d="M6 3.5 3.5 12.5M9 3.5 6.5 12.5" />
    </>,
  ),
};

const EASING_LABELS: Record<EasingName, string> = {
  expo: "Expo out",
  quint: "Quint out",
  cubic: "Gentle out",
  drafting: "Drafting",
  back: "Overshoot",
  smooth: "Ease in-out",
  sine: "Sine",
  linear: "Linear",
};

const ORDER_LABELS: Record<PartOrder, string> = {
  layer: "Layer order",
  reverse: "Reverse layers",
  "left-right": "Left → right",
  "right-left": "Right → left",
  "top-bottom": "Top → bottom",
  "bottom-top": "Bottom → top",
  "center-out": "Center out",
  "edges-in": "Edges in",
  custom: "Custom (by id)",
};

const TRAVEL: EntranceKind[] = ["fade-up", "bounce", "assemble", "cascade"];

/* ---------------- controls ---------------- */

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onCommit: (v: number) => void; title?: string }) {
  const [local, setLocal] = useState<number | null>(null);
  const v = local ?? props.value;
  const commit = () => {
    if (local !== null && local !== props.value) props.onCommit(local);
    setLocal(null);
  };
  return (
    <label className="anim-slider" title={props.title}>
      <span className="label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={v}
        style={{ ["--p" as string]: `${((v - props.min) / (props.max - props.min)) * 100}%` }}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="num">{props.format(v)}</span>
    </label>
  );
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 2 : 1)}s` : `${Math.round(v)}ms`);

function Chips<K extends string>(props: { kinds: readonly K[]; value: K; labels: Record<K, { label: string; hint: string }>; glyphs: Record<K, ReactNode>; onPick: (k: K) => void; label: string }) {
  return (
    <div className="anim-chips" role="radiogroup" aria-label={props.label}>
      {props.kinds.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={props.value === k} className={`anim-chip k-${k}${props.value === k ? " on" : ""}`} title={props.labels[k].hint} onClick={() => props.onPick(k)}>
          {props.glyphs[k]}
          <span>{props.labels[k].label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- timeline ---------------- */

function Timeline({ built }: { built: BuiltAnimation }) {
  const total = timelineLength(built.plan);
  const head = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const mode = usePlayer((s) => s.mode);
  useEffect(
    () =>
      player.subscribe((t) => {
        const off = usePlayer.getState().mode === "off";
        const shown = off ? 0 : displayTime(t, built.plan);
        const x = Math.min(1, shown / Math.max(1, total));
        if (head.current) {
          head.current.style.left = `${x * 100}%`;
          head.current.style.opacity = off ? "0" : "1";
        }
        if (readout.current) readout.current.textContent = `${(shown / 1000).toFixed(2)} / ${(total / 1000).toFixed(2)} s`;
      }),
    [total, mode, built.plan],
  );
  const scrub = (e: React.PointerEvent) => {
    const el = track.current;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number }) => {
      const r = el.getBoundingClientRect();
      player.seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * total);
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const parts = built.plan.parts.filter((p) => p.end > p.start);
  const shown = parts.slice(0, 8);
  const loop = built.plan.loop;
  const ticks = Math.min(24, Math.floor(total / 250));
  return (
    <div className="anim-timeline">
      <div className="anim-transport">
        <button type="button" className="anim-play" onClick={() => player.toggle()} aria-label={mode === "playing" ? "Pause" : "Play"} title="Play / pause (Space while previewing)">
          {mode === "playing" ? (
            <svg viewBox="0 0 12 12" aria-hidden>
              <rect x="2.5" y="2" width="2.4" height="8" rx=".6" fill="currentColor" />
              <rect x="7.1" y="2" width="2.4" height="8" rx=".6" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden>
              <path d="M3.5 2.2v7.6c0 .4.4.6.7.4l5.8-3.8a.5.5 0 0 0 0-.8L4.2 1.8c-.3-.2-.7 0-.7.4z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="anim-time" ref={readout} />
        {mode !== "off" && (
          <button type="button" className="anim-done" onClick={() => player.stop()} title="Back to editing (Esc)">
            Done
          </button>
        )}
      </div>
      <div className="anim-track" ref={track} onPointerDown={scrub} role="slider" aria-label="Scrub" aria-valuemin={0} aria-valuemax={total}>
        <div className="anim-ticks">
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <i key={i} className={i % 4 === 0 ? "major" : ""} style={{ left: `${((i * 250) / total) * 100}%` }} />
          ))}
        </div>
        {loop && <div className="anim-loopzone" style={{ left: `${(loop.start / total) * 100}%` }} title="Loop" />}
        <div className="anim-lanes">
          {shown.map((p) => (
            <div key={p.id} className="anim-lane" title={`${p.name || p.id} · ${p.kind} · ${ms(p.start)} → ${ms(p.end)}`}>
              <i style={{ left: `${(p.start / total) * 100}%`, width: `${Math.max(0.8, ((p.end - p.start) / total) * 100)}%` }} />
            </div>
          ))}
          {parts.length > shown.length && <div className="anim-more">+{parts.length - shown.length} parts</div>}
        </div>
        <div className="anim-head" ref={head} />
      </div>
    </div>
  );
}

/** Size of the mini artboard inside the panel stage (fits 228 × 132). */
const fit = (w: number, h: number) => {
  const k = Math.min(228 / w, 132 / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
};

/* ---------------- section ---------------- */

/** Animation of one version: presets, timing, loop, and a live preview on the canvas. */
export function AnimationSection({ doc, f }: { doc: DocT; f: FrameNodeT }) {
  const spec = useMemo(() => animationOf(f.animation), [f.animation]);
  const proj = useMemo(() => frameDoc(doc, f.id), [doc, f.id]);
  const fontV = useFontVersion((s) => s.v);
  const built = useMemo(() => buildAnimation(proj, spec, { animate: false }), [proj, spec, fontV]);
  const animated = hasAnimation(spec);

  useEffect(() => {
    player.setPlan(animated ? built.plan : null);
  }, [built, animated]);
  useEffect(() => () => player.stop(), [f.id]);

  const commit = (patch: Record<string, unknown> | null, label: string, replay = true) => {
    const value = patch === null ? null : f.animation ? patch : deepMerge(structuredClone(NO_ANIMATION) as unknown as Record<string, unknown>, patch);
    dispatch([{ op: "update", id: f.id, set: { animation: value } }], label);
    // Show the result right away (the plan updates on the next render).
    if (replay && patch) requestAnimationFrame(() => player.play(0));
  };
  const e = spec.entrance;
  const l = spec.loop;
  const pickEntrance = (k: EntranceKind) => {
    const p = ENTRANCE_PRESETS[k];
    commit({ entrance: { kind: k, ...(k === "none" ? {} : { duration: p.duration, easing: p.easing, stagger: p.stagger, ...(p.distance !== undefined ? { distance: p.distance } : {}), ...(p.order && e.order !== "custom" ? { order: p.order } : {}) }) } }, `Animation: ${p.label}`, k !== "none");
  };
  const pickLoop = (k: LoopKind) => {
    const p = LOOP_PRESETS[k];
    commit({ loop: { kind: k, ...(k === "none" ? {} : { period: p.period, intensity: p.intensity }) } }, `Loop: ${p.label}`, k !== "none");
  };
  const setE = (patch: Partial<AnimationT["entrance"]>, label: string) => commit({ entrance: patch }, label);
  const setL = (patch: Partial<AnimationT["loop"]>, label: string) => commit({ loop: patch }, label);
  const nParts = built.plan.parts.length;

  return (
    <Section
      title="Animation"
      right={
        f.animation ? (
          <button className="btn small ghost" onClick={() => (player.stop(), commit(null, "Remove animation", false))} title="Remove this version's animation">
            Clear
          </button>
        ) : undefined
      }
    >
      <CanvasOverlay built={built} frameId={f.id} />
      <div className={`anim-stage${animated ? "" : " empty"}`} onClick={() => animated && player.toggle()} title={animated ? "Play / pause" : undefined}>
        <div className={`anim-sheet${f.background ? "" : " clear"}`} style={{ ...fit(f.width, f.height), background: f.background ?? undefined }}>
          <AnimSvg built={built} className="anim-stage-art" />
        </div>
        {!animated && <span className="anim-stage-hint">Pick an entrance or a loop</span>}
      </div>
      {animated && <Timeline built={built} />}

      <div className="anim-label">
        Entrance
        {nParts > 1 && e.kind !== "none" && <span>{nParts} parts</span>}
      </div>
      <Chips kinds={ENTRANCE_KINDS} value={e.kind} labels={ENTRANCE_PRESETS} glyphs={ENTRANCE_GLYPHS} onPick={pickEntrance} label="Entrance" />
      {e.kind !== "none" && (
        <div className="anim-controls">
          <Slider label="Duration" value={e.duration} min={150} max={3000} step={10} format={ms} onCommit={(v) => setE({ duration: v }, "Animation duration")} title="Length of each part's entrance" />
          <Slider label="Delay" value={e.delay} min={0} max={2000} step={10} format={ms} onCommit={(v) => setE({ delay: v }, "Animation delay")} />
          {nParts > 1 && <Slider label="Stagger" value={e.stagger} min={0} max={600} step={5} format={ms} onCommit={(v) => setE({ stagger: v }, "Animation stagger")} title="Time between parts" />}
          {TRAVEL.includes(e.kind) && (
            <Slider label="Travel" value={Math.round(e.distance * 100)} min={1} max={30} format={(v) => `${v}%`} onCommit={(v) => setE({ distance: v / 100 }, "Animation travel")} title="How far parts travel, as % of the artboard" />
          )}
          <div className="grid2">
            <select className="select" value={e.easing} onChange={(ev) => setE({ easing: ev.target.value as EasingName }, "Animation easing")} aria-label="Easing">
              {(Object.keys(EASING_LABELS) as EasingName[]).map((k) => (
                <option key={k} value={k}>
                  {EASING_LABELS[k]}
                </option>
              ))}
            </select>
            <select className="select" value={e.order} onChange={(ev) => setE({ order: ev.target.value as PartOrder }, "Animation order")} aria-label="Part order" disabled={nParts < 2}>
              {(Object.keys(ORDER_LABELS) as PartOrder[]).filter((k) => k !== "custom" || e.order === "custom" || e.ids.length).map((k) => (
                <option key={k} value={k}>
                  {ORDER_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {e.kind === "wipe" && (
            <div className="seg-group" role="group" aria-label="Wipe direction">
              {(["right", "left", "down", "up"] as const).map((d) => (
                <button key={d} className={`seg${e.direction === d ? " on" : ""}`} onClick={() => setE({ direction: d }, "Wipe direction")} title={`Reveal toward the ${d === "down" ? "bottom" : d === "up" ? "top" : d}`}>
                  {d === "right" ? "→" : d === "left" ? "←" : d === "down" ? "↓" : "↑"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="anim-label">Loop</div>
      <Chips kinds={LOOP_KINDS} value={l.kind} labels={LOOP_PRESETS} glyphs={LOOP_GLYPHS} onPick={pickLoop} label="Loop" />
      {l.kind !== "none" && (
        <div className="anim-controls">
          <Slider label="Cycle" value={l.period} min={800} max={l.kind === "rotate" ? 30000 : 10000} step={50} format={ms} onCommit={(v) => setL({ period: v }, "Loop cycle")} title="Length of one cycle" />
          {l.kind !== "rotate" && <Slider label="Strength" value={Math.round(l.intensity * 100)} min={5} max={100} format={(v) => `${v}%`} onCommit={(v) => setL({ intensity: v / 100 }, "Loop strength")} />}
          {l.kind !== "shimmer" && nParts > 1 && (
            <div className="seg-group" role="group" aria-label="Loop target">
              <button className={`seg${l.target === "logo" ? " on" : ""}`} onClick={() => setL({ target: "logo" }, "Loop: whole logo")}>
                Whole logo
              </button>
              <button className={`seg${l.target === "parts" ? " on" : ""}`} onClick={() => setL({ target: "parts" }, "Loop: each part")}>
                Each part
              </button>
            </div>
          )}
        </div>
      )}
      <p className="muted">Subtle wins: entrances under 1.5 s, loops you barely notice. Exports as animated SVG, MP4 and GIF.</p>
    </Section>
  );
}
