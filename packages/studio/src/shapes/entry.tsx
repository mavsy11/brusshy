import { lazy, Suspense } from "react";
import { useStore } from "../lib/store";
import { toggleShapes, useShapes } from "./state";
import "./commands";

/**
 * Light entry point mounted by the toolbar: the button and a lazy panel. The shape generators
 * and the symbol data only load the first time the panel opens.
 */

const Body = lazy(() => import("./ShapesPanel").then((m) => ({ default: m.ShapesPanelBody })));

export const ShapesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="3.6" />
    <path d="M16.2 4.2l3.6 6.2h-7.2z" />
    <rect x="4.4" y="13.6" width="7" height="7" rx="1.4" />
    <path d="M16.6 13.4l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3z" />
  </svg>
);

/** Toolbar button that opens the library. */
export function ShapesButton() {
  const open = useShapes((s) => s.open);
  return (
    <button className={`icon-btn${open ? " active" : ""}`} onClick={toggleShapes} aria-label="Shapes" aria-expanded={open}>
      {ShapesIcon}
      <span className="tip">Shapes &amp; symbols</span>
    </button>
  );
}

export function ShapesPanel() {
  const open = useShapes((s) => s.open);
  const view = useStore((s) => s.view);
  if (!open || view === "3d") return null;
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}
