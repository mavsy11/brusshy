import { useEffect, useRef, useState } from "react";
import { describeRepeat, type RepeatOptions } from "@brusshy/core";
import { useStore } from "../lib/store";
import { XIcons } from "./icons";
import { repeatSelection, repeatTargets, selectedRepeatGroup, updateRepeat } from "./state";
import "./explore.css";

const PRESETS: { label: string; hint: string; icon: keyof typeof XIcons; o: RepeatOptions }[] = [
  { label: "Radial ×6", hint: "around the artboard centre", icon: "radial", o: { mode: "radial", count: 6 } },
  { label: "Radial ×8", hint: "around the artboard centre", icon: "radial", o: { mode: "radial", count: 8 } },
  { label: "Radial ×12", hint: "around the artboard centre", icon: "radial", o: { mode: "radial", count: 12 } },
  { label: "Mirror ↔", hint: "left ↔ right, artboard centre", icon: "mirror", o: { mode: "mirror", axis: "vertical" } },
  { label: "Mirror ↕", hint: "top ↕ bottom, artboard centre", icon: "mirror", o: { mode: "mirror", axis: "horizontal" } },
  { label: "Mirror 4-way", hint: "both axes", icon: "mirror", o: { mode: "mirror", axis: "both" } },
  { label: "Grid 3×3", hint: "even gaps", icon: "grid", o: { mode: "grid", count: 3, rows: 3 } },
];

/** Quick-bar button: exact radial / mirror / grid repeats of the selection, or "Update" on a repeat. */
export function RepeatQuick() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useStore((s) => s.doc);
  useStore((s) => s.selection);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  if (!repeatTargets().length) return null;
  const g = selectedRepeatGroup();
  const run = (f: () => unknown) => () => {
    setOpen(false);
    f();
  };
  return (
    <div className="rq" ref={ref}>
      <button className={`qb-btn${open ? " on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Repeat" title={g ? `Repeat — ${describeRepeat(g.repeat!)}` : "Repeat — radial, mirror, grid (exact copies)"}>
        {XIcons.repeat}
      </button>
      {open && (
        <div className="rq-menu panel" role="menu">
          {g && (
            <>
              <button role="menuitem" className="rq-item strong" onClick={run(() => updateRepeat(g.id, {}, "Update repeat"))}>
                {XIcons.refresh}
                <span>Update from source</span>
                <span className="dim">{g.name}</span>
              </button>
              <div className="rq-sep" />
              <div className="label rq-label">Change to</div>
            </>
          )}
          {PRESETS.map((p) => (
            <button key={p.label} role="menuitem" className="rq-item" onClick={run(() => repeatSelection(p.o))}>
              {XIcons[p.icon]}
              <span>{p.label}</span>
              <span className="dim">{p.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
