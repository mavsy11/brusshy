import { create } from "zustand";
import type { AnimPlan } from "@brusshy/core";

/**
 * Preview transport shared by the panel's mini stage and the canvas overlay.
 * Time lives outside React (rAF-driven); only the mode is reactive.
 */

export type PlayerMode = "off" | "playing" | "paused";

export const usePlayer = create<{ mode: PlayerMode; total: number }>(() => ({ mode: "off", total: 0 }));

type Listener = (t: number) => void;

let time = 0;
let plan: AnimPlan | null = null;
let raf = 0;
let last = 0;
let holdUntil = 0;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l(time));

/** Timeline length shown by the scrubber: entrance + hold, or + one loop cycle (it then repeats). */
export const timelineLength = (p: AnimPlan | null) => (p ? Math.max(600, p.loop ? p.loop.start + p.loop.period : p.total) : 0);

/** Clock time as shown on the scrubber (loops wrap into the last cycle). */
export const displayTime = (t: number, p: AnimPlan | null) => {
  const total = timelineLength(p);
  if (!p?.loop || t <= total) return t;
  return p.loop.start + ((t - p.loop.start) % p.loop.period);
};

/** Resting time: the end of the entrance, before any loop starts (= the static artwork). */
export const restTime = (p: AnimPlan | null) => (p ? p.entranceEnd : 0);

function frame(now: number) {
  raf = 0;
  if (usePlayer.getState().mode !== "playing" || !plan) return;
  const dt = Math.min(250, now - last);
  last = now;
  const total = timelineLength(plan);
  if (holdUntil) {
    if (now >= holdUntil) {
      holdUntil = 0;
      player.stop();
      return;
    }
  } else {
    time += dt;
    if (time >= total) {
      if (plan.loop) {
        // Keep the clock running (seamless for phase-shifted parts); the scrubber shows it wrapped.
        if (time > total + plan.loop.period * 1000) time -= plan.loop.period * 1000;
      } else {
        time = total;
        holdUntil = now + 450;
      }
    }
  }
  emit();
  raf = requestAnimationFrame(frame);
}

export const player = {
  get time() {
    return time;
  },
  get plan() {
    return plan;
  },
  setPlan(p: AnimPlan | null) {
    plan = p;
    const total = timelineLength(p);
    if (time > total) time = total;
    usePlayer.setState({ total });
    if (!p || (p.entranceEnd === 0 && !p.loop)) this.stop();
    emit();
  },
  play(from?: number) {
    if (!plan || (plan.entranceEnd === 0 && !plan.loop)) return;
    const total = timelineLength(plan);
    if (from !== undefined) time = from;
    else if (time >= total - 1 || usePlayer.getState().mode === "off") time = 0;
    holdUntil = 0;
    last = performance.now();
    usePlayer.setState({ mode: "playing" });
    emit();
    if (!raf) raf = requestAnimationFrame(frame);
  },
  pause() {
    if (usePlayer.getState().mode === "playing") usePlayer.setState({ mode: "paused" });
  },
  toggle() {
    if (usePlayer.getState().mode === "playing") this.pause();
    else this.play();
  },
  /** Scrub (pauses). */
  seek(t: number) {
    time = Math.max(0, Math.min(timelineLength(plan), t));
    holdUntil = 0;
    usePlayer.setState({ mode: "paused" });
    emit();
  },
  stop() {
    holdUntil = 0;
    usePlayer.setState({ mode: "off" });
    time = 0;
    emit();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    l(time);
    return () => listeners.delete(l);
  },
};
