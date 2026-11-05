import type { NodeT } from "@brusshy/core";
import { select, useStore } from "../lib/store";
import { worldBox } from "../lib/geom";
import { toScreen } from "./camera";
import { QIcons } from "../panels/quickIcons";
import "../styles/quickwins.css";

/** A subtle badge on every part the user locked for the AI (top-most locked node of each branch). */
export function AiLockBadges() {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  if (!doc) return null;
  const locked = Object.values(doc.nodes).filter((n): n is NodeT => {
    if (!n.aiLock || !n.visible) return false;
    for (let p = n.parent ? doc.nodes[n.parent] : undefined; p; p = p.parent ? doc.nodes[p.parent] : undefined) if (p.aiLock) return false;
    return true;
  });
  if (!locked.length) return null;
  return (
    <div className="ai-badges">
      {locked.map((n) => {
        const b = n.type === "frame" ? { x: n.transform.x, y: n.transform.y, w: n.width, h: n.height } : worldBox(doc, n);
        const [x1, y0] = toScreen(camera, b.x + b.w, b.y);
        const frame = n.type === "frame";
        return (
          <button
            key={n.id}
            data-ui
            className={`ai-badge${frame ? " frame" : ""}`}
            style={frame ? { left: x1, top: y0 - 26 } : { left: x1, top: y0 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => select([n.id])}
            tabIndex={-1}
          >
            {QIcons.aiLock}
            <span className="ai-badge-tip">Locked for AI{n.name ? ` · ${n.name}` : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
