import { pathDataBounds } from "@brusshy/core";

/** The word drawn big in the panel: click a letter to pick it (alternates, kerning, baseline, scale). */

export interface StripGlyph {
  key: string;
  d: string;
  label: string;
  /** Optional SVG transform for the glyph (lettering letters keep their own transforms). */
  transform?: string;
}

export function WordStrip({ glyphs, selected, onSelect, title }: { glyphs: StripGlyph[]; selected: number | null; onSelect: (i: number | null) => void; title?: string }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of glyphs) {
    const b = pathDataBounds(g.d);
    if (!b) continue;
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  if (!Number.isFinite(x0)) return <div className="tl-strip empty">No letters to show</div>;
  const w = x1 - x0, h = y1 - y0;
  const pad = Math.max(w, h) * 0.06;
  return (
    <div className="tl-strip" title={title ?? "Click a letter to pick it · ⌥←/→ kerning"}>
      <svg viewBox={`${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}`} preserveAspectRatio="xMidYMid meet" role="listbox" aria-label="Letters">
        {glyphs.map((g, i) => (
          <path
            key={g.key}
            d={g.d}
            transform={g.transform}
            className={`tl-glyph${selected === i ? " on" : ""}`}
            role="option"
            aria-selected={selected === i}
            aria-label={g.label}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(selected === i ? null : i);
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/** A small tile rendering one glyph outline (alternates picker). */
export function GlyphTile({ d, label, on, onClick, hint }: { d: string; label: string; on: boolean; onClick: () => void; hint?: string }) {
  const b = pathDataBounds(d);
  const s = b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : 1;
  const cx = b ? (b.x0 + b.x1) / 2 : 0, cy = b ? (b.y0 + b.y1) / 2 : 0;
  const pad = s * 0.18;
  return (
    <button className={`tl-tile${on ? " on" : ""}`} onClick={onClick} title={hint ? `${label} — ${hint}` : label} aria-label={label} aria-pressed={on}>
      <svg viewBox={`${cx - s / 2 - pad} ${cy - s / 2 - pad} ${s + pad * 2} ${s + pad * 2}`}>
        <path d={d} />
      </svg>
    </button>
  );
}
