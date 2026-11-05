import { useEffect, useRef, useState } from "react";
import { EMPTY_TAGS, tagCount, type BriefT, type BriefTagsT } from "@brusshy/core";
import { dispatch, toast, useStore } from "../lib/store";
import { useQuick, usePalette } from "../lib/quick";
import { QIcons } from "./quickIcons";
import "../styles/quickwins.css";
import { BriefTagsEditor } from "../explore/BriefTags";

type Key = Exclude<keyof BriefT, "tags">;
const tagsKey = (t?: BriefTagsT) => JSON.stringify(t ?? EMPTY_TAGS);

const FIELDS: { key: Key; label: string; hint: string; placeholder: string; multiline?: boolean; wide?: boolean }[] = [
  { key: "subject", label: "What it is", hint: "Name and what the brand does", placeholder: "Northwind — a small-batch coffee roaster in Portland" },
  { key: "use", label: "Where it's used", hint: "Sizes and surfaces it must work on", placeholder: "Bag labels, storefront sign, Instagram avatar, favicon" },
  { key: "style", label: "Style", hint: "Mood, era, references in words", placeholder: "Warm and hand-made, a little vintage. Confident, never cute.", multiline: true, wide: true },
  { key: "palette", label: "Palette", hint: "Colors to use (or avoid)", placeholder: "Roast brown #3B2416 and cream #F3E9DC — two colors max" },
  { key: "typography", label: "Typography", hint: "Wordmark feel, case, weight", placeholder: "Rounded serif, all caps, generous tracking" },
  { key: "keep", label: "Must keep", hint: "Non-negotiables", placeholder: "The mountain silhouette from my sketch; name on one line", multiline: true },
  { key: "avoid", label: "Avoid", hint: "Clichés and no-go's", placeholder: "Coffee beans, cups, steam — every roaster uses them", multiline: true },
  { key: "notes", label: "Anything else", hint: "Context your AI should know", placeholder: "Should sit well next to the shop's neon sign. Launching in spring.", multiline: true, wide: true },
];

const EMPTY: BriefT = { subject: "", use: "", style: "", palette: "", typography: "", keep: "", avoid: "", notes: "" };

/** How many brief fields are filled in. */
export function useBriefCount(): number {
  return useStore((s) => (s.doc?.brief ? Object.values(s.doc.brief).filter((v) => (typeof v === "string" ? !!v.trim() : tagCount(v as BriefTagsT) > 0)).length : 0));
}

/** Structured brief editor: your AI reads it first (get_document) and follows it. */
export function BriefModal() {
  const open = useQuick((s) => s.briefOpen);
  const brief = useStore((s) => s.doc?.brief);
  const docName = useStore((s) => s.doc?.name ?? "");
  const palette = usePalette();
  const [draft, setDraft] = useState<BriefT>(EMPTY);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY, ...(brief ?? {}) });
      requestAnimationFrame(() => first.current?.focus());
    }
    // Only when opening: later remote changes shouldn't clobber what you're typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const base = { ...EMPTY, ...(brief ?? {}) };
  const changed = (Object.keys(EMPTY) as Key[]).filter((k) => draft[k].trim() !== base[k].trim());
  const tagsChanged = tagsKey(draft.tags) !== tagsKey(base.tags);
  const dirty = changed.length > 0 || tagsChanged;
  const close = () => useQuick.setState({ briefOpen: false });
  const save = () => {
    if (dirty) {
      const set: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, draft[k].trim()]));
      if (tagsChanged) set.tags = draft.tags ?? EMPTY_TAGS;
      if (!dispatch([{ op: "doc", set: { brief: set } }], "Edit brief")) return;
      toast("Brief saved — your AI reads it before designing");
    }
    close();
  };
  const addPaletteColors = () => {
    const hexes = palette.slice(0, 5).map((p) => p.color);
    if (!hexes.length) return;
    setDraft((d) => ({ ...d, palette: d.palette.trim() ? `${d.palette.trim()} · ${hexes.join(", ")}` : hexes.join(", ") }));
  };
  const filled = (Object.keys(EMPTY) as Key[]).filter((k) => draft[k].trim()).length;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && (dirty ? undefined : close())}>
      <div
        className="modal brief-modal"
        role="dialog"
        aria-label="Brief"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !dirty) close();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
        }}
      >
        <div className="modal-head">
          <div>
            <div className="label">Brief · {docName}</div>
            <h2>What should this logo be?</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted brief-intro">Your AI reads this before it draws and follows it on every change. Fill what you know — empty fields are skipped.</p>
        <div className="brief-form">
          {FIELDS.map((f, i) => (
            <label key={f.key} className={`brief-field${f.wide ? " wide" : ""}`}>
              <span className="brief-label">
                <span>{f.label}</span>
                <span className="dim">{f.hint}</span>
              </span>
              {f.multiline ? (
                <textarea rows={2} value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              ) : (
                <input ref={i === 0 ? first : undefined} value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
              {f.key === "palette" && palette.length > 0 && (
                <button type="button" className="brief-chip" onClick={addPaletteColors} title="Add the colors used in the active version">
                  <span className="brief-dots">
                    {palette.slice(0, 5).map((p) => (
                      <i key={p.color} style={{ background: p.color }} />
                    ))}
                  </span>
                  Use version colors
                </button>
              )}
            </label>
          ))}
          <BriefTagsEditor value={draft.tags ?? EMPTY_TAGS} onChange={(f) => setDraft((d) => ({ ...d, tags: f(d.tags ?? EMPTY_TAGS) }))} />
        </div>
        <div className="brief-foot">
          <span className="muted">
            {filled}/8 filled · <span className="kbd">⌘↩</span> to save
          </span>
          <div className="brief-actions">
            <button className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={!dirty}>
              {QIcons.check} Save brief
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
