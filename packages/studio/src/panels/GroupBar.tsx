import { useRef, type KeyboardEvent } from "react";
import type { FrameNodeT } from "@brusshy/core";
import { select, setActiveFrame } from "../lib/store";
import { DESIGN_GROUPS, setDesignGroup, type DesignContext, type DesignGroup } from "./designGroups";

export const groupTabId = (g: DesignGroup) => `dg-tab-${g}`;
export const GROUP_PANEL_ID = "dg-panel";

/**
 * Segmented control for the Design tab's groups. A tablist with roving focus:
 * ←/→ (and Home/End) move and switch, like any native segmented control.
 */
export function GroupBar({ ctx, value, dots }: { ctx: DesignContext; value: DesignGroup; dots?: Partial<Record<DesignGroup, "on" | "accent">> }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const index = DESIGN_GROUPS.findIndex((g) => g.id === value);
  const go = (i: number) => {
    const g = DESIGN_GROUPS[(i + DESIGN_GROUPS.length) % DESIGN_GROUPS.length]!;
    setDesignGroup(ctx, g.id);
    refs.current[g.id]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown") go(index + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp") go(index - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(DESIGN_GROUPS.length - 1);
    else return;
    e.preventDefault();
    e.stopPropagation(); // keep canvas shortcuts (arrow nudges) out of it
  };
  return (
    <div className="dg-bar-wrap">
      <div className="dg-bar" role="tablist" aria-label="Design panel groups" onKeyDown={onKey} style={{ ["--dg-i" as string]: index, ["--dg-n" as string]: DESIGN_GROUPS.length }}>
        <span className="dg-thumb" aria-hidden />
        {DESIGN_GROUPS.map((g) => {
          const on = g.id === value;
          const dot = dots?.[g.id];
          return (
            <button
              key={g.id}
              ref={(el) => {
                refs.current[g.id] = el;
              }}
              id={groupTabId(g.id)}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={GROUP_PANEL_ID}
              tabIndex={on ? 0 : -1}
              className={`dg-seg${on ? " on" : ""}`}
              onClick={() => setDesignGroup(ctx, g.id)}
              title={g.hint}
            >
              {g.label}
              {dot && <i className={`dg-dot${dot === "accent" ? " accent" : ""}`} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** When a layer is selected, the Brand / Motion / Review groups describe its version: say which. */
export function GroupScope({ f, group }: { f: FrameNodeT; group: DesignGroup }) {
  return (
    <div className="dg-scope">
      <span>
        For version <b>{f.name}</b>
      </span>
      <button
        type="button"
        className="dg-scope-btn"
        onClick={() => {
          setDesignGroup("version", group); // stay on this group once the version is selected
          setActiveFrame(f.id);
          select([f.id]);
        }}
        title="Select the whole version"
      >
        Select version
      </button>
    </div>
  );
}
