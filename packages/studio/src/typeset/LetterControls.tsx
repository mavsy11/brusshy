import { useEffect, useState } from "react";
import {
  applyOps,
  arrangeLetters,
  baselineLetterOps,
  kernLetterOps,
  letteringGroupOf,
  lettersOf,
  scaleLetterOps,
  swapLetterOps,
  transformAttr,
  type DocT,
  type LetteringSourceT,
  type NodeT,
  type OpT,
} from "@brusshy/core";
import { dispatch, select, toast, useStore } from "../lib/store";
import { layoutMemory } from "../lib/lettering";
import { NumField, Section } from "../panels/controls";
import { useFontVersion } from "../lib/fonts";
import { coordsFor, outlineD, outlineOf, type Layout } from "./engine";
import { drawnGlyphs, letterSwaps, sourceLayout } from "./info";
import { glyphAlternates } from "./gsub";
import { installTextKeys } from "./TypeControls";
import { useTypeUI } from "./state";
import { GlyphTile, WordStrip } from "./WordStrip";
import "./typeset.css";

/**
 * Letter-by-letter control on lettering groups: kerning (moves the letter and the rest of the word),
 * baseline shift, per-letter scale, and glyph alternates from the font the word was made from.
 *
 * Interactions: pick a letter in the strip or on the canvas (double-click into the group), then
 * ⌥←/→ kern, ⌥↑/↓ baseline (⇧ = ×5). Kerning and baseline are baked into the letter's outline and
 * scale sits about its baseline center, so Arc/Wave/Rise/Stagger layouts keep all three; when this
 * session knows the group's layout it is re-applied in the same undo step so letters stay on the curve.
 */

const get = () => useStore.getState();

/** Letter height of a group (for nudge steps). */
function stepOf(doc: DocT, groupId: string) {
  const ls = lettersOf(doc, groupId);
  const hs = ls.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
  return Math.max(0.25, (hs[Math.floor(hs.length / 2)] ?? 100) / 100);
}

/** Dispatch letter ops, re-applying the remembered layout so letters stay on it. */
function commit(groupId: string, ops: OpT[], label: string) {
  const doc = get().doc;
  if (!doc || !ops.length) return;
  const all = [...ops];
  const mem = layoutMemory.get(groupId);
  if (mem && mem.layout !== "straight") {
    try {
      const next = applyOps(doc, ops).doc;
      all.push(...arrangeLetters(next, groupId, mem.layout, mem.amount).map(({ id, transform }) => ({ op: "update", id, set: { transform } }) as OpT));
    } catch {
      /* not arrangeable any more */
    }
  }
  dispatch(all, label);
}

export function kernLetter(letterId: string, dir: -1 | 1, big: boolean) {
  const doc = get().doc;
  const g = doc ? letteringGroupOf(doc, letterId) : null;
  if (!doc || !g) return false;
  const dx = stepOf(doc, g) * (big ? 5 : 1) * dir;
  commit(g, kernLetterOps(doc, letterId, dx), `Kern “${doc.nodes[letterId]?.name}” ${dir < 0 ? "tighter" : "looser"}`);
  return true;
}

export function shiftBaseline(letterId: string, dir: -1 | 1, big: boolean) {
  const doc = get().doc;
  const g = doc ? letteringGroupOf(doc, letterId) : null;
  if (!doc || !g) return false;
  const dy = stepOf(doc, g) * (big ? 5 : 1) * dir;
  commit(g, baselineLetterOps(doc, letterId, dy), `Baseline “${doc.nodes[letterId]?.name}” ${dir < 0 ? "up" : "down"}`);
  return true;
}

/** The letter the keys act on: a selected letter path, or the strip pick of a selected lettering group. */
function activeLetter(): string | null {
  const s = get();
  const doc = s.doc;
  if (!doc || s.selection.length !== 1) return null;
  const id = s.selection[0]!;
  if (letteringGroupOf(doc, id)) return id;
  const pick = useTypeUI.getState().letter;
  if (pick?.id === id && doc.nodes[id]?.type === "group") return lettersOf(doc, id)[pick.index]?.id ?? null;
  return null;
}

installTextKeys((e) => {
  const letter = activeLetter();
  if (!letter) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") kernLetter(letter, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
  else shiftBaseline(letter, e.key === "ArrowUp" ? -1 : 1, e.shiftKey);
  return true;
});

export function LetterControls({ doc, n }: { doc: DocT; n: NodeT }) {
  const groupId = n.type === "group" ? (lettersOf(doc, n.id).length >= 2 ? n.id : null) : letteringGroupOf(doc, n.id);
  if (!groupId) return null;
  return <LetterPanel doc={doc} groupId={groupId} letterId={n.id === groupId ? null : n.id} />;
}

function LetterPanel({ doc, groupId, letterId }: { doc: DocT; groupId: string; letterId: string | null }) {
  useFontVersion((s) => s.v);
  const g = doc.nodes[groupId]!;
  const letters = lettersOf(doc, groupId);
  const pick = useTypeUI((s) => (s.letter?.id === groupId ? s.letter.index : null));
  const sel = letterId ? letters.findIndex((l) => l.id === letterId) : pick;
  const cur = sel !== null && sel >= 0 ? letters[sel] : null;
  const node = cur ? doc.nodes[cur.id] : null;
  const glyphs = letters.map((l) => {
    const ln = doc.nodes[l.id]!;
    return { key: l.id, d: ln.type === "path" ? ln.d : "", label: ln.name, transform: transformAttr(ln.transform) };
  });
  const source = g.type === "group" ? (g.lettering ?? null) : null;

  const choose = (i: number | null) => {
    if (i === null) return useTypeUI.setState({ letter: null });
    if (letterId) select([letters[i]!.id]);
    else useTypeUI.setState({ letter: { id: groupId, index: i } });
  };
  const scale = node ? Math.abs(node.transform.scaleX) : 1;
  const raised = cur ? Math.round((cur.baseline - cur.y1) * 10) / 10 : 0;

  return (
    <Section title={`Letters · ${letters.length}`}>
      <WordStrip glyphs={glyphs} selected={sel !== null && sel >= 0 ? sel : null} onSelect={choose} title="Pick a letter · ⌥←/→ kern · ⌥↑/↓ baseline" />
      {cur && node ? (
        <>
          <div className="tl-letter-head">
            <span className="tl-letter-name">“{node.name || "?"}”</span>
            <div className="tl-nudge" title="Kerning: moves this letter and every letter after it — ⌥← / ⌥→ (⇧ ×5)">
              <button className="mini-btn" onClick={() => kernLetter(cur.id, -1, false)} aria-label="Tighten before this letter">
                ‹
              </button>
              <span className="tl-nudge-l">Kern</span>
              <button className="mini-btn" onClick={() => kernLetter(cur.id, 1, false)} aria-label="Loosen before this letter">
                ›
              </button>
            </div>
          </div>
          <div className="grid2">
            <NumField
              label="⇡"
              title="Baseline shift (up is positive) — ⌥↑ / ⌥↓"
              value={raised}
              step={0.5}
              onCommit={(v) => {
                const d = get().doc;
                if (d) commit(groupId, baselineLetterOps(d, cur.id, -(v - raised)), `Baseline “${node.name}” ${v}`);
              }}
            />
            <NumField
              label="%"
              title="Letter scale, about its baseline center"
              value={Math.round(scale * 1000) / 10}
              min={10}
              max={400}
              step={1}
              onCommit={(v) => {
                const d = get().doc;
                if (d) commit(groupId, scaleLetterOps(d, cur.id, v / 100), `Scale “${node.name}” ${v}%`);
              }}
            />
          </div>
          <LetterAlternates doc={doc} groupId={groupId} letterId={cur.id} index={sel!} source={source} />
        </>
      ) : (
        <p className="muted">Pick a letter (or double-click one on the canvas) to kern it, raise it, scale it or swap its glyph. Layouts keep these edits.</p>
      )}
    </Section>
  );
}

function LetterAlternates({ doc, groupId, letterId, index, source }: { doc: DocT; groupId: string; letterId: string; index: number; source: LetteringSourceT | null }) {
  const [layout, setLayout] = useState<{ key: string; l: Layout | null; error?: string } | null>(null);
  const key = source ? JSON.stringify(source) : "";
  useEffect(() => {
    if (!source) return;
    let alive = true;
    sourceLayout(source).then(
      (l) => alive && setLayout({ key, l }),
      (e: Error) => alive && setLayout({ key, l: null, error: e.message }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!source) return <p className="muted">Glyph alternates need the font this lettering was made from — lettering made from now on remembers it.</p>;
  if (!layout || layout.key !== key) return <p className="muted tl-loading">Loading {source.fontFamily}…</p>;
  if (!layout.l) return <p className="muted">{layout.error}</p>;
  const l = layout.l;
  const p = drawnGlyphs(l)[index];
  if (!p) return <p className="muted">This letter isn't in the original word any more.</p>;
  const chars = Array.from(source.text);
  const ch = chars[p.chars[0] ?? 0] ?? "";
  const base = p.chars.length > 1 ? p.g : l.face.font.charToGlyphIndex(ch) || p.g;
  const alts = [...glyphAlternates(l.face, p.g), ...glyphAlternates(l.face, base)].filter((a, i, all) => all.findIndex((b) => b.g === a.g) === i && a.g !== base);
  if (!alts.length) return <p className="muted">No alternates for “{ch}” in {source.fontFamily}.</p>;
  const coords = coordsFor(l.face, source as never);
  const tile = (g: number) => outlineD(outlineOf(l.face, g, coords), 0, l.scale);
  const swap = async (k: string, label: string) => {
    const cur = get().doc?.nodes[letterId];
    if (cur?.type !== "path") return;
    try {
      const r = await letterSwaps(source, [{ letter: index, key: k, current: cur.d }]);
      const d = get().doc;
      const out = r.letters[0];
      if (!d || !out) return;
      const ops = swapLetterOps(d, letterId, out.d);
      if (ops.length) dispatch(ops, `“${ch}” → ${label}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  void doc;
  void groupId;
  return (
    <div className="tl-tiles">
      <GlyphTile d={tile(base)} label="Default" on={false} onClick={() => void swap("", "default")} />
      {alts.map((a) => (
        <GlyphTile key={a.key} d={tile(a.g)} label={a.label} hint={a.key} on={false} onClick={() => void swap(a.key, a.label)} />
      ))}
    </div>
  );
}
