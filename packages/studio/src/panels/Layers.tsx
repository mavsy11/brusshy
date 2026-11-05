import { useState } from "react";
import type { DocT, NodeT } from "@brusshy/core";
import { dispatch, select, useStore } from "../lib/store";
import { Icons, NODE_ICON } from "./icons";
import { AiLockMiniButton } from "./QuickControls";

type DropPos = "before" | "after" | "inside";

function label(n: NodeT): string {
  if (n.name) return n.name;
  if (n.type === "text") return n.text;
  if (n.type === "shape") return n.shape[0]!.toUpperCase() + n.shape.slice(1);
  return n.type[0]!.toUpperCase() + n.type.slice(1);
}

function Row({ doc, id, depth, drag, setDrag }: { doc: DocT; id: string; depth: number; drag: { id: string; over?: string; pos?: DropPos } | null; setDrag: (d: { id: string; over?: string; pos?: DropPos } | null) => void }) {
  const n = doc.nodes[id];
  const selection = useStore((s) => s.selection);
  const hoverId = useStore((s) => s.hoverId);
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  if (!n) return null;
  const on = selection.includes(id);
  const kids = n.type === "group" || n.type === "frame" ? [...n.children].reverse() : [];
  const dropCls = drag?.over === id ? ` drop-${drag.pos}` : "";
  return (
    <>
      <div
        className={`layer${on ? " on" : ""}${hoverId === id ? " hover" : ""}${n.visible ? "" : " hidden"}${dropCls}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          setDrag({ id });
        }}
        onDragOver={(e) => {
          if (!drag || drag.id === id) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          const dragged = doc.nodes[drag.id];
          // Versions (frames) only reorder among themselves; layers dropped on a version go inside it.
          if ((dragged?.type === "frame") !== (n.type === "frame") && !(n.type === "frame" && dragged?.type !== "frame")) return;
          const pos: DropPos =
            n.type === "frame" && dragged?.type !== "frame" ? "inside" : n.type === "group" && y > 0.3 && y < 0.7 ? "inside" : y < 0.5 ? "before" : "after";
          if (drag.over !== id || drag.pos !== pos) setDrag({ ...drag, over: id, pos });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!drag || !drag.pos || drag.id === id) return setDrag(null);
          // Rows are shown top-first, the tree is bottom-first: "before" on screen = above = higher index.
          if (drag.pos === "inside") dispatch([{ op: "move", id: drag.id, parent: id }], "Move into group");
          else {
            const parent = n.parent;
            const sibs = (parent ? (doc.nodes[parent] as { children: string[] }).children : doc.root).filter((x) => x !== drag.id);
            const idx = sibs.indexOf(id) + (drag.pos === "before" ? 1 : 0);
            dispatch([{ op: "move", id: drag.id, parent, index: idx }], "Reorder");
          }
          setDrag(null);
        }}
        onDragEnd={() => setDrag(null)}
        onPointerEnter={() => useStore.setState({ hoverId: id })}
        onPointerLeave={() => useStore.getState().hoverId === id && useStore.setState({ hoverId: null })}
        onClick={(e) => select(e.shiftKey ? (on ? selection.filter((x) => x !== id) : [...selection, id]) : [id])}
        onDoubleClick={() => setRenaming(true)}
      >
        {(n.type === "group" || n.type === "frame") && n.children.length ? (
          <button className={`twisty${open ? " open" : ""}`} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
            {Icons.chevron}
          </button>
        ) : (
          <span className="twisty-space" />
        )}
        <span className="layer-icon">{Icons[NODE_ICON[n.type]!]}</span>
        {renaming ? (
          <input
            className="layer-rename"
            autoFocus
            defaultValue={n.name || label(n)}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setRenaming(false);
              if (e.target.value.trim() !== (n.name || label(n))) dispatch([{ op: "update", id, set: { name: e.target.value.trim() } }], "Rename");
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="layer-name">{label(n)}</span>
        )}
        {(n.type === "sketch" || n.type === "reference") && <span className="layer-tag">not exported</span>}
        <span className="layer-actions">
          <AiLockMiniButton doc={doc} n={n} />
          <button className={`mini-btn${n.locked ? " pinned" : ""}`} onClick={(e) => (e.stopPropagation(), dispatch([{ op: "update", id, set: { locked: !n.locked } }], n.locked ? "Unlock" : "Lock"))} aria-label="Lock">
            {n.locked ? Icons.lock : Icons.unlock}
          </button>
          <button className={`mini-btn${!n.visible ? " pinned" : ""}`} onClick={(e) => (e.stopPropagation(), dispatch([{ op: "update", id, set: { visible: !n.visible } }], n.visible ? "Hide" : "Show"))} aria-label="Visibility">
            {n.visible ? Icons.eye : Icons.eyeOff}
          </button>
        </span>
      </div>
      {open && kids.map((c) => <Row key={c} doc={doc} id={c} depth={depth + 1} drag={drag} setDrag={setDrag} />)}
    </>
  );
}

export function Layers() {
  const doc = useStore((s) => s.doc);
  const [drag, setDrag] = useState<{ id: string; over?: string; pos?: DropPos } | null>(null);
  if (!doc) return null;
  const rows = [...doc.root].reverse();
  if (!rows.length) return <p className="muted pad">No layers yet. Sketch, add shapes, or ask your AI.</p>;
  return (
    <div className="layers">
      {rows.map((id) => (
        <Row key={id} doc={doc} id={id} depth={0} drag={drag} setDrag={setDrag} />
      ))}
    </div>
  );
}
