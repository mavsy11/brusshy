import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { findFrame, listFrames, type DocT, type FrameNodeT } from "@brusshy/core";
import { activeFrameId, setActiveFrame, useStore } from "../lib/store";
import { SceneNodes } from "../canvas/Scene";
import { fitFrame } from "../canvas/camera";
import { STAGE_BGS, STAGE_BG_LABEL, closeStage, openStage, setStageBg, useStage, type StageBg } from "./state";
import "./commands";
import "./stage.css";

/**
 * Stage view: every piece of UI chrome goes away and only the active version stays, centred on
 * paper, ink or its own background — a clean screen for recording. The logo glides from where it
 * sits on the canvas into place and back on exit. ←/→ move between versions, B cycles the
 * background, F goes full screen, Esc exits. The artwork is live: edits (and your AI's drawing)
 * show as they happen.
 */

type Rect = { x: number; y: number; w: number; h: number };

const PAPER = "#f4f5f5";
const INK = "#0b0c0e";
const ENTER_MS = 720;
const EXIT_MS = 560;
const SWAP_MS = 520;

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function sheetRect(): Rect | null {
  const el = document.querySelector<HTMLElement>(".pane-2d .sheet.active");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

/** The artboard fitted into the window with calm margins. */
function fitRect(f: FrameNodeT, vw: number, vh: number): Rect {
  const k = Math.min((vw * 0.74) / f.width, (vh * 0.74) / f.height);
  const w = f.width * k;
  const h = f.height * k;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/** Transform that places `to`-sized art (laid out at `to`) over `from`. */
const flip = (to: Rect, from: Rect) => `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;

/** Frames in reading order (left → right, then top → bottom). */
const ordered = (doc: DocT) =>
  [...listFrames(doc)].sort((a, b) => (Math.abs(a.transform.y - b.transform.y) < Math.max(a.height, b.height) / 2 ? a.transform.x - b.transform.x : a.transform.y - b.transform.y));

function backgroundOf(bg: StageBg, f: FrameNodeT | null): string {
  if (bg === "ink") return INK;
  if (bg === "version") return f?.background ?? "#ffffff";
  return PAPER;
}

/** Always mounted: ⇧S / \ open the stage (the open stage handles its own keys). */
export function Stage() {
  const open = useStage((s) => s.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStage.getState().open || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!((e.shiftKey && e.code === "KeyS") || e.key === "\\")) return;
      if (isTyping(e.target) || document.querySelector(".scrim") || !useStore.getState().doc) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openStage();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <StageView /> : null;
}

function Art({ doc, frame, rect, className, style }: { doc: DocT; frame: FrameNodeT; rect: Rect; className?: string; style?: CSSProperties }) {
  const scoped = { ...doc, root: [frame.id] };
  return (
    <svg
      className={`stage-art${className ? ` ${className}` : ""}`}
      viewBox={`${frame.transform.x} ${frame.transform.y} ${frame.width} ${frame.height}`}
      width={rect.w}
      height={rect.h}
      style={{ left: rect.x, top: rect.y, ...style }}
      shapeRendering="geometricPrecision"
      aria-label={frame.name}
      role="img"
    >
      <SceneNodes doc={scoped} />
    </svg>
  );
}

function StageView() {
  const doc = useStore((s) => s.doc);
  const bgPref = useStage((s) => s.bg);
  const [fid, setFid] = useState<string | null>(() => activeFrameId());
  const [startFid] = useState(fid);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [phase, setPhase] = useState<"from" | "in" | "out">("from");
  const [origin, setOrigin] = useState<Rect | null>(() => sheetRect());
  const [outgoing, setOutgoing] = useState<{ id: string; dir: 1 | -1; key: number } | null>(null);
  const [swapKey, setSwapKey] = useState(0);
  const [flash, setFlash] = useState<string | null>("hint");
  const [idle, setIdle] = useState(false);
  const fullscreenByUs = useRef(false);
  const exiting = useRef(false);

  const frame = doc && fid ? findFrame(doc, fid) : null;
  // The version can disappear under us (undo, the AI): follow the active one.
  useEffect(() => {
    if (doc && !frame) setFid(activeFrameId(doc));
  }, [doc, frame]);

  const bg: StageBg = bgPref ?? (frame?.background ? "version" : "paper");
  const background = backgroundOf(bg, frame);

  // Enter: the art starts where the version sits on the canvas, then glides into place.
  useLayoutEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("in")));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Short-lived captions (the key hint on entry, the background name on B).
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash === "hint" ? 2600 : 1100);
    return () => clearTimeout(t);
  }, [flash]);

  // Hide the cursor when it rests (it would show in the recording).
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 1400);
    const onMove = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 1400);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  const exit = useCallback(() => {
    if (exiting.current) return;
    exiting.current = true;
    const d = useStore.getState().doc;
    const cur = fid;
    if (fullscreenByUs.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    // Landed on another version: put the canvas camera on it (hidden under the stage), then glide back to it.
    if (d && cur && cur !== startFid && document.querySelector(".pane-2d")) useStore.setState({ camera: fitFrame(d, cur) });
    requestAnimationFrame(() => {
      setOrigin(sheetRect());
      setPhase("out");
      setTimeout(closeStage, reducedMotion() ? 0 : EXIT_MS);
    });
  }, [fid, startFid]);

  useEffect(() => {
    const onExit = () => exit();
    window.addEventListener("brusshy:stage-exit", onExit);
    return () => window.removeEventListener("brusshy:stage-exit", onExit);
  }, [exit]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const d = useStore.getState().doc;
      if (!d || !fid) return;
      const list = ordered(d);
      const i = list.findIndex((f) => f.id === fid);
      const next = list[i + dir];
      if (!next) return;
      setOutgoing({ id: fid, dir, key: Date.now() });
      setSwapKey((k) => k + 1);
      setFid(next.id);
      setActiveFrame(next.id);
    },
    [fid],
  );

  useEffect(() => {
    if (!outgoing) return;
    const t = setTimeout(() => setOutgoing(null), SWAP_MS);
    return () => clearTimeout(t);
  }, [outgoing]);

  // While the stage is up it owns the keyboard (nothing edits the logo behind it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "Escape" || k === "\\" || (e.shiftKey && e.code === "KeyS")) {
        e.preventDefault();
        return exit();
      }
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || (k === " " && !e.shiftKey)) {
        e.preventDefault();
        return step(1);
      }
      if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || (k === " " && e.shiftKey)) {
        e.preventDefault();
        return step(-1);
      }
      if (k === "b" || k === "B") {
        e.preventDefault();
        const nextBg = STAGE_BGS[(STAGE_BGS.indexOf(bg) + 1) % STAGE_BGS.length]!;
        setStageBg(nextBg);
        return setFlash(STAGE_BG_LABEL[nextBg]);
      }
      if (k === "f" || k === "F") {
        e.preventDefault();
        if (document.fullscreenElement) {
          fullscreenByUs.current = false;
          void document.exitFullscreen().catch(() => undefined);
        } else {
          fullscreenByUs.current = true;
          void document.documentElement.requestFullscreen?.().catch(() => undefined);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bg, exit, step]);

  // Stop wheel/gestures from reaching the canvas (no accidental zoom while recording).
  const swallow = (e: { stopPropagation: () => void }) => e.stopPropagation();

  if (!doc || !frame) return null;
  const target = fitRect(frame, vp.w, vp.h);
  const reduced = reducedMotion();
  const fromT = origin ? flip(target, origin) : "scale(0.94)";
  const artStyle: CSSProperties =
    phase === "in"
      ? { transform: "none", opacity: 1, transition: reduced ? "none" : `transform ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${ENTER_MS / 2}ms ease` }
      : phase === "out"
        ? { transform: fromT, opacity: origin ? 1 : 0, transition: reduced ? "none" : `transform ${EXIT_MS}ms cubic-bezier(0.5, 0, 0.2, 1), opacity ${EXIT_MS}ms ease` }
        : { transform: fromT, opacity: origin ? 1 : 0, transition: "none" };
  const prevFrame = outgoing ? findFrame(doc, outgoing.id) : null;
  const order = ordered(doc);
  const pos = order.findIndex((f) => f.id === frame.id);
  const dark = bg === "ink" || (bg === "version" && isDark(background));

  return (
    <div
      className={`stage-view${phase === "in" ? " in" : ""}${phase === "out" ? " out" : ""}${idle ? " idle" : ""}${dark ? " dark" : ""}`}
      data-ui
      onPointerDown={swallow}
      onWheel={swallow}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-label={`Stage — ${frame.name}`}
    >
      {/* The version's artwork on the canvas hides while the stage shows it, so the glide never doubles it. */}
      <style>{`.pane-2d svg.scene g[data-frame="${frame.id}"]{visibility:hidden}`}</style>
      <div className="stage-bg" style={{ background }} />
      {prevFrame && outgoing && (
        <Art key={`out-${outgoing.key}`} doc={doc} frame={prevFrame} rect={fitRect(prevFrame, vp.w, vp.h)} className={`swap-out ${outgoing.dir > 0 ? "left" : "right"}`} />
      )}
      <div className="stage-swap" key={swapKey} data-dir={outgoing ? (outgoing.dir > 0 ? "right" : "left") : undefined}>
        <Art doc={doc} frame={frame} rect={target} style={artStyle} />
      </div>
      {flash && (
        <div className={`stage-caption${flash === "hint" ? "" : " short"}`} key={flash}>
          {flash === "hint" ? (
            <>
              <span>
                <kbd>B</kbd> background
              </span>
              {order.length > 1 && (
                <span>
                  <kbd>←</kbd>
                  <kbd>→</kbd> versions · {pos + 1} of {order.length}
                </span>
              )}
              <span>
                <kbd>F</kbd> full screen
              </span>
              <span>
                <kbd>Esc</kbd> exit
              </span>
            </>
          ) : (
            <span>{flash}</span>
          )}
        </div>
      )}
    </div>
  );
}

function isDark(color: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, "$&$&") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.5;
}
