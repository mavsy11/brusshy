import { useMemo, useState } from "react";
import { frameDoc, listFrames, matchPaletteOps, styleBrief, styleProfile, type DocT, type FrameNodeT, type StyleProfile } from "@brusshy/core";
import { dispatch, toast } from "../lib/store";
import { textToPath, useFontVersion } from "../lib/fonts";
import { Section } from "./controls";
import { Icons } from "./icons";
import "../styles/series.css";

/** Style series: one version's style profile, palette chips and "make the others match". */

const pct = (x: number) => `${Math.round(x * 100)}%`;

function copy(textToCopy: string, done: string) {
  navigator.clipboard
    ?.writeText(textToCopy)
    .then(() => toast(done))
    .catch(() => toast("Clipboard is not available here", "error"));
}

function rows(p: StyleProfile): [string, string, string?][] {
  const out: [string, string, string?][] = [];
  const c = p.curves;
  if (c.anchors) out.push(["Shapes", c.character, `${pct(c.curvedShare)} of the outline is curved`]);
  if (c.cornerRadius !== null) out.push(["Corners", `r ${c.cornerRadius} · ${pct(c.cornerRadiusRelative!)} of the mark`]);
  else if (c.anchors && c.sharpShare > 0.2) out.push(["Corners", "sharp"]);
  out.push(["Strokes", p.strokes.dominant !== null ? `${p.strokes.dominant} · ${(p.strokes.relative! * 100).toFixed(1)}% of height · ${p.strokes.caps.join("/")}` : "none — filled shapes"]);
  out.push(["Symmetry", p.symmetry.label, `left/right ${pct(p.symmetry.vertical)} · top/bottom ${pct(p.symmetry.horizontal)}`]);
  if (p.type.length)
    out.push(["Type", p.type.map((t) => `${t.family} ${t.weight} · ${t.tracking >= 0 ? "+" : ""}${t.tracking}em${t.uppercase ? " · caps" : ""}`).join(" / ")]);
  out.push(["Detail", `${p.complexity.level} · ${p.complexity.layers} part${p.complexity.layers === 1 ? "" : "s"} · ${p.complexity.anchors} nodes`]);
  const b = p.layout.bounds;
  const m = p.layout.margins;
  if (b && m) out.push(["Layout", `${pct(b.w / p.frame.width)} × ${pct(b.h / p.frame.height)}${p.layout.centered ? " · centered" : " · off-center"}`, `margins L ${pct(m.left)} R ${pct(m.right)} T ${pct(m.top)} B ${pct(m.bottom)}`]);
  return out;
}

export function StyleSeries({ doc, f }: { doc: DocT; f: FrameNodeT }) {
  const fontsV = useFontVersion((s) => s.v);
  const [matchKey, setMatchKey] = useState(0);
  // Profile of this version only: recomputed when its content changes (or a font finishes loading).
  const subtree = useMemo(() => frameDoc(doc, f.id), [doc, f.id]);
  const profile = useMemo(() => styleProfile(subtree, { textToPath, name: f.name }), [subtree, fontsV, f.name]);
  const others = listFrames(doc).filter((x) => x.id !== f.id);

  if (!profile.complexity.layers)
    return (
      <Section title="Style">
        <p className="muted">Draw something in this version to read its style (palette, strokes, curves, type) for a matching series.</p>
      </Section>
    );

  const match = (sourceId: string) => {
    const src = doc.nodes[sourceId];
    if (!src || src.type !== "frame") return;
    const r = matchPaletteOps(doc, sourceId, f.id, { textToPath });
    if (!r.ops.length) toast(`${f.name} already uses ${src.name}'s colors`);
    else if (dispatch(r.ops, `Match palette from ${src.name}`)) {
      const changed = r.mapping.filter((m) => m.from !== m.to).length;
      toast(`${f.name} recolored with ${src.name}'s palette — ${changed} color${changed === 1 ? "" : "s"} mapped`);
    }
    setMatchKey((k) => k + 1);
  };

  return (
    <Section
      title="Style"
      right={
        <button className="btn small ghost" onClick={() => copy(styleBrief(profile), "Style brief copied — paste it to your AI to design matching pieces")} title="Copy a ready prompt that describes this style, for your AI">
          {Icons.copy} Copy style brief
        </button>
      }
    >
      <div className="style-palette">
        <div className="palette-bar" role="img" aria-label="Palette proportions">
          {profile.palette.map((c) => (
            <i key={c.hex} style={{ background: c.hex, flexGrow: Math.max(c.share, 0.02) }} title={`${c.hex.toUpperCase()} · ${pct(c.share)}`} />
          ))}
        </div>
        <div className="palette-chips">
          {profile.palette.slice(0, 8).map((c) => (
            <button key={c.hex} className="palette-chip" onClick={() => copy(c.hex.toUpperCase(), `Copied ${c.hex.toUpperCase()}`)} title={`${c.name} · ${c.roles.join(" + ")} · click to copy`}>
              <i style={{ background: c.hex }} />
              <span className="chip-hex">{c.hex.slice(1).toUpperCase()}</span>
              <span className="chip-share">{pct(c.share)}</span>
            </button>
          ))}
        </div>
        {profile.frame.background && (
          <p className="muted small">
            on {profile.frame.background.toUpperCase()} · {profile.contrast.replace(/-/g, " ")}
            {profile.gradients ? ` · ${profile.gradients} gradient${profile.gradients === 1 ? "" : "s"}` : ""}
          </p>
        )}
      </div>
      <dl className="style-rows" title={profile.summary}>
        {rows(profile).map(([k, v, hint]) => (
          <div key={k} className="style-row" title={hint}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {others.length ? (
        <select key={matchKey} className="select" defaultValue="" onChange={(e) => e.target.value && match(e.target.value)} title="Recolor this version with another version's palette (lightness order is kept, one undo step)">
          <option value="" disabled>
            Match palette from…
          </option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="muted">Add another version to build a series — then match palettes between them here.</p>
      )}
    </Section>
  );
}
