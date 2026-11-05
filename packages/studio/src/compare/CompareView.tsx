import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { frameDoc, listFrames, type DocT, type FrameNodeT } from "@brusshy/core";
import { useStore } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import { buildSvg, prepareFonts } from "../export/svg";
import { svgToCanvas } from "../export/raster";
import { closeCompare, useCompare, type CompareMode } from "./state";
import "./compare.css";

/**
 * Before/after view of two versions, overlaid in place (same artboard units, centred in a
 * common box): a draggable split, side by side, or onion skin — plus a difference mask of
 * the pixels that changed.
 */

const ACCENT: [number, number, number] = [255, 77, 31];

interface Shots {
  key: string;
  /** CSS size of one stage. */
  w: number;
  h: number;
  a: HTMLCanvasElement;
  b: HTMLCanvasElement;
  diff: HTMLCanvasElement;
  /** Share of the artwork's pixels that changed (0–1). */
  changed: number;
}

/** One version drawn into the common box (artboard centred, its background or white). */
async function renderInto(doc: DocT, f: FrameNodeT, W: number, H: number, k: number): Promise<HTMLCanvasElement> {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(W * k));
  out.height = Math.max(1, Math.round(H * k));
  const ctx = out.getContext("2d")!;
  const x = Math.round(((W - f.width) / 2) * k);
  const y = Math.round(((H - f.height) / 2) * k);
  const w = Math.max(1, Math.round(f.width * k));
  const h = Math.max(1, Math.round(f.height * k));
  ctx.fillStyle = f.background ?? "#ffffff";
  ctx.fillRect(x, y, w, h);
  const pd = frameDoc(doc, f.id);
  await prepareFonts(pd);
  const art = await svgToCanvas(buildSvg(pd, { background: null }), w, { height: h });
  ctx.drawImage(art, x, y, w, h);
  art.width = art.height = 0;
  return out;
}

/** Pixels that differ between the two renders, dilated a little so single-pixel changes stay visible. */
function diffMask(a: HTMLCanvasElement, b: HTMLCanvasElement, dpr: number): { canvas: HTMLCanvasElement; changed: number } {
  const w = a.width, h = a.height;
  const da = a.getContext("2d")!.getImageData(0, 0, w, h).data;
  const db = b.getContext("2d")!.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let changed = 0, ink = 0;
  for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
    const inkA = da[i + 3] > 0 && (da[i] < 245 || da[i + 1] < 245 || da[i + 2] < 245);
    const inkB = db[i + 3] > 0 && (db[i] < 245 || db[i + 1] < 245 || db[i + 2] < 245);
    if (inkA || inkB) ink++;
    if (d > 40) {
      mask[p] = 1;
      changed++;
    }
  }
  // Separable max filter (radius ~1.5 CSS px).
  const r = Math.max(1, Math.round(1.5 * dpr));
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = -r; k <= r && !on; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && mask[y * w + xx]) on = 1;
      }
      tmp[y * w + x] = on;
    }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let k = -r; k <= r && !on; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) on = 1;
      }
      if (!on) continue;
      const o = (y * w + x) * 4;
      const core = mask[y * w + x];
      img.data[o] = ACCENT[0];
      img.data[o + 1] = ACCENT[1];
      img.data[o + 2] = ACCENT[2];
      img.data[o + 3] = core ? 235 : 120;
    }
  ctx.putImageData(img, 0, 0);
  return { canvas: out, changed: ink ? changed / ink : 0 };
}

/** Live renders of both versions at the stage size (re-rendered as they change). */
function useShots(doc: DocT | null, a: FrameNodeT | null, b: FrameNodeT | null, avail: { w: number; h: number } | null, mode: CompareMode): Shots | null {
  const fontsV = useFontVersion((s) => s.v);
  const [shots, setShots] = useState<Shots | null>(null);
  useEffect(() => {
    if (!doc || !a || !b || !avail) return;
    let dead = false;
    const W = Math.max(a.width, b.width);
    const H = Math.max(a.height, b.height);
    const paneW = mode === "side" ? (avail.w - 32) / 2 : avail.w;
    const s = Math.max(0.01, Math.min(paneW / W, avail.h / H));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    // Cap the raster size (each canvas ≤ ~6 Mpx).
    const k = Math.min(s * dpr, Math.sqrt(6e6 / (W * H)));
    const key = `${a.id}|${b.id}|${mode}|${Math.round(W * s)}x${Math.round(H * s)}`;
    const t = setTimeout(
      async () => {
        try {
          const [ca, cb] = await Promise.all([renderInto(doc, a, W, H, k), renderInto(doc, b, W, H, k)]);
          if (dead) return;
          const d = diffMask(ca, cb, k / s);
          if (dead) return;
          setShots({ key, w: W * s, h: H * s, a: ca, b: cb, diff: d.canvas, changed: d.changed });
        } catch (e) {
          console.error("compare render failed", e);
        }
      },
      shots ? 180 : 0,
    );
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, a, b, avail?.w, avail?.h, mode, fontsV]);
  return shots;
}

/** Mount a canvas element produced off-DOM. */
function CanvasSlot({ canvas, className, style }: { canvas: HTMLCanvasElement; className: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren(canvas);
  }, [canvas]);
  return <div ref={ref} className={`cmp-layer ${className}`} style={style} />;
}

const MODES: { id: CompareMode; label: string }[] = [
  { id: "split", label: "Split" },
  { id: "side", label: "Side by side" },
  { id: "onion", label: "Onion skin" },
];

export function CompareView() {
  const open = useCompare((s) => s.open);
  const aId = useCompare((s) => s.a);
  const bId = useCompare((s) => s.b);
  const mode = useCompare((s) => s.mode);
  const diff = useCompare((s) => s.diff);
  const split = useCompare((s) => s.split);
  const opacity = useCompare((s) => s.opacity);
  const doc = useStore((s) => s.doc);
  const area = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const frames = doc ? listFrames(doc) : [];
  const a = (aId && (doc?.nodes[aId] as FrameNodeT | undefined)) || null;
  const b = (bId && (doc?.nodes[bId] as FrameNodeT | undefined)) || null;
  const shots = useShots(open ? doc : null, a, b, avail, mode);

  // Fit the stage to the free area.
  useLayoutEffect(() => {
    if (!open) return;
    const el = area.current;
    if (!el) return;
    const measure = () => setAvail({ w: Math.max(120, el.clientWidth - 64), h: Math.max(120, el.clientHeight - 48) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // Keyboard: ←/→ move the divider (or the onion opacity), D toggles the difference, Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      const s = useCompare.getState();
      const step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === "Escape") closeCompare();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (s.mode === "onion") useCompare.setState({ opacity: Math.min(1, Math.max(0, s.opacity + dir * (e.shiftKey ? 0.2 : 0.05))) });
        else if (s.mode === "split") useCompare.setState({ split: Math.min(1, Math.max(0, s.split + dir * step)) });
      } else if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey) useCompare.setState({ diff: !s.diff });
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open || !doc) return null;
  if (!a || !b) {
    return (
      <div className="cmp" role="dialog" aria-label="Compare versions">
        <p className="muted cmp-missing">That version no longer exists.</p>
        <button className="btn" onClick={closeCompare}>
          Close
        </button>
      </div>
    );
  }

  const dragTo = (clientX: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r) return;
    useCompare.setState({ split: Math.min(1, Math.max(0, (clientX - r.left) / r.width)) });
  };
  const onDown = (e: React.PointerEvent) => {
    if (mode !== "split" || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragTo(e.clientX);
  };
  const pick = (which: "a" | "b", id: string) => useCompare.setState(which === "a" ? { a: id } : { b: id });
  const changedLabel = shots ? (shots.changed < 0.0005 ? "No visible change" : `${shots.changed < 0.01 ? "<1" : Math.round(shots.changed * 100)}% of the artwork changed`) : "";
  const ready = shots && shots.a.width > 0;
  const dims = shots ? { width: shots.w, height: shots.h } : undefined;
  const diffLayer = diff && shots ? <CanvasSlot canvas={shots.diff} className="cmp-diff" /> : null;

  const select = (which: "a" | "b", value: string) => (
    <select className="cmp-select" value={value} onChange={(e) => pick(which, e.target.value)} aria-label={which === "a" ? "Before version" : "After version"}>
      {frames.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className={`cmp mode-${mode}${diff ? " diffing" : ""}`} role="dialog" aria-label="Compare versions">
      <div className="cmp-bar panel" data-ui>
        <div className="cmp-pair">
          <span className="label">Before</span>
          {select("a", a.id)}
          <button className="icon-btn small cmp-swap" onClick={() => useCompare.setState({ a: b.id, b: a.id })} title="Swap before and after" aria-label="Swap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7h11l-3-3M17 17H6l3 3" />
            </svg>
          </button>
          <span className="label">After</span>
          {select("b", b.id)}
        </div>
        <span className="cmp-sep" />
        <div className="cmp-modes" role="radiogroup" aria-label="Compare mode">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={`seg${mode === m.id ? " on" : ""}`} onClick={() => useCompare.setState({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        {mode === "onion" && (
          <label className="cmp-opacity" title="Opacity of the after version (← →)">
            <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => useCompare.setState({ opacity: Number(e.target.value) / 100 })} />
            <span className="num">{Math.round(opacity * 100)}%</span>
          </label>
        )}
        <span className="cmp-sep" />
        <label className={`cmp-toggle${diff ? " on" : ""}`} title="Highlight the pixels that changed (D)">
          <input type="checkbox" checked={diff} onChange={(e) => useCompare.setState({ diff: e.target.checked })} />
          <i aria-hidden />
          Difference
        </label>
        <button className="icon-btn cmp-close" onClick={closeCompare} aria-label="Close compare" title="Close (Esc)">
          ×
        </button>
      </div>

      <div className="cmp-area" ref={area}>
        {!ready ? (
          <p className="muted">Rendering…</p>
        ) : mode === "side" ? (
          <div className="cmp-side">
            {(["a", "b"] as const).map((k) => (
              <figure key={k} className="cmp-pane">
                <div className="cmp-stage" style={dims}>
                  <CanvasSlot canvas={k === "a" ? shots.a : shots.b} className="cmp-img" />
                  {diffLayer && <CanvasSlot canvas={k === "a" ? shots.diff : cloneOnce(shots.diff)} className="cmp-diff" />}
                </div>
                <figcaption>
                  <span className="label">{k === "a" ? "Before" : "After"}</span> {k === "a" ? a.name : b.name}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div
            className={`cmp-stage${mode === "split" ? " splittable" : ""}${dragging ? " dragging" : ""}`}
            ref={stage}
            style={dims}
            onPointerDown={onDown}
            onPointerMove={(e) => dragging && dragTo(e.clientX)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
          >
            <CanvasSlot canvas={shots.a} className="cmp-img" />
            <CanvasSlot
              canvas={shots.b}
              className="cmp-img"
              style={mode === "split" ? { clipPath: `inset(0 0 0 ${split * 100}%)` } : { opacity }}
            />
            {diffLayer}
            {mode === "split" && (
              <div className="cmp-handle" style={{ left: `${split * 100}%` }} aria-hidden>
                <span className="cmp-grip">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 7l-4 5 4 5M15 7l4 5-4 5" />
                  </svg>
                </span>
              </div>
            )}
            {mode === "onion" ? (
              <span className="cmp-tag left">
                <span className="label">After</span> {b.name} <span className="cmp-over">over</span> <span className="label">Before</span> {a.name}
              </span>
            ) : (
              <>
                <span className="cmp-tag left">
                  <span className="label">Before</span> {a.name}
                </span>
                <span className="cmp-tag right">
                  <span className="label">After</span> {b.name}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="cmp-foot">
        {diff && changedLabel ? <span className="cmp-stat">{changedLabel}</span> : null}
        <span className="muted">
          {mode === "split" ? "Drag or ← → to move the divider" : mode === "onion" ? "← → change the opacity" : "Same scale, same position"} · <span className="kbd">D</span> difference · <span className="kbd">Esc</span> close
        </span>
      </div>
    </div>
  );
}

/** The side-by-side view shows the same mask twice: a canvas can only live in one place. */
const clones = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function cloneOnce(c: HTMLCanvasElement): HTMLCanvasElement {
  let out = clones.get(c);
  if (!out) {
    out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    out.getContext("2d")!.drawImage(c, 0, 0);
    clones.set(c, out);
  }
  return out;
}
