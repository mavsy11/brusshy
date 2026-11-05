import { useState } from "react";
import { LAYOUT_RANGE, letterBoxes, type DocT, type LetterLayout, type NodeT } from "@brusshy/core";
import { commitArrange, layoutMemory, makeLettering, previewArrange } from "../lib/lettering";
import { Section } from "./controls";
import "../styles/series.css";

/** Lettering: text → per-letter shapes, and letter layouts (arc, wave, rise, stagger). */

const LAYOUTS: { id: LetterLayout; label: string; title: string }[] = [
  { id: "straight", label: "Straight", title: "Back on one baseline" },
  { id: "arc", label: "Arc", title: "Letters on a circle — badges and emblems" },
  { id: "wave", label: "Wave", title: "Letters ride a wave" },
  { id: "rise", label: "Rise", title: "Letters climb from left to right" },
  { id: "stagger", label: "Stagger", title: "Letters bounce up and down" },
];

/** Five little letter blocks drawn on each layout's path. */
function LayoutGlyph({ layout }: { layout: LetterLayout }) {
  const xs = [5, 13, 21, 29, 37];
  const place = (x: number, i: number): [number, number, number] => {
    const u = (x - 21) / 16;
    if (layout === "arc") return [21 + Math.sin(u * 1.1) * 16 / 1.1, 14 + (1 - Math.cos(u * 1.1)) * 9, u * 1.1 * 57.3];
    if (layout === "wave") return [x, 12 - Math.sin(((x - 5) / 32) * Math.PI * 2) * 4, -Math.cos(((x - 5) / 32) * Math.PI * 2) * 30];
    if (layout === "rise") return [x, 17 - ((x - 5) / 32) * 9, 0];
    if (layout === "stagger") return [x, i % 2 ? 15 : 10, i % 2 ? 6 : -6];
    return [x, 13, 0];
  };
  return (
    <svg viewBox="0 0 42 24" className="layout-glyph" aria-hidden>
      {xs.map((x, i) => {
        const [cx, by, r] = place(x, i);
        return <rect key={i} x={cx - 2.6} y={by - 7} width={5.2} height={7} rx={1.2} transform={`rotate(${r} ${cx} ${by})`} />;
      })}
    </svg>
  );
}

function inferLayout(doc: DocT, groupId: string): LetterLayout | null {
  const g = doc.nodes[groupId];
  if (g?.type !== "group") return null;
  const straight = g.children.every((c) => {
    const t = doc.nodes[c]?.transform;
    return !t || (!t.x && !t.y && !t.rotation);
  });
  return straight ? "straight" : null;
}

export function LetteringSection({ doc, n }: { doc: DocT; n: NodeT }) {
  const remembered = layoutMemory.get(n.id);
  const [state, setState] = useState<{ id: string; layout: LetterLayout | null; amount: number }>({
    id: n.id,
    layout: remembered?.layout ?? null,
    amount: remembered?.amount ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Selection changed to another layer: start from what that layer has.
  // (A text turned into lettering keeps its id: fall back to what makeLettering remembered.)
  const cur = state.id === n.id && state.layout ? state : { id: n.id, layout: layoutMemory.get(n.id)?.layout ?? null, amount: layoutMemory.get(n.id)?.amount ?? 0 };

  if (n.type === "text") {
    const run = async (layout?: LetterLayout) => {
      setBusy(true);
      await makeLettering(n.id, layout);
      setBusy(false);
    };
    return (
      <Section title="Lettering">
        <p className="muted">Shape the word: each letter becomes its own editable shape (one undo step).</p>
        <div className="layout-tiles">
          {LAYOUTS.filter((l) => l.id !== "straight").map((l) => (
            <button key={l.id} className="layout-tile" disabled={busy} onClick={() => run(l.id)} title={`${l.title} — makes lettering`}>
              <LayoutGlyph layout={l.id} />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </Section>
    );
  }

  if (n.type !== "group") return null;
  // Repeats (petal ×8) and other shape groups aren't words: only lettering groups get this panel.
  if (n.repeat || (!n.lettering && n.children.some((c) => doc.nodes[c]?.type !== "path"))) return null;
  const letters = letterBoxes(doc, n.id);
  if (letters.length < 2) return null;
  const active = cur.layout ?? inferLayout(doc, n.id);
  const range = active ? LAYOUT_RANGE[active] : null;

  const choose = (layout: LetterLayout) => {
    const amount = layout === cur.layout ? cur.amount : (layoutMemory.get(n.id)?.layout === layout ? layoutMemory.get(n.id)!.amount : LAYOUT_RANGE[layout].default);
    setState({ id: n.id, layout, amount });
    commitArrange(n.id, layout, amount);
  };
  const slide = (v: number) => {
    if (!active) return;
    setDragging(true);
    setState({ id: n.id, layout: active, amount: v });
    previewArrange(n.id, active, v);
  };
  const release = () => {
    if (!active || !dragging) return;
    setDragging(false);
    commitArrange(n.id, active, cur.amount);
  };

  return (
    <Section title={`Lettering · ${letters.length} letters`}>
      <div className="layout-tiles five">
        {LAYOUTS.map((l) => (
          <button key={l.id} className={`layout-tile${active === l.id ? " on" : ""}`} onClick={() => choose(l.id)} title={l.title}>
            <LayoutGlyph layout={l.id} />
            <span>{l.label}</span>
          </button>
        ))}
      </div>
      {range && active !== "straight" && (
        <div className="deform-row" title={range.hint}>
          <span className="label">{active === "arc" ? "Sweep" : active === "rise" ? "Climb" : "Height"}</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={cur.amount}
            onChange={(e) => slide(Number(e.target.value))}
            onPointerUp={release}
            onKeyUp={release}
          />
          <span className="num">
            {cur.amount}
            {range.unit}
          </span>
        </div>
      )}
      <p className="muted">
        {range && active !== "straight" ? `${range.hint}. ` : ""}Letters stay editable: select one to reshape its nodes, or Bend/Twist it from its Deform panel.
      </p>
    </Section>
  );
}
