import { useEffect, useRef, useState } from "react";
import { INSPIRATION_SOURCES, TAG_GROUPS, tagCount, tagSearchQuery, type BriefTagsT, type TagGroupId } from "@brusshy/core";
import { XIcons } from "./icons";
import { openBoard } from "./state";
import "./explore.css";

/** Brief → optional taxonomy chips (mark type, style, shape, mood). Controlled: the Brief saves them. */
export function BriefTagsEditor({ value, onChange }: { value: BriefTagsT; onChange: (update: (t: BriefTagsT) => BriefTagsT) => void }) {
  const toggle = (g: TagGroupId, id: string) =>
    onChange((t) => ({ ...t, [g]: t[g].includes(id) ? t[g].filter((x) => x !== id) : [...t[g], id] }));
  const n = tagCount(value);
  return (
    <div className="bt">
      <div className="bt-head">
        <span className="brief-label">
          <span>Direction</span>
          <span className="dim">Optional — tap what fits; your AI reads these too</span>
        </span>
        <span className="grow" />
        {n > 0 && (
          <button type="button" className="xpl-link" onClick={() => onChange(() => ({ markType: [], style: [], shape: [], mood: [] }))}>
            Clear
          </button>
        )}
        <FindReferences tags={value} />
      </div>
      {TAG_GROUPS.map((g) => (
        <div key={g.id} className="bt-group">
          <span className="bt-label" title={g.hint}>
            {g.label}
          </span>
          <div className="bt-chips">
            {g.options.map(([id, label]) => {
              const on = value[g.id].includes(id);
              return (
                <button type="button" key={id} className={`bt-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(g.id, id)}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Outbound searches on public inspiration galleries, built from the chips (links only). */
function FindReferences({ tags }: { tags: BriefTagsT }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);
  const empty = tagCount(tags) === 0;
  const q = tagSearchQuery(tags);
  return (
    <div className="bt-find" ref={ref}>
      <button type="button" className="brief-chip" disabled={empty} onClick={() => setOpen(!open)} aria-expanded={open} title={empty ? "Pick a few chips first" : `Search inspiration for “${q}”`}>
        {XIcons.search} Find references
      </button>
      {open && (
        <div className="bt-menu panel" role="menu">
          <div className="bt-q">
            <span className="label">Search for</span>
            <span className="bt-qtext">{q}</span>
          </div>
          {INSPIRATION_SOURCES.map((s) => (
            <a key={s.id} role="menuitem" className="rq-item" href={s.url(q)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
              {XIcons.external}
              <span>{s.label}</span>
            </a>
          ))}
          <div className="rq-sep" />
          <button
            type="button"
            role="menuitem"
            className="rq-item"
            onClick={() => {
              setOpen(false);
              openBoard();
            }}
          >
            {XIcons.board}
            <span>Open the reference board</span>
            <span className="dim">drop what you find</span>
          </button>
          <p className="bt-note">Opens in your browser. Use what you find for direction — save images to the board, never copy a mark.</p>
        </div>
      )}
    </div>
  );
}
