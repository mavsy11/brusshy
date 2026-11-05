import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { PHOTO_DEFAULTS, vectorizeOps, type PhotoCrop, type PhotoStyle, type PhotoSubject, type PhotoVectorizeOptions, type PhotoVectorizeResult } from "@brusshy/core";
import { dispatch, select, toast, useStore } from "../lib/store";
import { closeVectorize, Tracer } from "./run";
import { CloseButton, Segmented, Slider } from "./controls";
import type { TabProps } from "./VectorizeDialog";

/**
 * "Photo / Object" tab: cut the subject out of a photo (offline, no ML), then draw it as a
 * silhouette, posterized tones, line art or a stencil. Live mask preview, crop handles,
 * style thumbnails, before/after hold.
 */

interface PhotoChoices {
  style: PhotoStyle;
  subject: PhotoSubject;
  autoTolerance: boolean;
  tolerance: number;
  shadows: number;
  keep: number;
  fillHoles: boolean;
  isolate: boolean;
  cleanup: number;
  exposure: number;
  contrast: number;
  denoise: number;
  detail: number;
  smoothing: number;
  corners: number;
  specks: number;
  tones: number;
  palette: "color" | "mono";
  bridges: number;
  weight: number;
}

const D = PHOTO_DEFAULTS;
const DEFAULTS: PhotoChoices = {
  style: D.style,
  subject: D.subject,
  autoTolerance: true,
  tolerance: 0.3,
  shadows: D.shadows,
  keep: D.keep,
  fillHoles: D.fillHoles,
  isolate: D.isolate,
  cleanup: D.cleanup,
  exposure: D.exposure,
  contrast: D.contrast,
  denoise: D.denoise,
  detail: D.detail,
  smoothing: D.smoothing,
  corners: D.corners,
  specks: D.specks,
  tones: D.tones,
  palette: D.palette,
  bridges: D.bridges,
  weight: D.weight,
};
const KEY = "brusshy:vectorize:photo:v1";

function load(): PhotoChoices {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PhotoChoices>) };
  } catch {
    /* storage blocked */
  }
  return DEFAULTS;
}

type View = "subject" | "overlay" | "result" | "outline";
const VIEWS: [View, string][] = [
  ["subject", "Subject"],
  ["overlay", "Over photo"],
  ["result", "Result"],
  ["outline", "Outlines"],
];

const STYLES: { id: PhotoStyle; name: string; hint: string }[] = [
  { id: "silhouette", name: "Silhouette", hint: "One solid shape" },
  { id: "posterized", name: "Posterized", hint: "Stacked tones" },
  { id: "lineart", name: "Line art", hint: "Edges as strokes" },
  { id: "stencil", name: "Stencil", hint: "Cut-ready, bridged" },
];

const FULL: PhotoCrop = { x: 0, y: 0, width: 1, height: 1 };
type Handle = "new" | "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Paint the working-resolution subject mask as a dimming layer (subject clear, background dark). */
function maskUrl(m: PhotoVectorizeResult["mask"]): string {
  if (!m.width || !m.height) return "";
  const c = document.createElement("canvas");
  c.width = m.width;
  c.height = m.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(m.width, m.height);
  for (let p = 0; p < m.width * m.height; p++) {
    if (m.data[p]) continue;
    img.data[p * 4] = 11;
    img.data[p * 4 + 1] = 12;
    img.data[p * 4 + 2] = 14;
    img.data[p * 4 + 3] = 168;
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL("image/png");
  c.width = c.height = 0;
  return url;
}

function Layers({ r, mode, stroke, weight = 1 }: { r: PhotoVectorizeResult; mode: "fill" | "outline"; stroke: number; weight?: number }) {
  return (
    <>
      {r.layers.map((l, i) => (
        <g
          key={i}
          fill={mode === "outline" || l.kind === "stroke" ? "none" : l.color}
          fillRule="evenodd"
          stroke={mode === "outline" ? "#ff4d1f" : l.kind === "stroke" ? l.color : "none"}
          strokeWidth={mode === "outline" ? stroke : l.strokeWidth * weight}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {l.parts.map((p, j) => (
            <path key={j} d={p.d} />
          ))}
        </g>
      ))}
    </>
  );
}

export function PhotoTab({ refId, width, height, name, decoded, error: decodeError, tabs }: TabProps) {
  const [c, setC] = useState<PhotoChoices>(load);
  const [crop, setCrop] = useState<PhotoCrop>(FULL);
  const [result, setResult] = useState<PhotoVectorizeResult | null>(null);
  const [thumbs, setThumbs] = useState<PhotoVectorizeResult[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [traceError, setError] = useState<string | null>(null);
  const error = decodeError ?? traceError;
  const [view, setView] = useState<View>("subject");
  const [peek, setPeek] = useState(false);
  const [autoTol, setAutoTol] = useState(0.3);
  const tracer = useRef<Tracer | null>(null);
  const thumbTracer = useRef<Tracer | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [unit, setUnit] = useState(1); // artboard units per screen pixel in the stage

  const set = (patch: Partial<PhotoChoices>) =>
    setC((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  useEffect(() => {
    tracer.current = new Tracer();
    thumbTracer.current = new Tracer();
    return () => {
      tracer.current?.dispose();
      thumbTracer.current?.dispose();
    };
  }, []);

  // Keep handle sizes constant on screen.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setUnit(Math.max(width / r.width, height / r.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, decoded]);

  const base: PhotoVectorizeOptions = useMemo(
    () => ({
      subject: c.subject,
      tolerance: c.autoTolerance ? null : c.tolerance,
      shadows: c.shadows,
      keep: c.keep,
      fillHoles: c.fillHoles,
      isolate: c.isolate,
      cleanup: c.cleanup,
      exposure: c.exposure,
      contrast: c.contrast,
      denoise: c.denoise,
      detail: c.detail,
      smoothing: c.smoothing,
      corners: c.corners,
      specks: c.specks,
      tones: c.tones,
      palette: c.palette,
      bridges: c.bridges,
      weight: c.weight,
      crop,
      target: { width, height },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.subject, c.autoTolerance, c.tolerance, c.shadows, c.keep, c.fillHoles, c.isolate, c.cleanup, c.exposure, c.contrast, c.denoise, c.detail, c.smoothing, c.corners, c.specks, c.tones, c.palette, c.bridges, c.weight, crop, width, height],
  );
  const options = useMemo(() => ({ ...base, style: c.style }), [base, c.style]);

  // Live preview (debounced; stale answers are dropped by the tracer).
  useEffect(() => {
    if (!decoded) return;
    setBusy(true);
    const t = setTimeout(() => {
      tracer.current
        ?.run(decoded.image, options, "photo")
        .then((r) => {
          setResult(r);
          setError(null);
          setBusy(false);
          if (r.tolerance !== null && c.autoTolerance) setAutoTol(r.tolerance);
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

  // Style thumbnails follow the subject settings, a little behind.
  useEffect(() => {
    if (!decoded) return;
    const t = setTimeout(() => {
      thumbTracer.current
        ?.run(decoded.image, { ...base, detail: 0.2 }, "thumbs")
        .then(setThumbs)
        .catch(() => {});
    }, 260);
    return () => clearTimeout(t);
  }, [decoded, base]);

  const mask = useMemo(() => (result ? maskUrl(result.mask) : ""), [result]);

  const apply = () => {
    const d = useStore.getState().doc;
    if (!d || !result || !result.stats.parts) return;
    const label = STYLES.find((s) => s.id === result.style)!.name;
    const { ops, groupId } = vectorizeOps(d, refId, result, { name: `${label} trace — ${name}` });
    if (dispatch(ops, "Vectorize photo")) {
      select([groupId]);
      toast(`${label}: ${result.stats.parts} ${result.style === "lineart" ? "strokes" : "shapes"}, ${result.stats.nodes} nodes — now simplify and design on top`);
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

  /* ---- crop handles ---- */
  const drag = useRef<{ h: Handle; x: number; y: number; start: PhotoCrop } | null>(null);
  const toFrac = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x / width, y: pt.y / height };
  };
  const startDrag = (h: Handle) => (e: RPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toFrac(e);
    drag.current = { h, x: p.x, y: p.y, start: crop };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toFrac(e);
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const s = d.start;
    const MIN = 0.04;
    let x0 = s.x;
    let y0 = s.y;
    let x1 = s.x + s.width;
    let y1 = s.y + s.height;
    if (d.h === "new") {
      // Drawing a fresh crop from the press point.
      const c0 = { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
      x0 = Math.min(d.x, c0.x);
      x1 = Math.max(d.x, c0.x);
      y0 = Math.min(d.y, c0.y);
      y1 = Math.max(d.y, c0.y);
      if (x1 - x0 < MIN || y1 - y0 < MIN) return;
    } else if (d.h === "move") {
      const mx = Math.max(-x0, Math.min(1 - x1, dx));
      const my = Math.max(-y0, Math.min(1 - y1, dy));
      x0 += mx;
      x1 += mx;
      y0 += my;
      y1 += my;
    } else {
      if (d.h.includes("w")) x0 = Math.max(0, Math.min(x1 - MIN, x0 + dx));
      if (d.h.includes("e")) x1 = Math.min(1, Math.max(x0 + MIN, x1 + dx));
      if (d.h.includes("n")) y0 = Math.max(0, Math.min(y1 - MIN, y0 + dy));
      if (d.h.includes("s")) y1 = Math.min(1, Math.max(y0 + MIN, y1 + dy));
    }
    setCrop({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  };
  const endDrag = () => (drag.current = null);
  const cropped = crop.x > 0.001 || crop.y > 0.001 || crop.width < 0.999 || crop.height < 0.999;

  const show: View | "image" = peek ? "image" : view;
  const stroke = Math.max(width, height) / 500;
  const empty = result && !result.stats.parts;
  const cx = crop.x * width;
  const cy = crop.y * height;
  const cw = crop.width * width;
  const ch = crop.height * height;
  const hs = 9 * unit;
  const handles: [Handle, number, number][] = [
    ["nw", cx, cy],
    ["n", cx + cw / 2, cy],
    ["ne", cx + cw, cy],
    ["e", cx + cw, cy + ch / 2],
    ["se", cx + cw, cy + ch],
    ["s", cx + cw / 2, cy + ch],
    ["sw", cx, cy + ch],
    ["w", cx, cy + ch / 2],
  ];
  const subjectD = result?.subject.parts.map((p) => p.d).join("") ?? "";
  const pct = result ? Math.round(result.subject.coverage * 100) : 0;
  const source = result?.subject.source;

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeVectorize()}>
      <div className="modal vz" role="dialog" aria-modal="true" aria-labelledby="vz-title" data-ui>
        <div className="vz-stage">
          <div className="vz-views" role="group" aria-label="Preview">
            {VIEWS.map(([v, label]) => (
              <button key={v} className={`vz-chip${view === v ? " on" : ""}`} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
            <button className="vz-chip" onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} title="Hold to compare with the photo">
              Hold for original
            </button>
          </div>
          <div className="vz-canvas">
            {decoded ? (
              <svg
                ref={svgRef}
                className="vz-photo-svg"
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <rect width={width} height={height} fill="#ffffff" />
                {show !== "result" && (
                  <image
                    href={decoded.url}
                    width={width}
                    height={height}
                    preserveAspectRatio="none"
                    opacity={show === "image" || show === "subject" ? 1 : show === "overlay" ? 0.3 : 0.5}
                  />
                )}
                {show === "subject" && result && (
                  <>
                    {mask && <image href={mask} x={cx} y={cy} width={cw} height={ch} preserveAspectRatio="none" />}
                    {subjectD && <path d={subjectD} fill="none" stroke="#ff4d1f" strokeWidth={2 * unit} strokeLinejoin="round" fillRule="evenodd" />}
                  </>
                )}
                {(show === "overlay" || show === "result") && result && (
                  <g opacity={show === "overlay" ? 0.92 : 1}>
                    <Layers r={result} mode="fill" stroke={stroke} />
                  </g>
                )}
                {show === "outline" && result && <Layers r={result} mode="outline" stroke={1.2 * unit} />}
                {show !== "image" && (
                  <g className="vz-crop">
                    {cropped && <path d={`M0 0H${width}V${height}H0Z M${cx} ${cy}V${cy + ch}H${cx + cw}V${cy}Z`} fill="rgba(11,12,14,0.5)" fillRule="evenodd" pointerEvents="none" />}
                    <rect className="vz-crop-body" x={cx} y={cy} width={cw} height={ch} fill="transparent" stroke="#ffffff" strokeWidth={1.5 * unit} strokeDasharray={`${5 * unit} ${4 * unit}`} onPointerDown={startDrag(cropped ? "move" : "new")} style={{ cursor: cropped ? "move" : "crosshair" }} />
                    {handles.map(([h, x, y]) => (
                      <rect
                        key={h}
                        className={`vz-handle vz-h-${h}`}
                        x={x - hs / 2}
                        y={y - hs / 2}
                        width={hs}
                        height={hs}
                        rx={2 * unit}
                        fill="#ffffff"
                        stroke="#0b0c0e"
                        strokeWidth={1.2 * unit}
                        onPointerDown={startDrag(h)}
                      />
                    ))}
                  </g>
                )}
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
              <span className="vz-err">Nothing traced — adjust the tolerance, crop around the object, or try another style.</span>
            ) : result ? (
              <>
                <b>{result.stats.parts}</b> {result.style === "lineart" ? "strokes" : "shapes"} · <b>{result.stats.nodes}</b> nodes
                <span className="vz-swatches">
                  {result.layers.map((l, i) => (
                    <i key={i} style={{ background: l.color }} title={l.color} />
                  ))}
                </span>
                <span className="vz-dim">
                  subject {pct}%{source === "alpha" ? " (transparency)" : source === "all" ? " (whole crop)" : ""} · {result.stats.ms} ms · on this computer
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
              <div className="vz-sub">Turn “{name}” into logo material</div>
            </div>
            <CloseButton onClick={closeVectorize} />
          </div>
          {tabs}

          <div className="vz-body">
            <div className="vz-group">
              <div className="label">Style</div>
              <div className="vz-styles">
                {STYLES.map((s, i) => {
                  const t = thumbs?.[i];
                  return (
                    <button key={s.id} className={c.style === s.id ? "on" : ""} aria-pressed={c.style === s.id} onClick={() => set({ style: s.id, tones: s.id === "stencil" ? Math.min(c.tones, 3) : c.tones })}>
                      <span className="vz-thumb">
                        {t ? (
                          <svg viewBox={`${t.crop.x * width} ${t.crop.y * height} ${t.crop.width * width} ${t.crop.height * height}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
                            <Layers r={t} mode="fill" stroke={stroke} weight={2.2} />
                          </svg>
                        ) : (
                          <i className="vz-thumb-wait" />
                        )}
                      </span>
                      <b>{s.name}</b>
                      <span>{s.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {c.style === "posterized" && (
              <div className="vz-group">
                <div className="vz-field-head">
                  <span>Tones</span>
                  <span className="vz-num">{c.tones}</span>
                </div>
                <Segmented label="Tones" value={c.tones} options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))} onChange={(v) => set({ tones: v })} />
                <Segmented
                  label="Colors"
                  value={c.palette}
                  options={[
                    { value: "color", label: "Photo colors" },
                    { value: "mono", label: "Grays" },
                  ]}
                  onChange={(v) => set({ palette: v })}
                />
              </div>
            )}
            {c.style === "stencil" && (
              <div className="vz-group">
                <div className="vz-field-head">
                  <span>Tones</span>
                  <span className="vz-num">{Math.min(3, c.tones)}</span>
                </div>
                <Segmented
                  label="Tones"
                  value={Math.min(3, c.tones)}
                  options={[
                    { value: 2, label: "2 · one layer", title: "Black on the paper" },
                    { value: 3, label: "3 · two layers", title: "Gray under black" },
                  ]}
                  onChange={(v) => set({ tones: v })}
                />
                <Slider label="Bridges" hint="Width of the ties that keep enclosed pieces attached" value={c.bridges} left="Thin" right="Sturdy" onChange={(v) => set({ bridges: v })} />
              </div>
            )}
            {c.style === "lineart" && (
              <div className="vz-group">
                <Slider label="Line weight" hint="Stroke width of the drawn lines" value={c.weight} left="Fine" right="Bold" onChange={(v) => set({ weight: v })} />
              </div>
            )}

            <div className="vz-group">
              <div className="label">Subject</div>
              <Segmented
                label="Subject is"
                value={c.subject}
                options={[
                  { value: "auto", label: "Auto", title: "Any difference from the background" },
                  { value: "darker", label: "Darker", title: "The subject is darker than the background" },
                  { value: "lighter", label: "Lighter", title: "The subject is lighter than the background" },
                ]}
                onChange={(v) => set({ subject: v })}
              />
              <Slider
                label="Background tolerance"
                hint="How different from the background a pixel must be to count as the subject"
                value={c.autoTolerance ? autoTol : c.tolerance}
                disabled={!c.isolate || source === "alpha"}
                left="Keep more"
                right="Remove more"
                onChange={(v) => set({ tolerance: v, autoTolerance: false })}
              />
              <div className="vz-row">
                <label className="check">
                  <input type="checkbox" checked={c.autoTolerance} disabled={!c.isolate} onChange={(e) => set({ autoTolerance: e.target.checked, tolerance: autoTol })} />
                  Automatic
                </label>
                <label className="check" title="Off: use the whole photo (or crop) as the subject">
                  <input type="checkbox" checked={c.isolate} onChange={(e) => set({ isolate: e.target.checked })} />
                  Remove background
                </label>
              </div>
              <Slider label="Ignore shadows" hint="Treat cast shadows on the background as background" value={c.shadows} disabled={!c.isolate} left="Off" right="Strong" onChange={(v) => set({ shadows: v })} />
              <div className="vz-row">
                <label className="check" title="Close light patches inside the subject that got cut out">
                  <input type="checkbox" checked={c.fillHoles} onChange={(e) => set({ fillHoles: e.target.checked })} />
                  Fill holes
                </label>
                <span className="vz-keep">
                  Keep
                  <Segmented label="Keep largest" value={c.keep} options={[1, 2, 3, 4].map((n) => ({ value: n, label: n, title: `Keep the ${n} largest subject${n > 1 ? "s" : ""}` }))} onChange={(v) => set({ keep: v })} />
                </span>
              </div>
              <div className="vz-row vz-crop-row">
                <span>{cropped ? `Crop ${Math.round(crop.width * 100)} × ${Math.round(crop.height * 100)}%` : "Drag on the photo to crop around the object"}</span>
                {cropped && (
                  <button className="btn small ghost" onClick={() => setCrop(FULL)}>
                    Reset crop
                  </button>
                )}
              </div>
            </div>

            <div className="vz-group">
              <div className="label">Photo</div>
              <Slider min={-1} label="Exposure" hint="Brighten or darken before tracing (double-click to reset)" value={c.exposure} left="Darker" right="Brighter" onChange={(v) => set({ exposure: v })} />
              <Slider min={-1} label="Contrast" hint="Separate the tones more (double-click to reset)" value={c.contrast} left="Flat" right="Punchy" onChange={(v) => set({ contrast: v })} />
              <Slider label="Denoise" hint="Blur grain and texture before tracing" value={c.denoise} left="Sharp" right="Smooth" onChange={(v) => set({ denoise: v })} />
            </div>

            <div className="vz-group">
              <div className="label">Shape</div>
              <Slider label="Detail" hint="More nodes, closer to the photo" value={c.detail} left="Simple" right="Detailed" onChange={(v) => set({ detail: v })} />
              <Slider label="Smoothing" hint="Rounder, calmer curves" value={c.smoothing} left="Faithful" right="Smooth" onChange={(v) => set({ smoothing: v })} />
              <Slider label="Corners" hint="Keep sharp corners or round them off" value={c.corners} left="Rounded" right="Sharp" onChange={(v) => set({ corners: v })} />
              <Slider label="Min region" hint="Drop specks and fill pinholes up to this size" value={c.specks} left="Keep all" right="Large" onChange={(v) => set({ specks: v })} />
              <Slider label="Clean-up" hint="Smooth the subject mask: removes whiskers, closes nicks" value={c.cleanup} disabled={source === "all"} left="Raw" right="Tidy" onChange={(v) => set({ cleanup: v })} />
            </div>

            <p className="vz-note">
              Runs offline on this computer — no upload, no AI model. Best with a plain, contrasting background and soft side light. The result lands as one group right over the photo (one undo step). It is raw material: simplify it, then design the mark on top.
            </p>
          </div>

          <div className="vz-foot">
            <button
              className="btn ghost"
              onClick={() => {
                setC(DEFAULTS);
                setCrop(FULL);
                try {
                  localStorage.removeItem(KEY);
                } catch {
                  /* ignore */
                }
              }}
            >
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
