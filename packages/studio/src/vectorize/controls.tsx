import type { ReactNode } from "react";

/** 0–1 slider (or −1…1 when `min` is −1) with a value readout and end labels. */
export function Slider(props: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  left: string;
  right: string;
  min?: 0 | -1;
}) {
  const min = props.min ?? 0;
  const v = Math.round(props.value * 100);
  return (
    <div className={`vz-field${props.disabled ? " off" : ""}`}>
      <div className="vz-field-head">
        <span>{props.label}</span>
        <span className="vz-num">{min < 0 && v > 0 ? `+${v}` : v}</span>
      </div>
      <input
        type="range"
        min={min * 100}
        max={100}
        value={v}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value) / 100)}
        onDoubleClick={() => min < 0 && props.onChange(0)}
        aria-label={props.label}
        title={props.hint}
      />
      <div className="vz-ends">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </div>
    </div>
  );
}

/** A row of mutually exclusive chips. */
export function Segmented<T extends string | number>(props: { label: string; value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="vz-seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={String(o.value)} className={`vz-chip${props.value === o.value ? " on" : ""}`} title={o.title} aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label="Close" onClick={onClick}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}
