import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REFINE_ACTIONS, REFINE_LABELS, SNAP_STEPS, type RefineAction } from "@brusshy/core";
import { useStore } from "../lib/store";
import { selectionBox } from "../lib/geom";
import { toScreen } from "../canvas/camera";
import { RefineIcons } from "./icons";
import {
  askMoreStyle,
  cancelRefine,
  commitRefine,
  INSTANT,
  MAKE_IT_MORE,
  refineTargets,
  schedulePreview,
  setRefineAmount,
  setRefineOpen,
  setRefineSide,
  startRefine,
  useRefine,
} from "./state";
import "./commands";
import "./refine.css";

const SHORT: Record<RefineAction, string> = {
  simplify: "Simplify",
  smooth: "Smooth",
  bolder: "Bolder",
  thinner: "Thinner",
  round: "Round",
  "optical-center": "Center",
  "snap-grid": "Snap",
  symmetric: "Mirror",
};

const fmt = (v: number, step: number) => (step < 1 ? v.toFixed(1) : String(Math.round(v)));

/** Quick-bar button that opens the refine panel. */
export function RefineButton() {
  const open = useRefine((s) => s.open);
  return (
    <button className={`qb-btn qb-refine${open ? " on" : ""}`} onClick={() => setRefineOpen(!open)} aria-expanded={open} aria-label="Refine the selection" title="Refine — simplify, smooth, bolder, round, center, mirror…">
      {RefineIcons.wand}
    </button>
  );
}

type Rect = { left: number; top: number; right: number; bottom: number };
const rectOf = (sel: string): Rect | null => {
  const el = document.querySelector(sel);
  return el ? el.getBoundingClientRect() : null;
};

/**
 * Where the panel goes: above the quick bar, else beside or below the selection — wherever it
 * fits on the canvas without covering the selection (so the live preview stays visible).
 */
function place(bar: Rect, selR: Rect, host: Rect, w: number, h: number): { left: number; top: number } {
  const L = Math.max(host.left, rectOf(".toolbar")?.right ?? host.left) + 8;
  const R = Math.min(host.right, rectOf(".side-panel")?.left ?? host.right) - 8;
  const T = Math.max(host.top, rectOf(".topbar")?.bottom ?? host.top) + 8;
  const B = Math.min(host.bottom, rectOf(".chat-dock")?.top ?? host.bottom) - 8;
  const cx = (bar.left + bar.right) / 2;
  const clampX = (x: number) => Math.max(L, Math.min(R - w, x));
  const clampY = (y: number) => Math.max(T, Math.min(B - h, y));
  const barAbove = bar.bottom <= selR.top + 2;
  const tries: { left: number; top: number; ok: boolean }[] = [
    { left: clampX(cx - w / 2), top: bar.top - 8 - h, ok: barAbove && bar.top - 8 - h >= T },
    { left: clampX(cx - w / 2), top: bar.bottom + 8, ok: !barAbove && bar.bottom + 8 + h <= B },
    { left: selR.right + 16, top: clampY(Math.max(bar.bottom + 8, selR.top)), ok: selR.right + 16 + w <= R },
    { left: selR.left - 16 - w, top: clampY(Math.max(bar.bottom + 8, selR.top)), ok: selR.left - 16 - w >= L },
    { left: clampX(cx - w / 2), top: selR.bottom + 16, ok: selR.bottom + 16 + h <= B },
  ];
  // Never on top of the quick bar itself.
  const clear = (t: { left: number; top: number }) => t.left + w <= bar.left || t.left >= bar.right || t.top + h <= bar.top || t.top >= bar.bottom;
  const pick = tries.find((t) => t.ok && clear(t)) ?? { left: clampX(cx - w / 2), top: clampY(bar.bottom + 8) };
  return { left: pick.left - host.left, top: pick.top - host.top };
}

/** Refine panel next to the quick bar, placed where it doesn't cover the selection (portaled to the canvas). */
export function RefinePanel() {
  const anchor = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const camera = useStore((s) => s.camera);
  const open = useRefine((s) => s.open);
  const action = useRefine((s) => s.action);
  const amount = useRefine((s) => s.amount);
  const spec = useRefine((s) => s.spec);
  const side = useRefine((s) => s.side);
  const summary = useRefine((s) => s.summary);
  const notes = useRefine((s) => s.notes);
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const count = doc ? refineTargets(doc, selection).length : 0;

  // A new selection ends the preview; a document change (e.g. your AI) refreshes it.
  useEffect(() => {
    const { action, ids } = useRefine.getState();
    const d = useStore.getState().doc;
    if (!action || !d) return;
    const cur = refineTargets(d, selection);
    if (cur.length !== ids.length || cur.some((id) => !ids.includes(id))) cancelRefine();
  }, [selection]);
  useEffect(() => {
    if (useRefine.getState().action) schedulePreview();
  }, [doc]);

  // Enter applies, Esc cancels (before the canvas shortcuts see them).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("textarea, [contenteditable], .cmdk")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (useRefine.getState().action) cancelRefine();
        else setRefineOpen(false);
      } else if (e.key === "Enter" && useRefine.getState().action) {
        e.preventDefault();
        e.stopImmediatePropagation();
        commitRefine();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);


  useLayoutEffect(() => {
    const bar = anchor.current?.closest(".quick-bar") as HTMLElement | null;
    const h = (bar?.offsetParent as HTMLElement | null) ?? bar?.parentElement ?? null;
    if (h !== host) setHost(h);
    if (!open || !bar || !h || !pop.current || !doc) return;
    const ids = refineTargets(doc, selection);
    const b = selectionBox(doc, ids);
    const hostR = h.getBoundingClientRect();
    const barR = bar.getBoundingClientRect();
    let selR: Rect = barR;
    if (b) {
      const [x0, y0] = toScreen(camera, b.x, b.y);
      const [x1, y1] = toScreen(camera, b.x + b.w, b.y + b.h);
      selR = { left: hostR.left + x0, top: hostR.top + y0, right: hostR.left + x1, bottom: hostR.top + y1 };
    }
    const next = place(barR, selR, hostR, pop.current.offsetWidth, pop.current.offsetHeight);
    if (!pos || Math.abs(pos.left - next.left) > 0.5 || Math.abs(pos.top - next.top) > 0.5) setPos(next);
  });

  if (!open) return <span ref={anchor} hidden />;
  const panel = (
    <div
      ref={pop}
      className="refine-pop"
      data-ui
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      role="dialog"
      aria-label="Refine"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="rf-head">
        <span className="label">Refine</span>
        <span className="rf-count">
          {count} layer{count === 1 ? "" : "s"} · no AI
        </span>
      </div>
      <div className="rf-grid">
        {REFINE_ACTIONS.map((a) => (
          <button
            key={a}
            className={`rf-act${action === a ? " on" : ""}`}
            onClick={() => (action === a ? commitRefine() : startRefine(a))}
            title={`${REFINE_LABELS[a].label} — ${REFINE_LABELS[a].hint}${INSTANT.includes(a) ? "" : action === a ? " (click again to apply)" : ""}`}
          >
            {RefineIcons[a]}
            <span>{SHORT[a]}</span>
          </button>
        ))}
      </div>
      {action && (
        <div className="rf-adjust">
          <div className="rf-adjust-title">
            <span>{REFINE_LABELS[action].label}</span>
            <span className="rf-summary">{summary.replace(/^[^·]*·\s*/, "")}</span>
          </div>
          {action === "snap-grid" && amount !== null ? (
            <div className="rf-steps" role="radiogroup" aria-label="Grid step">
              {SNAP_STEPS.map((s) => (
                <button key={s} role="radio" aria-checked={amount === s} className={`rf-step${amount === s ? " on" : ""}`} onClick={() => setRefineAmount(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : action === "symmetric" ? (
            <div className="rf-steps" role="radiogroup" aria-label="Half to keep">
              {(["left", "right"] as const).map((s) => (
                <button key={s} role="radio" aria-checked={side === s} className={`rf-step wide${side === s ? " on" : ""}`} onClick={() => setRefineSide(s)}>
                  Keep {s} half
                </button>
              ))}
            </div>
          ) : (
            spec &&
            amount !== null && (
              <label className="rf-slider">
                <span className="rf-slider-label">{spec.label}</span>
                <input
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={amount}
                  onChange={(e) => setRefineAmount(Number(e.target.value))}
                  style={{ ["--p" as string]: `${((amount - spec.min) / (spec.max - spec.min || 1)) * 100}%` }}
                />
                <span className="rf-val">
                  {fmt(amount, spec.step)}
                  {spec.unit}
                </span>
              </label>
            )
          )}
          {notes[0] && <p className={`rf-note${/isn't|vanish|can't|skipped|left alone|no counterpart|Nothing/.test(notes[0]) ? " warn" : ""}`}>{notes[0]}</p>}
          <div className="rf-actions">
            <button className="rf-cancel" onClick={cancelRefine}>
              Cancel <span className="kbd">esc</span>
            </button>
            <button className="rf-apply" onClick={commitRefine}>
              Apply <span className="kbd">↵</span>
            </button>
          </div>
        </div>
      )}
      <div className="rf-ai">
        <span className="label">
          {RefineIcons.ai}
          Make it more…
        </span>
        <div className="rf-chips">
          {MAKE_IT_MORE.map((m) => (
            <button key={m} className="rf-chip" onClick={() => askMoreStyle(m)} title={`Ask your AI (canvas chat) to make the selection more ${m}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {host && createPortal(panel, host)}
    </>
  );
}
