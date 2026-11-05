import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast, useStore } from "../lib/store";
import { saveToProject } from "../export/pipeline";
import { downloadBlob, slug } from "../export/util";
import { closeTimelapse, useTimelapseUI } from "./state";
import { formatElapsed, loadTimelapse, type TLModel } from "./data";
import { ASPECT_SIZE, autoBuildMs, DEFAULT_LOOK, makePlan, overlayFontsReady, stepAt, TimelapseCompositor, type TLLook } from "./compose";
import { renderTimelapseGif, renderTimelapseVideo } from "./export";
import "./timelapse.css";

const LOOK_KEY = "brusshy:timelapse:v1";
const SPEEDS = [0.5, 1, 2, 4];
const LENGTHS = [0, 10, 20, 30];

interface Prefs extends TLLook {
  seconds: number;
  dest: "download" | "project";
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) return { ...DEFAULT_LOOK, seconds: 0, dest: "download", ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* blocked storage */
  }
  return { ...DEFAULT_LOOK, seconds: 0, dest: "download" };
}

const clock = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const I = {
  play: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M5 3.2v9.6c0 .5.5.8.9.5l7.3-4.8c.4-.3.4-.8 0-1L5.9 2.7C5.5 2.4 5 2.7 5 3.2z" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="1" />
      <rect x="9" y="3" width="3" height="10" rx="1" />
    </svg>
  ),
  replay: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M3 2.5v2.8h2.8" />
    </svg>
  ),
  prev: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 4 6 8l4 4" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 4 4 4-4 4" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  export: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5v7.5M5 5.5l3-3 3 3M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
    </svg>
  ),
};

export function TimelapsePlayer() {
  const open = useTimelapseUI((s) => s.open);
  return open ? <Player /> : null;
}

function Player() {
  const frame = useTimelapseUI((s) => s.frame);
  const [model, setModel] = useState<TLModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void overlayFontsReady();
    loadTimelapse(frame).then(
      (m) => alive && setModel(m),
      (e: Error) => alive && setError(e.message || "Could not rebuild the history"),
    );
    return () => {
      alive = false;
    };
  }, [frame]);

  // Esc closes even while loading.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !model) {
        e.stopPropagation();
        closeTimelapse();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [model]);

  return (
    <div className="tlp-root" role="dialog" aria-modal="true" aria-label="Design timelapse">
      {model && model.data.steps.length > 0 ? (
        <Stage model={model} />
      ) : (
        <div className="tlp-empty">
          <button className="icon-btn tlp-close-abs" onClick={closeTimelapse} aria-label="Close">
            {I.close}
          </button>
          {error ? (
            <>
              <b>Couldn't rebuild this version's history</b>
              <span>{error}</span>
            </>
          ) : model ? (
            <>
              <b>Nothing to replay yet</b>
              <span>Draw something — every step you or your AI take becomes part of the timelapse.</span>
            </>
          ) : (
            <>
              <span className="tlp-spinner" aria-hidden />
              <span>Rebuilding the history…</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stage({ model }: { model: TLModel }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const setP = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(LOOK_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const look: TLLook = useMemo(() => ({ aspect: prefs.aspect, captions: prefs.captions, clock: prefs.clock, sketches: prefs.sketches }), [prefs.aspect, prefs.captions, prefs.clock, prefs.sketches]);
  const plan = useMemo(() => makePlan(model, prefs.seconds ? prefs.seconds * 1000 : autoBuildMs(model)), [model, prefs.seconds]);
  const N = model.data.steps.length;

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Canvas size: the composition fitted into the stage, at device resolution (capped).
  const size = ASPECT_SIZE[look.aspect];
  const fit = Math.min(box.w / size.w, box.h / size.h);
  const cssW = Math.max(0, Math.floor(size.w * fit));
  const cssH = Math.max(0, Math.floor(size.h * fit));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);

  const comp = useMemo(() => (pxW > 20 && pxH > 20 ? new TimelapseCompositor(model, look, pxW, pxH, plan, 14) : null), [model, look, pxW, pxH, plan]);
  useEffect(() => () => comp?.dispose(), [comp]);

  const tRef = useRef(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const draw = useRef({ busy: false, dirty: false });

  const requestDraw = useCallback(() => {
    const st = draw.current;
    const ctx = canvasRef.current?.getContext("2d", { alpha: false });
    if (!comp || !ctx) return;
    if (st.busy) {
      st.dirty = true;
      return;
    }
    st.busy = true;
    void (async () => {
      try {
        do {
          st.dirty = false;
          await comp.draw(ctx, tRef.current);
        } while (st.dirty);
      } catch (e) {
        console.error("[timelapse] draw failed", e);
      } finally {
        st.busy = false;
      }
    })();
  }, [comp]);

  useEffect(() => {
    // Keep the playhead when the look or length changes (scaled to the new plan).
    tRef.current = Math.min(tRef.current, plan.total);
    requestDraw();
  }, [requestDraw, plan]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    if (tRef.current >= plan.total - 1) tRef.current = 0;
    const loop = (ts: number) => {
      const dt = Math.min(100, ts - last);
      last = ts;
      tRef.current = Math.min(plan.total, tRef.current + dt * speed);
      setNow(tRef.current);
      requestDraw();
      if (tRef.current >= plan.total) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, plan, requestDraw]);

  const seek = useCallback(
    (t: number) => {
      tRef.current = Math.max(0, Math.min(plan.total, t));
      setNow(tRef.current);
      requestDraw();
    },
    [plan, requestDraw],
  );

  /** Show step i fully applied (-1 = the start, N = finished). */
  const seekStep = useCallback(
    (i: number) => {
      setPlaying(false);
      if (i < 0) return seek(0);
      if (i >= N) return seek(plan.buildEnd + 1);
      seek(plan.starts[i]! + Math.max(1, plan.durs[i]! - 1));
    },
    [N, plan, seek],
  );
  const cur = stepAt(plan, now);

  // Keyboard: Space play/pause, ←/→ step, Home/End, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input,textarea,select,[contenteditable]")) return;
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) return;
      const i = stepAt(plan, tRef.current);
      if (e.key === "Escape") closeTimelapse();
      else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekStep(Math.min(N, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekStep(Math.max(-1, i >= N ? N - 1 : i - 1));
      } else if (e.key === "Home") seekStep(-1);
      else if (e.key === "End") seek(plan.total);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [N, plan, seek, seekStep]);

  // Scrubber.
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);
  const tAtX = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * plan.total;
  };
  const onTrackDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPlaying(false);
    seek(tAtX(e.clientX));
  };
  const onTrackMove = (e: React.PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), i: stepAt(plan, tAtX(e.clientX)) });
    if (e.buttons & 1) seek(tAtX(e.clientX));
  };

  const ticks = useMemo(
    () =>
      model.data.steps.map((s, i) => ({
        left: (plan.starts[i]! / plan.total) * 100,
        width: Math.max(0.12, (plan.durs[i]! / plan.total) * 100),
        ai: s.author === "agent",
      })),
    [model, plan],
  );
  const hoverStep = hover && hover.i >= 0 && hover.i < N ? model.data.steps[hover.i]! : null;

  // Export.
  const [menu, setMenu] = useState(false);
  const [job, setJob] = useState<{ kind: "mp4" | "gif"; p: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const runExport = async (kind: "mp4" | "gif") => {
    if (job) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setJob({ kind, p: 0 });
    setPlaying(false);
    try {
      const o = { aspect: look.aspect, look, buildMs: prefs.seconds ? prefs.seconds * 1000 : undefined, onProgress: (p: number) => setJob({ kind, p }), signal: ctrl.signal };
      const r = kind === "mp4" ? await renderTimelapseVideo(model, o) : { blob: await renderTimelapseGif(model, o), ext: "gif" };
      const name = `${slug(model.data.docName)}-timelapse-${look.aspect === "vertical" ? "9x16" : "1x1"}.${r.ext}`;
      if (prefs.dest === "project" && useStore.getState().connected) {
        const res = await saveToProject([{ name, blob: r.blob }], undefined, `${model.data.docName} timelapse`);
        const dir = useStore.getState().projectDir;
        toast(`Saved ${name} to ${dir && res.dir.startsWith(dir) ? res.dir.slice(dir.length).replace(/^[\\/]/, "") : res.dir}`);
      } else {
        downloadBlob(r.blob, name);
        toast(`Downloaded ${name}`);
      }
      setMenu(false);
    } catch (e) {
      if ((e as Error).message !== "Cancelled") toast((e as Error).message || "Export failed", "error");
    } finally {
      abort.current = null;
      setJob(null);
    }
  };
  useEffect(() => () => abort.current?.abort(), []);

  const d = model.data;
  const span = formatElapsed(d.endedAt - d.startedAt);
  const ended = now >= plan.total - 1;

  return (
    <>
      <header className="tlp-top">
        <div className="tlp-title">
          <span className="label">Design timelapse</span>
          <b>
            {d.docName} <span className="tlp-dim">· {d.frameName}</span>
          </b>
          <span className="tlp-sub">
            {N} {N === 1 ? "step" : "steps"} · {span} of work{d.entries > d.visible ? ` · ${d.entries} edits` : ""}
            {!d.startsBlank ? " · history starts mid-way" : ""}
          </span>
        </div>
        <div className="tlp-tools">
          <div className="tlp-seg" role="group" aria-label="Format">
            {(["square", "vertical"] as const).map((a) => (
              <button key={a} aria-pressed={prefs.aspect === a} onClick={() => setP({ aspect: a })} title={a === "square" ? "1080 × 1080" : "1080 × 1920 — stories and reels"}>
                <i className={`tlp-aspect ${a}`} />
                {a === "square" ? "1:1" : "9:16"}
              </button>
            ))}
          </div>
          <div className="tlp-seg" role="group" aria-label="Overlays">
            {(
              [
                ["captions", "Captions"],
                ["clock", "Clock"],
                ["sketches", "Sketches"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} aria-pressed={prefs[k]} onClick={() => setP({ [k]: !prefs[k] } as Partial<Prefs>)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tlp-seg" role="group" aria-label="Length">
            {LENGTHS.map((s) => (
              <button key={s} aria-pressed={prefs.seconds === s} onClick={() => setP({ seconds: s })} title={s ? `Build in ${s} seconds` : "About 0.6 s a step"}>
                {s ? `${s}s` : "Auto"}
              </button>
            ))}
          </div>
          <div className="tlp-export">
            <button className="btn primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              {I.export}
              {job ? `Exporting ${Math.round(job.p * 100)}%` : "Export"}
            </button>
            {menu && (
              <div className="tlp-menu" role="menu">
                <div className="label">{look.aspect === "square" ? "Square · 1080 × 1080" : "Vertical · 1080 × 1920"}</div>
                <button className="tlp-menu-item" disabled={!!job} onClick={() => void runExport("mp4")}>
                  <b>MP4 video</b>
                  <span>H.264, 30 fps — reels, posts, decks</span>
                </button>
                <button className="tlp-menu-item" disabled={!!job} onClick={() => void runExport("gif")}>
                  <b>GIF</b>
                  <span>540 px, loops everywhere</span>
                </button>
                {job && (
                  <div className="tlp-progress">
                    <i style={{ width: `${Math.round(job.p * 100)}%` }} />
                  </div>
                )}
                <div className="tlp-dest">
                  <span>Save to</span>
                  <div className="tlp-seg small" role="group" aria-label="Destination">
                    <button aria-pressed={prefs.dest === "download"} onClick={() => setP({ dest: "download" })}>
                      Downloads
                    </button>
                    <button aria-pressed={prefs.dest === "project"} onClick={() => setP({ dest: "project" })}>
                      Project
                    </button>
                  </div>
                </div>
                {job && (
                  <button className="btn small ghost" onClick={() => abort.current?.abort()}>
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={closeTimelapse} aria-label="Close timelapse">
            {I.close}
            <span className="tip below">
              Close <span className="kbd">Esc</span>
            </span>
          </button>
        </div>
      </header>

      <div className="tlp-stage" ref={stageRef} onPointerDown={() => setMenu(false)}>
        <canvas
          ref={canvasRef}
          className={`tlp-canvas ${look.aspect}`}
          width={pxW}
          height={pxH}
          style={{ width: cssW, height: cssH }}
          onClick={() => (ended ? (seek(0), setPlaying(true)) : setPlaying((p) => !p))}
        />
      </div>

      <footer className="tlp-transport">
        <button className="icon-btn" onClick={() => seekStep(Math.max(-1, cur >= N ? N - 1 : cur - 1))} aria-label="Previous step">
          {I.prev}
        </button>
        <button
          className="tlp-play"
          onClick={() => {
            if (ended) seek(0);
            setPlaying((p) => (ended ? true : !p));
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? I.pause : ended ? I.replay : I.play}
        </button>
        <button className="icon-btn" onClick={() => seekStep(Math.min(N, cur + 1))} aria-label="Next step">
          {I.next}
        </button>
        <span className="tlp-time">{clock(now)}</span>
        <div className="tlp-track" ref={trackRef} onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerLeave={() => setHover(null)} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={Math.round(plan.total)} aria-valuenow={Math.round(now)}>
          <div className="tlp-ticks">
            {ticks.map((t, i) => (
              <i key={i} className={`${t.ai ? "ai" : "you"}${i === cur ? " on" : ""}${i < cur || cur >= N ? " done" : ""}`} style={{ left: `${t.left}%`, width: `${t.width}%` }} />
            ))}
            <i className="tlp-tail" style={{ left: `${(plan.buildEnd / plan.total) * 100}%`, right: 0 }} />
          </div>
          <div className="tlp-head" style={{ left: `${(now / plan.total) * 100}%` }} />
          {hover && (
            <div className="tlp-tip" style={{ left: hover.x }}>
              {hoverStep ? (
                <>
                  <span className="tlp-tip-step">Step {hover.i + 1}</span>
                  <span className={`tlp-who ${hoverStep.author}`}>{hoverStep.author === "agent" ? "AI" : "You"}</span>
                  <span className="tlp-tip-label">{hoverStep.label}</span>
                </>
              ) : (
                <span className="tlp-tip-label">{hover.i < 0 ? "Start" : "Finished · end card"}</span>
              )}
            </div>
          )}
        </div>
        <span className="tlp-time dim">{clock(plan.total)}</span>
        <div className="tlp-seg small" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <div className="tlp-legend" aria-hidden>
          <span>
            <i className="ai" /> AI
          </span>
          <span>
            <i className="you" /> You
          </span>
        </div>
      </footer>
    </>
  );
}
