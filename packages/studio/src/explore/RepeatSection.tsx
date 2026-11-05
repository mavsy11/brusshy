import { useState } from "react";
import { describeRepeat, repeatGroupOf, type DocT, type GroupNodeT, type MirrorAxis, type RepeatMode } from "@brusshy/core";
import { select } from "../lib/store";
import { NumField, Section } from "../panels/controls";
import { XIcons } from "./icons";
import { releaseRepeat, repeatSelection, updateRepeat } from "./state";
import "./explore.css";

type PivotPick = "artboard" | "selection";

const MODES: { id: RepeatMode; label: string; hint: string }[] = [
  { id: "radial", label: "Radial", hint: "Copies rotated around a centre — petals, rays, apertures" },
  { id: "mirror", label: "Mirror", hint: "Draw half, mirror the other half — faces, crests, wings" },
  { id: "grid", label: "Grid", hint: "Rows and columns with even gaps — modules, pixels, lines" },
];

const AXES: { id: MirrorAxis; label: string; title: string }[] = [
  { id: "vertical", label: "↔", title: "Left ↔ right (across a vertical line)" },
  { id: "horizontal", label: "↕", title: "Top ↕ bottom (across a horizontal line)" },
  { id: "both", label: "✣", title: "Both ways (4 quarters)" },
];

/**
 * Properties → Repeat. On a plain selection: one click makes an exact radial / mirror / grid
 * repeat. On a repeat group (or its source or a copy): its settings, live — every change
 * rebuilds the copies in one undo step — plus "Update from source" after editing the source.
 */
export function RepeatSection({ doc, ids }: { doc: DocT; ids: string[] }) {
  const group = ids.length === 1 ? repeatGroupOf(doc, ids[0]) : null;
  if (group?.repeat) return <RepeatGroupSection doc={doc} g={group} picked={ids[0]!} />;
  return <NewRepeat ids={ids} />;
}

function NewRepeat({ ids }: { ids: string[] }) {
  const [pivot, setPivot] = useState<PivotPick>("artboard");
  const many = ids.length > 1;
  return (
    <Section title="Repeat">
      <div className="rp-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className="rp-mode"
            title={m.hint}
            onClick={() => repeatSelection({ mode: m.id, pivot: m.id === "grid" ? undefined : pivot })}
          >
            {XIcons[m.id]}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="rp-row">
        <span className="label">Centre</span>
        <div className="rp-seg" role="radiogroup" aria-label="Centre for radial and mirror">
          {(["artboard", "selection"] as const).map((p) => (
            <button key={p} role="radio" aria-checked={pivot === p} className={pivot === p ? "on" : ""} onClick={() => setPivot(p)}>
              {p === "artboard" ? "Artboard" : many ? "Selection" : "This layer"}
            </button>
          ))}
        </div>
      </div>
      <p className="muted rp-hint">
        Exact copies, grouped as one layer. Edit the {many ? "unit" : "source"} later and press <b>Update</b> to rebuild them.
      </p>
    </Section>
  );
}

function RepeatGroupSection({ doc, g, picked }: { doc: DocT; g: GroupNodeT; picked: string }) {
  const r = g.repeat!;
  const src = doc.nodes[r.source];
  const isSource = picked === r.source;
  const set = (patch: Parameters<typeof updateRepeat>[1]) => updateRepeat(g.id, patch);
  return (
    <Section
      title={`Repeat · ${r.mode}`}
      right={
        <button className="btn small rp-update" onClick={() => updateRepeat(g.id, {}, "Update repeat")} title="Rebuild the copies from the source (after you edited it)">
          {XIcons.refresh} Update
        </button>
      }
    >
      <p className="rp-desc">{describeRepeat(r)}</p>
      {r.mode === "radial" && (
        <>
          <div className="grid2">
            <NumField label="×" title="Copies (the source included)" value={r.count} min={2} max={72} precision={0} onCommit={(v) => set({ count: Math.round(v) })} />
            <NumField label="∠" title="Sweep (360° = full turn; less = a fan)" value={r.angle} min={-360} max={360} suffix="°" precision={1} onCommit={(v) => set({ angle: v })} />
          </div>
          <div className="rp-steps" aria-label="Common counts">
            {[3, 4, 5, 6, 8, 10, 12].map((n) => (
              <button key={n} className={r.count === n ? "on" : ""} onClick={() => r.count !== n && set({ count: n })}>
                {n}
              </button>
            ))}
          </div>
          <div className="rp-row">
            <span className="label" title="Every other copy">Alternate</span>
            <div className="rp-alt">
              <NumField label="%" title="Scale every other copy (toward the centre)" value={Math.round(r.altScale * 100)} min={5} max={400} precision={0} onCommit={(v) => set({ altScale: v / 100 })} />
              <label className="check mini" title="Mirror every other copy across its radius (symmetric rosettes from one-sided units)">
                <input type="checkbox" checked={r.altMirror} onChange={(e) => set({ altMirror: e.target.checked })} />
                Mirror
              </label>
            </div>
          </div>
          <label className="check" title="Off: copies move around the circle but stay upright">
            <input type="checkbox" checked={r.orient} onChange={(e) => set({ orient: e.target.checked })} />
            Rotate copies with the circle
          </label>
        </>
      )}
      {r.mode === "mirror" && (
        <div className="rp-row">
          <span className="label">Axis</span>
          <div className="rp-seg" role="radiogroup" aria-label="Mirror axis">
            {AXES.map((a) => (
              <button key={a.id} role="radio" aria-checked={r.axis === a.id} className={r.axis === a.id ? "on" : ""} title={a.title} onClick={() => r.axis !== a.id && set({ axis: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {r.mode === "grid" && (
        <div className="grid2">
          <NumField label="↔" title="Columns" value={r.count} min={1} max={72} precision={0} onCommit={(v) => set({ count: Math.round(v) })} />
          <NumField label="↕" title="Rows" value={r.rows} min={1} max={72} precision={0} onCommit={(v) => set({ rows: Math.round(v) })} />
          <NumField label="gx" title="Gap between columns" value={r.gapX} step={1} onCommit={(v) => set({ gap: v, gapY: r.gapY })} />
          <NumField label="gy" title="Gap between rows" value={r.gapY} step={1} onCommit={(v) => set({ gapY: v })} />
        </div>
      )}
      {r.mode !== "grid" && (
        <div className="rp-row">
          <span className="label">Centre</span>
          <div className="rp-seg" role="radiogroup" aria-label="Centre">
            <button role="radio" aria-checked={r.pivotMode === "artboard"} className={r.pivotMode === "artboard" ? "on" : ""} onClick={() => set({ pivot: "artboard" })}>
              Artboard
            </button>
            <button role="radio" aria-checked={r.pivotMode === "selection"} className={r.pivotMode === "selection" ? "on" : ""} onClick={() => set({ pivot: "selection" })}>
              Source
            </button>
            {r.pivotMode === "point" && (
              <button role="radio" aria-checked className="on" title={`(${Math.round(r.pivot[0])}, ${Math.round(r.pivot[1])})`}>
                Point
              </button>
            )}
          </div>
        </div>
      )}
      <label className="check rp-merge" title="Union the source and its copies into one exact shape (the source is kept, hidden, so Update still works)">
        <input type="checkbox" checked={r.merged} onChange={(e) => set({ merge: e.target.checked })} />
        Merge into one shape
      </label>
      <div className="rp-actions">
        <button
          className="btn small ghost"
          disabled={isSource || !src}
          onClick={() => {
            if (!src) return;
            // A merged repeat hides its source: split it back into copies so the source can be seen and edited.
            if (r.merged && !updateRepeat(g.id, { merge: false }, "Unmerge repeat to edit")) return;
            select([src.id]);
          }}
          title={r.merged ? "Split back into copies and select the source (merge again when done)" : "Select the source layer to edit it"}
        >
          {isSource ? "Source selected" : "Edit source"}
        </button>
        <button className="btn small ghost" onClick={() => releaseRepeat(g.id)} title="Keep the copies as ordinary layers and forget the recipe">
          Release
        </button>
      </div>
      <p className="muted rp-hint">{isSource ? "Edit this source, then press Update — the copies follow." : "Copies are rebuilt from the source; hand edits to copies are replaced on Update."}</p>
    </Section>
  );
}
