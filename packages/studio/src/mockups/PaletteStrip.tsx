import { useEffect, useMemo, useState } from "react";
import { contrastRatio, frameDoc, keepColorwaysOps, planColorways, recolorFrameOps, type Colorway, type DocT } from "@brusshy/core";
import { dispatch, toast, useStore } from "../lib/store";
import { textToPath, useFontVersion } from "../lib/fonts";
import { prepareFonts } from "../export/svg";
import { colorwaySvg } from "../palette/render";
import { openPalette } from "../palette/state";
import "./live.css";

/**
 * The brand palette and its colorways inside the Mockups dialog: clicking a colorway previews
 * it on every mockup (nothing is committed); Apply recolors the version in one undo step.
 */

const inkOn = (bg: string) => (contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0b0c0e") ? "#ffffff" : "#0b0c0e");
const cwKey = (cw: Colorway) => `${cw.background}|${JSON.stringify(cw.member)}`;

/** Ops that recolor a version in place to a colorway (paints + background). */
export function applyColorwayOps(doc: DocT, fid: string, cw: Colorway) {
  const { ops } = recolorFrameOps(doc, fid, new Map(Object.entries(cw.member)));
  const f = doc.nodes[fid];
  if (f?.type === "frame" && (f.background ?? "").toLowerCase() !== cw.background.toLowerCase()) ops.push({ op: "update", id: fid, set: { background: cw.background } });
  return ops;
}

function useColorwayPlan(doc: DocT, fid: string | null) {
  const fontsV = useFontVersion((s) => s.v);
  const colors = doc.palette?.colors;
  const sub = useMemo(() => (fid ? frameDoc(doc, fid) : null), [doc, fid]);
  useEffect(() => void (sub && prepareFonts(sub)), [sub]);
  return useMemo(() => {
    if (!fid || !colors || colors.length < 2) return null;
    try {
      return planColorways(doc, fid, colors, { textToPath });
    } catch (e) {
      console.error("[mockups] colorways", e);
      return null;
    }
  }, [sub, colors, fontsV]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Swatch({ doc, fid, cw, on, onPick }: { doc: DocT; fid: string; cw: Colorway; on: boolean; onPick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const key = cwKey(cw);
  useEffect(() => {
    let u: string | null = null;
    const t = setTimeout(() => {
      try {
        u = URL.createObjectURL(new Blob([colorwaySvg(doc, fid, cw)], { type: "image/svg+xml;charset=utf-8" }));
        setUrl(u);
      } catch (e) {
        console.error("[mockups] colorway tile", e);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      if (u) setTimeout(() => URL.revokeObjectURL(u!), 500);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, fid, key]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={`mk-cw${on ? " on" : ""}`}
      style={{ background: cw.background, color: inkOn(cw.background) }}
      onClick={onPick}
      title={`${cw.id} · ${cw.label} · ${cw.contrast.toFixed(1)}:1`}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span className="mk-cw-skel" />}
    </button>
  );
}

export function PaletteStrip({ doc, fid, preview, onPreview }: { doc: DocT; fid: string | null; preview: Colorway | null; onPreview: (cw: Colorway | null) => void }) {
  const plan = useColorwayPlan(doc, fid);
  const colors = doc.palette?.colors ?? [];
  const [ground, setGround] = useState<string | null>(null);
  const frame = fid ? doc.nodes[fid] : null;
  const name = frame?.name ?? "this version";

  // Readable colorways only (the palette dialog shows the full grid), full color first.
  const list = useMemo(() => {
    if (!plan) return [];
    const ok = plan.all.filter((c) => c.readable && (!ground || c.background === ground));
    return [...ok.filter((c) => c.kind === "full"), ...ok.filter((c) => c.kind === "one")];
  }, [plan, ground]);

  // The palette changed under a preview: follow the same colorway id, or drop it.
  useEffect(() => {
    if (!preview) return;
    const same = plan?.all.find((c) => c.id === preview.id);
    if (!same) onPreview(null);
    else if (cwKey(same) !== cwKey(preview)) onPreview(same);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  if (colors.length < 2 || !fid) {
    return (
      <div className="mk-strip empty">
        <span className="mk-strip-label">Colorways</span>
        <span className="mk-strip-hint">{colors.length ? "Add a second brand color to preview colorways here." : "No brand palette yet — make one to preview the logo in every colorway."}</span>
        <button className="btn small" onClick={() => openPalette("palette")}>
          {colors.length ? "Edit palette" : "Create palette"}
        </button>
      </div>
    );
  }

  const apply = () => {
    const cur = useStore.getState().doc;
    if (!cur || !preview) return;
    const ops = applyColorwayOps(cur, fid, preview);
    if (!ops.length) return (toast(`${name} already uses these colors`), onPreview(null));
    if (dispatch(ops, `Apply colorway ${preview.id} to ${name}`)) {
      toast(`${name} recolored — ${preview.label}`);
      onPreview(null);
    }
  };
  const keep = () => {
    const cur = useStore.getState().doc;
    if (!cur || !preview) return;
    try {
      const r = keepColorwaysOps(cur, fid, [preview]);
      if (dispatch(r.ops, `Keep colorway ${preview.label}`)) {
        toast(`Kept as ${r.frames[0]!.name} — ${preview.label}`);
        onPreview(null);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="mk-strip">
      <div className="mk-strip-pal" role="group" aria-label="Brand palette — click a color to show only colorways on it">
        {colors.map((c) => (
          <button
            key={c.hex}
            type="button"
            className={`mk-pal${ground === c.hex ? " on" : ""}`}
            style={{ background: c.hex }}
            aria-pressed={ground === c.hex}
            onClick={() => setGround((g) => (g === c.hex ? null : c.hex))}
            title={`${c.name} ${c.hex} — ${ground === c.hex ? "show every background" : "show colorways on this background"}`}
          />
        ))}
      </div>
      <div className="mk-strip-sep" />
      <div className="mk-strip-scroll" role="radiogroup" aria-label="Colorways">
        <button type="button" role="radio" aria-checked={!preview} className={`mk-cw original${preview ? "" : " on"}`} onClick={() => onPreview(null)} title={`${name} as designed`}>
          <span>As designed</span>
        </button>
        {list.map((cw) => (
          <Swatch key={cw.id} doc={doc} fid={fid} cw={cw} on={preview?.id === cw.id} onPick={() => onPreview(preview?.id === cw.id ? null : cw)} />
        ))}
        {!list.length && <span className="mk-strip-hint">No readable colorway on this background.</span>}
      </div>
      <div className={`mk-strip-act${preview ? " show" : ""}`} aria-hidden={!preview}>
        <span className="mk-strip-now">
          <b>{preview?.id}</b> {preview?.label}
        </span>
        <button className="btn small ghost" tabIndex={preview ? 0 : -1} onClick={keep} title="Keep it as a new version next to this one (one undo step)">
          Keep as version
        </button>
        <button className="btn small primary" tabIndex={preview ? 0 : -1} onClick={apply} title={`Recolor ${name} with this colorway (one undo step)`}>
          Apply to {name}
        </button>
      </div>
    </div>
  );
}
