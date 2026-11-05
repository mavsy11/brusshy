import type { ReactNode } from "react";
import { BOOLEAN_LABELS, type BooleanOp } from "@brusshy/core";
import { useStore } from "../lib/store";
import { booleanTargets, runBoolean } from "./actions";

const S = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" className="bool-ico">
    {children}
  </svg>
);

/** Two overlapping squares, with the result filled. */
export const BOOL_ICONS: Record<BooleanOp, ReactNode> = {
  union: (
    <S>
      <path d="M4 4h10v6h6v10H10v-6H4z" className="f" />
    </S>
  ),
  subtract: (
    <S>
      <path d="M4 4h10v6h-4v4H4z" className="f" />
      <rect x="10" y="10" width="10" height="10" className="o" />
    </S>
  ),
  intersect: (
    <S>
      <rect x="4" y="4" width="10" height="10" className="o" />
      <rect x="10" y="10" width="10" height="10" className="o" />
      <rect x="10" y="10" width="4" height="4" className="f" />
    </S>
  ),
  exclude: (
    <S>
      <path d="M4 4h10v6h-4v4H4zM14 10h6v10H10v-6h4z" className="f" />
    </S>
  ),
  divide: (
    <S>
      <rect x="4" y="4" width="10" height="10" className="o" />
      <rect x="10" y="10" width="10" height="10" className="o" />
      <path d="M10 10h4v4h-4z" className="f" />
      <path d="M4 4h10M4 4v10" className="o" />
    </S>
  ),
};

export const BOOL_HINTS: Record<BooleanOp, string> = {
  union: "Union — merge into one shape (keeps the top layer's style)",
  subtract: "Subtract — cut the upper shapes out of the bottom one",
  intersect: "Intersect — keep only where they overlap",
  exclude: "Exclude — keep where they don't overlap",
  divide: "Divide — split into every overlapping piece",
};

/** Boolean buttons for the quick bar (shown with two or more shapes selected). */
export function BooleanButtons() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  if (!doc || booleanTargets(doc, selection).length < 2) return null;
  return (
    <>
      <span className="qb-sep" />
      <div className="qb-bools" role="group" aria-label="Combine shapes">
        {(["union", "subtract", "intersect", "exclude", "divide"] as const).map((op) => (
          <button key={op} className="qb-btn" onClick={() => runBoolean(op)} title={BOOL_HINTS[op]} aria-label={BOOLEAN_LABELS[op]}>
            {BOOL_ICONS[op]}
          </button>
        ))}
      </div>
    </>
  );
}
