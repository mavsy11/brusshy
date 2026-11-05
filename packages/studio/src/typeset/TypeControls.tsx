import { useMemo, useState } from "react";
import { AXIS_NAMES, featureOn, toggleFeature, type DocT, type FontInfo, type KerningModeT, type NodeT, type TextNodeT } from "@brusshy/core";
import { dispatch, setLive, useStore } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import { NumField, Section } from "../panels/controls";
import { coordsFor, layoutText, outlineD, outlineOf, type TypesetSpec } from "./engine";
import { glyphAlternates } from "./gsub";
import { openFonts, useFamilyMeta, useFontInfo, useTypeUI } from "./state";
import { GlyphTile, WordStrip } from "./WordStrip";
import "./typeset.css";

/**
 * Type controls for a text node: variable axes, OpenType features, tracking + kerning mode, and the
 * Letters strip (glyph alternates and per-pair kerning). Every change is one undo step; sliders
 * preview live and commit on release.
 */

type Text = Extract<NodeT, { type: "text" }>;
const upd = (id: string, set: Record<string, unknown>, label: string) => dispatch([{ op: "update", id, set }], label);
const clampWeight = (w: number) => Math.min(900, Math.max(100, Math.round(w / 100) * 100));
const fmt = (v: number) => String(Math.round(v * 100) / 100);

export function TypeControls({ doc, n }: { doc: DocT; n: Text }) {
  const italic = (n.axes?.ital ?? 0) >= 0.5;
  const { info, error } = useFontInfo(n.fontFamily, italic);
  return (
    <>
      <BrandFonts doc={doc} n={n} />
      {error ? (
        <Section title="Type controls">
          <p className="muted">{error}</p>
        </Section>
      ) : !info ? (
        <Section title="Type controls">
          <p className="muted tl-loading">Loading the full {n.fontFamily} font…</p>
        </Section>
      ) : (
        <>
          <AxesSection n={n} info={info} />
          <FeaturesSection n={n} info={info} />
          <SpacingSection n={n} />
          <LettersSection n={n} />
        </>
      )}
    </>
  );
}

/* ---------- brand fonts (type system) ---------- */

function BrandFonts({ doc, n }: { doc: DocT; n: Text }) {
  const ts = doc.typeSystem;
  const apply = (role: "heading" | "body") => {
    const r = role === "heading" ? ts?.heading : ts?.body;
    if (!r) return;
    const set: Record<string, unknown> = { fontFamily: r.family, fontWeight: clampWeight(r.weight) };
    if (r.axes && Object.keys(r.axes).length) set.axes = { ...r.axes, ...(r.weight !== clampWeight(r.weight) ? { wght: r.weight } : {}) };
    else set.axes = null;
    set.features = r.features?.length ? r.features : null;
    if (r.tracking !== undefined) set.letterSpacing = (r.tracking / 1000) * n.fontSize;
    upd(n.id, set, `${role === "heading" ? "Heading" : "Body"} font: ${r.family}`);
  };
  return (
    <Section
      title="Brand fonts"
      right={
        <button className="btn small ghost" onClick={() => openFonts("selection")} title="Search every font, preview your brand name in every weight, and pair a heading with a body font">
          Browse fonts…
        </button>
      }
    >
      {ts ? (
        <div className="tl-roles">
          <button className={`tl-role${n.fontFamily === ts.heading.family ? " on" : ""}`} onClick={() => apply("heading")} title="Apply the heading font to this text (one undo step)">
            <span className="tl-role-k">Heading</span>
            <span className="tl-role-v">{ts.heading.family}</span>
          </button>
          {ts.body && (
            <button className={`tl-role${n.fontFamily === ts.body.family ? " on" : ""}`} onClick={() => apply("body")} title="Apply the body font to this text">
              <span className="tl-role-k">Body</span>
              <span className="tl-role-v">{ts.body.family}</span>
            </button>
          )}
        </div>
      ) : (
        <p className="muted">
          No type system yet. <button className="tl-link" onClick={() => openFonts("heading")}>Choose heading + body fonts</button> and apply them in one click.
        </p>
      )}
    </Section>
  );
}

/* ---------- variable axes ---------- */

const AXIS_SHORT: Record<string, string> = { opsz: "Optical", SOFT: "Soft", XTRA: "Counters", XOPQ: "Thick", YOPQ: "Thin", YTUC: "Caps", YTLC: "x-height", YTAS: "Ascend.", YTDE: "Descend.", YTFI: "Figures" };

function axisStep(tag: string, min: number, max: number) {
  if (tag === "wght") return 1;
  if (tag === "ital" || max - min <= 1) return 0.01;
  if (max - min <= 20) return 0.1;
  return 0.5;
}

function AxesSection({ n, info }: { n: Text; info: FontInfo }) {
  const meta = useFamilyMeta(n.fontFamily);
  const [drag, setDrag] = useState<Record<string, number> | null>(null);
  const values = useMemo(() => {
    const out: Record<string, number> = {};
    // Shown as rendered: the engine clamps values to the font's axis range.
    for (const a of info.axes) out[a.tag] = Math.min(a.max, Math.max(a.min, a.tag === "wght" ? (n.axes?.wght ?? n.fontWeight) : (n.axes?.[a.tag] ?? a.default)));
    return out;
  }, [info.axes, n.axes, n.fontWeight]);
  const shown = { ...values, ...(drag ?? {}) };
  const italic = (n.axes?.ital ?? 0) >= 0.5;

  const preview = (tag: string, v: number) => {
    const next = { ...(drag ?? {}), [tag]: v };
    setDrag(next);
    setLive(n.id, { axes: { ...(n.axes ?? {}), ...next }, ...(tag === "wght" ? { fontWeight: clampWeight(v) } : {}) } as Partial<NodeT>);
  };
  const commit = () => {
    if (!drag) return;
    const set: Record<string, unknown> = { axes: drag };
    if (drag.wght !== undefined) set.fontWeight = clampWeight(drag.wght);
    const label = Object.entries(drag)
      .map(([t, v]) => `${AXIS_NAMES[t] ?? info.axes.find((a) => a.tag === t)?.name ?? t} ${fmt(v)}`)
      .join(", ");
    setDrag(null);
    setLive(n.id, null);
    upd(n.id, set, label);
  };
  const setAxes = (axes: Record<string, number> | null, label: string) => upd(n.id, { axes, ...(axes?.wght !== undefined ? { fontWeight: clampWeight(axes.wght) } : {}) }, label);
  const instance = info.instances.find((i) => Object.entries(i.coords).every(([t, v]) => Math.abs((shown[t] ?? v) - v) < 0.01));
  const hasCustom = n.axes && Object.keys(n.axes).some((k) => k !== "ital");

  if (!info.axes.length) {
    const weights = meta?.weights ?? [];
    return (
      <Section title="Weight & style" right={<span className="tl-badge" title="This family ships separate files per weight">Static</span>}>
        <div className="tl-chips">
          {weights.map((w) => (
            <button key={w} className={`tl-chip${n.fontWeight === w ? " on" : ""}`} onClick={() => upd(n.id, { fontWeight: w }, `Weight ${w}`)}>
              {w}
            </button>
          ))}
        </div>
        {(meta?.styles.includes("italic") || italic) && <ItalicToggle n={n} italic={italic} />}
      </Section>
    );
  }
  return (
    <Section
      title="Variable axes"
      right={
        hasCustom ? (
          <button className="btn small ghost" onClick={() => setAxes(null, "Reset axes")} title="Back to the font's defaults (keeps the weight)">
            Reset
          </button>
        ) : (
          <span className="tl-badge" title={info.source === "google-full" ? "Full variable font (all features)" : "Variable subset"}>
            Variable
          </span>
        )
      }
    >
      {info.instances.length > 1 && (
        <select
          className="select"
          value={instance?.name ?? ""}
          onChange={(e) => {
            const inst = info.instances.find((i) => i.name === e.target.value);
            if (inst) setAxes({ ...(n.axes?.ital ? { ital: n.axes.ital } : {}), ...inst.coords }, `Instance: ${inst.name}`);
          }}
          title="Named instances the designer defined"
        >
          <option value="">{instance ? instance.name : "Custom instance"}</option>
          {info.instances.map((i) => (
            <option key={i.name} value={i.name}>
              {i.name}
            </option>
          ))}
        </select>
      )}
      {info.axes.map((a) => (
        <div className="deform-row tl-axis" key={a.tag} title={`${a.name} (${a.tag}) · ${fmt(a.min)}–${fmt(a.max)}, default ${fmt(a.default)}`}>
          <span className="label">{AXIS_SHORT[a.tag] ?? AXIS_NAMES[a.tag] ?? a.name}</span>
          <input
            type="range"
            min={a.min}
            max={a.max}
            step={axisStep(a.tag, a.min, a.max)}
            value={shown[a.tag] ?? a.default}
            onChange={(e) => preview(a.tag, Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onDoubleClick={() => setAxes({ ...(n.axes ?? {}), [a.tag]: a.tag === "wght" ? 400 : a.default }, `${a.name} default`)}
          />
          <span className="num">{fmt(shown[a.tag] ?? a.default)}</span>
        </div>
      ))}
      <div className="tl-axis-foot">
        {info.axes.some((a) => a.tag === "opsz") && (
          <button
            className="tl-link"
            onClick={() => {
              const a = info.axes.find((x) => x.tag === "opsz")!;
              setAxes({ ...(n.axes ?? {}), opsz: Math.min(a.max, Math.max(a.min, Math.round(n.fontSize))) }, "Optical size: match size");
            }}
            title="Set the optical size to the text size — display cuts get tighter spacing and finer details"
          >
            Optical size = text size
          </button>
        )}
        {(meta?.styles.includes("italic") || italic) && <ItalicToggle n={n} italic={italic} />}
      </div>
    </Section>
  );
}

function ItalicToggle({ n, italic }: { n: Text; italic: boolean }) {
  return (
    <label className="check mini">
      <input
        type="checkbox"
        checked={italic}
        onChange={(e) => {
          const rest = { ...(n.axes ?? {}) };
          delete rest.ital;
          const axes = e.target.checked ? { ...rest, ital: 1 } : rest;
          upd(n.id, { axes: Object.keys(axes).length ? axes : null }, e.target.checked ? "Italic" : "Upright");
        }}
      />
      Italic
    </label>
  );
}

/* ---------- OpenType features ---------- */

const GROUPS: { title: string; test: RegExp }[] = [
  { title: "Ligatures & alternates", test: /^(liga|dlig|hlig|calt|salt|swsh|cswh|titl|hist)$/ },
  { title: "Caps & figures", test: /^(smcp|c2sc|pcap|case|onum|lnum|tnum|zero)$/ },
  { title: "Stylistic sets", test: /^ss\d\d$/ },
  { title: "Character variants", test: /^cv\d\d$/ },
];

const SHORT: Record<string, string> = {
  liga: "Ligatures",
  dlig: "Discretionary lig.",
  hlig: "Historical lig.",
  calt: "Contextual",
  salt: "Stylistic alt.",
  swsh: "Swashes",
  cswh: "Context swashes",
  titl: "Titling",
  hist: "Historical",
  smcp: "Small caps",
  c2sc: "Caps → small caps",
  pcap: "Petite caps",
  case: "Case forms",
  onum: "Oldstyle 123",
  lnum: "Lining 123",
  tnum: "Tabular 123",
  zero: "Slashed 0",
};

function FeaturesSection({ n, info }: { n: Text; info: FontInfo }) {
  if (!info.features.length)
    return (
      <Section title="OpenType">
        <p className="muted">{info.source === "google-full" ? "This font has no stylistic features." : "Only basic features are available for this font (subset file)."}</p>
      </Section>
    );
  const on = (tag: string) => featureOn(n.features ?? undefined, tag);
  const toggle = (tag: string, name: string) => {
    const next = toggleFeature(n.features ?? undefined, tag, !on(tag));
    upd(n.id, { features: next.length ? next : null }, `${on(tag) ? "Off" : "On"}: ${name}`);
  };
  const count = (n.features ?? []).length;
  return (
    <Section
      title="OpenType"
      right={
        count ? (
          <button className="btn small ghost" onClick={() => upd(n.id, { features: null }, "Reset OpenType features")}>
            Reset
          </button>
        ) : undefined
      }
    >
      {GROUPS.map((g) => {
        const feats = info.features.filter((f) => g.test.test(f.tag));
        if (!feats.length) return null;
        return (
          <div className="tl-feat-group" key={g.title}>
            <div className="tl-mini-label">{g.title}</div>
            <div className="tl-chips">
              {feats.map((f) => {
                const generic = /^(Stylistic set|Character variant) \d+$/.test(f.name);
                const label = SHORT[f.tag] ?? (generic ? f.tag.toUpperCase() : f.name);
                return (
                  <button key={f.tag} className={`tl-chip${on(f.tag) ? " on" : ""}`} onClick={() => toggle(f.tag, f.name)} title={`${f.name} (${f.tag})`} aria-pressed={on(f.tag)}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

/* ---------- spacing ---------- */

function SpacingSection({ n }: { n: Text }) {
  const tracking = (n.letterSpacing / n.fontSize) * 1000;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? tracking;
  const mode: KerningModeT = n.kerning ?? "metric";
  const commit = () => {
    if (drag === null) return;
    setDrag(null);
    setLive(n.id, null);
    upd(n.id, { letterSpacing: Math.round((drag / 1000) * n.fontSize * 100) / 100 }, `Tracking ${Math.round(drag)}`);
  };
  const manualCount = (n.kerns ?? []).filter((k) => k).length;
  return (
    <Section title="Spacing">
      <div className="deform-row" title="Tracking: even spacing for the whole word, in 1/1000 em (scales with the size). Wordmarks in caps usually want +40…+120.">
        <span className="label">Tracking</span>
        <input
          type="range"
          min={-120}
          max={400}
          step={1}
          value={Math.round(shown)}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDrag(v);
            setLive(n.id, { letterSpacing: (v / 1000) * n.fontSize } as Partial<NodeT>);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        <span className="num">{Math.round(shown)}</span>
      </div>
      <div className="paint-row">
        <span className="label">Kerning</span>
        <div className="seg-group tl-seg">
          {(["metric", "optical", "manual"] as const).map((m) => (
            <button
              key={m}
              className={`seg${mode === m ? " on" : ""}`}
              onClick={() => upd(n.id, { kerning: m === "metric" ? null : m }, `Kerning: ${m}`)}
              title={m === "metric" ? "The font's own kerning pairs" : m === "optical" ? "Computed from the letter shapes — evens out the white space between any pair" : "No automatic kerning: only your pair adjustments (Letters below)"}
            >
              {m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {manualCount > 0 && (
        <p className="muted">
          {manualCount} pair adjustment{manualCount === 1 ? "" : "s"} ·{" "}
          <button className="tl-link" onClick={() => upd(n.id, { kerns: null }, "Clear pair kerning")}>
            clear
          </button>
        </p>
      )}
    </Section>
  );
}

/* ---------- letters: alternates + pair kerning ---------- */

export const specOf = (n: TextNodeT): TypesetSpec => ({ ...n, anchor: "start" });

function LettersSection({ n }: { n: Text }) {
  useFontVersion((s) => s.v);
  const live = useStore((s) => s.live[n.id]);
  const spec = specOf({ ...n, ...(live as object) } as TextNodeT);
  const layout = layoutText(spec);
  const picked = useTypeUI((s) => (s.letter?.id === n.id ? s.letter.index : null));
  const chars = Array.from(n.text);
  const drawn = layout ? layout.placed.filter((p) => p.outline.cmds.length > 0 && p.chars.length) : [];
  const glyphs = layout ? drawn.map((p, i) => ({ key: `${i}`, d: outlineD(p.outline, p.x, layout.scale), label: p.chars.map((c) => chars[c]).join("") })) : [];
  const sel = picked !== null && picked < drawn.length ? picked : null;
  const p = sel !== null ? drawn[sel]! : null;
  const charIdx = p ? p.chars[0]! : -1;
  const prevChar = charIdx - 1;
  const gapBefore = prevChar >= 0 ? n.kerns?.[prevChar] ?? 0 : null;

  const setGap = (value: number) => {
    if (prevChar < 0) return;
    const kerns = Array.from({ length: Math.max(chars.length - 1, (n.kerns ?? []).length) }, (_, i) => n.kerns?.[i] ?? 0);
    kerns[prevChar] = Math.round(value);
    while (kerns.length && !kerns[kerns.length - 1]) kerns.pop();
    upd(n.id, { kerns: kerns.length ? kerns : null }, `Kern ${chars[prevChar]}${chars[charIdx]} ${Math.round(value)}`);
  };

  const alts = layout && p ? glyphAlternates(layout.face, layout.face.font.charToGlyphIndex(chars[charIdx] ?? "")) : [];
  const current = n.alternates?.[String(charIdx)] ?? "";
  const tileD = (g: number) => (layout ? outlineD(outlineOf(layout.face, g, coordsFor(layout.face, spec)), 0, layout.scale) : "");

  return (
    <Section title="Letters">
      {!layout ? (
        <p className="muted tl-loading">Shaping…</p>
      ) : (
        <WordStrip glyphs={glyphs} selected={sel} onSelect={(i) => useTypeUI.setState({ letter: i === null ? null : { id: n.id, index: i } })} />
      )}
      {p && layout ? (
        <>
          <div className="tl-letter-head">
            <span className="tl-letter-name">“{p.chars.map((c) => chars[c]).join("")}”</span>
            {gapBefore !== null && (
              <div className="tl-nudge" title="Kerning before this letter, in 1/1000 em — ⌥← / ⌥→ (⇧ for ×5)">
                <button className="mini-btn" onClick={() => setGap((gapBefore ?? 0) - 10)} aria-label="Tighten">
                  ‹
                </button>
                <NumField label="Kern" value={gapBefore} step={1} precision={0} onCommit={setGap} />
                <button className="mini-btn" onClick={() => setGap((gapBefore ?? 0) + 10)} aria-label="Loosen">
                  ›
                </button>
              </div>
            )}
          </div>
          {alts.length > 0 ? (
            <div className="tl-tiles">
              <GlyphTile d={tileD(layout.face.font.charToGlyphIndex(chars[charIdx] ?? ""))} label="Default" on={!current} onClick={() => upd(n.id, { alternates: { [String(charIdx)]: "" } }, `${chars[charIdx]}: default glyph`)} />
              {alts.map((a) => (
                <GlyphTile key={a.key} d={tileD(a.g)} label={a.label} hint={a.key} on={current === a.key} onClick={() => upd(n.id, { alternates: { [String(charIdx)]: a.key } }, `${chars[charIdx]}: ${a.label}`)} />
              ))}
            </div>
          ) : (
            <p className="muted">No alternates for this letter in {n.fontFamily}.</p>
          )}
        </>
      ) : (
        <p className="muted">Pick a letter for its alternates and kerning. With a letter picked, ⌥←/→ kerns on the canvas too.</p>
      )}
    </Section>
  );
}

/* ---------- keyboard: ⌥ arrows on a picked letter ---------- */

let installed = false;
/** ⌥←/→ kern the picked letter of the selected text (capture phase, so plain arrows still nudge). */
export function installTextKeys(extra?: (e: KeyboardEvent) => boolean) {
  if (installed) return;
  installed = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || !e.key.startsWith("Arrow")) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (extra?.(e)) return;
      const s = useStore.getState();
      const doc = s.doc;
      const id = s.selection.length === 1 ? s.selection[0]! : null;
      const n = id ? doc?.nodes[id] : null;
      const pick = useTypeUI.getState().letter;
      if (!n || n.type !== "text" || pick?.id !== n.id || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const layout = layoutText(specOf(n));
      const drawn = layout ? layout.placed.filter((p) => p.outline.cmds.length > 0 && p.chars.length) : [];
      const ci = drawn[pick.index]?.chars[0];
      if (ci === undefined || ci < 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const chars = Array.from(n.text);
      const step = (e.shiftKey ? 50 : 10) * (e.key === "ArrowLeft" ? -1 : 1);
      const kerns = Array.from({ length: Math.max(chars.length - 1, (n.kerns ?? []).length) }, (_, i) => n.kerns?.[i] ?? 0);
      kerns[ci - 1] = (kerns[ci - 1] ?? 0) + step;
      while (kerns.length && !kerns[kerns.length - 1]) kerns.pop();
      upd(n.id, { kerns: kerns.length ? kerns : null }, `Kern ${chars[ci - 1]}${chars[ci]} ${kerns[ci - 1] ?? 0}`);
    },
    true,
  );
}
