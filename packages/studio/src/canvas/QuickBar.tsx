import { useEffect, useRef } from "react";
import { subtreeIds, type DocT, type NodeT, type OpT, type PaintT } from "@brusshy/core";
import { dispatch, toast, useStore } from "../lib/store";
import { topSelection } from "../lib/actions";
import { selectionBox } from "../lib/geom";
import { normColor, usePalette, useQuick } from "../lib/quick";
import { toScreen } from "./camera";
import { QIcons } from "../panels/quickIcons";
import "../styles/quickwins.css";
import { RefineButton, RefinePanel } from "../refine/RefineMenu";
import { isRefinePreviewing } from "../refine/state";
import { BooleanButtons } from "../construct/BooleanButtons";
import { RepeatQuick } from "../explore/RepeatQuick";

const PAINTED = new Set<NodeT["type"]>(["path", "shape", "text"]);

/** Paintable layers behind a selection (groups paint their contents). */
function paintTargets(doc: DocT, ids: string[]): NodeT[] {
  const out: NodeT[] = [];
  for (const id of ids) for (const sid of subtreeIds(doc, id)) if (PAINTED.has(doc.nodes[sid]!.type)) out.push(doc.nodes[sid]!);
  return out;
}

function setPaint(nodes: NodeT[], target: "fill" | "stroke", color: string | null) {
  if (!nodes.length) return;
  const ops: OpT[] = nodes.map((n) => ({
    op: "update",
    id: n.id,
    set: { style: target === "fill" ? { fill: color } : { stroke: color, strokeWidth: color && !n.style.strokeWidth ? 8 : n.style.strokeWidth } },
  }));
  dispatch(ops, target === "fill" ? "Fill" : "Stroke");
}

const chipStyle = (p: PaintT) =>
  p === null ? undefined : typeof p === "string" ? { background: p } : { background: `linear-gradient(135deg, ${p.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(",")})` };

/** Native color picker that commits once, when the picker closes (one undo step). */
function CustomColor({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => pick.current(el.value);
    el.addEventListener("change", on);
    return () => el.removeEventListener("change", on);
  }, []);
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#0b0c0e";
  return (
    <label className="qb-btn qb-custom" title="Any color…">
      <span className="qb-rainbow" />
      <input ref={ref} type="color" defaultValue={hex} key={hex} aria-label="Custom color" />
    </label>
  );
}

/**
 * Floating fill/stroke bar next to the selection: the version's colors one click away,
 * a custom picker and an eyedropper.
 */
export function QuickBar() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const busy = useStore((s) => (Object.keys(s.live).length > 0 && !isRefinePreviewing()) || !!s.textEditId || !!s.openAnnotation);
  const target = useQuick((s) => s.quickTarget);
  const palette = usePalette();
  if (!doc || tool !== "select" || busy || !selection.length) return null;
  const ids = topSelection(doc, selection).filter((id) => doc.nodes[id]?.type !== "frame");
  const nodes = paintTargets(doc, ids);
  if (!nodes.length) return null;
  const box = selectionBox(doc, ids);
  if (!box) return null;
  const [cx, top] = toScreen(camera, box.x + box.w / 2, box.y);
  const [, bottom] = toScreen(camera, box.x, box.y + box.h);
  // Sit above the selection (clear of the rotate handle); flip below when there's no room.
  const above = top - 56 > 84;
  const y = above ? top - 56 : bottom + 18;
  const fill = nodes[0]!.style.fill;
  const stroke = nodes[0]!.style.strokeWidth > 0 ? nodes[0]!.style.stroke : null;
  const mixed = (k: "fill" | "stroke") => new Set(nodes.map((n) => JSON.stringify(k === "fill" ? n.style.fill : n.style.strokeWidth ? n.style.stroke : null))).size > 1;
  const cur = target === "fill" ? fill : stroke;
  const curKey = typeof cur === "string" ? normColor(cur) : null;
  const apply = (c: string | null) => setPaint(nodes, target, c);
  const eyedrop = async () => {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!ED) return toast("This browser has no eyedropper — pick one of the version's colors instead");
    try {
      const r = await new ED().open();
      apply(normColor(r.sRGBHex));
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="quick-bar panel" data-ui style={{ left: cx, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="qb-targets" role="tablist" aria-label="Paint">
        {(["fill", "stroke"] as const).map((k) => {
          const p = k === "fill" ? fill : stroke;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={target === k}
              className={`qb-target${target === k ? " on" : ""}`}
              onClick={() => useQuick.setState({ quickTarget: k })}
              title={k === "fill" ? "Fill" : "Stroke"}
            >
              <span className={`qb-chip ${k}${p === null ? " none" : ""}${mixed(k) ? " mixed" : ""}`} style={chipStyle(p)} />
              <span className="qb-label">{k === "fill" ? "Fill" : "Stroke"}</span>
            </button>
          );
        })}
      </div>
      <span className="qb-sep" />
      <div className="qb-dots">
        {palette.slice(0, 8).map(({ color }) => (
          <button key={color} className={`qb-dot${color === curKey ? " on" : ""}`} style={{ ["--c" as string]: color }} onClick={() => apply(color)} title={`${target === "fill" ? "Fill" : "Stroke"} ${color}`} />
        ))}
        <button className="qb-btn qb-none" onClick={() => apply(null)} title={`No ${target}`} aria-label={`No ${target}`}>
          {QIcons.none}
        </button>
      </div>
      <span className="qb-sep" />
      <CustomColor value={curKey ?? "#0b0c0e"} onPick={(c) => apply(normColor(c))} />
      <button className="qb-btn" onClick={() => void eyedrop()} title="Pick a color from the screen" aria-label="Eyedropper">
        {QIcons.eyedropper}
      </button>
      <span className="qb-sep" />
      <RepeatQuick />
      <RefineButton />
      <RefinePanel />
      <BooleanButtons />
    </div>
  );
}
