import { useEffect, useMemo, useRef, useState } from "react";
import {
  CLEAR_SPACE_DEFAULT,
  CLEAR_SPACE_LABELS,
  frameOf,
  isTypeNode,
  LOCKUP_LABELS,
  lockupMetrics,
  type ClearSpaceUnit,
  type DocT,
  type FrameNodeT,
  type LockupAlign,
  type LockupArrangement,
  type LockupCentre,
  type LockupGapUnit,
  type LockupMetrics,
  type LockupOptions,
} from "@brusshy/core";
import { useFontVersion } from "../lib/fonts";
import {
  clearLockupPreview,
  commitLockup,
  fitArtboardToClearSpace,
  lockupParts,
  makeLockupVersions,
  previewLockup,
  setLockupUi,
  studioTypeMetrics,
  useLockupUi,
  withLive,
} from "../lib/lockup";
import { useStore } from "../lib/store";
import { NumField, Section } from "./controls";
import "../styles/series.css";
import "../styles/lockup.css";

/**
 * Lockup builder: arrangement tiles, mark size in cap heights, gap, vertical alignment and
 * optical centring — previewed live, committed on release (one undo step each) — plus clear
 * space guides and a minimum-size suggestion.
 */

const TILES: { id: LockupArrangement; short: string; title: string }[] = [
  { id: "horizontal", short: "Horiz.", title: "Horizontal — mark left of the wordmark" },
  { id: "stacked", short: "Stack", title: "Stacked — mark above, optically centred over the wordmark" },
  { id: "mark-right", short: "Right", title: "Mark right — wordmark first, mark on the right" },
  { id: "wordmark-only", short: "Word", title: "Wordmark only (the mark is hidden)" },
  { id: "icon-only", short: "Icon", title: "Icon only (the wordmark is hidden)" },
];

/** Tiny diagram of each arrangement: a mark square and type bars. */
function TileGlyph({ a }: { a: LockupArrangement }) {
  const mark = (x: number, y: number, s: number) => <rect className="lk-g-mark" x={x} y={y} width={s} height={s} rx={2} />;
  const type = (x: number, y: number, w: number, h = 4.4) => <rect className="lk-g-type" x={x} y={y} width={w} height={h} rx={1} />;
  return (
    <svg viewBox="0 0 42 24" className="lk-glyph" aria-hidden>
      {a === "horizontal" && (
        <>
          {mark(4, 6, 12)}
          {type(19.5, 9.8, 19)}
        </>
      )}
      {a === "stacked" && (
        <>
          {mark(15.5, 2, 11)}
          {type(9, 16.5, 24)}
        </>
      )}
      {a === "mark-right" && (
        <>
          {type(3.5, 9.8, 19)}
          {mark(26, 6, 12)}
        </>
      )}
      {a === "wordmark-only" && type(7, 9.8, 28)}
      {a === "icon-only" && mark(14.5, 5, 13)}
    </svg>
  );
}

interface Draft {
  frame: string;
  arrangement: LockupArrangement;
  ratio?: number;
  gap?: number;
  align: LockupAlign;
}

const ALIGNS: { id: LockupAlign; label: string; title: string }[] = [
  { id: "optical", label: "Optical", title: "The mark's visual centre on the cap band (x-height band for lowercase words)" },
  { id: "cap", label: "Cap", title: "The mark's box centred on the cap height" },
  { id: "baseline", label: "Base", title: "The mark sits on the baseline" },
];
const CENTRES: { id: LockupCentre; label: string; title: string }[] = [
  { id: "optical", label: "Optical", title: "Centre the lockup on its visual (contrast-weighted) centre" },
  { id: "bbox", label: "Box", title: "Centre the lockup's bounding box" },
  { id: "none", label: "Keep", title: "Keep the wordmark where it is" },
];
const UNITS: { id: ClearSpaceUnit; label: string }[] = [
  { id: "cap", label: "Cap" },
  { id: "x", label: "x" },
  { id: "mark", label: "Mark" },
];

const fx = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : (Math.round(v * 10 ** d) / 10 ** d).toFixed(d));
const px = (v: number) => `${Math.round(v)} px`;
const two = (a: LockupArrangement) => a === "horizontal" || a === "stacked" || a === "mark-right";

function readouts(m: LockupMetrics): [string, string, string?][] {
  const rows: [string, string, string?][] = [];
  if (m.ratio !== null) rows.push(["Ratio", `mark ${fx(m.ratio)} × cap`, "Mark height ÷ cap height"]);
  if (m.gap !== null) rows.push(["Gap", `${fx(m.gapCap)} cap · ${px(m.gap)}${m.gapStroke !== null ? ` · ${fx(m.gapStroke, 1)} strokes` : ""}`, "Ink-to-ink distance between the mark and the wordmark"]);
  if (m.align) {
    const off = m.align[m.align.closest];
    rows.push(["Align", `${m.align.closest === "cap" ? "cap centre" : m.align.closest}${Math.abs(off) < 0.005 ? " · exact" : ` · ${off > 0 ? "+" : ""}${fx(off, 3)} cap`}`, `Offsets in cap heights (+ = mark lower): optical ${fx(m.align.optical, 3)}, cap ${fx(m.align.cap, 3)}, baseline ${fx(m.align.baseline, 3)}`]);
  }
  if (m.stackOffset !== null) rows.push(["Centre", Math.abs(m.stackOffset) < 0.005 ? "mark optically centred" : `mark ${fx(Math.abs(m.stackOffset), 3)} cap ${m.stackOffset > 0 ? "right" : "left"}`, "Mark's visual centre vs the wordmark's centre"]);
  if (m.centreOffset) {
    const [dx, dy] = m.centreOffset.optical;
    rows.push(["Board", Math.hypot(dx, dy) < 0.75 ? "optically centred" : `${dx >= 0 ? "+" : ""}${Math.round(dx)}, ${dy >= 0 ? "+" : ""}${Math.round(dy)} px off`, `Visual centre vs artboard centre (box: ${Math.round(m.centreOffset.bbox[0])}, ${Math.round(m.centreOffset.bbox[1])} px)`]);
  }
  if (m.clearSpace) {
    const c = m.clearSpace;
    rows.push(["Clear", `${px(c.value)} · ${fx(c.amount, 2).replace(/\.?0+$/, "")} × ${c.unit === "x" ? "x-height" : c.unit}${c.ok ? "" : " · cut by artboard"}`, `Margins L ${Math.round(c.margins.left)} R ${Math.round(c.margins.right)} T ${Math.round(c.margins.top)} B ${Math.round(c.margins.bottom)}`]);
  }
  if (m.minSize) rows.push(["Min size", `${m.minSize.px} px wide${m.minSize.mm ? ` · ${m.minSize.mm} mm` : ""}`, `Smallest width that stays legible (limited by ${m.minSize.limitedBy}: cap ≥ 6 px on screen, ≥ 1.5 mm in print)`]);
  return rows;
}

export function LockupSection({ doc, f, selection }: { doc: DocT; f: FrameNodeT; selection?: string[] }) {
  const fontsV = useFontVersion((s) => s.v);
  const ui = useLockupUi();
  const selKey = (selection ?? []).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parts = useMemo(() => lockupParts(doc, f.id, selection ?? []), [doc, f.id, selKey]);
  const clearSpace = { unit: ui.unit, amount: ui.amount };
  const metrics = useMemo(
    () => lockupMetrics(doc, f.id, { parts, typeMetrics: studioTypeMetrics, clearSpace }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, f.id, parts, fontsV, ui.unit, ui.amount],
  );
  const [draftState, setDraft] = useState<Draft | null>(null);
  const live = useStore((s) => s.live);
  const previewing = !!draftState && draftState.frame === f.id;
  // While a preview is on the canvas, the numbers describe the preview.
  const shown = useMemo(
    () => (previewing ? lockupMetrics(withLive(doc, live), f.id, { parts, typeMetrics: studioTypeMetrics, clearSpace }) : metrics),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewing, live, metrics],
  );
  const [centre, setCentre] = useState<LockupCentre>("optical");
  const [gapUnit, setGapUnit] = useState<LockupGapUnit>("cap");
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);

  // Leaving the panel (or another version) drops an uncommitted preview.
  useEffect(() => () => clearLockupPreview(), [f.id]);

  const hasMark = parts.mark.length > 0 && !!metrics.mark;
  const hasType = parts.wordmark.length > 0 && !!metrics.type;
  if (!hasMark && !hasType) return null;

  const current = metrics.arrangement === "custom" || metrics.arrangement === "none" ? null : metrics.arrangement;
  const draft = draftState?.frame === f.id ? draftState : null;
  const view: Draft = draft ?? {
    frame: f.id,
    arrangement: current ?? "horizontal",
    ratio: metrics.ratio ?? undefined,
    gap: (gapUnit === "stroke" ? metrics.gapStroke : metrics.gapCap) ?? undefined,
    align: metrics.align?.closest ?? "optical",
  };
  const pending = !!draft;

  const optsOf = (d: Draft, c = centre, gu = gapUnit): LockupOptions => ({
    arrangement: d.arrangement,
    ratio: two(d.arrangement) ? d.ratio : undefined,
    gap: two(d.arrangement) ? d.gap : undefined,
    gapUnit: gu,
    align: d.align,
    centre: c,
    clearSpace,
  });

  /** Preview `next`; commit right away when it only fine-tunes the current arrangement. */
  const run = (next: Draft, commit: boolean, c = centre, gu = gapUnit) => {
    setError(null);
    if (commit && next.arrangement === current) {
      commitLockup(doc, f.id, parts, optsOf(next, c, gu));
      setDraft(null);
      return;
    }
    const plan = previewLockup(doc, f.id, parts, optsOf(next, c, gu));
    if (typeof plan === "string") {
      setError(plan);
      setDraft(null);
      return;
    }
    setDraft({ ...next, ratio: next.ratio ?? plan.ratio ?? undefined, gap: next.gap ?? plan.gapValue ?? undefined });
  };

  const pickTile = (a: LockupArrangement) => {
    if (a === current && !pending) return;
    if (a === current) {
      clearLockupPreview();
      setDraft(null);
      return;
    }
    // Horizontal ↔ stacked want different proportions: let the planner choose, then show its numbers.
    const family = (x: LockupArrangement) => (x === "stacked" ? "s" : "h");
    const keep = two(a) && family(a) === family(view.arrangement) && two(view.arrangement);
    run({ frame: f.id, arrangement: a, align: view.align, ratio: keep ? view.ratio : undefined, gap: keep ? view.gap : undefined }, false);
  };

  const slide = (key: "ratio" | "gap", v: number) => {
    dragging.current = true;
    run({ ...view, [key]: v }, false);
  };
  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (view.arrangement === current) run(view, true);
  };

  const apply = () => {
    const plan = commitLockup(doc, f.id, parts, optsOf(view));
    if (plan) setDraft(null);
  };
  const cancel = () => {
    clearLockupPreview();
    setDraft(null);
    setError(null);
  };

  const both = hasMark && hasType;
  const set: LockupArrangement[] = both ? ["horizontal", "stacked", "wordmark-only", "icon-only"] : [];
  if (both && view.arrangement === "mark-right") set.splice(1, 0, "mark-right");
  const makeVersions = () =>
    makeLockupVersions(doc, f.id, parts, set, { align: view.align, centre, gapUnit, clearSpace }, two(view.arrangement) ? { arrangement: view.arrangement, ratio: view.ratio, gap: view.gap } : undefined);

  const guidesButton = (
    <button
      className={`btn small ghost lk-guides${ui.guides ? " on" : ""}`}
      onClick={() => setLockupUi({ guides: !ui.guides })}
      title="Show clear space, type lines and visual centre on the canvas"
      aria-pressed={ui.guides}
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1" strokeDasharray="2 1.6" />
        <rect x="5.5" y="5.5" width="5" height="5" rx="0.6" />
      </svg>
      Guides
    </button>
  );

  // A mark on its own isn't a lockup yet: no clear-space maths or warnings, just the next step.
  // (Guides stay reachable only to switch them off.)
  if (!hasType)
    return (
      <Section title="Lockup" id="lockup" right={ui.guides ? guidesButton : undefined}>
        <p className="muted lk-quiet">Add a wordmark to build lockups.</p>
      </Section>
    );

  const ratioMax = view.arrangement === "stacked" ? 6 : 4;
  const gapMax = gapUnit === "stroke" ? 12 : 3;
  const showSliders = both && two(view.arrangement);

  return (
    <Section
      title={pending ? `Preview · ${LOCKUP_LABELS[view.arrangement]}` : current ? `Lockup · ${LOCKUP_LABELS[current]}` : "Lockup"}
      id="lockup"
      right={guidesButton}
    >
      {both ? (
        <div className="lk-tiles" role="radiogroup" aria-label="Arrangement">
          {TILES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={view.arrangement === t.id}
              className={`lk-tile${view.arrangement === t.id ? " on" : ""}${current === t.id ? " current" : ""}`}
              onClick={() => pickTile(t.id)}
              title={`${t.title}${current === t.id ? " — current" : ""}`}
            >
              <TileGlyph a={t.id} />
              <span>{t.short}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted lk-quiet">Add a mark (name the symbol layer “icon”) to build lockups.</p>
      )}

      {showSliders && (
        <div className="lk-controls">
          <div className="lk-row" title="Mark height in cap heights of the wordmark">
            <span className="label">Mark</span>
            <input
              type="range"
              min={0.6}
              max={ratioMax}
              step={0.01}
              value={view.ratio ?? 1.8}
              onChange={(e) => slide("ratio", Number(e.target.value))}
              onPointerUp={release}
              onKeyUp={release}
            />
            <NumField label="×" value={view.ratio ?? null} min={0.2} max={12} step={0.05} precision={2} title="Mark height ÷ cap height" onCommit={(v) => run({ ...view, ratio: v }, true)} />
          </div>
          <div className="lk-row" title={gapUnit === "cap" ? "Gap in cap heights (ink to ink)" : "Gap in mark strokes (ink to ink)"}>
            <span className="label">Gap</span>
            <input
              type="range"
              min={0}
              max={gapMax}
              step={0.01}
              value={Math.min(view.gap ?? 0.75, gapMax)}
              onChange={(e) => slide("gap", Number(e.target.value))}
              onPointerUp={release}
              onKeyUp={release}
            />
            <NumField label={gapUnit === "cap" ? "H" : "|"} value={view.gap ?? null} min={0} max={20} step={0.05} precision={2} title={gapUnit === "cap" ? "Gap in cap heights" : "Gap in mark strokes"} onCommit={(v) => run({ ...view, gap: v }, true)} />
          </div>
          <div className="lk-seg-row">
            <span className="label">Unit</span>
            <div className="seg-group lk-seg">
              {(["cap", "stroke"] as const).map((u) => (
                <button
                  key={u}
                  className={`seg${gapUnit === u ? " on" : ""}`}
                  disabled={u === "stroke" && !metrics.mark?.stroke}
                  title={u === "cap" ? "Gap measured in cap heights" : `Gap measured in the mark's stroke weight${metrics.mark?.stroke ? ` (${fx(metrics.mark.stroke, 1)}${metrics.mark.strokeExplicit ? "" : ", stem estimate"})` : ""}`}
                  onClick={() => {
                    if (u === gapUnit) return;
                    setGapUnit(u);
                    if (draft) run({ ...view, gap: undefined }, false, centre, u);
                  }}
                >
                  {u === "cap" ? "Cap height" : "Stroke"}
                </button>
              ))}
            </div>
          </div>
          {(view.arrangement === "horizontal" || view.arrangement === "mark-right") && (
            <div className="lk-seg-row">
              <span className="label">Align</span>
              <div className="seg-group lk-seg">
                {ALIGNS.map((a) => (
                  <button key={a.id} className={`seg${view.align === a.id ? " on" : ""}`} title={a.title} onClick={() => run({ ...view, align: a.id }, true)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {both && (
        <div className="lk-seg-row">
          <span className="label">Centre</span>
          <div className="seg-group lk-seg">
            {CENTRES.map((c) => (
              <button
                key={c.id}
                className={`seg${centre === c.id ? " on" : ""}`}
                title={c.title}
                onClick={() => {
                  setCentre(c.id);
                  if (c.id !== "none") run(view, true, c.id);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="muted lk-error">{error}</p>}

      {both && (
        <div className="lk-actions">
          <button className={`btn small${pending ? " primary" : ""}`} onClick={apply} title="Apply this lockup to the version (one undo step)">
            Apply {LOCKUP_LABELS[view.arrangement].toLowerCase()}
          </button>
          {pending ? (
            <button className="btn small ghost" onClick={cancel} title="Drop the preview">
              Cancel
            </button>
          ) : (
            <button className="btn small ghost" onClick={makeVersions} title={`New versions side by side: ${set.map((a) => LOCKUP_LABELS[a]).join(", ")} — each artboard fitted to its clear space (one undo step)`}>
              Make versions
            </button>
          )}
        </div>
      )}

      <div className="lk-clear">
        <div className="lk-seg-row">
          <span className="label">Clear</span>
          <div className="seg-group lk-seg">
            {UNITS.map((u) => (
              <button
                key={u.id}
                className={`seg${ui.unit === u.id ? " on" : ""}`}
                disabled={(u.id !== "mark" && !hasType) || (u.id === "mark" && !hasMark)}
                title={`Measure clear space in ${CLEAR_SPACE_LABELS[u.id]}s`}
                onClick={() => setLockupUi({ unit: u.id, amount: CLEAR_SPACE_DEFAULT[u.id] })}
              >
                {u.label}
              </button>
            ))}
          </div>
          <NumField label="×" value={ui.amount} min={0.05} max={10} step={0.05} precision={2} title={`Clear space in ${CLEAR_SPACE_LABELS[ui.unit]}s`} onCommit={(v) => setLockupUi({ amount: v })} />
        </div>
      </div>

      <dl className="style-rows lk-rows">
        {readouts(shown).map(([k, v, hint]) => (
          <div key={k} className={`style-row${k === "Clear" && shown.clearSpace && !shown.clearSpace.ok ? " lk-warn" : ""}`} title={hint}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="lk-foot">
        <span className={`lk-src${metrics.exact ? " exact" : ""}`} title={metrics.notes.join(" ")}>
          {metrics.exact ? "Measured on the font" : metrics.type?.source === "letters" ? "Measured on the letters" : metrics.type ? "Estimated metrics" : "Mark only"}
        </span>
        <button className="btn small ghost" onClick={() => fitArtboardToClearSpace(doc, f.id, parts, clearSpace)} title="Resize the artboard so the lockup has exactly its clear space on every side (one undo step)">
          Fit artboard
        </button>
      </div>
    </Section>
  );
}

/** True when a multi-selection holds a mark and some type of one version (a lockup of just those parts). */
export function selectionMakesLockup(doc: DocT, ids: string[]): boolean {
  const f = frameOf(doc, ids[0]);
  if (!f || ids.some((id) => frameOf(doc, id)?.id !== f.id)) return false;
  const types = ids.filter((id) => isTypeNode(doc, id)).length;
  return types > 0 && types < ids.length;
}

/** Lockup section for a multi-selection: only when it holds a mark and some type of one version. */
export function LockupForSelection({ doc, ids }: { doc: DocT; ids: string[] }) {
  const f = frameOf(doc, ids[0]);
  if (!f || !selectionMakesLockup(doc, ids)) return null;
  return <LockupSection doc={doc} f={f} selection={ids} />;
}
