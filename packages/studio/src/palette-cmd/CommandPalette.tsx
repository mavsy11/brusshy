import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../lib/store";
import { scoreCommand } from "./fuzzy";
import { allCommands, closeCommandPalette, hintOf, openCommandPalette, recentIds, runCommand, useCommandPalette, useRegistry, type Command } from "./registry";
import { askAi, contextLine } from "./commands";
import { CmdIcons } from "./icons";
import "./palette-cmd.css";

/**
 * ⌘K — one search box for everything in the studio: tools, actions, refinements, panels,
 * versions, layers, documents and history, recent commands first, plus "Ask your AI".
 */

const GROUP_ORDER = ["Ask AI", "Recent", "Refine", "AI", "Tools", "Edit", "View", "Panels", "Versions", "Layers", "Documents", "History"];
/** Long dynamic groups stay short while searching. */
const GROUP_CAP: Record<string, number> = { Layers: 8, History: 6, Documents: 6 };

interface Row {
  key: string;
  cmd: Command;
  group: string;
  hits: number[];
  score: number;
  ask?: boolean;
}

function buildRows(query: string, chatBusy: boolean): Row[] {
  const q = query.trim();
  const cmds = allCommands(q);
  const recents = recentIds();
  const rows: Row[] = [];
  if (!q) {
    const byId = new Map(cmds.map((c) => [c.id, c]));
    for (const id of recents) {
      const c = byId.get(id);
      if (c) rows.push({ key: `recent:${id}`, cmd: c, group: "Recent", hits: [], score: 0 });
    }
    for (const c of cmds) rows.push({ key: c.id, cmd: c, group: c.group, hits: [], score: 0 });
  } else {
    for (const c of cmds) {
      const extra = [c.group, ...(c.keywords ?? []), hintOf(c) ?? ""].join(" · ");
      const m = scoreCommand(q, c.title, extra);
      if (!m) continue;
      const r = recents.indexOf(c.id);
      rows.push({ key: c.id, cmd: c, group: c.group, hits: m.hits, score: m.score + (r >= 0 ? (recents.length - r) * 2 : 0) });
    }
  }
  // Group, order groups (by best match while searching), cap long ones.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group)!.push(r);
  }
  const rank = (g: string) => {
    const i = GROUP_ORDER.indexOf(g);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  let names = [...groups.keys()];
  if (q) {
    for (const g of names) groups.get(g)!.sort((a, b) => b.score - a.score);
    names.sort((a, b) => groups.get(b)![0]!.score - groups.get(a)![0]!.score || rank(a) - rank(b));
  } else names.sort((a, b) => rank(a) - rank(b));
  names = names.filter((g) => groups.get(g)!.length);
  const out: Row[] = [];
  if (q) {
    const ask: Command = {
      id: "ai.ask",
      title: `Ask your AI: ${q}`,
      group: "Ask AI",
      icon: CmdIcons.ai,
      hint: chatBusy ? "your AI is busy" : "canvas chat",
      run: () => askAi(q),
    };
    out.push({ key: "ask", cmd: ask, group: "Ask AI", hits: [], score: 0, ask: true });
  }
  for (const g of names) out.push(...(q ? groups.get(g)!.slice(0, GROUP_CAP[g] ?? 12) : groups.get(g)!));
  return out;
}

function Highlight({ text, hits, offset = 0 }: { text: string; hits: number[]; offset?: number }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits.map((h) => h + offset));
  const parts: ReactNode[] = [];
  let buf = "";
  let on = false;
  const flush = (k: number) => {
    if (!buf) return;
    parts.push(on ? <mark key={k}>{buf}</mark> : <span key={k}>{buf}</span>);
    buf = "";
  };
  [...text].forEach((ch, i) => {
    const hit = set.has(i);
    if (hit !== on) {
      flush(i);
      on = hit;
    }
    buf += ch;
  });
  flush(text.length);
  return <>{parts}</>;
}

/** "⇧⌘C" → ⇧ ⌘ C as separate key caps. */
function Keys({ combo }: { combo: string }) {
  const caps: string[] = [];
  let i = 0;
  while (i < combo.length && "⌘⇧⌥⌃".includes(combo[i]!)) caps.push(combo[i++]!);
  if (i < combo.length) caps.push(combo.slice(i));
  return (
    <span className="cmdk-keys" aria-label={`Shortcut ${combo}`}>
      {caps.map((c, k) => (
        <kbd key={k}>{c}</kbd>
      ))}
    </span>
  );
}

export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  // ⌘K anywhere (also from inputs); a second ⌘K closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        if (useCommandPalette.getState().open) closeCommandPalette();
        else if (useStore.getState().doc) openCommandPalette();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  if (!open) return null;
  return createPortal(<PaletteBody />, document.body);
}

function PaletteBody() {
  const initial = useCommandPalette((s) => s.query);
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(document.activeElement);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  // Re-read commands when the document, selection or registry change while open.
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const chatBusy = useStore((s) => !!s.chat?.busy);
  const v = useRegistry((s) => s.v);
  const rows = useMemo(() => buildRows(query, chatBusy), [query, doc, selection, tool, v, chatBusy]);

  // Default row: the best command when it's a convincing match, otherwise "Ask your AI".
  useEffect(() => {
    if (!query.trim()) return setActive(0);
    const best = rows.findIndex((r) => !r.ask);
    setActive(best >= 0 && rows[best]!.score >= 14 ? best : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const back = restore.current;
    return () => {
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus();
    };
  }, []);

  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

  const run = (r: Row | undefined) => {
    if (!r) return;
    closeCommandPalette();
    // Let the palette unmount (and focus return) before the command acts.
    requestAnimationFrame(() => runCommand(r.cmd));
  };

  const groupStarts = useMemo(() => rows.map((r, i) => (i === 0 || rows[i - 1]!.group !== r.group ? i : -1)).filter((i) => i >= 0), [rows]);

  const onKey = (e: React.KeyboardEvent) => {
    const n = rows.length;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setActive((a) => (n ? (a + 1) % n : 0));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setActive((a) => (n ? (a - 1 + n) % n : 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (!groupStarts.length) return;
      const cur = groupStarts.filter((s) => s <= active).pop() ?? 0;
      const k = groupStarts.indexOf(cur);
      const next = groupStarts[(k + (e.shiftKey ? -1 : 1) + groupStarts.length) % groupStarts.length]!;
      setActive(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && query.trim()) run(rows.find((r) => r.ask));
      else run(rows[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery("");
      else closeCommandPalette();
    } else if (e.key === "Home" && e.metaKey) setActive(0);
    else if (e.key === "End" && e.metaKey) setActive(Math.max(0, n - 1));
    e.stopPropagation();
  };

  const ctx = contextLine();
  const activeRow = rows[active];
  return (
    <div className="cmdk-scrim" data-ui onPointerDown={(e) => e.target === e.currentTarget && closeCommandPalette()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="cmdk-search">
          <span className="cmdk-search-ico">{CmdIcons.search}</span>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools, actions, versions, layers… or ask your AI"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={activeRow ? `cmdk-row-${active}` : undefined}
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>
        <div className="cmdk-list scroll-y" id="cmdk-list" role="listbox" ref={list}>
          {rows.length === 0 && <div className="cmdk-empty">Nothing matches — type a request and press ↵ to ask your AI.</div>}
          {rows.map((r, i) => {
            const head = i === 0 || rows[i - 1]!.group !== r.group;
            const hint = hintOf(r.cmd);
            return (
              <div key={r.key} role="presentation">
                {head && (
                  <div className="cmdk-group" role="presentation">
                    {r.group}
                  </div>
                )}
                <div
                  id={`cmdk-row-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk-row${i === active ? " on" : ""}${r.ask ? " ask" : ""}`}
                  onMouseMove={(e) => {
                    // Only real pointer moves pick a row (not the list scrolling under a still pointer).
                    const m = mouse.current;
                    mouse.current = { x: e.clientX, y: e.clientY };
                    if (m && (m.x !== e.clientX || m.y !== e.clientY) && active !== i) setActive(i);
                  }}
                  onClick={() => run(r)}
                >
                  <span className="cmdk-ico">{r.cmd.icon ?? CmdIcons.search}</span>
                  <span className="cmdk-title">
                    {r.ask ? (
                      <>
                        <span className="cmdk-ask-label">Ask your AI:</span> {query.trim()}
                      </>
                    ) : (
                      <Highlight text={r.cmd.title} hits={r.hits} />
                    )}
                  </span>
                  {hint && <span className="cmdk-hint">{hint}</span>}
                  {r.ask ? <Keys combo="⌘↵" /> : r.cmd.shortcut && <Keys combo={r.cmd.shortcut} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span>
            <kbd>⇥</kbd> next group
          </span>
          <span>
            <kbd>⌘↵</kbd> ask AI
          </span>
          <span className="cmdk-ctx">{ctx}</span>
        </div>
      </div>
    </div>
  );
}

/** Small top-bar button that opens the palette (discoverability for ⌘K). */
export function CommandPaletteButton() {
  return (
    <button className="icon-btn cmdk-btn" onClick={() => openCommandPalette()} aria-label="Command palette">
      {CmdIcons.search}
      <span className="tip below">
        Search everything <span className="kbd">⌘K</span>
      </span>
    </button>
  );
}
