import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { thumbFor, useThumbVersion } from "../lib/historyThumbs";
import "../styles/quickwins.css";

/**
 * A History row's thumbnail (the active version right after that step). Hovering the
 * row shows a larger preview next to the panel.
 */
export function HistThumb({ k, label }: { k: string; label: string }) {
  useThumbVersion((s) => s.v);
  const url = thumbFor(k);
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const row = ref.current?.parentElement;
    if (!row) return;
    const enter = () => {
      const r = row.getBoundingClientRect();
      const panel = row.closest(".side-panel")?.getBoundingClientRect();
      setHover({ x: (panel?.left ?? r.left) - 12, y: r.top + r.height / 2 });
    };
    const leave = () => setHover(null);
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    return () => {
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <span className={`hist-thumb${url ? "" : " empty"}`} ref={ref}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="hist-thumb-dot" />}
      {hover &&
        url &&
        createPortal(
          <div className="hist-preview" style={{ left: hover.x, top: Math.min(Math.max(hover.y, 110), window.innerHeight - 110) }}>
            <img src={url} alt="" />
            <span>{label}</span>
          </div>,
          document.body,
        )}
    </span>
  );
}
