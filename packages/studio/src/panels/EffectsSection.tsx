import { useEffect, useMemo, useRef, useState } from "react";
import {
  effectLayers,
  effectsGroupOf,
  effectSources,
  resolveEffectParams,
  defaultEffectParams,
  sourceGeometry,
  EFFECT_KINDS,
  EFFECT_LABELS,
  EFFECT_PARAMS,
  type DocT,
  type EffectKind,
  type EffectParams,
} from "@brusshy/core";
import { addEffect, clearEffectPreview, previewEffect, removeEffect, textOutlinesNow, updateEffects } from "../lib/typelab";
import { ColorSwatch, Section } from "./controls";
import "../styles/typelab.css";

/** Type Lab · Effects: outline, inline, shadow and double outline as real, re-generatable path layers. */

function FxIcon({ kind }: { kind: EffectKind }) {
  const letter = "M9 16V7.5C9 5.6 10.6 4 12.5 4h5C19.4 4 21 5.6 21 7.5V16";
  return (
    <svg viewBox="0 0 30 20" className="fx-icon" aria-hidden>
      {kind === "shadow" && <path d="M9 16V7.5C9 5.6 10.6 4 12.5 4h5C19.4 4 21 5.6 21 7.5V16l3 3H12z" fill="currentColor" opacity={0.25} />}
      {kind === "double" && <path d="M4.5 18V7.5C4.5 3.4 7.9 0.5 12 0.5h6c4.1 0 7.5 2.9 7.5 7V18" fill="none" stroke="currentColor" strokeWidth={0.9} opacity={0.7} />}
      {(kind === "outline" || kind === "double") && <path d="M6.5 18V7.5C6.5 4.4 9.1 2 12.2 2h5.6c3.1 0 5.7 2.4 5.7 5.5V18" fill="none" stroke="currentColor" strokeWidth={1.1} />}
      <path d={`${letter}Z`} fill="currentColor" />
      {kind === "inline" && <path d="M11.5 16V8c0-1.2 1-2 2-2h3c1 0 2 .8 2 2v8" fill="none" stroke="var(--paper-pure)" strokeWidth={0.9} />}
    </svg>
  );
}

/** Angle dial: drag around the circle (0° = right, 90° = down). */
function AngleDial({ value, onChange, onRelease }: { value: number; onChange: (v: number) => void; onRelease: () => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const r = (value * Math.PI) / 180;
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const set = (ev: { clientX: number; clientY: number; shiftKey?: boolean }) => {
      const b = ref.current!.getBoundingClientRect();
      let a = (Math.atan2(ev.clientY - (b.top + b.height / 2), ev.clientX - (b.left + b.width / 2)) * 180) / Math.PI;
      a = Math.round((a + 360) % 360);
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      onChange(a % 360);
    };
    set(e);
    const move = (ev: PointerEvent) => set(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onRelease();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <svg ref={ref} viewBox="0 0 22 22" className="fx-dial" onPointerDown={down} aria-label="Shadow angle">
      <title>Drag to aim the shadow · ⇧ snaps to 15°</title>
      <circle cx={11} cy={11} r={9.5} />
      <line x1={11} y1={11} x2={11 + Math.cos(r) * 8} y2={11 + Math.sin(r) * 8} />
    </svg>
  );
}

const ROWS: Partial<Record<keyof EffectParams, { label: string; title: string; factor: number }>> = {
  gap: { label: "Gap", title: "Space between the letters and the line", factor: 0.3 },
  width: { label: "Width", title: "Line thickness", factor: 0.25 },
  inset: { label: "Inset", title: "Distance from the edge inwards", factor: 0.2 },
  distance: { label: "Length", title: "Shadow offset / extrusion length", factor: 0.8 },
  gap2: { label: "Gap 2", title: "Space between the two lines", factor: 0.3 },
  width2: { label: "Width 2", title: "Second line thickness", factor: 0.25 },
};

function EffectCard({ ids, kind, layerId, params, scale, stale }: { ids: string[]; kind: EffectKind; layerId: string; params: EffectParams; scale: number; stale: boolean }) {
  const [p, setP] = useState(params);
  const dragging = useRef(false);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!dragging.current) setP(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const change = (patch: Partial<EffectParams>) => {
    dragging.current = true;
    const next = { ...p, ...patch };
    setP(next);
    previewEffect(ids, kind, next);
  };
  const commit = (patch: Partial<EffectParams> = {}) => {
    const next = { ...p, ...patch };
    dragging.current = false;
    setP(next);
    void addEffect(ids, kind, next).finally(() => clearEffectPreview(layerId));
  };
  const slider = (k: keyof EffectParams) => {
    const row = ROWS[k]!;
    const max = Math.max(1, Math.round(scale * row.factor), Math.ceil((p[k] as number) * 1.5));
    const step = max > 60 ? 1 : max > 12 ? 0.5 : 0.1;
    return (
      <div className="warp-row" key={k} title={row.title}>
        <span className="label">{row.label}</span>
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={p[k] as number}
          onChange={(e) => change({ [k]: Number(e.target.value) })}
          onPointerUp={() => commit()}
          onKeyUp={() => commit()}
        />
        <span className="num">{Math.round((p[k] as number) * 10) / 10}</span>
      </div>
    );
  };
  return (
    <div className="fx-card">
      <div className="fx-card-head">
        <span className="grow">{EFFECT_LABELS[kind].label}</span>
        <ColorSwatch color={p.color} onChange={(c) => commit({ color: c })} />
        <button className="icon-x" onClick={() => removeEffect(layerId)} title={`Remove the ${EFFECT_LABELS[kind].label.toLowerCase()}`} aria-label="Remove effect">
          ×
        </button>
      </div>
      {kind === "shadow" && (
        <div className="warp-bar">
          <div className="warp-seg" role="group" aria-label="Shadow style">
            <button className={p.style === "drop" ? "on" : ""} onClick={() => commit({ style: "drop" })} title="An offset copy behind the letters">
              Drop
            </button>
            <button className={p.style === "long" ? "on" : ""} onClick={() => commit({ style: "long" })} title="A solid extrusion: the letters swept along the angle">
              Long
            </button>
          </div>
          <span className="grow" />
          <AngleDial value={p.angle} onChange={(a) => change({ angle: a })} onRelease={() => commit()} />
          <span className="warp-status">{Math.round(p.angle)}°</span>
        </div>
      )}
      {EFFECT_PARAMS[kind].filter((k) => ROWS[k]).map(slider)}
      {kind !== "shadow" && (
        <div className="warp-bar">
          <span className="label grow">Corners</span>
          <div className="warp-seg" role="group" aria-label="Corners">
            <button className={p.corners === "round" ? "on" : ""} onClick={() => commit({ corners: "round" })}>
              Round
            </button>
            <button className={p.corners === "miter" ? "on" : ""} onClick={() => commit({ corners: "miter" })}>
              Sharp
            </button>
          </div>
        </div>
      )}
      {stale && <span className="warp-status">The letters changed since this was made.</span>}
    </div>
  );
}

export function EffectsSection({ doc, ids }: { doc: DocT; ids: string[] }) {
  const [busy, setBusy] = useState<EffectKind | null>(null);
  const group = ids.length === 1 ? effectsGroupOf(doc, ids[0]!) : null;
  const target = group ? [group] : ids;
  const layers = group ? effectLayers(doc, group) : {};
  const geom = useMemo(() => {
    if (!group) return null;
    try {
      return sourceGeometry(doc, effectSources(doc, group), group, textOutlinesNow(doc, [group]));
    } catch {
      return null;
    }
  }, [doc, group]);
  const scale = geom ? Math.max(1, Math.min(geom.box.w, geom.box.h)) : 100;
  const stale = !!geom && Object.values(layers).some((id) => doc.nodes[id!]?.effect?.sig !== geom.sig);

  const add = async (kind: EffectKind) => {
    setBusy(kind);
    await addEffect(target, kind);
    setBusy(null);
  };

  return (
    <Section title="Effects">
      <div className="fx-chips">
        {EFFECT_KINDS.map((k) => (
          <button key={k} className={`fx-chip${layers[k] ? " on" : ""}`} disabled={!!busy || !!layers[k]} onClick={() => void add(k)} title={layers[k] ? `${EFFECT_LABELS[k].label} is on — adjust it below` : `Add ${EFFECT_LABELS[k].hint.toLowerCase()} (a real path layer)`}>
            <FxIcon kind={k} />
            <span>{EFFECT_LABELS[k].label}</span>
          </button>
        ))}
      </div>
      {stale && (
        <div className="fx-stale">
          <span className="grow">Effects are out of date.</span>
          <button className="btn small" onClick={() => group && void updateEffects(group)}>
            Update
          </button>
        </div>
      )}
      {EFFECT_KINDS.filter((k) => layers[k]).map((k) => {
        const n = doc.nodes[layers[k]!]!;
        const params = resolveEffectParams(k, (n.effect?.params ?? {}) as Partial<EffectParams>, defaultEffectParams(k, geom ?? { box: { x: 0, y: 0, w: scale, h: scale }, fill: null }));
        return <EffectCard key={k} ids={target} kind={k} layerId={n.id} params={params} scale={scale} stale={false} />;
      })}
      {!Object.keys(layers).length && <p className="muted">Each effect is its own path layer next to the letters — editable, exportable and 3D-ready.</p>}
    </Section>
  );
}
