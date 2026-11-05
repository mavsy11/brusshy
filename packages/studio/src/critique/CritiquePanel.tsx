import { useEffect, useMemo } from "react";
import { CRITIQUE_HINTS, CRITIQUE_LABELS, findFrame, type CritiqueCategory, type CritiqueFinding } from "@brusshy/core";
import { useStore } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import {
  askAiReview,
  askAiToFix,
  closeCritique,
  copyReport,
  fitBeside,
  focusFinding,
  openCritique,
  pinFindings,
  runCritique,
  unpinLast,
  useCritique,
  visibleFindings,
} from "./state";
import "./critique.css";
import "./commands";
import { useCompare } from "../compare/state";

const PinIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </svg>
);

const SEV_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

function ScoreBar({ score }: { score: number | null }) {
  return (
    <span className={`cq-bar${score !== null && score < 60 ? " weak" : ""}`} aria-hidden>
      <i style={{ width: `${score ?? 0}%` }} />
    </span>
  );
}

function CategoryRow({ c, on, onClick }: { c: CritiqueCategory; on: boolean; onClick: () => void }) {
  const na = c.score === null;
  return (
    <button className={`cq-cat${on ? " on" : ""}${na ? " na" : ""}`} onClick={onClick} disabled={na} title={`${CRITIQUE_HINTS[c.id]}\n${c.verdict}`} aria-pressed={on}>
      <span className="cq-cat-top">
        <span className="cq-cat-label">{c.label}</span>
        <ScoreBar score={c.score} />
        <span className="cq-cat-score">{na ? "—" : c.score}</span>
      </span>
      <span className="cq-cat-verdict">{c.verdict}</span>
    </button>
  );
}

function FindingRow({ f, n, focused }: { f: CritiqueFinding; n: number; focused: boolean }) {
  return (
    <li
      className={`cq-finding sev-${f.severity}${focused ? " on" : ""}`}
      data-finding={f.id}
      onPointerEnter={() => useCritique.setState({ hover: f.id })}
      onPointerLeave={() => useCritique.getState().hover === f.id && useCritique.setState({ hover: null })}
    >
      <button className="cq-finding-main" onClick={() => focusFinding(focused ? null : f.id)} aria-expanded={focused}>
        <span className="cq-num">{n}</span>
        <span className="cq-finding-text">
          <span className="cq-finding-title">{f.title}</span>
          <span className="cq-finding-meta">
            <i className="cq-sev" />
            {SEV_LABEL[f.severity]} · {CRITIQUE_LABELS[f.category]}
          </span>
          {focused && (
            <>
              <span className="cq-finding-detail">{f.detail}</span>
              <span className="cq-finding-fix">
                <b>Fix</b> {f.fix}
              </span>
            </>
          )}
        </span>
      </button>
      <button className="cq-pin" onClick={() => pinFindings([f])} title="Pin this as a note on the canvas" aria-label="Pin as note">
        {PinIcon}
      </button>
    </li>
  );
}

/** Floating review panel: overall score, category bars, findings that light up on the canvas. */
export function CritiquePanel() {
  const open = useCritique((s) => s.open);
  const frameId = useCritique((s) => s.frameId);
  const report = useCritique((s) => s.report);
  const focus = useCritique((s) => s.focus);
  const filter = useCritique((s) => s.filter);
  const pinned = useCritique((s) => s.pinned);
  const doc = useStore((s) => s.doc);
  const active = useStore((s) => s.activeFrame);
  const fontsV = useFontVersion((s) => s.v);

  // Follow the version the user is working in.
  useEffect(() => {
    if (open && active && active !== frameId) {
      useCritique.setState({ frameId: active, focus: null, hover: null });
      fitBeside(active);
    }
  }, [open, active, frameId]);

  // Live: re-run the checks as the version (or its fonts) change.
  useEffect(() => {
    if (!open || !doc || !frameId) return;
    const first = !useCritique.getState().report || useCritique.getState().report?.frame.name !== findFrame(doc, frameId)?.name;
    const t = setTimeout(
      () => {
        try {
          useCritique.setState({ report: runCritique(doc, frameId) });
        } catch (e) {
          console.error("critique failed", e);
        }
      },
      first ? 0 : 260,
    );
    return () => clearTimeout(t);
  }, [open, doc, frameId, fontsV]);

  // Keep the focused finding in view in the list.
  useEffect(() => {
    if (!focus) return;
    document.querySelector(`.cq-finding[data-finding="${focus}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  // Esc closes the panel when nothing else wants it (a selection, a tool, an open note).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || useCompare.getState().open || (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      const s = useStore.getState();
      if (useCritique.getState().focus) {
        e.stopPropagation();
        return focusFinding(null);
      }
      if (s.selection.length || s.tool !== "select" || s.openAnnotation || s.exportOpen || s.helpOpen) return;
      e.stopPropagation();
      closeCritique();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const list = useMemo(() => visibleFindings(report, filter), [report, filter]);
  if (!open || !doc) return null;
  const frame = frameId ? findFrame(doc, frameId) : null;
  if (!frame) return null;
  const scoreClass = report?.overall == null ? "" : report.overall >= 78 ? "good" : report.overall >= 62 ? "fair" : "weak";

  return (
    <aside className="panel cq-panel" data-ui aria-label="Design critique">
      <header className="cq-head">
        <div>
          <div className="label" title="Measured craft: legibility, balance, contrast, complexity, consistency, alignment, spacing. Not the idea.">
            Craft checks · {frame.name}
          </div>
          {report && !report.empty ? (
            <div className={`cq-overall ${scoreClass}`}>
              <span className="cq-score">{report.overall}</span>
              <span className="cq-of">/100</span>
            </div>
          ) : (
            <div className="cq-overall">
              <span className="cq-score dim">—</span>
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={closeCritique} aria-label="Close critique" title="Close (Esc)">
          ×
        </button>
      </header>
      {!report ? (
        <p className="cq-verdict muted">Measuring…</p>
      ) : report.empty ? (
        <p className="cq-verdict">{report.verdict}</p>
      ) : (
        <>
          <p className="cq-verdict">{report.verdict}</p>
          <div className="cq-body scroll-y">
            <div className="cq-cats">
              {report.categories.map((c) => (
                <CategoryRow key={c.id} c={c} on={filter === c.id} onClick={() => useCritique.setState({ filter: filter === c.id ? null : c.id, focus: null })} />
              ))}
            </div>
            <div className="cq-list-head">
              <span className="label">
                {filter ? `${report.categories.find((c) => c.id === filter)?.label} · ` : "Findings · "}
                {list.length}
              </span>
              {filter && (
                <button className="btn small ghost" onClick={() => useCritique.setState({ filter: null, focus: null })}>
                  Show all
                </button>
              )}
            </div>
            {list.length ? (
              <ol className="cq-findings">
                {list.map((f, i) => (
                  <FindingRow key={f.id} f={f} n={i + 1} focused={focus === f.id} />
                ))}
              </ol>
            ) : (
              <p className="muted cq-empty">Nothing to fix here.</p>
            )}
            {!report.exactType && <p className="muted cq-note">Fonts are still loading: text is measured approximately for now.</p>}
          </div>
          <footer className="cq-foot">
            <div className="cq-actions">
              <button className="btn" onClick={() => pinFindings(list)} disabled={!list.length} title="Turn these findings into notes on the canvas, to apply one by one">
                Pin as notes
              </button>
              <button className="btn primary" onClick={() => askAiToFix(list)} disabled={!list.length} title="Send these findings to the canvas chat">
                Ask my AI to fix
              </button>
            </div>
            {pinned.some((id) => doc.annotations[id]) && (
              <p className="cq-pinned">
                {pinned.filter((id) => doc.annotations[id]).length} notes pinned on the canvas
                <button onClick={unpinLast}>Undo</button>
              </p>
            )}
            <div className="cq-links">
              <button onClick={() => void copyReport()}>Copy report</button>
              <span aria-hidden>·</span>
              <button onClick={askAiReview} title="Your AI runs the critique tool and adds its judgement on concept and originality">
                Ask for an AI review
              </button>
            </div>
          </footer>
        </>
      )}
    </aside>
  );
}

/** Reopen helper for entry points that know the version. */
export const critiqueVersion = (frameId?: string) => openCritique(frameId);
