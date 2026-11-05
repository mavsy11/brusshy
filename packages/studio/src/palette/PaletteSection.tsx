import { contrastRatio, roleLabel, type DocT } from "@brusshy/core";
import { Section } from "../panels/controls";
import { openPalette } from "./state";
import "./palette.css";

/** Side-panel entry: the brand palette at a glance, plus the generator and colorways. */
export function PaletteSection({ doc }: { doc: DocT }) {
  const colors = doc.palette?.colors ?? [];
  return (
    <Section
      title="Palette"
      right={
        <button className="btn small ghost" onClick={() => openPalette("palette")} title="Generate, lock and tune brand colors">
          {colors.length ? "Edit" : "Create"}
        </button>
      }
    >
      {colors.length ? (
        <>
          <button className="pl-mini" onClick={() => openPalette("palette")} aria-label="Edit the brand palette">
            {colors.map((c, i) => (
              <i
                key={i}
                className={c.locked ? "locked" : ""}
                style={{ background: c.hex, color: contrastRatio(c.hex, "#ffffff") > 2.5 ? "#fff" : "#0b0c0e" }}
                title={`${c.name} · ${roleLabel(c.role)} · ${c.hex.toUpperCase()}${c.locked ? " · locked" : ""}`}
              />
            ))}
          </button>
          <div className="pl-mini-actions">
            <button className="btn small" disabled={colors.length < 2} onClick={() => openPalette("colorways")} title="This version in every palette combination">
              Colorways…
            </button>
          </div>
        </>
      ) : (
        <p className="muted">A brand palette your AI reads: harmonies in OKLCH, locks, contrast checks and colorways of the logo.</p>
      )}
    </Section>
  );
}
