import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GradientT, PaintT } from "@brusshy/core";
import { DocSwatches } from "./QuickControls";

/** Numeric field: type a value, or drag the label to scrub. Commits on Enter/blur/scrub end. */
export function NumField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  precision = 1,
  title,
}: {
  label: ReactNode;
  value: number | null;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  precision?: number;
  title?: string;
}) {
  const fmt = (v: number | null) => (v === null ? "" : String(Math.round(v * 10 ** precision) / 10 ** precision));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v) && v !== value) onCommit(clamp(v));
    else setText(fmt(value));
  };
  const scrub = (e: React.PointerEvent) => {
    if (value === null) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value;
    let last = v0;
    const move = (ev: PointerEvent) => {
      last = clamp(v0 + Math.round((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1));
      setText(fmt(last));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (last !== v0) onCommit(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <label className="field" title={title}>
      <span className="scrub" onPointerDown={scrub}>
        {label}
      </span>
      <input
        value={text}
        placeholder={value === null ? "Mixed" : ""}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = clamp((Number(text) || 0) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(fmt(v));
            onCommit(v);
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </label>
  );
}

/** Collapsible side-panel section (panels/Section.tsx). */
export { Section } from "./Section";

export function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <span className="swatch">
      <i style={{ background: color }} />
      <input type="color" value={toHex(color)} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

export function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("").toLowerCase();
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = c;
  const v = ctx.fillStyle;
  return v.startsWith("#") ? v : "#000000";
}

function HexInput({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const [text, setText] = useState(toHex(color).slice(1).toUpperCase());
  useEffect(() => setText(toHex(color).slice(1).toUpperCase()), [color]);
  return (
    <input
      className="hex"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text) && onChange(`#${text}`)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Paint editor: none / solid / linear / radial gradient. */
export function PaintEditor({ paint, onChange, allowNone = true }: { paint: PaintT; onChange: (p: PaintT) => void; allowNone?: boolean }) {
  const kind = paint === null ? "none" : typeof paint === "string" ? "solid" : paint.type;
  const base = typeof paint === "string" ? paint : paint && typeof paint !== "string" ? paint.stops[0]!.color : "#0b0c0e";
  const setKind = (k: string) => {
    if (k === "none") return onChange(null);
    if (k === "solid") return onChange(base);
    const g: GradientT =
      paint && typeof paint !== "string"
        ? { ...paint, type: k as "linear" }
        : { type: k as "linear", angle: 90, stops: [{ offset: 0, color: base }, { offset: 1, color: shade(base) }] };
    onChange(g);
  };
  return (
    <div className="paint">
      <div className="paint-row">
        <select className="select paint-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {allowNone && <option value="none">None</option>}
          <option value="solid">Solid</option>
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        {kind === "solid" && (
          <>
            <ColorSwatch color={paint as string} onChange={onChange} />
            <HexInput color={paint as string} onChange={onChange} />
          </>
        )}
      </div>
      <DocSwatches paint={paint} onPick={onChange} />
      {paint && typeof paint !== "string" && (
        <div className="gradient">
          <div className="gradient-bar" style={{ background: `linear-gradient(90deg, ${paint.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(",")})` }} />
          {paint.stops.map((s, i) => (
            <div className="paint-row" key={i}>
              <ColorSwatch color={s.color} onChange={(c) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, color: c } : x)) })} />
              <HexInput color={s.color} onChange={(c) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, color: c } : x)) })} />
              <NumField label="%" value={Math.round(s.offset * 100)} min={0} max={100} precision={0} onCommit={(v) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, offset: v / 100 } : x)) })} />
            </div>
          ))}
          {paint.type === "linear" && <NumField label="∠" value={paint.angle} suffix="°" precision={0} onCommit={(v) => onChange({ ...paint, angle: v })} />}
        </div>
      )}
    </div>
  );
}

function shade(c: string): string {
  const h = toHex(c);
  const n = parseInt(h.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 60);
  const g = Math.max(0, ((n >> 8) & 255) - 60);
  const b = Math.max(0, (n & 255) - 60);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Text input that commits on Enter/blur (one undo step per edit, not per keystroke). */
export function CommitInput({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="text-input"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
