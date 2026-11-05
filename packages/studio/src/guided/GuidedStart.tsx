import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { BOARD_MAX, TAG_GROUPS, newId, type BoardItemT } from "@brusshy/core";
import { activeFrameId, dispatch, toast, useStore } from "../lib/store";
import { api } from "../lib/socket";
import { sendChatRequest } from "../lib/chatBridge";
import { refUrl } from "../export/svg";
import { XIcons } from "../explore/icons";
import { Icons } from "../panels/icons";
import { DIRECTIONS, FEELS, MAX_FEEL, guidedOps, guidedRequestText } from "./request";
import { closeGuided, resetGuided, useGuided } from "./state";
import "./guided.css";

/**
 * Guided start on an empty document: (1) what do you do, (2) how should it feel, (3) any
 * references. Finishing writes the Brief (+ board) in one undo step and asks your AI for
 * 4 distinct directions.
 */

const STEPS = ["Brand", "Feel", "References"] as const;
const MARKS = TAG_GROUPS.find((g) => g.id === "markType")!.options;

function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Upload to brusshy/refs/ now; the board itself is written when the guided start finishes. */
async function uploadRefs(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  const onBoard = useStore.getState().doc?.board?.items.length ?? 0;
  const room = BOARD_MAX - onBoard - useGuided.getState().refs.length;
  if (room <= 0) return toast(`The reference board holds ${BOARD_MAX} images`);
  if (imgs.length > room) toast(`Only ${room} more fit — the board holds ${BOARD_MAX}`);
  const batch = imgs.slice(0, room);
  useGuided.setState((s) => ({ uploading: s.uploading + batch.length }));
  for (const file of batch) {
    try {
      const size = await imageSize(file);
      const r = await api<{ src: string }>(`/api/refs?name=${encodeURIComponent(file.name || "reference.png")}`, { method: "POST", body: file });
      const item: BoardItemT = { id: newId("b"), src: r.src, role: "reference", note: "", name: (file.name || "").replace(/\.[^.]+$/, "").slice(0, 200), ...(size ? { width: size.w, height: size.h } : {}) };
      useGuided.setState((s) => ({ refs: [...s.refs, item] }));
    } catch (e) {
      toast(`Upload failed: ${(e as Error).message}`, "error");
    } finally {
      useGuided.setState((s) => ({ uploading: Math.max(0, s.uploading - 1) }));
    }
  }
}

function pickFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  input.multiple = true;
  input.onchange = () => void uploadRefs([...(input.files ?? [])]);
  input.click();
}

const hasFiles = (e: DragEvent) => [...e.dataTransfer.items].some((i) => i.kind === "file");

export function GuidedStart() {
  const g = useGuided();
  const boardCount = useStore((s) => s.doc?.board?.items.length ?? 0);
  const [dropping, setDropping] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const whatRef = useRef<HTMLInputElement>(null);

  const canNext = g.step !== 0 || !!(g.name.trim() || g.what.trim());
  const go = (step: 0 | 1 | 2) => useGuided.setState({ step, dir: step > g.step ? 1 : -1 });

  const finish = () => {
    const doc = useStore.getState().doc;
    if (!doc || g.uploading) return;
    const answers = { name: g.name, what: g.what, feel: g.feel, mark: g.mark, refs: g.refs };
    if (!dispatch(guidedOps(doc, answers), "Guided start")) return;
    const total = Math.min(BOARD_MAX, (doc.board?.items.length ?? 0) + g.refs.length);
    void sendChatRequest(guidedRequestText(answers, total), { frame: activeFrameId(doc), variants: DIRECTIONS });
    resetGuided();
  };
  const next = () => {
    if (!canNext) return (nameRef.current?.focus(), undefined);
    if (g.step < 2) go((g.step + 1) as 1 | 2);
    else finish();
  };
  const back = () => (g.step > 0 ? go((g.step - 1) as 0 | 1) : closeGuided());

  // Focus the first control of each step.
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      if (g.step === 0) nameRef.current?.focus();
      else root.current?.querySelector<HTMLElement>(".gs-body [data-first]")?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [g.step]);

  // Paste images straight in on the references step (and keep them off the canvas).
  useEffect(() => {
    if (g.step !== 2) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void uploadRefs(files);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [g.step]);

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      return closeGuided();
    }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    const mod = e.metaKey || e.ctrlKey;
    // Enter on a chip toggles it; ⌘↩ moves on from anywhere.
    if (!mod && el.tagName === "BUTTON") return;
    e.preventDefault();
    if (!mod && el === nameRef.current && !g.what.trim()) return whatRef.current?.focus();
    next();
  };

  const toggleFeel = (id: string) =>
    useGuided.setState((s) => (s.feel.includes(id) ? { feel: s.feel.filter((x) => x !== id) } : s.feel.length >= MAX_FEEL ? s : { feel: [...s.feel, id] }));

  const total = boardCount + g.refs.length;

  return (
    <div
      ref={root}
      className={`gs${dropping ? " dropping" : ""}`}
      role="dialog"
      aria-label="Guided start"
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        if (g.step !== 2) go(2);
        void uploadRefs([...e.dataTransfer.files]);
      }}
    >
      <header className="gs-top">
        <span className="label">Guided start</span>
        <ol className="gs-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === g.step ? "on" : i < g.step ? "done" : ""}>
              <button type="button" tabIndex={-1} disabled={i > g.step && !canNext} onClick={() => i !== g.step && go(i as 0 | 1 | 2)} aria-current={i === g.step ? "step" : undefined}>
                <span className="gs-dot">{i < g.step ? XIcons.check : i + 1}</span>
                <span className="gs-step-name">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="icon-btn gs-x" onClick={closeGuided} aria-label="Close the guided start" title="Back to the style starters (Esc)">
          {XIcons.close}
        </button>
      </header>

      <div key={g.step} className={`gs-body ${g.dir > 0 ? "fwd" : "bwd"}`}>
        {g.step === 0 && (
          <>
            <h2 className="gs-q">What do you do?</h2>
            <p className="gs-help">Your name and one line about the business — your AI designs around it.</p>
            <label className="gs-field">
              <span>Name</span>
              <input ref={nameRef} value={g.name} maxLength={60} placeholder="Northwind" onChange={(e) => useGuided.setState({ name: e.target.value })} />
            </label>
            <label className="gs-field">
              <span>What it does</span>
              <input ref={whatRef} value={g.what} maxLength={160} placeholder="A small-batch coffee roaster in Portland" onChange={(e) => useGuided.setState({ what: e.target.value })} />
            </label>
          </>
        )}

        {g.step === 1 && (
          <>
            <h2 className="gs-q">How should it feel?</h2>
            <p className="gs-help">
              Pick up to {MAX_FEEL}. <span className="gs-count">{g.feel.length ? `${g.feel.length} of ${MAX_FEEL}` : ""}</span>
            </p>
            <div className="gs-chips feel" role="group" aria-label="Feel">
              {FEELS.map((f, i) => {
                const on = g.feel.includes(f.id);
                const full = !on && g.feel.length >= MAX_FEEL;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    data-first={i === 0 ? "" : undefined}
                    className={`gs-chip${on ? " on" : ""}${full ? " full" : ""}`}
                    onClick={() => toggleFeel(f.id)}
                    title={full ? `Up to ${MAX_FEEL} — unpick one first` : undefined}
                  >
                    {on && <span className="gs-tick">{XIcons.check}</span>}
                    {f.label}
                  </button>
                );
              })}
            </div>
            <div className="gs-sub">
              <span className="gs-sub-label">
                Mark type <span className="dim">· optional</span>
              </span>
              <div className="gs-chips small" role="radiogroup" aria-label="Mark type">
                {MARKS.map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={g.mark === id} className={`gs-chip small${g.mark === id ? " on" : ""}`} onClick={() => useGuided.setState({ mark: g.mark === id ? null : id })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {g.step === 2 && (
          <>
            <h2 className="gs-q">Any references?</h2>
            <p className="gs-help">Logos, posters, type or textures you love. Your AI takes the feel — never the mark.</p>
            {g.refs.length === 0 && !g.uploading ? (
              <button type="button" className="gs-drop" data-first="" onClick={pickFiles}>
                <span className="gs-drop-icon">{Icons.image}</span>
                <span className="gs-drop-title">Drop images, paste with ⌘V, or browse</span>
                <span className="gs-drop-hint">PNG, JPG, WebP, GIF or SVG · added to the reference board</span>
              </button>
            ) : (
              <div className="gs-thumbs">
                {g.refs.map((r) => (
                  <figure key={r.id} className="gs-thumb">
                    <img src={refUrl(r.src)} alt={r.name || "Reference"} draggable={false} />
                    <button type="button" aria-label="Remove" title="Remove" onClick={() => useGuided.setState((s) => ({ refs: s.refs.filter((x) => x.id !== r.id) }))}>
                      {XIcons.close}
                    </button>
                  </figure>
                ))}
                {Array.from({ length: g.uploading }, (_, i) => (
                  <span key={`u${i}`} className="gs-thumb loading" />
                ))}
                {total < BOARD_MAX && (
                  <button type="button" className="gs-thumb add" data-first="" onClick={pickFiles} aria-label="Add images">
                    {XIcons.plus}
                  </button>
                )}
              </div>
            )}
            {boardCount > 0 && (
              <p className="gs-note">
                Your reference board already has {boardCount} image{boardCount === 1 ? "" : "s"} — your AI sees {g.refs.length ? "them too" : "them"}.
              </p>
            )}
          </>
        )}
      </div>

      <footer className="gs-foot">
        <button type="button" className="btn ghost" onClick={back}>
          {g.step === 0 ? "Cancel" : "Back"}
        </button>
        <span className="grow" />
        <span className="gs-hint">
          <span className="kbd">↩</span> {g.step === 2 ? "draft" : "next"}
        </span>
        {g.step === 2 && !g.refs.length && (
          <button type="button" className="btn ghost" onClick={finish} disabled={!!g.uploading}>
            Skip
          </button>
        )}
        <button type="button" className="btn primary" onClick={next} disabled={!canNext || (g.step === 2 && !!g.uploading)}>
          {g.step === 2 ? `Draft ${DIRECTIONS} directions` : "Next"}
          {g.step === 2 ? Icons.sparkle : <span className="gs-arrow">→</span>}
        </button>
      </footer>
      {dropping && <div className="gs-dropping">Drop to add to your references</div>}
    </div>
  );
}
