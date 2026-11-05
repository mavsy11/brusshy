import { useEffect, useMemo, useRef, useState } from "react";
import { exploreRequest, listTechniques, nextVersionName, techniqueById, techniqueShortName, type Technique, type TechniqueKind } from "@brusshy/core";
import { activeFrameId, toast, useStore } from "../lib/store";
import { socket } from "../lib/socket";
import { copyText } from "../lib/notes";
import { TechniqueDiagram, XIcons } from "./icons";
import { closeExplorer, openBoard, openExplorer, useExploreUi } from "./state";
import "./explore.css";

type Mode = "letter" | "subject";

const DEFAULTS: Record<Mode, string[]> = {
  letter: ["stencil", "monoline", "negative-space", "interlock"],
  subject: ["radial", "geometric-reduction", "silhouette-cutout", "line-based"],
};
/** A varied order to "pick for me" from (contrasting constructions first). */
const VARIED: Record<Mode, string[]> = {
  letter: ["stencil", "monoline", "negative-space", "interlock", "container", "object-letter", "modular", "fold", "inline", "fragmented", "rotation", "perspective"],
  subject: ["geometric-reduction", "radial", "silhouette-cutout", "line-based", "mirror", "positive-negative", "modular-grid", "circle-construction"],
};
const LETTERS = "ABCDEF";
const KEY = "brusshy:explore";

interface Saved {
  mode: Mode;
  target: Record<Mode, string>;
  picks: string[];
  count: number;
}

function readSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    if (s && (s.mode === "letter" || s.mode === "subject")) return s;
  } catch {
    /* storage unavailable */
  }
  return { mode: "letter", target: { letter: "", subject: "" }, picks: DEFAULTS.letter, count: 4 };
}

/** Version panel / top of the design panel: entry points for exploring. */
export function ExploreEntry() {
  const items = useStore((s) => s.doc?.board?.items.length ?? 0);
  return (
    <span className="xpl-entry">
      <button className="btn small ghost" onClick={openExplorer} title="Run one letter or subject through several construction techniques — your AI draws one direction per technique">
        {XIcons.explore} Explore
      </button>
      <button className="btn small ghost" onClick={openBoard} title="Inspiration images with roles — your AI reads them before it draws">
        {XIcons.board} Board{items ? <span className="xpl-count">{items}</span> : null}
      </button>
    </span>
  );
}

/** Explorer: letter/initials or a subject × techniques from the catalog → one precise chat request. */
export function ExploreDialog() {
  const open = useExploreUi((s) => s.explorer);
  const doc = useStore((s) => s.doc);
  const chat = useStore((s) => s.chat);
  const [st, setSt] = useState<Saved>(readSaved);
  const [tab, setTab] = useState<TechniqueKind>(st.mode === "letter" ? "letter" : "symbol");
  const [showReq, setShowReq] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      /* storage unavailable */
    }
  }, [st]);

  const target = st.target[st.mode].trim();
  const picks = st.picks.map(techniqueById).filter((t): t is Technique => !!t);
  const request = useMemo(() => exploreRequest({ mode: st.mode, target: target || (st.mode === "letter" ? "A" : "your subject"), techniques: st.picks, count: st.count, versionName: doc ? nextVersionName(doc) : undefined }), [st, target, doc]);
  if (!open || !doc) return null;

  const fid = activeFrameId(doc);
  const frameName = fid ? doc.nodes[fid]?.name : "";
  const busy = !!chat?.busy;
  const boardCount = doc.board?.items.length ?? 0;
  const ready = !!target && !busy && !!chat;

  const setMode = (mode: Mode) => {
    if (mode === st.mode) return;
    // Swap the default picks along with the mode; keep hand-picked ones.
    const untouched = st.picks.join() === DEFAULTS[st.mode].join();
    setSt({ ...st, mode, picks: untouched ? DEFAULTS[mode] : st.picks });
    setTab(mode === "letter" ? "letter" : "symbol");
    requestAnimationFrame(() => input.current?.focus());
  };
  const toggle = (id: string) => setSt((s) => ({ ...s, picks: s.picks.includes(id) ? s.picks.filter((x) => x !== id) : [...s.picks, id] }));
  const pickForMe = () => setSt((s) => ({ ...s, picks: VARIED[s.mode].slice(0, s.count) }));
  const send = () => {
    if (!ready) return;
    socket.send({ t: "chat", text: request, frame: fid, selection: [] });
    closeExplorer();
    toast(`Sent to your AI — ${st.count} directions will appear side by side`, "agent");
  };
  const copy = async () => {
    await copyText(request);
    toast("Request copied — paste it in your AI's chat or terminal");
  };

  const balance =
    picks.length > st.count
      ? `Your AI keeps the ${st.count} that suit “${target || "it"}” best.`
      : picks.length < st.count
        ? `Your AI adds ${st.count - picks.length} more technique${st.count - picks.length === 1 ? "" : "s"}.`
        : "One technique per direction.";

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeExplorer()}>
      <div
        ref={box}
        className="modal xpl"
        role="dialog"
        aria-label="Explore techniques"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") closeExplorer();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
        }}
      >
        <header className="xpl-head">
          <div>
            <div className="label">Explore</div>
            <h2>One idea, many constructions</h2>
            <p className="xpl-sub">Pick a letter or a subject and a few techniques. Your AI draws one direction per technique, side by side — you keep the strongest.</p>
          </div>
          <button className="icon-btn" onClick={closeExplorer} aria-label="Close">
            {XIcons.close}
          </button>
        </header>

        <div className="xpl-body">
          <aside className="xpl-side">
            <div className="xpl-seg" role="radiogroup" aria-label="What to explore">
              {(["letter", "subject"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={st.mode === m} className={st.mode === m ? "on" : ""} onClick={() => setMode(m)}>
                  {m === "letter" ? "Letter / initials" : "Subject"}
                </button>
              ))}
            </div>
            <label className={`xpl-target ${st.mode}`}>
              <span className="label">{st.mode === "letter" ? "Letter or initials" : "Subject"}</span>
              <input
                ref={input}
                value={st.target[st.mode]}
                maxLength={st.mode === "letter" ? 4 : 60}
                placeholder={st.mode === "letter" ? "N" : "camera, fox, mountain…"}
                onChange={(e) => setSt({ ...st, target: { ...st.target, [st.mode]: st.mode === "letter" ? e.target.value.replace(/\s+/g, "") : e.target.value } })}
                onKeyDown={(e) => e.key === "Enter" && send()}
                spellCheck={false}
              />
            </label>

            <div className="xpl-block">
              <span className="label">Directions</span>
              <div className="xpl-count-seg" role="radiogroup" aria-label="Number of directions">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button key={n} role="radio" aria-checked={st.count === n} className={st.count === n ? "on" : ""} onClick={() => setSt({ ...st, count: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="xpl-block grow">
              <div className="xpl-picks-head">
                <span className="label">Techniques · {picks.length}</span>
                <button className="xpl-link" onClick={pickForMe} title="A varied set of contrasting techniques">
                  Pick for me
                </button>
              </div>
              {picks.length ? (
                <ol className="xpl-picks">
                  {picks.map((t, i) => (
                    <li key={t.id} className={i >= st.count ? "extra" : ""}>
                      <span className="xpl-pick-letter">{i < st.count ? LETTERS[i] : "·"}</span>
                      <TechniqueDiagram t={t} size={22} />
                      <span className="xpl-pick-name">{t.name}</span>
                      <button className="xpl-x" onClick={() => toggle(t.id)} aria-label={`Remove ${t.name}`}>
                        {XIcons.close}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted xpl-empty">No techniques picked — your AI will choose {st.count}.</p>
              )}
              <p className="xpl-balance">{balance}</p>
            </div>

            <button className="xpl-reqtoggle" onClick={() => setShowReq(!showReq)} aria-expanded={showReq}>
              {showReq ? "Hide" : "See"} the request
            </button>
            {showReq && <pre className="xpl-req">{request}</pre>}
          </aside>

          <main className="xpl-main">
            <div className="xpl-tabs" role="tablist">
              {(["letter", "symbol"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                  {k === "letter" ? "Letter treatments" : "Symbol constructions"}
                  <span className="xpl-tabn">{listTechniques(k).length}</span>
                </button>
              ))}
              <span className="grow" />
              <span className="xpl-tabhint">{tab === "letter" ? "One letter, many treatments" : "One subject, many constructions"}</span>
            </div>
            <div className="xpl-grid">
              {listTechniques(tab).map((t) => {
                const i = st.picks.indexOf(t.id);
                return (
                  <button key={t.id} className={`xpl-card${i >= 0 ? " on" : ""}`} aria-pressed={i >= 0} onClick={() => toggle(t.id)}>
                    <span className="xpl-art">
                      <TechniqueDiagram t={t} size={68} />
                      {i >= 0 && <span className="xpl-badge">{i < st.count ? LETTERS[i] : XIcons.check}</span>}
                    </span>
                    <span className="xpl-name">{t.name}</span>
                    <span className="xpl-sum">{t.summary}</span>
                    {t.subjects && <span className="xpl-subj">{t.subjects}</span>}
                    <span className="xpl-watch">
                      <b>Watch out</b> {t.watchOut}
                    </span>
                  </button>
                );
              })}
            </div>
          </main>
        </div>

        <footer className="xpl-foot">
          <span className="xpl-foot-hint">
            {busy ? (
              <>Your AI is busy — send when it's done.</>
            ) : (
              <>
                New versions appear next to <b>{frameName}</b>, named by technique ({`${techniqueShortName(picks[0] ?? listTechniques(tab)[0]!)}`}…). Uses your brief
                {boardCount ? (
                  <> and reference board ({boardCount})</>
                ) : (
                  <>
                    {" "}·{" "}
                    <button className="xpl-link" onClick={openBoard}>
                      add a reference board
                    </button>
                  </>
                )}
                .
              </>
            )}
          </span>
          <span className="grow" />
          <button className="btn ghost" onClick={() => void copy()} title="Copy the request to paste in your AI's chat or terminal">
            Copy request
          </button>
          <button className="btn primary" disabled={!ready} onClick={send} title={!target ? (st.mode === "letter" ? "Type a letter first" : "Type a subject first") : "Send to your AI (⌘↩)"}>
            {XIcons.explore} Explore {st.count} directions
          </button>
        </footer>
      </div>
    </div>
  );
}
