import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { photoLikelihood, resolveVectorizeOptions, vectorizeOps, type VectorizeMode, type VectorizeOptions, type VectorizeResult } from "@brusshy/core";
import { dispatch, select, toast, useStore } from "../lib/store";
import { closeVectorize, decodeReference, Tracer, useVectorize, type Decoded, type VectorizeTab } from "./run";
import { CloseButton, Slider } from "./controls";
import { PhotoTab } from "./PhotoTab";
import "./command";
import "./vectorize.css";

interface Choices {
  mode: VectorizeMode;
  colors: number;
  autoThreshold: boolean;
  threshold: number;
  smoothing: number;
  detail: number;
  specks: number;
  evenLighting: boolean | null;
}

const DEFAULTS: Choices = { mode: "shapes", colors: 1, autoThreshold: true, threshold: 0.4, smoothing: 0.5, detail: 0.5, specks: 0.25, evenLighting: null };
const KEY = "brusshy:vectorize:v1";

function load(): Choices {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Choices>) };
  } catch {
    /* storage blocked */
  }
  return DEFAULTS;
}

type View = "overlay" | "result" | "outline";

export function VectorizeDialog() {
  const refId = useVectorize((s) => s.refId);
  const doc = useStore((s) => s.doc);
  const ref = refId && doc ? doc.nodes[refId] : undefined;
  if (!refId || !ref || ref.type !== "reference") return null;
  return <Dialog key={refId} refId={refId} src={ref.src} width={ref.width} height={ref.height} name={ref.name || "image"} />;
}

const TAB_KEY = "brusshy:vectorize:tab";

export interface TabProps {
  refId: string;
  width: number;
  height: number;
  name: string;
  decoded: Decoded | null;
  error: string | null;
  /** The tab switcher, rendered in the side panel's header. */
  tabs: ReactNode;
}

function Dialog({ refId, src, width, height, name }: { refId: string; src: string; width: number; height: number; name: string }) {
  const forced = useVectorize((s) => s.tab);
  const [tab, setTabState] = useState<VectorizeTab | null>(() => {
    if (forced) return forced;
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (t === "image" || t === "photo") return t;
    } catch {
      /* storage blocked */
    }
    return null; // decided once the image is decoded
  });
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let url = "";
    decodeReference(src)
      .then((d) => {
        url = d.url;
        if (!alive) return URL.revokeObjectURL(d.url);
        setDecoded(d);
        // First time: photos of objects open on the Photo tab, sketches and flat art on Image.
        setTabState((t) => t ?? (photoLikelihood(d.image) > 0.45 ? "photo" : "image"));
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  const setTab = (t: VectorizeTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  const tabs = (
    <div className="vz-tabs" role="tablist" aria-label="Source">
      {(
        [
          ["image", "Sketch / Artwork"],
          ["photo", "Photo / Object"],
        ] as const
      ).map(([t, label]) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
          {label}
        </button>
      ))}
    </div>
  );
  const props: TabProps = { refId, width, height, name, decoded, error, tabs };
  return tab === "photo" ? <PhotoTab {...props} /> : <ImageTab {...props} />;
}

function ImageTab({ refId, width, height, name, decoded, error: decodeError, tabs }: TabProps) {
  const [c, setC] = useState<Choices>(load);
  const [result, setResult] = useState<VectorizeResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [traceError, setError] = useState<string | null>(null);
  const error = decodeError ?? traceError;
  const [view, setView] = useState<View>("overlay");
  const [peek, setPeek] = useState(false);
  const [autoT, setAutoT] = useState(0.4);
  const tracer = useRef<Tracer | null>(null);

  const set = (patch: Partial<Choices>) =>
    setC((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const options: VectorizeOptions = useMemo(
    () => ({
      mode: c.mode,
      colors: c.colors,
      threshold: c.autoThreshold ? null : c.threshold,
      smoothing: c.smoothing,
      detail: c.detail,
      specks: c.specks,
      evenLighting: c.evenLighting ?? undefined,
      target: { width, height },
    }),
    [c, width, height],
  );
  const evenLighting = c.evenLighting ?? resolveVectorizeOptions(options).evenLighting;

  useEffect(() => {
    tracer.current = new Tracer();
    return () => tracer.current?.dispose();
  }, []);

  // Live preview (debounced; stale answers are dropped by the tracer).
  useEffect(() => {
    if (!decoded) return;
    setBusy(true);
    const t = setTimeout(() => {
      tracer.current
        ?.run(decoded.image, options)
        .then((r) => {
          setResult(r);
          setError(null);
          setBusy(false);
          if (r.threshold !== null) setAutoT(r.threshold);
        })
        .catch((e) => {
          if ((e as Error).message === "superseded") return;
          setError((e as Error).message);
          setBusy(false);
        });
    }, 90);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, options]);

  const apply = () => {
    const d = useStore.getState().doc;
    if (!d || !result || !result.stats.parts) return;
    const { ops, groupId } = vectorizeOps(d, refId, result, { name: `Vectorized ${name}` });
    if (dispatch(ops, "Vectorize image")) {
      select([groupId]);
      toast(`Vectorized: ${result.stats.parts} ${c.mode === "lines" ? "strokes" : "shapes"}, ${result.stats.nodes} nodes`);
      closeVectorize();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeVectorize();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        apply();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const stroke = Math.max(width, height) / 500;
  const show = peek ? "image" : view;
  const empty = result && !result.stats.parts;

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeVectorize()}>
      <div className="modal vz" role="dialog" aria-modal="true" aria-labelledby="vz-title" data-ui>
        <div className="vz-stage">
          <div className="vz-views" role="group" aria-label="Preview">
            {(["overlay", "result", "outline"] as View[]).map((v) => (
              <button key={v} className={`vz-chip${view === v ? " on" : ""}`} onClick={() => setView(v)}>
                {v === "overlay" ? "Over image" : v === "result" ? "Result" : "Outlines"}
              </button>
            ))}
            <button className="vz-chip" onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} title="Hold to see the original">
              Hold for original
            </button>
          </div>
          <div className="vz-canvas">
            {decoded ? (
              <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
                <rect width={width} height={height} fill="#ffffff" />
                {show !== "result" && (
                  <image href={decoded.url} width={width} height={height} preserveAspectRatio="none" opacity={show === "image" ? 1 : show === "overlay" ? 0.28 : 0.55} />
                )}
                {show !== "image" &&
                  result?.layers.map((l, i) => (
                    <g
                      key={i}
                      fill={show === "outline" ? "none" : l.kind === "fill" ? l.color : "none"}
                      fillRule="evenodd"
                      stroke={show === "outline" ? "#ff4d1f" : l.kind === "stroke" ? l.color : "none"}
                      strokeWidth={show === "outline" ? stroke : l.strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={show === "overlay" ? 0.92 : 1}
                    >
                      {l.parts.map((p, j) => (
                        <path key={j} d={p.d} />
                      ))}
                    </g>
                  ))}
              </svg>
            ) : (
              <div className="vz-wait">{error ?? "Loading the image…"}</div>
            )}
            {busy && decoded && <div className="vz-busy">Tracing…</div>}
          </div>
          <div className="vz-stats">
            {error ? (
              <span className="vz-err">{error}</span>
            ) : empty ? (
              <span className="vz-err">Nothing traced — lower the threshold or the speck size.</span>
            ) : result ? (
              <>
                <b>{result.stats.parts}</b> {c.mode === "lines" ? "strokes" : "shapes"} · <b>{result.stats.nodes}</b> nodes
                {result.layers.length > 0 && (
                  <span className="vz-swatches">
                    {result.layers.map((l, i) => (
                      <i key={i} style={{ background: l.color }} title={l.color} />
                    ))}
                  </span>
                )}
                <span className="vz-dim">
                  traced at {result.stats.workWidth}×{result.stats.workHeight} · {result.stats.ms} ms · on this computer
                </span>
              </>
            ) : (
              "…"
            )}
          </div>
        </div>

        <aside className="vz-side">
          <div className="vz-head">
            <div>
              <div className="vz-title" id="vz-title">
                Vectorize
              </div>
              <div className="vz-sub">Trace “{name}” into editable paths</div>
            </div>
            <CloseButton onClick={closeVectorize} />
          </div>
          {tabs}

          <div className="vz-body">
            <div className="vz-group">
              <div className="label">Trace as</div>
              <div className="vz-mode">
                <button className={c.mode === "shapes" ? "on" : ""} onClick={() => set({ mode: "shapes" })}>
                  <svg viewBox="0 0 32 20" aria-hidden>
                    <path d="M4 16c2-9 8-12 12-12s9 3 12 12z" fill="currentColor" />
                  </svg>
                  <b>Shapes</b>
                  <span>Filled areas — logos, silhouettes</span>
                </button>
                <button className={c.mode === "lines" ? "on" : ""} onClick={() => set({ mode: "lines" })}>
                  <svg viewBox="0 0 32 20" aria-hidden>
                    <path d="M4 15c4-10 9-11 12-5s8 5 12-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                  <b>Lines</b>
                  <span>Centerline strokes — pencil sketches</span>
                </button>
              </div>
            </div>

            <div className="vz-group">
              <div className="vz-field-head">
                <span>Colors</span>
                <span className="vz-num">{c.colors}</span>
              </div>
              <div className="vz-colors" role="group" aria-label="Colors">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} className={`vz-chip${c.colors === n ? " on" : ""}`} onClick={() => set({ colors: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="vz-group">
              <Slider
                label="Threshold"
                hint="Lower picks up fainter marks"
                value={c.autoThreshold ? autoT : c.threshold}
                disabled={c.colors > 1}
                left="Faint marks"
                right="Only dark"
                onChange={(v) => set({ threshold: v, autoThreshold: false })}
              />
              <div className="vz-row">
                <label className="check">
                  <input type="checkbox" checked={c.autoThreshold} disabled={c.colors > 1} onChange={(e) => set({ autoThreshold: e.target.checked, threshold: autoT })} />
                  Automatic
                </label>
                <label className="check" title="Flatten shadows and vignetting of a photographed page">
                  <input type="checkbox" checked={evenLighting} onChange={(e) => set({ evenLighting: e.target.checked })} />
                  Even out lighting
                </label>
              </div>
            </div>

            <div className="vz-group">
              <Slider label="Smoothing" hint="Rounder curves and fewer corners" value={c.smoothing} left="Faithful" right="Smooth" onChange={(v) => set({ smoothing: v })} />
              <Slider label="Detail" hint="More nodes, closer to the image" value={c.detail} left="Simple" right="Detailed" onChange={(v) => set({ detail: v })} />
              <Slider label="Ignore specks" hint="Drop dots and fill pinholes up to this size" value={c.specks} left="Keep all" right="Large" onChange={(v) => set({ specks: v })} />
            </div>

            <p className="vz-note">
              Runs offline on this computer. The result lands as one group right over the image (one undo step); the image stays as a reference and is never exported. Then ask your AI to simplify and clean it up.
            </p>
          </div>

          <div className="vz-foot">
            <button className="btn ghost" onClick={() => setC(DEFAULTS)}>
              Reset
            </button>
            <div className="grow" />
            <button className="btn" onClick={closeVectorize}>
              Cancel
            </button>
            <button className="btn primary" disabled={!result || !result.stats.parts || busy} onClick={apply} title="⌘↵">
              Add paths
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
