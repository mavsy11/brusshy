import { roleLabel } from "@brusshy/core";
import { useStore } from "../lib/store";

/** The brand palette's colors first in every color picker (one click to apply). */
export function BrandSwatches({ cur, onPick }: { cur: string | null; onPick: (c: string) => void }) {
  const colors = useStore((s) => s.doc?.palette?.colors);
  if (!colors?.length) return null;
  return (
    <div className="doc-swatches brand-swatches" role="listbox" aria-label="Brand palette">
      {colors.map((c, i) => (
        <button
          key={i}
          role="option"
          aria-selected={c.hex === cur}
          className={`doc-swatch${c.hex === cur ? " on" : ""}`}
          style={{ ["--c" as string]: c.hex, borderRadius: 999 }}
          onClick={() => onPick(c.hex)}
          title={`${c.name} · ${roleLabel(c.role)} · ${c.hex.toUpperCase()} (brand palette)`}
        />
      ))}
    </div>
  );
}
