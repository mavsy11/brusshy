import { useEffect, useRef, useState } from "react";
import {
  currentWarp,
  presetWarp,
  warpRecordOf,
  WARP_DEFAULT_AMOUNT,
  WARP_LABELS,
  WARP_PRESETS,
  type DocT,
  type P,
  type WarpOrientation,
  type WarpPreset,
  type WarpSpec,
  type WarpTarget,
} from "@brusshy/core";
import { select } from "../lib/store";
import { applyWarp, beginWarp, clearWarpPreview, commitWarp, endEnvelope, previewWarp, resetEnvelope, setEnvelopeGrid, startEnvelope, useTypeLab } from "../lib/typelab";
import { Section } from "./controls";
import "../styles/typelab.css";

/** Type Lab · Warp: envelope presets, amount, orientation and a free envelope, for any selection. */

const ICON_BOX = { x: 4, y: 4, w: 30, h: 14 };

/** A tiny mesh drawn through the preset itself — it eases in and out while hovered. */
function WarpGlyph({ preset, amount, orientation, animate }: { preset: WarpPreset; amount: number; orientation: WarpOrientation; animate: boolean }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!animate) return setPhase(0);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      setPhase(((t - t0) / 1400) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);
  const a = animate ? (Math.abs(amount) || 70) * Math.sign(amount || 1) * (0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)) : amount;
  const f = presetWarp(preset, a, ICON_BOX, orientation);
  const { x, y, w, h } = ICON_BOX;
  const line = (pts: P[]) => "M" + pts.map((p) => f(p)).map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L");
  const seg = (a0: P, b0: P, n = 10): P[] => Array.from({ length: n + 1 }, (_, i) => [a0[0] + ((b0[0] - a0[0]) * i) / n, a0[1] + ((b0[1] - a0[1]) * i) / n]);
  const frame =
    line([...seg([x, y], [x + w, y]), ...seg([x + w, y], [x + w, y + h], 6).slice(1), ...seg([x + w, y + h], [x, y + h]).slice(1), ...seg([x, y + h], [x, y], 6).slice(1)]) + "Z";
  const mesh = [0.25, 0.5, 0.75].map((u) => line(seg([x + u * w, y], [x + u * w, y + h], 6))).join("") + [1 / 3, 2 / 3].map((v) => line(seg([x, y + v * h], [x + w, y + v * h]))).join("");
  return (
    <svg viewBox="0 0 38 22" className="warp-glyph" aria-hidden>
      <path className="wg-fill" d={frame} />
      <path className="wg-mesh" d={mesh} />
      <path className="wg-frame" d={frame} />
    </svg>
  );
}

function EnvelopeGlyph() {
  return (
    <svg viewBox="0 0 38 22" className="warp-glyph" aria-hidden>
      <path className="wg-fill" d="M5 6C13 1 25 1 33 6L33 17C25 20 13 20 5 17Z" />
      <path className="wg-mesh" d="M19 2.4L19 19.3M5 11.5C13 9 25 9 33 11.5" />
      <path className="wg-frame" d="M5 6C13 1 25 1 33 6L33 17C25 20 13 20 5 17Z" />
      {[
        [5, 6],
        [33, 6],
        [33, 17],
        [5, 17],
      ].map(([cx, cy], i) => (
        <rect key={i} className="wg-node" x={cx! - 1.8} y={cy! - 1.8} width={3.6} height={3.6} rx={0.6} />
      ))}
    </svg>
  );
}

const OrientIcon = ({ v }: { v: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden>
    {v ? <path d="M5 2.5C2.5 6 2.5 10 5 13.5M11 2.5C8.5 6 8.5 10 11 13.5" /> : <path d="M2.5 5C6 2.5 10 2.5 13.5 5M2.5 11C6 8.5 10 8.5 13.5 11" />}
  </svg>
);

const DEFAULT: WarpSpec = { preset: "arch", amount: 0, orientation: "horizontal" };

export function WarpSection({ doc, ids }: { doc: DocT; ids: string[] }) {
  const cur = currentWarp(doc, ids);
  const key = ids.join(",") + "|" + JSON.stringify(cur && { ...cur, envelope: !!cur.envelope });
  const [spec, setSpec] = useState<WarpSpec>(cur ?? DEFAULT);
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ target: Promise<WarpTarget | null>; last: WarpSpec } | null>(null);
  const session = useTypeLab((s) => s.envelope);
  const editing = !!session && session.members.some((m) => ids.includes(m));
  // Another layer selected, or the warp changed elsewhere (undo, AI): show what the document has.
  useEffect(() => {
    if (!drag.current) setSpec(cur ?? { ...DEFAULT, orientation: spec.orientation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const active = cur ? (cur.preset === "envelope" ? "envelope" : cur.preset) : null;
  const rec = ids.length === 1 ? warpRecordOf(doc, ids[0]!) : null;
  const partOfSet = rec && rec.members.length > 1 && !rec.members.every((m) => ids.includes(m)) ? rec : null;

  const run = async (next: WarpSpec) => {
    setBusy(true);
    setSpec(next);
    await applyWarp(ids, next);
    setBusy(false);
  };
  const choose = (preset: WarpPreset) => {
    if (editing) endEnvelope();
    if (active === preset) return;
    void run({ preset, amount: WARP_DEFAULT_AMOUNT[preset], orientation: spec.orientation });
  };
  const slide = (amount: number) => {
    if (spec.preset === "envelope") return;
    const next = { ...spec, amount };
    setSpec(next);
    if (!drag.current) drag.current = { target: beginWarp(ids), last: next };
    drag.current.last = next;
    const d = drag.current;
    void d.target.then((t) => t && drag.current === d && previewWarp(t, d.last));
  };
  const release = () => {
    const d = drag.current;
    if (!d) return;
    void d.target.then((t) => {
      drag.current = null;
      if (!t) return;
      clearWarpPreview(t);
      commitWarp(t, d.last);
    });
  };
  const orient = (o: WarpOrientation) => {
    if (o === spec.orientation) return;
    const next = { ...spec, orientation: o };
    setSpec(next);
    if (active && active !== "envelope") void run(next);
  };
  const shown = spec.preset === "envelope" ? null : spec.preset;

  return (
    <Section
      title="Warp"
      right={
        <div className="warp-seg" role="group" aria-label="Orientation">
          <button className={spec.orientation === "horizontal" ? "on" : ""} onClick={() => orient("horizontal")} title="Warp along the width">
            <OrientIcon v={false} />
          </button>
          <button className={spec.orientation === "vertical" ? "on" : ""} onClick={() => orient("vertical")} title="Warp along the height">
            <OrientIcon v />
          </button>
        </div>
      }
    >
      {partOfSet && (
        <div className="warp-bar">
          <span className="warp-status grow">Warped together with {partOfSet.members.length - 1} other layer{partOfSet.members.length > 2 ? "s" : ""}.</span>
          <button className="btn small ghost" onClick={() => select(partOfSet.members.filter((m) => doc.nodes[m]))}>
            Select set
          </button>
        </div>
      )}
      <div className="warp-tiles">
        {WARP_PRESETS.map((p) => (
          <button
            key={p}
            className={`warp-tile${active === p ? " on" : ""}`}
            disabled={busy}
            onClick={() => choose(p)}
            onPointerEnter={() => setHover(p)}
            onPointerLeave={() => setHover((h) => (h === p ? null : h))}
            title={WARP_LABELS[p].hint}
          >
            <WarpGlyph preset={p} orientation={spec.orientation} amount={active === p ? spec.amount : WARP_DEFAULT_AMOUNT[p] * 1.6} animate={hover === p && active !== p} />
            <span>{WARP_LABELS[p].label}</span>
          </button>
        ))}
        <button
          className={`warp-tile envelope${active === "envelope" || editing ? " on" : ""}`}
          disabled={busy}
          onClick={() => (editing ? endEnvelope() : void startEnvelope(ids))}
          title="Free envelope: drag corners and edge handles on the canvas (starts from the current warp)"
        >
          <EnvelopeGlyph />
          <span>Envelope</span>
        </button>
      </div>
      {shown && active && active !== "envelope" && !editing && (
        <div className="warp-row" title={WARP_LABELS[shown].hint}>
          <span className="label">Amount</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={spec.amount}
            onChange={(e) => slide(Number(e.target.value))}
            onPointerUp={release}
            onKeyUp={release}
            onDoubleClick={() => void run({ ...spec, amount: 0 })}
          />
          <span className="num">{Math.round(spec.amount)}</span>
        </div>
      )}
      {editing && session && (
        <div className="warp-env-card">
          <div className="warp-bar">
            <b className="grow">Free envelope</b>
            <div className="warp-seg" role="group" aria-label="Mesh">
              <button className={session.rows === 1 ? "on" : ""} onClick={() => setEnvelopeGrid(1)} title="Four corners and their edge handles">
                1×1
              </button>
              <button className={session.rows === 2 ? "on" : ""} onClick={() => setEnvelopeGrid(2)} title="A 3×3 mesh for finer control">
                2×2
              </button>
            </div>
          </div>
          <span>Drag the red points and handles on the canvas. ⌥ keeps a node smooth, ⇧ constrains. Each drag is one undo step.</span>
          <div className="warp-bar">
            <button className="btn small ghost" onClick={resetEnvelope}>
              Flatten
            </button>
            <span className="grow" />
            <button className="btn small" onClick={endEnvelope}>
              Done
            </button>
          </div>
        </div>
      )}
      <div className="warp-bar">
        <span className="warp-status grow">
          {cur ? (
            <>
              <b>{cur.preset === "envelope" ? "Free envelope" : `${WARP_LABELS[cur.preset].label} ${Math.round(cur.amount)}`}</b> · re-editable from the original
            </>
          ) : (
            "Bend the whole selection as one piece. Text becomes editable letters."
          )}
        </span>
        {cur && (
          <button className="btn small ghost" onClick={() => (editing && endEnvelope(), void run({ ...spec, preset: spec.preset === "envelope" ? "arch" : spec.preset, amount: 0 }))} title="Back to the original shapes">
            Reset
          </button>
        )}
      </div>
      {cur && <p className="muted">Subtle amounts read best on logos — check small sizes after warping.</p>}
    </Section>
  );
}
