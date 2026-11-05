import { useEffect, useState, type ReactNode } from "react";
import { PHI, primaryColor, type FrameNodeT, type GuideT } from "@brusshy/core";
import { activeFrameId, useStore } from "../lib/store";
import { usePalette } from "../lib/quick";
import { addTemplate, clearConstruction, deleteGuide, frameNode, replaceGuide } from "./actions";
import { toggleConstruction, useConstruct, type BuilderMode } from "./state";

const MODES: { id: BuilderMode; label: string; tip: string; icon: ReactNode }[] = [
  {
    id: "fill",
    label: "Fill",
    tip: "Click a region to fill it · drag across regions to merge them · ⇧-click to add to the last region · ⌥-click to cut a region out of a shape",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="9" cy="9" r="5.5" />
        <circle cx="15" cy="15" r="5.5" />
        <path d="M9.53 14.47A5.5 5.5 0 0 1 14.47 9.53 5.5 5.5 0 0 1 9.53 14.47z" className="fillme" />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Circle",
    tip: "Drag from a centre to draw a guide circle — snaps to centres, intersections and tangents (⌥ = no snap)",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 12h7.5" strokeDasharray="1.6 1.8" />
        <path d="M10.6 12h2.8M12 10.6v2.8" />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    tip: "Drag to draw a guide line — snaps to construction points (⇧ = 15° steps)",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M5 18.5L19 5.5" />
        <circle cx="5" cy="18.5" r="1.4" />
        <circle cx="19" cy="5.5" r="1.4" />
      </svg>
    ),
  },
];

const RATIOS: { v: number; label: string }[] = [
  { v: 2, label: "1 : 2" },
  { v: 1.5, label: "2 : 3" },
  { v: PHI, label: "Golden 1 : 1.618" },
  { v: Math.SQRT2, label: "1 : √2" },
];

function NumberField({ label, value, onCommit, step = 1, min }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && (min === undefined || n >= min) && n !== value) onCommit(n);
    else setV(String(Math.round(value * 100) / 100));
  };
  return (
    <label className="cb-num">
      <span>{label}</span>
      <input value={v} step={step} inputMode="decimal" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
    </label>
  );
}

function GuideFields({ f, g }: { f: FrameNodeT; g: GuideT }) {
  const set = (patch: Partial<GuideT>) => replaceGuide(f.id, { ...g, ...patch } as GuideT, "Edit guide");
  return (
    <div className="cb-guide">
      <span className="cb-kind">{g.kind === "circle" ? "Circle" : g.kind === "line" ? "Line" : "Polygon"}</span>
      {g.kind === "circle" && (
        <>
          <NumberField label="X" value={g.cx} onCommit={(v) => set({ cx: v })} />
          <NumberField label="Y" value={g.cy} onCommit={(v) => set({ cy: v })} />
          <NumberField label="R" value={g.r} min={0.01} onCommit={(v) => set({ r: v })} />
        </>
      )}
      {g.kind === "line" && <span className="cb-dim">{Math.round(Math.hypot(g.x2 - g.x1, g.y2 - g.y1) * 10) / 10} long</span>}
      <button className="cb-icon" title="Delete guide (⌫)" aria-label="Delete guide" onClick={() => deleteGuide(f.id, g.id)}>
        <svg viewBox="0 0 24 24">
          <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
        </svg>
      </button>
    </div>
  );
}

function Templates() {
  const { ratio, sectors, divisions } = useConstruct();
  const [custom, setCustom] = useState("");
  const preset = RATIOS.find((r) => Math.abs(r.v - ratio) < 1e-6);
  return (
    <div className="cb-menu panel" data-ui onPointerDown={(e) => e.stopPropagation()}>
      <div className="cb-row">
        <div className="cb-row-title">
          <b>Circle grid</b>
          <span>Concentric circles on one ratio, smaller ones tangent inside the outer circle</span>
        </div>
        <select value={preset ? String(preset.v) : "custom"} onChange={(e) => e.target.value !== "custom" && useConstruct.setState({ ratio: Number(e.target.value) })}>
          {RATIOS.map((r) => (
            <option key={r.label} value={String(r.v)}>
              {r.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {!preset && (
          <input
            className="cb-ratio"
            placeholder={String(Math.round(ratio * 1000) / 1000)}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              const n = Number(e.target.value);
              if (n > 1 && n < 10) useConstruct.setState({ ratio: n });
            }}
          />
        )}
        {preset && (
          <button className="cb-link" onClick={() => useConstruct.setState({ ratio: 1.25 })}>
            Custom
          </button>
        )}
        <button className="cb-add" onClick={() => addTemplate("circle-grid", { ratio })}>
          Add
        </button>
      </div>
      <div className="cb-row">
        <div className="cb-row-title">
          <b>Square grid</b>
          <span>Cells of one unit; the diagonal grid adds 45° lines</span>
        </div>
        <NumberField label="Cells" value={divisions} min={2} onCommit={(v) => useConstruct.setState({ divisions: Math.max(2, Math.min(32, Math.round(v))) })} />
        <button className="cb-add ghost" onClick={() => addTemplate("square-grid", { divisions, diagonals: true })}>
          Diagonal
        </button>
        <button className="cb-add" onClick={() => addTemplate("square-grid", { divisions })}>
          Add
        </button>
      </div>
      <div className="cb-row">
        <div className="cb-row-title">
          <b>Keylines</b>
          <span>Square, circle and diamond of equal visual size</span>
        </div>
        <button className="cb-add" onClick={() => addTemplate("keylines")}>
          Add
        </button>
      </div>
      <div className="cb-row">
        <div className="cb-row-title">
          <b>Radial grid</b>
          <span>N equal sectors with one petal circle each — flowers, suns, apertures</span>
        </div>
        <NumberField label="Sectors" value={sectors} min={3} onCommit={(v) => useConstruct.setState({ sectors: Math.max(3, Math.min(48, Math.round(v))) })} />
        <button className="cb-add" onClick={() => addTemplate("radial", { sectors })}>
          Add
        </button>
      </div>
    </div>
  );
}

/** Floating bar of the shape builder tool. */
export function ConstructBar() {
  const doc = useStore((s) => s.doc);
  const active = useStore((s) => s.activeFrame);
  const { mode, visible, menu, fill, guide } = useConstruct();
  const palette = usePalette();
  if (!doc) return null;
  const f = frameNode(doc, activeFrameId(doc));
  const g = guide && f && guide.frame === f.id ? f.construction?.guides.find((x) => x.id === guide.id) : undefined;
  const primary = primaryColor(doc);
  const colors = [...new Set([primary, ...palette.map((p) => p.color)])].slice(0, 7);
  const current = fill ?? primary;
  void active;
  return (
    <>
      {menu && <Templates />}
      <div className="panel construct-bar" data-ui onPointerDown={(e) => e.stopPropagation()}>
        <div className="cb-seg" role="tablist" aria-label="Shape builder mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : ""} title={m.tip} onClick={() => useConstruct.setState({ mode: m.id, guide: null })}>
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
        <span className="cb-sep" />
        {mode === "fill" && (
          <div className="cb-dots" aria-label="Fill color">
            {colors.map((c) => (
              <button key={c} className={`cb-dot${c === current ? " on" : ""}`} style={{ ["--c" as string]: c }} title={c === primary ? `Brand primary ${c}` : c} onClick={() => useConstruct.setState({ fill: c === primary ? null : c })} />
            ))}
          </div>
        )}
        {mode !== "fill" && g && f ? <GuideFields f={f} g={g} /> : mode !== "fill" && <span className="cb-hint">{mode === "circle" ? "Drag from a centre · click a guide to edit it" : "Drag to draw · ⇧ for 15° steps"}</span>}
        <span className="cb-sep" />
        <button className={`cb-btn${menu ? " on" : ""}`} onClick={() => useConstruct.setState({ menu: !menu })} aria-expanded={menu} title="Insert a construction grid">
          <svg viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="1" />
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="4.9" />
          </svg>
          <span>Grids</span>
        </button>
        <button className={`cb-icon${visible ? "" : " off"}`} onClick={toggleConstruction} title={`${visible ? "Hide" : "Show"} construction outside this tool (⇧G)`} aria-label="Show or hide construction">
          {visible ? (
            <svg viewBox="0 0 24 24">
              <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="2.8" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M4 4l16 16M9.5 6a10 10 0 0 1 2.5-.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.3 7.6A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 0 0 4.2-1" />
            </svg>
          )}
        </button>
        <button className="cb-icon" onClick={() => clearConstruction()} title="Clear this version's construction" aria-label="Clear construction" disabled={!f?.construction?.guides.length}>
          <svg viewBox="0 0 24 24">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
          </svg>
        </button>
      </div>
    </>
  );
}
