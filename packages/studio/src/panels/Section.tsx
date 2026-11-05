import type { ReactNode } from "react";
import { isCollapsed, sectionKey, setSectionCollapsed, useDesignUi } from "./designGroups";
import "../styles/design-groups.css";

const Chevron = (
  <svg className="section-chev" viewBox="0 0 12 12" aria-hidden>
    <path d="M3.5 4.75 6 7.25l2.5-2.5" />
  </svg>
);

/**
 * A side-panel section. The title folds it (state remembered per section, across sessions).
 * `data-section` is the stable anchor the command palette reveals; `collapsible={false}` keeps
 * the always-visible basics (layer, version) plain.
 */
export function Section({
  title,
  children,
  right,
  id,
  className,
  collapsible = true,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
  /** Stable key when the title changes with state (e.g. "Lockup · Horizontal" / "Preview · …"). */
  id?: string;
  className?: string;
  collapsible?: boolean;
}) {
  const key = id ?? sectionKey(title);
  const folded = useDesignUi((s) => collapsible && isCollapsed(s, key));
  const cls = `section${className ? ` ${className}` : ""}${folded ? " folded" : ""}`;
  return (
    <section className={cls} data-section={key} data-collapsed={folded ? "true" : undefined}>
      <div className="section-head">
        {collapsible ? (
          <button
            type="button"
            className="section-toggle"
            aria-expanded={!folded}
            onClick={() => setSectionCollapsed(key, !folded)}
            title={folded ? `Show ${title}` : `Fold ${title}`}
          >
            <span className="label">{title}</span>
            {Chevron}
          </button>
        ) : (
          <span className="label">{title}</span>
        )}
        {!folded && right}
      </div>
      {!folded && children}
    </section>
  );
}
