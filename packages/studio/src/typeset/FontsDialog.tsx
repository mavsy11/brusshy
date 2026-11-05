import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { describeTraits, fontTraits, suggestPairings, type DocT, type OpT, type PairingScore, type TypeRoleT, type TypeSystemT } from "@brusshy/core";
import { dispatch, toast, useStore } from "../lib/store";
import { topSelection } from "../lib/actions";
import { CATEGORIES, CATEGORY_LABEL, catalog, isCurated, search, type Category } from "./catalog";
import { familyAxes, familyMeta, previewFamily, type FamilyMeta, type FsAxis } from "./sources";
import { useTypeUI } from "./state";
import "./typeset.css";
import { SkelRows } from "../panels/Skeleton";

/**
 * Fonts: search every Fontsource family, see the brand name in every weight (waterfall), pick a
 * Heading and a Body font with offline pairing suggestions, and save them as the document's type
 * system (one undo step). "Apply to selection" sets the selected text's font.
 */

type Role = "heading" | "body";
const close = () => useTypeUI.setState({ fontsOpen: false });

function brandWord(doc: DocT): string {
  if (doc.typeSystem?.sample) return doc.typeSystem.sample;
  const subj = doc.brief?.subject?.split(/[—–\-:,.]/)[0]?.trim();
  if (subj && subj.length <= 24) return subj;
  return doc.name && !/^untitled/i.test(doc.name) ? doc.name : "Brandname";
}

/** CSS font of a preview face; re-renders when it has loaded. */
function usePreview(family: string | null, weight: number, variable: boolean, italic = false): { style: CSSProperties; ready: boolean } {
  const [ready, setReady] = useState(false);
  const key = family ? `${family}|${variable ? "v" : weight}|${italic}` : "";
  const f = useMemo(() => (family ? previewFamily(family, weight, { variable, italic }) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setReady(false);
    let alive = true;
    void f?.ready.then((ok) => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, [f]);
  return { style: f ? { fontFamily: `"${f.name}", var(--font)`, fontWeight: weight, fontStyle: italic ? "italic" : "normal" } : {}, ready };
}

function useMeta(family: string | null) {
  const [m, set] = useState<{ f: string; meta: FamilyMeta | null; axes: Record<string, FsAxis> }>({ f: "", meta: null, axes: {} });
  useEffect(() => {
    if (!family) return;
    let alive = true;
    void Promise.all([familyMeta(family), familyAxes(family)]).then(([meta, axes]) => alive && set({ f: family, meta, axes }));
    return () => {
      alive = false;
    };
  }, [family]);
  return m.f === family ? m : { f: "", meta: null, axes: {} as Record<string, FsAxis> };
}

const nearest = (ws: number[], w: number) => ws.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), ws[0] ?? 400);

export function FontsDialog() {
  const open = useTypeUI((s) => s.fontsOpen);
  const doc = useStore((s) => s.doc);
  if (!open || !doc) return null;
  return <Dialog doc={doc} />;
}

function Dialog({ doc }: { doc: DocT }) {
  const target = useTypeUI((s) => s.fontsTarget);
  const selection = useStore((s) => s.selection);
  const texts = topSelection(doc, selection).filter((id) => doc.nodes[id]?.type === "text");
  const firstText = texts[0] ? doc.nodes[texts[0]] : null;
  const ts = doc.typeSystem;
  const [draft, setDraft] = useState<{ heading: TypeRoleT | null; body: TypeRoleT | null }>(() => ({
    heading: ts?.heading ?? (firstText?.type === "text" ? { family: firstText.fontFamily, weight: firstText.fontWeight } : null),
    body: ts?.body ?? null,
  }));
  const [role, setRole] = useState<Role>(target === "body" ? "body" : "heading");
  const [word, setWord] = useState(() => brandWord(doc));
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | "all" | "curated">("curated");
  const [browse, setBrowse] = useState<string | null>(() => (target === "body" ? draft.body?.family : draft.heading?.family) ?? "Fraunces");
  const [all, setAll] = useState<FamilyMeta[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Escape closes even when focus left the dialog (e.g. after a button became disabled).
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    let alive = true;
    void catalog().then((c) => alive && setAll(c));
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      alive = false;
    };
  }, []);

  const results = useMemo(() => (all ? search(all, query, query && cat === "curated" ? "all" : cat) : []), [all, query, cat]);
  const current = role === "heading" ? draft.heading : draft.body;
  const { meta, axes } = useMeta(browse);

  const assign = (family: string, weight?: number, category?: string) => {
    const prevW = (role === "heading" ? draft.heading : draft.body)?.weight ?? (role === "heading" ? 600 : 400);
    const r: TypeRoleT = { family, weight: weight ?? prevW, ...(category ? { category } : {}) };
    setDraft((d) => ({ ...d, [role]: r }));
  };
  const pick = (f: FamilyMeta) => {
    setBrowse(f.family);
    const want = (role === "heading" ? draft.heading?.weight : draft.body?.weight) ?? (role === "heading" ? 600 : 400);
    const lo = Math.min(...f.weights), hi = Math.max(...f.weights);
    assign(f.family, f.variable ? Math.min(hi, Math.max(lo, want)) : nearest(f.weights, want), f.category);
  };

  const changed = JSON.stringify({ h: draft.heading, b: draft.body, s: word }) !== JSON.stringify({ h: ts?.heading ?? null, b: ts?.body ?? null, s: ts?.sample ?? brandWord(doc) });
  const pairing = draft.heading && draft.body ? suggestPairings(draft.heading.family, { candidates: [fontTraits(draft.body.family, { category: draft.body.category })], traits: { category: draft.heading.category }, limit: 1 })[0] : null;

  const save = () => {
    if (!draft.heading) return;
    const note = pairing ? [...pairing.reasons.slice(0, 2), ...pairing.warnings.slice(0, 1)].join("; ") : "";
    const sys: Partial<TypeSystemT> & Record<string, unknown> = { heading: draft.heading, sample: word.trim(), note };
    if (draft.body) sys.body = draft.body;
    // The dialog edits the whole system: replace it (one undo step restores the previous one).
    const ops: OpT[] = [{ op: "doc", set: { typeSystem: sys }, replace: true }];
    if (dispatch(ops, `Type system: ${draft.heading.family}${draft.body ? ` + ${draft.body.family}` : ""}`)) toast("Type system saved — your AI reads it, and Brand fonts applies it in one click");
  };
  const applyToSelection = () => {
    const r = current;
    if (!r || !texts.length) return;
    const ops: OpT[] = texts.map((id) => ({ op: "update", id, set: { fontFamily: r.family, fontWeight: Math.min(900, Math.max(100, Math.round(r.weight / 100) * 100)), axes: r.weight % 100 ? { wght: r.weight } : null } }) as OpT);
    dispatch(ops, `Font: ${r.family}`);
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="modal tl-fonts"
        role="dialog"
        aria-label="Fonts"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") close();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
        }}
      >
        <div className="modal-head tl-fonts-head">
          <div>
            <div className="label">Type system · {doc.name}</div>
            <h2>Choose your brand fonts</h2>
          </div>
          <label className="tl-word" title="The word every preview shows — usually the brand name">
            <span>Preview</span>
            <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Brand name" maxLength={40} />
          </label>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <div className="tl-fonts-body">
          <aside className="tl-browser">
            <input ref={searchRef} className="text-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={all ? `Search ${all.length.toLocaleString()} families` : "Loading fonts…"} aria-label="Search fonts" />
            <div className="tl-cats">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`tl-chip${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
            {all ? <FamilyList fonts={results} word={word} browse={browse} onPick={pick} /> : <SkelRows rows={9} />}
          </aside>

          <section className="tl-main">
            <div className="tl-slots">
              {(["heading", "body"] as const).map((r) => {
                const v = draft[r];
                return (
                  <button
                    key={r}
                    className={`tl-slot${role === r ? " on" : ""}`}
                    onClick={() => {
                      setRole(r);
                      if (v) setBrowse(v.family);
                    }}
                  >
                    <span className="tl-slot-k">{r === "heading" ? "Heading · wordmark" : "Body · text"}</span>
                    <SlotPreview role={v} word={r === "heading" ? word : "Aa Bb Cc 123"} />
                    <span className="tl-slot-v">{v ? `${v.family} · ${v.weight}` : "Pick a font"}</span>
                    {v && r === "body" && (
                      <span
                        className="tl-slot-x"
                        role="button"
                        aria-label="Remove body font"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraft((d) => ({ ...d, body: null }));
                        }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {browse && (
              <Waterfall
                family={browse}
                meta={meta}
                axes={axes}
                word={role === "heading" ? word : "The quick brown fox jumps"}
                weight={current?.family === browse ? current.weight : null}
                onWeight={(w) => assign(browse, w, meta?.category)}
                role={role}
              />
            )}

            {(draft.heading || draft.body) && (
              <Suggestions
                draft={draft}
                word={word}
                onPick={(r, family, category) => {
                  setRole(r);
                  setBrowse(family);
                  setDraft((d) => ({ ...d, [r]: { family, weight: r === "heading" ? (d.heading?.weight ?? 600) : 400, category } }));
                }}
              />
            )}

            {draft.heading && <Specimen heading={draft.heading} body={draft.body} word={word} pairing={pairing} />}
          </section>
        </div>

        <div className="tl-fonts-foot">
          <span className="muted">
            {pairing ? (
              <>
                Pairing score <b>{pairing.score}</b> — {pairing.reasons[0] ?? pairing.warnings[0] ?? ""}
              </>
            ) : (
              "Pick a heading font, then a body font. ⌘↩ saves."
            )}
          </span>
          <div className="tl-actions">
            <button className="btn ghost" onClick={applyToSelection} disabled={!texts.length || !current} title={texts.length ? `Set the selected text to ${current?.family ?? "this font"}` : "Select a text layer first"}>
              Apply {role} to selection
            </button>
            <button className="btn primary" onClick={save} disabled={!draft.heading || !changed}>
              Save type system
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotPreview({ role, word }: { role: TypeRoleT | null; word: string }) {
  const w = role?.weight ?? 400;
  const { style, ready } = usePreview(role?.family ?? null, w, w % 100 !== 0);
  if (!role) return <span className="tl-slot-p empty">—</span>;
  return (
    <span className={`tl-slot-p${ready ? "" : " loading"}`} style={style}>
      {word || "Aa"}
    </span>
  );
}

function FamilyRow({ f, word, on, onPick }: { f: FamilyMeta; word: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const w = f.weights.includes(400) ? 400 : nearest(f.weights, 400);
  const { style, ready } = usePreview(seen ? f.family : null, w, false);
  return (
    <button ref={ref} className={`tl-fam${on ? " on" : ""}`} onClick={onPick} title={`${f.family} — ${CATEGORY_LABEL[f.category] ?? f.category}, ${f.variable ? "variable" : `${f.weights.length} weights`}, ${f.license}`}>
      <span className={`tl-fam-p${ready ? "" : " loading"}`} style={style}>
        {word || f.family}
      </span>
      <span className="tl-fam-meta">
        <span>{f.family}</span>
        <span className="dim">
          {CATEGORY_LABEL[f.category]}
          {f.variable ? " · VF" : ` · ${f.weights.length}w`}
          {isCurated(f.family) ? " · ★" : ""}
        </span>
      </span>
    </button>
  );
}

function FamilyList({ fonts, word, browse, onPick }: { fonts: FamilyMeta[]; word: string; browse: string | null; onPick: (f: FamilyMeta) => void }) {
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [fonts]);
  return (
    <div
      className="tl-fams scroll-y"
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && limit < fonts.length) setLimit((l) => l + 60);
      }}
    >
      {fonts.slice(0, limit).map((f) => (
        <FamilyRow key={f.id} f={f} word={word} on={browse === f.family} onPick={() => onPick(f)} />
      ))}
      {!fonts.length && <p className="muted tl-pad">No family matches.</p>}
    </div>
  );
}

function Waterfall({ family, meta, axes, word, weight, onWeight, role }: { family: string; meta: FamilyMeta | null; axes: Record<string, FsAxis>; word: string; weight: number | null; onWeight: (w: number) => void; role: Role }) {
  const wght = axes.wght;
  const variable = !!meta?.variable && !!wght;
  const weights = variable ? [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= wght!.min && w <= wght!.max) : (meta?.weights ?? []);
  const [free, setFree] = useState<number | null>(null);
  const t = fontTraits(family, { category: meta?.category });
  const otherAxes = Object.keys(axes).filter((a) => a !== "wght" && a !== "ital");
  return (
    <div className="tl-water">
      <div className="tl-water-head">
        <div>
          <b>{family}</b>
          <span className="dim"> · {describeTraits(t)}</span>
        </div>
        <span className="dim">{!meta ? "Loading…" : variable ? `Variable ${wght!.min}–${wght!.max}${otherAxes.length ? ` · ${otherAxes.join(", ")}` : ""}` : `${weights.length} weight${weights.length === 1 ? "" : "s"}`}</span>
      </div>
      <div className="tl-water-rows">
        {weights.length ? (
          weights.map((w) => <WaterRow key={w} family={family} w={w} variable={variable} word={word} on={weight === w} onPick={() => onWeight(w)} role={role} />)
        ) : !meta ? (
          <SkelRows rows={5} big={30} />
        ) : null}
      </div>
      {variable && (
        <div className="deform-row tl-free" title="Any weight in between (variable font)">
          <span className="label">Weight</span>
          <input type="range" min={wght!.min} max={wght!.max} step={1} value={free ?? weight ?? 400} onChange={(e) => setFree(Number(e.target.value))} onPointerUp={() => free !== null && onWeight(free)} onKeyUp={() => free !== null && onWeight(free)} />
          <span className="num">{free ?? weight ?? 400}</span>
        </div>
      )}
      {variable && free !== null && <WaterRow family={family} w={free} variable word={word} on={weight === free} onPick={() => onWeight(free)} role={role} />}
    </div>
  );
}

function WaterRow({ family, w, variable, word, on, onPick, role }: { family: string; w: number; variable: boolean; word: string; on: boolean; onPick: () => void; role: Role }) {
  const { style, ready } = usePreview(family, w, variable);
  return (
    <button className={`tl-wrow${on ? " on" : ""}`} onClick={onPick} title={`Use ${family} ${w} as the ${role} font`}>
      <span className="tl-wrow-w">{w}</span>
      <span className={`tl-wrow-p${ready ? "" : " loading"}`} style={style}>
        {word || family}
      </span>
    </button>
  );
}

/** Body fonts for the heading (or, with only a body picked, headings for it). */
function Suggestions({ draft, word, onPick }: { draft: { heading: TypeRoleT | null; body: TypeRoleT | null }; word: string; onPick: (role: Role, family: string, category: string) => void }) {
  const forBody = !!draft.heading;
  const anchor = forBody ? draft.heading! : draft.body!;
  const list: PairingScore[] = suggestPairings(anchor.family, { role: forBody ? "heading" : "body", traits: { category: anchor.category }, limit: 6 });
  return (
    <div className="tl-sugs">
      <div className="tl-mini-label">{forBody ? `Body fonts for ${anchor.family}` : `Headings for ${anchor.family}`}</div>
      <div className="tl-sug-grid">
        {list.map((p) => {
          const fam = forBody ? p.body : p.heading;
          const t = fontTraits(fam);
          return <SuggestionCard key={fam} p={p} fam={fam} category={t.category} forBody={forBody} word={word} on={(forBody ? draft.body?.family : draft.heading?.family) === fam} onPick={() => onPick(forBody ? "body" : "heading", fam, t.category)} />;
        })}
      </div>
    </div>
  );
}

function SuggestionCard({ p, fam, category, forBody, word, on, onPick }: { p: PairingScore; fam: string; category: string; forBody: boolean; word: string; on: boolean; onPick: () => void }) {
  const { style, ready } = usePreview(fam, forBody ? 400 : 600, false);
  return (
    <button className={`tl-sug${on ? " on" : ""}`} onClick={onPick} title={[...p.reasons, ...p.warnings.map((w) => `⚠ ${w}`)].join("\n")}>
      <span className={`tl-sug-p${ready ? "" : " loading"}`} style={style}>
        {forBody ? "Clear, calm text that reads well." : word || fam}
      </span>
      <span className="tl-sug-meta">
        <b>{fam}</b>
        <span className="tl-score">{p.score}</span>
      </span>
      <span className="tl-sug-why">{p.reasons.length ? p.reasons.slice(0, 2).join(" · ") : (p.warnings[0] ?? CATEGORY_LABEL[category])}</span>
    </button>
  );
}

function Specimen({ heading, body, word, pairing }: { heading: TypeRoleT; body: TypeRoleT | null; word: string; pairing: PairingScore | null }) {
  const h = usePreview(heading.family, heading.weight, false);
  const b = usePreview(body?.family ?? null, body?.weight ?? 400, false);
  return (
    <div className="tl-spec">
      <div className="tl-mini-label">Together</div>
      <div className={`tl-spec-h${h.ready ? "" : " loading"}`} style={h.style}>
        {word || "Brandname"}
      </div>
      {body ? (
        <p className={`tl-spec-b${b.ready ? "" : " loading"}`} style={b.style}>
          A short line about what {word || "the brand"} does, set in the body font. Good pairings feel like one voice in two registers — the wordmark carries the character, the text stays calm and easy to read at small sizes.
        </p>
      ) : (
        <p className="muted">Add a body font to see them together.</p>
      )}
      {pairing && pairing.warnings.length > 0 && <p className="muted tl-warn">⚠ {pairing.warnings[0]}</p>}
    </div>
  );
}
