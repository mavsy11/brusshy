import { useMemo } from "react";
import { CLEAR_SPACE_LABELS, lockupMetrics, type FrameNodeT } from "@brusshy/core";
import { activeFrameId, useStore } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import { lockupParts, studioTypeMetrics, useLockupUi, withLive } from "../lib/lockup";
import { toScreen } from "./camera";
import "../styles/lockup.css";

const UNIT_GLYPH = { cap: "H", x: "x", mark: "◆" } as const;

/**
 * Brand-guideline guides for the active version: the clear-space zone (dashed edge + the unit
 * box on each side), the ink bounds, the wordmark's cap / x-height / baseline lines, and the
 * lockup's visual centre against the artboard centre. Follows live previews.
 */
export function LockupOverlay() {
  const guides = useLockupUi((s) => s.guides);
  const unit = useLockupUi((s) => s.unit);
  const amount = useLockupUi((s) => s.amount);
  const doc = useStore((s) => s.doc);
  const live = useStore((s) => s.live);
  const camera = useStore((s) => s.camera);
  const selection = useStore((s) => s.selection);
  const active = useStore((s) => s.activeFrame);
  const fontsV = useFontVersion((s) => s.v);

  const fid = doc ? activeFrameId(doc) : null;
  const selKey = selection.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parts = useMemo(() => (guides && doc && fid ? lockupParts(doc, fid, selection) : null), [guides, doc, fid, selKey]);
  const m = useMemo(() => {
    if (!guides || !doc || !fid || !parts) return null;
    try {
      return lockupMetrics(withLive(doc, live), fid, { parts, typeMetrics: studioTypeMetrics, clearSpace: { unit, amount } });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guides, doc, live, fid, parts, unit, amount, fontsV, active]);

  if (!m || !doc || !fid || !m.bounds) return null;
  const f = doc.nodes[fid] as FrameNodeT;
  const ox = f.transform.x, oy = f.transform.y;
  const z = camera.zoom;
  const S = (x: number, y: number) => toScreen(camera, ox + x, oy + y);
  const rect = (x: number, y: number, w: number, h: number) => {
    const [sx, sy] = S(x, y);
    return { x: sx, y: sy, width: Math.max(0, w * z), height: Math.max(0, h * z) };
  };
  const b = m.bounds;
  const cs = m.clearSpace?.value ?? 0;
  const outer = { x: b.x - cs, y: b.y - cs, w: b.w + 2 * cs, h: b.h + 2 * cs };
  const ro = rect(outer.x, outer.y, outer.w, outer.h);
  const ri = rect(b.x, b.y, b.w, b.h);
  const zone = `M${ro.x} ${ro.y}h${ro.width}v${ro.height}h${-ro.width}Z M${ri.x} ${ri.y}h${ri.width}v${ri.height}h${-ri.width}Z`;
  const unitPx = cs * z;
  const units =
    cs > 0 && unitPx >= 6
      ? [
          rect(b.x - cs, b.y + b.h / 2 - cs / 2, cs, cs),
          rect(b.x + b.w, b.y + b.h / 2 - cs / 2, cs, cs),
          rect(b.x + b.w / 2 - cs / 2, b.y - cs, cs, cs),
          rect(b.x + b.w / 2 - cs / 2, b.y + b.h, cs, cs),
        ]
      : [];
  const t = m.type && m.typeVisible ? m.type : null;
  const lines = t
    ? ([
        ["cap", t.baseline - t.capHeight],
        ["x", t.baseline - t.xHeight],
        ["base", t.baseline],
      ] as const)
    : [];
  const lx0 = (t ? Math.min(t.box.x, b.x) : b.x) - 6 / z;
  const lx1 = (t ? Math.max(t.box.x + t.box.w, b.x + b.w) : b.x + b.w) + 6 / z;
  const vc = m.visualCentre ? S(m.visualCentre[0], m.visualCentre[1]) : null;
  const ac = S(f.width / 2, f.height / 2);
  const c = m.clearSpace;
  const tag = c
    ? `Clear space ${String(Math.round(c.amount * 100) / 100)} × ${CLEAR_SPACE_LABELS[c.unit]} · ${Math.round(c.value)} px${c.ok || !t ? "" : " · cut by the artboard"}${m.minSize ? ` · min ${m.minSize.px} px${m.minSize.mm ? ` · ${m.minSize.mm} mm` : ""}` : ""}`
    : "";

  return (
    <svg className="lockup-overlay" width="100%" height="100%" aria-hidden>
      {cs > 0 && <path d={zone} className="lk-zone" />}
      {cs > 0 && <rect {...ro} className={`lk-zone-edge${c && !c.ok && t ? " cut" : ""}`} />}
      <rect {...ri} className="lk-ink" />
      {units.map((u, i) => (
        <g key={i}>
          <rect {...u} className="lk-unit" />
          {u.width >= 13 && (
            <text x={u.x + u.width / 2} y={u.y + u.height / 2} className="lk-unit-label" style={{ fontSize: Math.min(14, Math.max(9, u.width * 0.42)) }}>
              {UNIT_GLYPH[c?.unit ?? "cap"]}
            </text>
          )}
        </g>
      ))}
      {lines.map(([k, y]) => {
        const [x0, sy] = S(lx0, y);
        const [x1] = S(lx1, y);
        return (
          <g key={k}>
            <line x1={x0} x2={x1} y1={sy} y2={sy} className={`lk-line${k === "base" ? " base" : ""}`} />
            {z * (t?.capHeight ?? 0) >= 18 && (
              <text x={Math.max(x1, ro.x + ro.width) + 6} y={sy + (k === "x" ? 3 : k === "cap" ? -3 : 0)} className="lk-line-label">
                {k}
              </text>
            )}
          </g>
        );
      })}
      <g className="lk-centre-board">
        <line x1={ac[0] - 5} x2={ac[0] + 5} y1={ac[1]} y2={ac[1]} />
        <line x1={ac[0]} x2={ac[0]} y1={ac[1] - 5} y2={ac[1] + 5} />
      </g>
      {vc && (
        <g className="lk-centre">
          <circle cx={vc[0]} cy={vc[1]} r={4.5} />
          <line x1={vc[0] - 9} x2={vc[0] + 9} y1={vc[1]} y2={vc[1]} />
          <line x1={vc[0]} x2={vc[0]} y1={vc[1] - 9} y2={vc[1] + 9} />
        </g>
      )}
      {tag && (
        <text x={ro.x} y={ro.y + ro.height + 16} className="lk-tag">
          {tag}
        </text>
      )}
    </svg>
  );
}
