import { spreadMarkers, type FrameNodeT } from "@brusshy/core";
import { useStore } from "../lib/store";
import { toScreen } from "../canvas/camera";
import { focusFinding, useCritique, visibleFindings } from "./state";

/**
 * Canvas markers for the open critique: a numbered pin per finding (matching the list) and,
 * for the hovered or focused one, its area outlined in red pencil with the finding's title.
 */
export function CritiqueOverlay() {
  const open = useCritique((s) => s.open);
  const report = useCritique((s) => s.report);
  const frameId = useCritique((s) => s.frameId);
  const focus = useCritique((s) => s.focus);
  const hover = useCritique((s) => s.hover);
  const filter = useCritique((s) => s.filter);
  const camera = useStore((s) => s.camera);
  const doc = useStore((s) => s.doc);
  if (!open || !report || report.empty || !doc || !frameId) return null;
  const frame = doc.nodes[frameId] as FrameNodeT | undefined;
  if (!frame || frame.type !== "frame") return null;
  const list = visibleFindings(report, filter);
  const S = (x: number, y: number) => toScreen(camera, frame.transform.x + x, frame.transform.y + y);
  const lit = list.find((f) => f.id === (hover ?? focus)) ?? list.find((f) => f.id === focus) ?? null;
  const pad = 6;
  const spots = spreadMarkers(list.map((f) => S(f.x, f.y)), 22);
  let area = null;
  if (lit?.box) {
    const [x0, y0] = S(lit.box.x, lit.box.y);
    const [x1, y1] = S(lit.box.x + lit.box.w, lit.box.y + lit.box.h);
    area = { x: x0 - pad, y: y0 - pad, w: Math.max(8, x1 - x0 + 2 * pad), h: Math.max(8, y1 - y0 + 2 * pad) };
  }
  return (
    <svg className="cq-overlay" width="100%" height="100%" aria-hidden>
      {area && (
        <g className="cq-area">
          <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={6} />
          <text x={area.x} y={area.y - 8} className="cq-area-label">
            {lit!.title.length > 72 ? `${lit!.title.slice(0, 70)}…` : lit!.title}
          </text>
        </g>
      )}
      {list.map((f, i) => {
        const [x, y] = spots[i];
        const on = f.id === lit?.id;
        return (
          <g
            key={f.id}
            className={`cq-mark sev-${f.severity}${on ? " on" : ""}`}
            transform={`translate(${x} ${y})`}
            onPointerDown={(e) => {
              e.stopPropagation();
              focusFinding(focus === f.id ? null : f.id);
            }}
            onPointerEnter={() => useCritique.setState({ hover: f.id })}
            onPointerLeave={() => useCritique.getState().hover === f.id && useCritique.setState({ hover: null })}
          >
            <circle r={on ? 11 : 9} />
            <text y={on ? 3.8 : 3.4}>{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}
