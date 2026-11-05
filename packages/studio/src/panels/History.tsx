import { useStore } from "../lib/store";
import { socket } from "../lib/socket";
import { stepKey } from "../lib/historyThumbs";
import { HistThumb } from "./HistThumb";
import { openTimelapse } from "../timelapse/state";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Activity log of the logo: every change by you or your AI, newest first.
 * Click a step to go back to it (later steps stay available until you edit again).
 */
export function History() {
  const t = useStore((s) => s.timeline);
  const docId = useStore((s) => s.doc?.id ?? "");
  const rows = t.items.map((it, i) => ({ ...it, step: t.offset + i + 1, applied: i < t.cursor })).reverse();
  const current = t.offset + t.cursor;
  const go = (index: number) => socket.send({ t: "goto", index });
  if (!t.items.length) return <p className="muted pad">No changes yet. Every edit — yours or your AI's — shows up here, and you can jump back to any of them.</p>;
  return (
    <div className="history with-thumbs">
      <button className="btn small ghost hist-replay" onClick={() => openTimelapse()} title="Replay how this version was made, step by step — and export it as a video">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden>
          <path d="M5 3.2v9.6c0 .5.5.8.9.5l7.3-4.8c.4-.3.4-.8 0-1L5.9 2.7C5.5 2.4 5 2.7 5 3.2z" />
        </svg>
        Replay as timelapse
      </button>
      {rows.map((r) => (
        <button key={r.step} className={`hist-row${r.applied ? "" : " undone"}${r.step === current ? " current" : ""}`} onClick={() => go(r.step)} title={r.step === current ? "You are here" : "Go back to this point"}>
          <HistThumb k={stepKey(docId, r)} label={r.label} />
          <span className="hist-text">
            <span className="what">{r.label}</span>
            <span className="hist-meta">
              <span className={`who ${r.author}`}>{r.author === "agent" ? "AI" : "You"}</span>
              <span className="when">{time(r.at)}</span>
            </span>
          </span>
          <span className="hist-step">{r.step === current ? "Now" : r.step}</span>
        </button>
      ))}
      <button className={`hist-row origin${current === t.offset ? " current" : ""}`} onClick={() => go(t.offset)} disabled={t.offset > 0 && current === t.offset}>
        <HistThumb k={stepKey(docId, undefined, t.offset)} label={t.offset > 0 ? "Older steps" : "Start"} />
        <span className="hist-text">
          <span className="what">{t.offset > 0 ? "Older steps" : "Start"}</span>
          <span className="hist-meta">
            <span className="who">{t.offset > 0 ? "Trimmed" : "Blank"}</span>
          </span>
        </span>
        <span className="hist-step">{current === t.offset ? "Now" : ""}</span>
      </button>
      <p className="muted hist-hint">Going back keeps later steps (greyed) until you make a new edit. ⌘Z / ⇧⌘Z step one at a time.</p>
    </div>
  );
}
