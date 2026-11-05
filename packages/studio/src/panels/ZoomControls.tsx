import { useStore } from "../lib/store";
import { fitCamera } from "../canvas/camera";
import { animateCamera, targetZoom, zoomToAnimated } from "../canvas/cameraAnim";

/** Drawn minus / plus so they share the icon set's 1.5 px stroke instead of font glyphs. */
const ZoomIcon = {
  minus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M6 12h12" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M6 12h12M12 6v12" />
    </svg>
  ),
};
import { Icons } from "./icons";
import { OutlinesToggle } from "./QuickTopBar";

export function ZoomControls() {
  const zoom = useStore((s) => s.camera.zoom);
  const doc = useStore((s) => s.doc);
  return (
    <div className="panel zoom" data-ui>
      <button className="icon-btn small" onClick={() => zoomToAnimated(targetZoom() / 1.25)} aria-label="Zoom out">
        {ZoomIcon.minus}
        <span className="tip">
          Zoom out <span className="kbd">⌘−</span>
        </span>
      </button>
      <button className="zoom-val" onClick={() => zoomToAnimated(1)} aria-label="Zoom to 100%" title="Zoom to 100% (⌘1)">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn small" onClick={() => zoomToAnimated(targetZoom() * 1.25)} aria-label="Zoom in">
        {ZoomIcon.plus}
        <span className="tip">
          Zoom in <span className="kbd">⌘+</span>
        </span>
      </button>
      <button className="icon-btn small" onClick={() => doc && animateCamera(fitCamera(doc))} aria-label="Fit all versions">
        {Icons.fit}
        <span className="tip">
          Fit all versions <span className="kbd">⇧1</span>
        </span>
      </button>
      <OutlinesToggle />
    </div>
  );
}
