import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { activeFrameId, useStore } from "../lib/store";
import { copyAsPng, copyAsSvg, toggleOutlines, useQuick } from "../lib/quick";
import { BriefModal, useBriefCount } from "./BriefPanel";
import { SmallSizesModal } from "./SmallSizes";
import { QIcons } from "./quickIcons";
import "../styles/quickwins.css";

/** Top bar: open the structured brief. */
export function BriefButton() {
  const count = useBriefCount();
  return (
    <button className={`brief-btn${count ? " filled" : ""}`} onClick={() => useQuick.setState({ briefOpen: true })} title={count ? "Edit the brief your AI follows" : "Write a brief for your AI"}>
      {QIcons.brief}
      <span>Brief</span>
      {count > 0 ? <span className="brief-count">{count}</span> : <span className="brief-empty" aria-hidden />}
    </button>
  );
}

/** Top bar: copy as SVG / PNG and the Outlines view. */
export function CopyMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const outlines = useQuick((s) => s.outlines);
  const hasSel = useStore((s) => s.selection.some((id) => s.doc?.nodes[id] && s.doc.nodes[id]!.type !== "frame"));
  const versionName = useStore((s) => {
    const fid = s.doc ? activeFrameId(s.doc) : null;
    return fid ? (s.doc!.nodes[fid]?.name ?? "") : "";
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const what = hasSel ? "selection" : versionName || "version";
  const run = (f: () => unknown) => () => {
    setOpen(false);
    void f();
  };
  return (
    <div className="copy-menu" ref={ref}>
      <button className={`icon-btn${open ? " active-soft" : ""}`} onClick={() => setOpen(!open)} aria-label="Copy and view options" aria-expanded={open}>
        {QIcons.copySvg}
        {!open && (
          <span className="tip below">
            Copy as SVG / PNG <span className="kbd">⇧⌘C</span>
          </span>
        )}
      </button>
      {open && (
        <div className="menu copy-menu-pop">
          <div className="label menu-label">Copy {what}</div>
          <button className="menu-item" onClick={run(copyAsSvg)}>
            {QIcons.copySvg} As SVG <span className="dim">⇧⌘C</span>
          </button>
          <button className="menu-item" onClick={run(copyAsPng)}>
            {QIcons.image} As PNG <span className="dim">⌥⇧⌘C</span>
          </button>
          <div className="menu-sep" />
          <div className="label menu-label">View</div>
          <button className={`menu-item${outlines ? " on" : ""}`} onClick={run(() => toggleOutlines())}>
            {QIcons.outlines} Outlines <span className="dim">{outlines ? "On · " : ""}⌘Y</span>
          </button>
          <button className="menu-item" onClick={run(() => useQuick.setState({ smallOpen: true }))}>
            {QIcons.pixels} Small sizes…
          </button>
        </div>
      )}
    </div>
  );
}

/** Zoom bar: Outlines view toggle. */
export function OutlinesToggle() {
  const on = useQuick((s) => s.outlines);
  return (
    <button className={`icon-btn small outlines-btn${on ? " active" : ""}`} onClick={() => toggleOutlines()} aria-label="Outlines view" aria-pressed={on}>
      {QIcons.outlines}
      <span className="tip">
        {on ? "Back to color" : "Outlines"} <span className="kbd">⌘Y</span>
      </span>
    </button>
  );
}

/** Modals owned by the quick-win tools (mounted once, from the top bar). */
export function QuickModals() {
  // Portaled to <body> so they sit above every panel, not inside the top bar's stacking context.
  return createPortal(
    <div className="quick-modals">
      <BriefModal />
      <SmallSizesModal />
    </div>,
    document.body,
  );
}
