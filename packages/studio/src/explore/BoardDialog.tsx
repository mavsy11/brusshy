import { useEffect, useRef, useState } from "react";
import { BOARD_MAX, BOARD_ROLE_LABEL, BOARD_ROLES, BOARD_SUGGESTED_MIN, newId, type BoardItemT, type BoardRole, type RefBoardT } from "@brusshy/core";
import { dispatch, toast, useStore } from "../lib/store";
import { api } from "../lib/socket";
import { refUrl } from "../export/svg";
import { ROLES } from "../panels/QuickControls";
import { XIcons } from "./icons";
import { closeBoard, useExploreUi } from "./state";
import "./explore.css";

const ROLE_HINT: Record<BoardRole, string> = Object.fromEntries(ROLES.map((r) => [r.id, r.hint])) as Record<BoardRole, string>;

const LEGEND: Record<BoardRole, string> = {
  reference: "the idea or the structure",
  palette: "only its colors",
  silhouette: "its outer shape",
  style: "its look — strokes, corners, era",
};

const items = () => useStore.getState().doc?.board?.items ?? [];
const saveBoard = (next: BoardItemT[], label: string) => dispatch([{ op: "doc", set: { board: next.length ? ({ items: next } satisfies RefBoardT) : null } }], label);

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

/** Upload images to brusshy/refs/ and add them to the board (one undo step). */
export async function addBoardImages(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  const room = BOARD_MAX - items().length;
  if (room <= 0) return toast(`The board holds ${BOARD_MAX} images — remove one first`);
  if (imgs.length > room) toast(`Only ${room} more fit — the board holds ${BOARD_MAX}`);
  const added: BoardItemT[] = [];
  for (const file of imgs.slice(0, room)) {
    try {
      const size = await imageSize(file);
      const r = await api<{ src: string }>(`/api/refs?name=${encodeURIComponent(file.name || "inspiration.png")}`, { method: "POST", body: file });
      added.push({ id: newId("b"), src: r.src, role: "reference", note: "", name: (file.name || "").replace(/\.[^.]+$/, "").slice(0, 200), ...(size ? { width: size.w, height: size.h } : {}) });
    } catch (e) {
      toast(`Upload failed: ${(e as Error).message}`, "error");
    }
  }
  if (added.length) saveBoard([...items(), ...added], added.length === 1 ? "Add to reference board" : `Add ${added.length} to reference board`);
}

function pickFiles() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  input.multiple = true;
  input.onchange = () => void addBoardImages([...(input.files ?? [])]);
  input.click();
}

function NoteField({ item }: { item: BoardItemT }) {
  const [v, setV] = useState(item.note);
  useEffect(() => setV(item.note), [item.note]);
  const commit = () => {
    const note = v.trim().slice(0, 400);
    if (note !== item.note) saveBoard(items().map((i) => (i.id === item.id ? { ...i, note } : i)), "Board note");
  };
  return (
    <textarea
      className="rb-note"
      rows={2}
      value={v}
      maxLength={400}
      placeholder="Note — what to take from it (optional)"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function Card({ item, index, total }: { item: BoardItemT; index: number; total: number }) {
  const setRole = (role: BoardRole) => role !== item.role && saveBoard(items().map((i) => (i.id === item.id ? { ...i, role } : i)), `Board role: ${BOARD_ROLE_LABEL[role]}`);
  const move = (d: -1 | 1) => {
    const list = [...items()];
    const j = index + d;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j]!, list[index]!];
    saveBoard(list, "Reorder board");
  };
  return (
    <figure className="rb-card">
      <div className="rb-img">
        <img src={refUrl(item.src)} alt={item.name || `Inspiration ${index + 1}`} draggable={false} />
        <span className="rb-num">{index + 1}</span>
        <span className={`rb-role-tag ${item.role}`}>{BOARD_ROLE_LABEL[item.role]}</span>
        <div className="rb-tools">
          <button onClick={() => move(-1)} disabled={index === 0} aria-label="Move earlier" title="Move earlier">
            ‹
          </button>
          <button onClick={() => move(1)} disabled={index === total - 1} aria-label="Move later" title="Move later">
            ›
          </button>
          <button onClick={() => saveBoard(items().filter((i) => i.id !== item.id), "Remove from board")} aria-label="Remove from the board" title="Remove from the board (the file stays in brusshy/refs/)">
            {XIcons.close}
          </button>
        </div>
      </div>
      <figcaption>
        <div className="rb-roles" role="radiogroup" aria-label="What your AI takes from it">
          {BOARD_ROLES.map((r) => (
            <button key={r} role="radio" aria-checked={item.role === r} className={item.role === r ? "on" : ""} onClick={() => setRole(r)} title={ROLE_HINT[r]}>
              {BOARD_ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <p className="rb-hint">{ROLE_HINT[item.role]}</p>
        <NoteField item={item} />
      </figcaption>
    </figure>
  );
}

/** Reference board: 3–12 inspiration images with roles and notes, stored on the document. */
export function BoardDialog() {
  const open = useExploreUi((s) => s.board);
  const board = useStore((s) => s.doc?.board?.items ?? null);
  const [dropping, setDropping] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    // Paste images straight into the board (and keep them off the canvas while it's open).
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input,textarea,[contenteditable]")) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void addBoardImages(files);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [open]);

  if (!open) return null;
  const list = board ?? [];
  const n = list.length;
  const roles = BOARD_ROLES.map((r) => [r, list.filter((i) => i.role === r).length] as const).filter(([, c]) => c);

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closeBoard()}>
      <div
        ref={box}
        tabIndex={-1}
        className={`modal rb${dropping ? " dropping" : ""}`}
        role="dialog"
        aria-label="Reference board"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") closeBoard();
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          void addBoardImages([...e.dataTransfer.files]);
        }}
      >
        <header className="xpl-head">
          <div>
            <div className="label">Reference board</div>
            <h2>What should it feel like?</h2>
            <p className="xpl-sub">Collect {BOARD_SUGGESTED_MIN}–{BOARD_MAX} images that set the direction. Each one's role tells your AI what to take from it — the technique and feel, never the mark itself.</p>
          </div>
          <button className="icon-btn" onClick={closeBoard} aria-label="Close">
            {XIcons.close}
          </button>
        </header>

        <div className="rb-body">
          {n === 0 ? (
            <button className="rb-empty" onClick={pickFiles}>
              <span className="rb-empty-art">
                {XIcons.image}
              </span>
              <span className="rb-empty-title">Drop images here, paste with ⌘V, or browse</span>
              <span className="muted">Posters, packaging, type you love, textures, photos of the place — PNG, JPG, WebP, GIF or SVG.</span>
              <span className="rb-legend">
                {BOARD_ROLES.map((r) => (
                  <span key={r}>
                    <b>{BOARD_ROLE_LABEL[r]}</b> {LEGEND[r]}
                  </span>
                ))}
              </span>
            </button>
          ) : (
            <div className="rb-grid">
              {list.map((it, i) => (
                <Card key={it.id} item={it} index={i} total={n} />
              ))}
              {n < BOARD_MAX && (
                <button className="rb-add" onClick={pickFiles}>
                  {XIcons.plus}
                  <span>Add images</span>
                  <span className="muted">or drop / paste</span>
                </button>
              )}
            </div>
          )}
          {dropping && <div className="rb-drop">Drop to add to the board</div>}
        </div>

        <footer className="xpl-foot">
          <span className="rb-meter" aria-label={`${n} of ${BOARD_MAX} images`}>
            {Array.from({ length: BOARD_MAX }, (_, i) => (
              <i key={i} className={i < n ? "on" : i < BOARD_SUGGESTED_MIN ? "min" : ""} />
            ))}
          </span>
          <span className="xpl-foot-hint">
            {n === 0
              ? "Stored with this logo (files in brusshy/refs/). Never exported."
              : n < BOARD_SUGGESTED_MIN
                ? `${n} of ${BOARD_MAX} — add ${BOARD_SUGGESTED_MIN - n} more for a clear direction.`
                : `${n} of ${BOARD_MAX} · ${roles.map(([r, c]) => `${c} ${BOARD_ROLE_LABEL[r].toLowerCase()}`).join(", ")} · your AI reads them with get_board.`}
          </span>
          <span className="grow" />
          <button className="btn primary" onClick={closeBoard}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
