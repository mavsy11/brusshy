import { useEffect, useRef, useState } from "react";
import { BrandWord } from "./BrandWord";
import { dispatch, redo, setView, undo, useStore } from "../lib/store";
import { socket } from "../lib/socket";
import { copyNotes } from "../lib/notes";
import { Icons } from "./icons";
import { BriefButton, CopyMenu, QuickModals } from "./QuickTopBar";
import { t } from "../lib/i18n";
import { openMockups } from "../mockups/MockupsDialog";
import { openFonts } from "../typeset/state";
import { openPresentation } from "../present/state";
import { openStage } from "../stage/state";
import { CommandPaletteButton } from "../palette-cmd/CommandPalette";

function DocMenu() {
  const doc = useStore((s) => s.doc);
  const docs = useStore((s) => s.docs);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  if (!doc) return null;
  const commitName = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== doc.name) dispatch([{ op: "doc", set: { name: n } }], "Rename");
  };
  return (
    <div className="doc-menu" ref={ref}>
      {editing ? (
        <input
          className="doc-name-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button
          className="doc-name"
          onClick={() => setOpen(!open)}
          onDoubleClick={() => {
            setName(doc.name);
            setEditing(true);
            setOpen(false);
          }}
          title="Double-click to rename"
        >
          {doc.name}
          <span className="chev">{Icons.chevron}</span>
        </button>
      )}
      {open && (
        <div className="menu">
          <div className="label menu-label">Logos in this folder</div>
          {docs.map((d) => (
            <button
              key={d.id}
              className={`menu-item${d.id === doc.id ? " on" : ""}`}
              onClick={() => {
                socket.send({ t: "open", id: d.id });
                setOpen(false);
              }}
            >
              <span>{d.name}</span>
              <span className="dim">{d.file}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              socket.send({ t: "create", name: "Untitled logo" });
              setOpen(false);
            }}
          >
            {Icons.plus} New logo
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setName(doc.name);
              setEditing(true);
              setOpen(false);
            }}
          >
            Rename…
          </button>
        </div>
      )}
    </div>
  );
}

/** Pending notes, with Agentation-style "copy as prompt" for pasting into your AI's terminal. */
function NotesPill() {
  const doc = useStore((s) => s.doc);
  if (!doc) return null;
  const pending = Object.values(doc.annotations).filter((a) => a.status === "pending");
  if (!pending.length) return null;
  return (
    <button className="notes-pill" onClick={() => void copyNotes(doc, pending)} title="Copy the notes as a prompt — paste it in your AI's chat or terminal">
      <span className="notes-count">{pending.length}</span>
      note{pending.length === 1 ? "" : "s"} · Copy for AI
    </button>
  );
}

function AgentPill() {
  const agent = useStore((s) => s.agent);
  const connected = useStore((s) => s.connected);
  const working = agent.state === "working";
  return (
    <div className={`agent-pill${working ? " working" : ""}${connected ? "" : " offline"}`} title={connected ? "Your AI talks to this canvas through MCP" : "Lost connection to Brusshy"}>
      <span className="agent-dot" />
      <span className="agent-label">{!connected ? t("agent.offline") : working ? agent.message || "Your AI is working…" : t("agent.idle")}</span>
    </div>
  );
}

export function TopBar() {
  const view = useStore((s) => s.view);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  return (
    <div className="topbar" data-ui>
      <div className="panel topbar-left">
        <div className="brand-mark" aria-label="Brusshy">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="26" height="26" alt="" />
          <BrandWord />
        </div>
        <div className="vsep" />
        <DocMenu />
      </div>

      <div className="panel view-switch">
        {(["2d", "split", "3d"] as const).map((v) => (
          <button key={v} className={`seg${view === v ? " on" : ""}`} onClick={() => setView(v)}>
            {v === "2d" ? Icons.square2d : v === "3d" ? Icons.cube : Icons.split}
            <span>{t(`view.${v}`)}</span>
            <span className="tip below">
              {v === "2d" ? "2D canvas" : v === "3d" ? "3D view" : "2D and 3D side by side"} <span className="kbd">{v === "2d" ? "2" : v === "3d" ? "3" : "4"}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="panel topbar-right">
        <BriefButton />
        <NotesPill />
        <AgentPill />
        <div className="vsep" />
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
          {Icons.undo}
          <span className="tip below">
            Undo <span className="kbd">⌘Z</span>
          </span>
        </button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo">
          {Icons.redo}
          <span className="tip below">
            Redo <span className="kbd">⇧⌘Z</span>
          </span>
        </button>
        <CopyMenu />
        <CommandPaletteButton />
        <button className="icon-btn" onClick={() => useStore.setState({ helpOpen: true })} aria-label="Help">
          {Icons.help}
          <span className="tip below">
            Shortcuts & AI setup <span className="kbd">?</span>
          </span>
        </button>
        <button className="btn mockups-btn" onClick={() => openFonts("heading")} aria-label="Brand fonts">
          <span aria-hidden style={{ fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1 }}>Aa</span>
          <span className="btn-label">Fonts</span>
          <span className="tip below">Brand fonts · pair a heading with a body font</span>
        </button>
        <button className="btn mockups-btn" onClick={openMockups} aria-label="Mockups">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
            <rect x="1.8" y="3.2" width="9" height="6.6" rx="1.2" transform="rotate(-8 6.3 6.5)" />
            <rect x="5.2" y="6.2" width="9" height="6.6" rx="1.2" fill="var(--paper-lift)" />
          </svg>
          <span className="btn-label">Mockups</span>
          <span className="tip below">The logo on cards, an app icon, a sign, merch</span>
        </button>
        <button className="icon-btn stage-btn" onClick={openStage} aria-label="Stage view">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5.2V3.4C2 2.6 2.6 2 3.4 2h1.8M10.8 2h1.8c.8 0 1.4.6 1.4 1.4v1.8M14 10.8v1.8c0 .8-.6 1.4-1.4 1.4h-1.8M5.2 14H3.4C2.6 14 2 13.4 2 12.6v-1.8" />
            <circle cx="8" cy="8" r="2.1" />
          </svg>
          <span className="tip below">
            Stage · only the logo, for recording <span className="kbd">⇧S</span>
          </span>
        </button>
        <button className="btn mockups-btn" onClick={openPresentation} aria-label="Present">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.4" />
            <path d="M8 11v2.4M5.6 13.6h4.8M7 5.3v3l2.4-1.5z" />
          </svg>
          <span className="btn-label">Present</span>
          <span className="tip below">Present to a client — full screen, ←/→ to move</span>
        </button>
        <button className="btn primary export-btn" onClick={() => useStore.setState({ exportOpen: true })}>
          {Icons.export}
          {t("export")}
          <span className="tip below">
            SVG, PNG, icons, 3D, brand kit <span className="kbd">E</span>
          </span>
        </button>
      </div>
      <QuickModals />
    </div>
  );
}
