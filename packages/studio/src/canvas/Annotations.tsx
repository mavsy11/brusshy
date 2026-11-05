import { useEffect, useRef, useState } from "react";
import type { AnnotationT, DocT } from "@brusshy/core";
import { copyNotes } from "../lib/notes";
import { dispatch, useStore } from "../lib/store";
import { toScreen } from "./camera";
import { Icons } from "../panels/icons";

export interface DraftNote {
  /** Frame-local coordinates. */
  x: number;
  y: number;
  frameId: string | null;
  nodeId: string | null;
}

/** Frame-local note position → canvas (world) position. */
function noteWorld(doc: DocT, frameId: string | null, x: number, y: number): [number, number] {
  const f = frameId ? doc.nodes[frameId] : undefined;
  return f ? [f.transform.x + x, f.transform.y + y] : [x, y];
}

const STATUS_LABEL: Record<AnnotationT["status"], string> = {
  pending: "Waiting for AI",
  in_progress: "AI is on it",
  resolved: "Done",
  dismissed: "Dismissed",
};

/** Pins + note popovers: the user points at a part of the logo and says what to change. */
export function AnnotationLayer({ draft, onDraftDone }: { draft: DraftNote | null; onDraftDone: () => void }) {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const open = useStore((s) => s.openAnnotation);
  const show = useStore((s) => s.showAnnotations);
  if (!doc) return null;
  const list = Object.values(doc.annotations).sort((a, b) => a.createdAt - b.createdAt);
  const openNotes = list.filter((a) => a.status === "pending" || a.status === "in_progress");
  const visible = list.filter((a) => show && (a.status === "pending" || a.status === "in_progress" || a.id === open));

  return (
    <div className="annotations" data-ui>
      {visible.map((a) => {
        const [x, y] = toScreen(camera, ...noteWorld(doc, a.frameId, a.x, a.y));
        // Number open notes 1…N within their version (resolved ones don't take a number).
        const n = openNotes.filter((o) => o.frameId === a.frameId).indexOf(a) + 1 || list.filter((o) => o.frameId === a.frameId).indexOf(a) + 1;
        return (
          <div key={a.id} className={`pin ${a.status}`} style={{ left: x, top: y }}>
            <button
              className="pin-dot"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => useStore.setState({ openAnnotation: open === a.id ? null : a.id })}
              title={a.note}
            >
              <span>{a.status === "resolved" ? "✓" : n}</span>
            </button>
            {open === a.id && <NotePopover a={a} n={n} />}
          </div>
        );
      })}
      {draft && <DraftPopover draft={draft} n={openNotes.filter((o) => o.frameId === draft.frameId).length + 1} onDone={onDraftDone} />}
    </div>
  );
}

function DraftPopover({ draft, n, onDone }: { draft: DraftNote; n: number; onDone: () => void }) {
  const camera = useStore((s) => s.camera);
  const doc = useStore((s) => s.doc)!;
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [x, y] = toScreen(camera, ...noteWorld(doc, draft.frameId, draft.x, draft.y));
  const target = draft.nodeId ? doc.nodes[draft.nodeId] : null;
  const submit = () => {
    if (!text.trim()) return onDone();
    dispatch([{ op: "annotate", annotation: { x: draft.x, y: draft.y, nodeId: draft.nodeId, frameId: draft.frameId, note: text.trim() } }], "Note");
    onDone();
  };
  return (
    <div className="pin pending draft" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="pin-dot">
        <span>{n}</span>
      </div>
      <div className="note-pop">
        <div className="note-target">{target ? `On ${target.name || target.type}` : "On the artboard"}</div>
        <textarea
          ref={ref}
          value={text}
          placeholder="What should change here? e.g. “make this curve rounder”"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") onDone();
            e.stopPropagation();
          }}
          rows={3}
        />
        <div className="note-actions">
          <span className="hint">Your AI sees this note and the part you pinned.</span>
          <button className="note-trash" onClick={onDone} aria-label="Discard note" title="Discard note">
            {Icons.trash}
          </button>
          <button className="btn small primary" onClick={submit} disabled={!text.trim()}>
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}

function NotePopover({ a, n }: { a: AnnotationT; n: number }) {
  const doc = useStore((s) => s.doc)!;
  const target = a.nodeId ? doc.nodes[a.nodeId] : null;
  const close = () => useStore.setState({ openAnnotation: null });
  return (
    <div className="note-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="note-head">
        <span className="note-num">#{n}</span>
        <span className={`note-status ${a.status}`}>{STATUS_LABEL[a.status]}</span>
        <button className="icon-btn tiny" onClick={close} aria-label="Close">
          ×
        </button>
      </div>
      <div className="note-target">{target ? `On ${target.name || target.type}` : "On the artboard"}</div>
      <p className="note-text">{a.note}</p>
      {a.reply && <p className="note-reply">{a.reply}</p>}
      <div className="note-actions">
        {a.status !== "resolved" ? (
          <button className="btn small" onClick={() => dispatch([{ op: "annotation", id: a.id, set: { status: "resolved" } }], "Resolve note")}>
            Mark done
          </button>
        ) : (
          <button className="btn small" onClick={() => dispatch([{ op: "annotation", id: a.id, set: { status: "pending" } }], "Reopen note")}>
            Reopen
          </button>
        )}
        <button className="btn small ghost" onClick={() => void copyNotes(doc, [a])} title="Copy as a prompt to paste in your AI's chat or terminal">
          Copy
        </button>
        <button
          className="note-trash"
          aria-label="Delete note"
          title="Delete note"
          onClick={() => {
            dispatch([{ op: "unannotate", id: a.id }], "Delete note");
            close();
          }}
        >
          {Icons.trash}
        </button>
      </div>
    </div>
  );
}
