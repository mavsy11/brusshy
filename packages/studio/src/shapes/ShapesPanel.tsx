import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ICON_CATEGORIES,
  ICON_SOURCE,
  SHAPE_CATEGORIES,
  getShape,
  isIconId,
  searchShapes,
  type ShapeEntry,
  type ShapeGeometry,
  type ShapeParam,
} from "@brusshy/shapes";
import { useStore } from "../lib/store";
import { closeShapes, ensureIcons, useShapes } from "./state";
import { dropTarget, geometryFor, insertShape, paramsFor, reshapeLinked } from "./insert";
import "./shapes.css";

const COLS = 4;
const GAP = 6;
const PAD = 12;
const LABEL = 18;

// Preview geometry, cached per id (+ icon style).
const cache = new Map<string, ShapeGeometry | null>();
function preview(e: ShapeEntry, weight: number): ShapeGeometry | null {
  const key = e.kind === "icon" ? `${e.id}|${weight}` : e.id;
  if (cache.has(key)) return cache.get(key)!;
  let g: ShapeGeometry | null = null;
  try {
    g = geometryFor(e.id, e.kind === "icon" ? { weight } : undefined);
  } catch {
    return null; // icons of a style that's still loading: retry on the next render
  }
  cache.set(key, g);
  return g;
}

const Glyph = memo(function Glyph({ g }: { g: ShapeGeometry | null }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      {g?.paths.map((p, i) => <path key={i} d={p.d} fillRule={p.fillRule} />)}
    </svg>
  );
});

type Drag = { entry: ShapeEntry; x: number; y: number; over: boolean };

/** The library panel (lazy-loaded by ./entry when first opened). */
export function ShapesPanelBody() {
  const { query, category, sub, iconWeight, icons, iconsLoading, iconsError, picked, iconsV } = useShapes();
  const hasDoc = useStore((s) => !!s.doc);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [box, setBox] = useState({ w: 320, h: 400 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<ShapeEntry | null>(null);

  useEffect(() => {
    search.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const cat = category === "icons" && sub ? `icons/${sub}` : category;
  const hits = useMemo(() => searchShapes(query, { category: cat, icons }).map((h) => h.entry), [query, cat, icons]);

  // Back to the top whenever the result set changes.
  useEffect(() => {
    grid.current?.scrollTo({ top: 0 });
    setScroll(0);
  }, [query, cat]);

  const cell = (box.w - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const rowH = cell + LABEL + GAP;
  const rows = Math.ceil(hits.length / COLS);
  const first = Math.max(0, Math.floor((scroll - PAD) / rowH) - 2);
  const last = Math.min(rows, Math.ceil((scroll + box.h) / rowH) + 2);
  const visible: { e: ShapeEntry; i: number }[] = [];
  for (let r = first; r < last; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (hits[i]) visible.push({ e: hits[i]!, i });
  }

  const startDrag = (entry: ShapeEntry) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) dragging = true;
      if (dragging) setDrag({ entry, x: ev.clientX, y: ev.clientY, over: !!dropTarget(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!hasDoc) return;
      if (!dragging) {
        useShapes.setState({ picked: entry.id });
        insertShape(entry.id);
        return;
      }
      const t = dropTarget(ev.clientX, ev.clientY);
      if (t) {
        useShapes.setState({ picked: entry.id });
        insertShape(entry.id, t);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const setCategory = (c: string) => {
    useShapes.setState({ category: c, sub: c === "icons" ? useShapes.getState().sub : "" });
    if (c === "icons" || c === "all") ensureIcons(iconWeight);
  };

  const pickedEntry = picked ? (hits.find((h) => h.id === picked) ?? entryFor(picked)) : null;
  void iconsV;

  return (
    <div
      className="panel shapes-panel"
      data-ui
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeShapes();
        }
      }}
    >
      <div className="shapes-head">
        <span className="label">Shapes</span>
        <span className="shapes-count">{hits.length.toLocaleString()}</span>
        <button className="icon-btn small" onClick={closeShapes} aria-label="Close shapes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="shapes-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.6-4.6" />
        </svg>
        <input
          ref={search}
          value={query}
          placeholder="Search shapes and symbols…"
          spellCheck={false}
          onChange={(e) => useShapes.setState({ query: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && hits[0]) {
              useShapes.setState({ picked: hits[0].id });
              insertShape(hits[0].id);
            }
            if (e.key === "Escape") {
              if (query) useShapes.setState({ query: "" });
              else closeShapes();
            }
          }}
        />
      </div>
      <div className="shapes-chips">
        <Chip on={category === "all"} onClick={() => setCategory("all")}>
          All
        </Chip>
        {SHAPE_CATEGORIES.map((c) => (
          <Chip key={c.id} on={category === c.id} onClick={() => setCategory(c.id)} title={c.label}>
            {SHORT[c.id] ?? c.label}
          </Chip>
        ))}
        <Chip on={category === "icons"} onClick={() => setCategory("icons")}>
          Icons
        </Chip>
      </div>
      {category === "icons" && (
        <div className="shapes-chips sub" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
          <Chip on={!sub} onClick={() => useShapes.setState({ sub: "" })}>
            All icons
          </Chip>
          {ICON_CATEGORIES.map((c) => (
            <Chip key={c.id} on={sub === c.id} onClick={() => useShapes.setState({ sub: c.id })}>
              {c.label}
            </Chip>
          ))}
        </div>
      )}
      {(category === "icons" || category === "all") && (
        <div className="shapes-style">
          <span className="muted">Icon style</span>
          <div className="shapes-seg">
            {["Solid", "Line"].map((l, i) => (
              <button
                key={l}
                className={iconWeight === i ? "on" : ""}
                onClick={() => {
                  useShapes.setState({ iconWeight: i });
                  ensureIcons(i);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="shapes-grid scroll-y" ref={grid} onScroll={(e) => setScroll((e.target as HTMLElement).scrollTop)}>
        <div style={{ height: rows * rowH + PAD * 2 - GAP, position: "relative" }}>
          {visible.map(({ e, i }) => {
            const g = e.id === picked && !isIconId(e.id) ? safeGeometry(e.id) : preview(e, iconWeight);
            return (
              <button
                key={e.id}
                className={`shape-tile${e.id === picked ? " picked" : ""}${e.kind === "icon" ? " icon" : ""}`}
                style={{ left: PAD + (i % COLS) * (cell + GAP), top: PAD + Math.floor(i / COLS) * rowH, width: cell, height: cell + LABEL }}
                title={`${e.name} — click to add, or drag onto the canvas`}
                onPointerDown={startDrag(e)}
                onPointerEnter={() => setHover(e)}
                onPointerLeave={() => setHover((h) => (h === e ? null : h))}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    useShapes.setState({ picked: e.id });
                    insertShape(e.id);
                  }
                }}
              >
                <span className="glyph" style={{ height: cell }}>
                  <Glyph g={g} />
                </span>
                <span className="name">{e.name}</span>
              </button>
            );
          })}
        </div>
        {!hits.length && (
          <div className="shapes-empty">
            {iconsLoading ? "Loading symbols…" : query ? `Nothing matches “${query}”.` : "Nothing here yet."}
          </div>
        )}
        {iconsLoading && hits.length > 0 && category !== "all" && <div className="shapes-empty">Loading symbols…</div>}
        {iconsError && <div className="shapes-empty">Symbols couldn't load: {iconsError}</div>}
      </div>
      {pickedEntry && pickedEntry.kind === "shape" && pickedEntry.params?.length ? (
        <ParamsBox id={pickedEntry.id} />
      ) : (
        <div className="shapes-foot muted">
          {hover
            ? hover.name
            : category === "icons" || (pickedEntry && pickedEntry.kind === "icon")
              ? `${ICON_SOURCE.name} (MIT) · customise before using in a logo`
              : "Click to add to the active version, or drag onto the canvas."}
        </div>
      )}
      {drag && (
        <div className={`shape-ghost${drag.over ? " over" : ""}`} style={{ left: drag.x, top: drag.y }}>
          <Glyph g={drag.entry.id === picked && !isIconId(drag.entry.id) ? safeGeometry(drag.entry.id) : preview(drag.entry, iconWeight)} />
        </div>
      )}
    </div>
  );
}

function entryFor(id: string): ShapeEntry | null {
  const d = getShape(id);
  return d ? { id: d.id, name: d.name, kind: "shape", category: d.category, tags: d.tags, params: d.params } : null;
}

function safeGeometry(id: string): ShapeGeometry | null {
  try {
    return geometryFor(id);
  } catch {
    return null;
  }
}

const SHORT: Record<string, string> = { stars: "Stars", lines: "Lines", badges: "Badges", frames: "Frames", letterforms: "Letters", marks: "Marks" };

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button className={`shape-chip${on ? " on" : ""}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** Parameter controls of the picked shape; they also re-shape the shape the panel just added. */
function ParamsBox({ id }: { id: string }) {
  const def = getShape(id)!;
  const stored = useShapes((s) => s.params[id]);
  const linked = useShapes((s) => (s.linked?.shapeId === id ? s.linked : null));
  const values = paramsFor(id);
  void stored;
  const set = (key: string, v: number, commit: boolean) => {
    const next = { ...values, [key]: v };
    useShapes.setState((s) => ({ params: { ...s.params, [id]: next } }));
    reshapeLinked(id, next, commit);
  };
  const commitAll = () => reshapeLinked(id, paramsFor(id), true);
  return (
    <div className="shapes-params">
      <div className="shapes-params-head">
        <span className="glyph big">
          <Glyph g={safeGeometry(id)} />
        </span>
        <div className="grow">
          <div className="pname">{def.name}</div>
          <div className="muted small">{linked ? "Adjusting the shape you added" : "Settings for the next one you add"}</div>
        </div>
        <button className="btn small" onClick={() => insertShape(id)}>
          Add
        </button>
      </div>
      {def.params!.map((p) => (
        <ParamRow key={p.key} p={p} value={values[p.key] ?? p.default} onChange={set} onCommit={commitAll} />
      ))}
    </div>
  );
}

function ParamRow({ p, value, onChange, onCommit }: { p: ShapeParam; value: number; onChange: (k: string, v: number, commit: boolean) => void; onCommit: () => void }) {
  if (p.type === "choice")
    return (
      <div className="param-row">
        <span className="pl">{p.label}</span>
        <div className="shapes-seg">
          {p.options.map((o, i) => (
            <button key={o} className={value === i ? "on" : ""} onClick={() => onChange(p.key, i, true)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  if (p.type === "seed")
    return (
      <div className="param-row">
        <span className="pl">{p.label}</span>
        <span className="num">{value}</span>
        <button className="btn small ghost" onClick={() => onChange(p.key, 1 + Math.floor(Math.random() * 9999), true)}>
          Shuffle
        </button>
      </div>
    );
  const step = p.type === "int" ? 1 : p.step;
  const shown = p.type === "int" ? String(value) : value >= 10 ? String(Math.round(value)) : value.toFixed(2);
  return (
    <label className="param-row">
      <span className="pl">{p.label}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={step}
        value={value}
        onChange={(e) => onChange(p.key, Number(e.target.value), false)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <span className="num">{shown}</span>
    </label>
  );
}
