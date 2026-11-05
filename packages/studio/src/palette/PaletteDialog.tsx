import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  colorFormats,
  contrastLevel,
  contrastPairs,
  contrastRatio,
  frameDoc,
  HARMONY_LABELS,
  hexToOklch,
  keepColorwaysOps,
  nudgeColor,
  PALETTE_HARMONIES,
  PALETTE_ROLES,
  planColorways,
  roleLabel,
  type Colorway,
  type ColorwayPlan,
  type DocT,
  type HarmonyT,
  type PaletteEntryT,
  type PaletteRoleT,
} from "@brusshy/core";
import { activeFrameId, dispatch, toast, useStore } from "../lib/store";
import { textToPath, useFontVersion } from "../lib/fonts";
import { copyText } from "../lib/notes";
import { prepareFonts, refUrl } from "../export/svg";
import { Icons } from "../panels/icons";
import {
  addColor,
  applyToVersion,
  closePalette,
  moveColor,
  regenerate,
  removeColor,
  setImagePixels,
  updateColor,
  useAsBrief,
  usePaletteUi,
} from "./state";
import { colorwaySvg, imagePixels } from "./render";
import "./palette.css";

/** Readable text color on a swatch. */
const inkOn = (bg: string) => (contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0b0c0e") ? "#ffffff" : "#0b0c0e");
const isTyping = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");

const HARMONY_SHORT: Record<HarmonyT, string> = {
  analogous: "Analogous",
  complementary: "Complementary",
  split: "Split",
  triadic: "Triadic",
  monochrome: "Mono",
  logo: "From logo",
  image: "From image",
};

const LEVEL_CLASS = { AAA: "aaa", AA: "aa", "AA large": "aal", fail: "fail" } as const;

export function PaletteDialog() {
  const open = usePaletteUi((s) => s.open);
  const doc = useStore((s) => s.doc);
  if (!open || !doc) return null;
  return <Dialog doc={doc} />;
}

function Dialog({ doc }: { doc: DocT }) {
  const tab = usePaletteUi((s) => s.tab);
  const colors = doc.palette?.colors ?? [];
  const fid = activeFrameId(doc);
  const f = fid ? doc.nodes[fid] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePalette();
        return;
      }
      const ui = usePaletteUi.getState();
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      const n = useStore.getState().doc?.palette?.colors.length ?? 0;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.code === "Space") {
        handled();
        if (!e.repeat) regenerate();
        if (ui.tab !== "palette") usePaletteUi.setState({ tab: "palette" });
        return;
      }
      if (ui.tab !== "palette" || !n) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        handled();
        const to = Math.max(0, Math.min(n - 1, ui.selected + (e.key === "ArrowLeft" ? -1 : 1)));
        if (e.altKey) moveColor(ui.selected, to);
        else usePaletteUi.setState({ selected: to });
      } else if (e.key.toLowerCase() === "l") {
        handled();
        const c = useStore.getState().doc?.palette?.colors[ui.selected];
        if (c) updateColor(ui.selected, { locked: !c.locked }, c.locked ? "Unlock color" : "Lock color");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="modal pl" role="dialog" aria-modal="true" aria-labelledby="pl-title" data-ui>
        <header className="pl-head">
          <div className="grow">
            <div className="pl-title" id="pl-title">
              {tab === "palette" ? "Palette" : "Colorways"}
            </div>
            <div className="pl-sub">
              {tab === "palette"
                ? "Brand colors as data — your AI reads them. Space regenerates everything that isn't locked."
                : `${f?.name ?? "This version"} in every combination of the palette — keep the ones that work as new versions.`}
            </div>
          </div>
          <div className="mk-seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={tab === "palette"} className={tab === "palette" ? "on" : ""} onClick={() => usePaletteUi.setState({ tab: "palette" })}>
              Palette
            </button>
            <button
              role="tab"
              aria-selected={tab === "colorways"}
              className={tab === "colorways" ? "on" : ""}
              disabled={colors.length < 2}
              title={colors.length < 2 ? "Make a palette first" : "The logo in every palette combination"}
              onClick={() => usePaletteUi.setState({ tab: "colorways" })}
            >
              Colorways
            </button>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={closePalette}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        {tab === "palette" || colors.length < 2 || !fid ? <PaletteTab doc={doc} /> : <ColorwaysTab doc={doc} fid={fid} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- palette tab

function PaletteTab({ doc }: { doc: DocT }) {
  const colors = doc.palette?.colors ?? [];
  const draft = usePaletteUi((s) => s.draft);
  const selected = usePaletteUi((s) => Math.min(s.selected, Math.max(0, colors.length - 1)));
  const shown = colors.map((c, i) => (draft[i] ? { ...c, hex: draft[i]! } : c));
  const fid = activeFrameId(doc);
  const fname = fid ? doc.nodes[fid]?.name : "";
  const [dropping, setDropping] = useState(false);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const file = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (!file) return;
    await pickImage(URL.createObjectURL(file), file.name);
  };

  return (
    <>
      <div
        className={`pl-body${dropping ? " dropping" : ""}`}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="pl-main">
          <GeneratorBar hasPalette={colors.length > 0} />
          <ImageSource doc={doc} />
          {colors.length ? <Strip colors={shown} selected={selected} gen={doc.palette?.seed ?? 0} /> : <EmptyStrip />}
          {colors.length > 0 && (
            <div className="pl-lower">
              <ContrastTable colors={shown} />
              <LogoPreviews doc={doc} colors={shown} />
            </div>
          )}
        </div>
        <aside className="pl-side">{colors[selected] ? <ColorDetail key={selected} index={selected} entry={colors[selected]!} shown={shown} /> : <SideHelp />}</aside>
        {dropping && <div className="pl-drop">Drop an image to take its colors</div>}
      </div>
      <footer className="mk-foot">
        <span className="mk-hint">
          <span className="kbd">Space</span> regenerate · <span className="kbd">L</span> lock · <span className="kbd">←</span>
          <span className="kbd">→</span> select · <span className="kbd">⌥←</span> move
        </span>
        <div className="grow" />
        <button className="btn" disabled={!colors.length} onClick={useAsBrief} title="Write this palette into the Brief's palette field">
          Use as brief palette
        </button>
        <button className="btn" disabled={colors.length < 2} onClick={() => usePaletteUi.setState({ tab: "colorways" })}>
          Colorways
        </button>
        <button className="btn primary" disabled={!colors.length || !fid} onClick={applyToVersion} title="Recolor the active version with this palette (one undo step)">
          Apply to {fname || "version"}
        </button>
      </footer>
    </>
  );
}

async function pickImage(url: string, label: string) {
  try {
    const px = await imagePixels(url);
    setImagePixels(px, { url, label });
    usePaletteUi.setState({ harmony: "image" });
    regenerate();
  } catch {
    toast("Couldn't read that image", "error");
  }
}

function GeneratorBar({ hasPalette }: { hasPalette: boolean }) {
  const harmony = usePaletteUi((s) => s.harmony);
  const count = usePaletteUi((s) => s.count);
  const image = usePaletteUi((s) => s.image);
  return (
    <div className="pl-gen">
      <div className="pl-harmonies" role="radiogroup" aria-label="Harmony">
        {PALETTE_HARMONIES.map((h) => (
          <button
            key={h}
            role="radio"
            aria-checked={harmony === h}
            className={`pl-chip${harmony === h ? " on" : ""}`}
            title={HARMONY_LABELS[h]}
            onClick={() => {
              usePaletteUi.setState({ harmony: h });
              if (h !== "image" || image) regenerate();
            }}
          >
            <HarmonyGlyph h={h} />
            {HARMONY_SHORT[h]}
          </button>
        ))}
      </div>
      <div className="grow" />
      <div className="pl-count" role="group" aria-label="Number of colors">
        <button aria-label="Fewer colors" disabled={count <= 3} onClick={() => usePaletteUi.setState({ count: count - 1 })}>
          −
        </button>
        <span title="Colors to generate">{count}</span>
        <button aria-label="More colors" disabled={count >= 6} onClick={() => usePaletteUi.setState({ count: count + 1 })}>
          +
        </button>
      </div>
      <button className="btn primary pl-regen" onClick={() => regenerate()} disabled={harmony === "image" && !image}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 2.5v3h-3" />
        </svg>
        {hasPalette ? "Regenerate" : "Generate"}
        <span className="kbd inv">Space</span>
      </button>
    </div>
  );
}

/** Tiny hue-wheel glyph for each harmony. */
function HarmonyGlyph({ h }: { h: HarmonyT }) {
  const dots: Record<string, number[]> = { analogous: [-35, 0, 35], complementary: [0, 180], split: [0, 150, 210], triadic: [0, 120, 240] };
  if (h === "monochrome")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <rect x="2" y="3" width="4" height="10" rx="1.2" fill="currentColor" opacity=".9" />
        <rect x="6" y="3" width="4" height="10" rx="0" fill="currentColor" opacity=".55" />
        <rect x="10" y="3" width="4" height="10" rx="1.2" fill="currentColor" opacity=".25" />
      </svg>
    );
  if (h === "logo")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="6.5" cy="8" r="4" />
        <path d="M9 4.5l4.5 7.5H6" strokeLinejoin="round" />
      </svg>
    );
  if (h === "image")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.2" />
      {dots[h]!.map((a) => (
        <circle key={a} cx={8 + 6 * Math.cos(((a - 90) * Math.PI) / 180)} cy={8 + 6 * Math.sin(((a - 90) * Math.PI) / 180)} r="1.9" fill="currentColor" />
      ))}
    </svg>
  );
}

function ImageSource({ doc }: { doc: DocT }) {
  const harmony = usePaletteUi((s) => s.harmony);
  const image = usePaletteUi((s) => s.image);
  const file = useRef<HTMLInputElement>(null);
  const refs = useMemo(
    () =>
      Object.values(doc.nodes)
        .filter((n) => n.type === "reference")
        .sort((a, b) => (a.type === "reference" && a.role === "palette" ? -1 : 0) - (b.type === "reference" && b.role === "palette" ? -1 : 0)),
    [doc.nodes],
  );
  if (harmony !== "image") return null;
  return (
    <div className="pl-image">
      <span className="label">Image</span>
      {refs.map((n) =>
        n.type === "reference" ? (
          <button
            key={n.id}
            className={`pl-thumb${image?.url === refUrl(n.src) ? " on" : ""}`}
            title={`${n.name || n.src}${n.role === "palette" ? " · palette reference" : ""}`}
            onClick={() => void pickImage(refUrl(n.src), n.name || n.src)}
          >
            <img src={refUrl(n.src)} alt="" />
          </button>
        ) : null,
      )}
      {image && !refs.some((n) => n.type === "reference" && refUrl(n.src) === image.url) && (
        <span className="pl-thumb on" title={image.label}>
          <img src={image.url} alt="" />
        </span>
      )}
      <button className="btn small" onClick={() => file.current?.click()}>
        {Icons.image} Choose image…
      </button>
      <span className="muted">{refs.length ? "Pick a reference layer, choose a file or drop one here." : "Choose a file or drop one here (a photo, a moodboard, an old logo)."}</span>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickImage(URL.createObjectURL(f), f.name);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function EmptyStrip() {
  return (
    <div className="pl-empty">
      <div className="pl-empty-art" aria-hidden>
        {["#e4472a", "#127c7a", "#f2a516", "#14161a", "#f6f3ec"].map((c, i) => (
          <i key={c} style={{ background: c, animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
      <b>No brand palette yet</b>
      <span>Pick a harmony and press Generate (or Space). Lock the colors you love, regenerate the rest.</span>
    </div>
  );
}

function Strip({ colors, selected, gen }: { colors: PaletteEntryT[]; selected: number; gen: number }) {
  const row = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; dx: number } | null>(null);
  const order = colors.map((_, i) => i);
  if (drag && drag.over !== drag.from) {
    order.splice(drag.from, 1);
    order.splice(drag.over, 0, drag.from);
  }

  const onPointerDown = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, select, input")) return;
    usePaletteUi.setState({ selected: i });
    const x0 = e.clientX;
    const rects = [...(row.current?.querySelectorAll<HTMLElement>(".pl-sw") ?? [])].map((el) => el.getBoundingClientRect());
    let moved = false;
    let over = i;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 5) return;
      moved = true;
      const mid = rects.map((r) => r.left + r.width / 2);
      over = Math.max(0, Math.min(colors.length - 1, mid.filter((m) => ev.clientX > m).length - (ev.clientX > mid[i]! ? 1 : 0)));
      setDrag({ from: i, over, dx });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moved && over !== i) moveColor(i, over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="pl-strip" ref={row} role="listbox" aria-label="Palette colors">
      {order.map((i) => {
        const c = colors[i]!;
        const ink = inkOn(c.hex);
        return (
          <div
            key={`${i}-${gen}`}
            role="option"
            aria-selected={i === selected}
            className={`pl-sw${i === selected ? " on" : ""}${drag?.from === i ? " dragging" : ""}${c.locked ? " locked" : ""}`}
            style={{ background: c.hex, color: ink }}
            onPointerDown={(e) => onPointerDown(e, i)}
            title="Click to edit · drag to reorder"
          >
            <div className="pl-sw-top">
              <select
                className="pl-role"
                value={c.role}
                aria-label="Role"
                onChange={(e) => {
                  updateColor(i, { role: e.target.value as PaletteRoleT }, "Color role");
                  e.target.blur(); // keep Space for regenerate
                }}
                style={{ color: ink }}
              >
                {PALETTE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <button
                className={`pl-lock${c.locked ? " on" : ""}`}
                aria-pressed={c.locked}
                aria-label={c.locked ? "Unlock" : "Lock"}
                title={c.locked ? "Locked — kept when you regenerate (L)" : "Lock to keep it when you regenerate (L)"}
                onClick={() => updateColor(i, { locked: !c.locked }, c.locked ? "Unlock color" : "Lock color")}
              >
                {c.locked ? Icons.lock : Icons.unlock}
              </button>
            </div>
            <div className="pl-sw-bottom">
              <b>{c.name}</b>
              <span>{c.hex.toUpperCase()}</span>
            </div>
          </div>
        );
      })}
      {colors.length < 8 && (
        <button className="pl-add" onClick={addColor} aria-label="Add a color" title="Add a color that fits">
          {Icons.plus}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- selected color

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="pl-fmt"
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1100);
        }
      }}
      title={`Copy ${label}`}
    >
      <span className="label">{label}</span>
      <code>{value}</code>
      <span className="pl-copy">{done ? "Copied" : Icons.copy}</span>
    </button>
  );
}

const SLIDERS: { key: "lightness" | "saturation" | "warmth"; label: string; left: string; right: string }[] = [
  { key: "lightness", label: "Lightness", left: "darker", right: "lighter" },
  { key: "saturation", label: "Saturation", left: "muted", right: "vivid" },
  { key: "warmth", label: "Warmth", left: "cooler", right: "warmer" },
];

function ColorDetail({ index, entry, shown }: { index: number; entry: PaletteEntryT; shown: PaletteEntryT[] }) {
  const hex = shown[index]!.hex;
  const fm = colorFormats(hex);
  const o = hexToOklch(hex);
  const [nudge, setNudge] = useState({ lightness: 0, saturation: 0, warmth: 0 });
  const base = useRef<string | null>(null);
  const [hexText, setHexText] = useState(entry.hex.toUpperCase());
  const [name, setName] = useState(entry.name);
  useEffect(() => setHexText(entry.hex.toUpperCase()), [entry.hex]);
  useEffect(() => setName(entry.name), [entry.name]);

  const live = (k: keyof typeof nudge, v: number) => {
    if (base.current === null) base.current = entry.hex;
    const next = { ...nudge, [k]: v };
    setNudge(next);
    usePaletteUi.setState((s) => ({ draft: { ...s.draft, [index]: nudgeColor(base.current!, { lightness: next.lightness / 100, saturation: next.saturation / 100, warmth: next.warmth / 100 }) } }));
  };
  const commit = () => {
    const d = usePaletteUi.getState().draft[index];
    base.current = null;
    setNudge({ lightness: 0, saturation: 0, warmth: 0 });
    usePaletteUi.setState((s) => {
      const draft = { ...s.draft };
      delete draft[index];
      return { draft };
    });
    if (d && d !== entry.hex) updateColor(index, { hex: d }, "Adjust color");
  };

  const others = shown.map((c, i) => ({ c, i })).filter((x) => x.i !== index);
  return (
    <div className="pl-detail">
      <div className="pl-big" style={{ background: hex, color: inkOn(hex) }}>
        <input
          className="pl-name"
          value={name}
          aria-label="Color name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== entry.name && updateColor(index, { name: name.trim() || entry.name }, "Rename color")}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          style={{ color: inkOn(hex) }}
        />
        <span className="pl-big-role">
          {roleLabel(entry.role)}
          {entry.locked ? " · locked" : ""}
        </span>
      </div>
      <div className="pl-hexrow">
        <label className="field">
          <span>HEX</span>
          <input
            value={hexText}
            spellCheck={false}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={() => hexText.toLowerCase() !== entry.hex && updateColor(index, { hex: hexText.startsWith("#") || !/^[0-9a-f]{3,6}$/i.test(hexText) ? hexText : `#${hexText}` }, "Edit color")}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <span className="swatch pl-picker" title="Pick a color">
          <i style={{ background: hex }} />
          <input type="color" value={entry.hex} onChange={(e) => usePaletteUi.setState((s) => ({ draft: { ...s.draft, [index]: e.target.value } }))} onBlur={commit} />
        </span>
        <button className="btn small ghost danger" onClick={() => removeColor(index)} title="Remove this color">
          {Icons.trash}
        </button>
      </div>
      <div className="pl-fmts">
        <CopyRow label="HEX" value={fm.hex} />
        <CopyRow label="RGB" value={fm.rgb} />
        <CopyRow label="HSL" value={fm.hsl} />
        <CopyRow label="OKLCH" value={fm.oklch} />
      </div>
      <div className="pl-sliders">
        {SLIDERS.map((s) => (
          <label key={s.key} className="pl-slider">
            <span className="pl-slider-head">
              <span className="label">{s.label}</span>
              <span className="num">{nudge[s.key] > 0 ? `+${nudge[s.key]}` : nudge[s.key]}</span>
            </span>
            <input
              type="range"
              min={-100}
              max={100}
              value={nudge[s.key]}
              className={`pl-range pl-range-${s.key}`}
              style={{ ["--c" as string]: hex }}
              onChange={(e) => live(s.key, Number(e.target.value))}
              onPointerUp={commit}
              onKeyUp={(e) => e.key.startsWith("Arrow") && commit()}
              onBlur={commit}
            />
            <span className="pl-slider-ends">
              <span>{s.left}</span>
              <span>{s.right}</span>
            </span>
          </label>
        ))}
        <p className="muted">
          L {Math.round(o.l * 100)} · C {o.c.toFixed(3)} · H {Math.round(o.h)}° — nudges work in OKLCH, so steps look even.
        </p>
      </div>
      {others.length > 0 && (
        <div className="pl-vs">
          <span className="label">As text on the others</span>
          {others.map(({ c, i }) => {
            const r = contrastRatio(hex, c.hex);
            const lvl = contrastLevel(r);
            return (
              <button key={i} className="pl-vs-row" onClick={() => usePaletteUi.setState({ selected: i })} title={`${c.name} — select`}>
                <span className="pl-aa" style={{ background: c.hex, color: hex }}>
                  Aa
                </span>
                <span className="pl-vs-name">{c.name}</span>
                <span className="num">{r.toFixed(2)}</span>
                <span className={`pl-lvl ${LEVEL_CLASS[lvl]}`}>{lvl === "fail" ? "—" : lvl}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SideHelp() {
  return (
    <div className="pl-help">
      <span className="label">How it works</span>
      <p>Colors are generated in OKLCH, so lightness steps look even. Each palette has a lead color, support colors, a dark ink and a light ground — the roles a logo needs.</p>
      <p>Lock what you love (L), press Space for new partners. Nudge any color's lightness, saturation and warmth.</p>
      <p>Colorways show the logo in every combination and flag pairs under 3:1 contrast.</p>
    </div>
  );
}

// ---------------------------------------------------------------- contrast + previews

function ContrastTable({ colors }: { colors: PaletteEntryT[] }) {
  const pairs = useMemo(() => contrastPairs(colors.map((c) => c.hex)), [colors]);
  const good = pairs.filter((p) => p.level !== "fail");
  const failing = pairs.length - good.length;
  return (
    <section className="pl-card">
      <div className="pl-card-head">
        <span className="label">Text pairs · WCAG</span>
        <span className="muted">
          {good.length} usable{failing ? ` · ${failing} under 3:1` : ""}
        </span>
      </div>
      <div className="pl-pairs">
        {good.slice(0, 8).map((p) => {
          const a = colors[p.a]!;
          const b = colors[p.b]!;
          // Lighter one as the ground.
          const [fg, bg] = hexToOklch(a.hex).l < hexToOklch(b.hex).l ? [a, b] : [b, a];
          return (
            <div key={`${p.a}-${p.b}`} className="pl-pair" title={`${fg.name} on ${bg.name}`}>
              <span className="pl-pair-sample" style={{ background: bg.hex, color: fg.hex }}>
                <b>Aa</b> Brand
              </span>
              <span className="pl-pair-names">
                {fg.name} / {bg.name}
              </span>
              <span className="num">{p.ratio.toFixed(2)}</span>
              <span className={`pl-lvl ${LEVEL_CLASS[p.level]}`}>{p.level}</span>
            </div>
          );
        })}
        {!good.length && <p className="muted">No pair reaches 3:1 — add a darker ink or a lighter ground.</p>}
      </div>
    </section>
  );
}

/** Pick three telling colorways: full color on the ground, one color, and reversed on the darkest. */
function previewPicks(plan: ColorwayPlan): { cw: Colorway; caption: string }[] {
  const pal = plan.palette;
  const idx = (role: PaletteRoleT) => pal.findIndex((c) => c.role === role);
  const byL = pal.map((c, i) => ({ i, l: hexToOklch(c.hex).l })).sort((a, b) => a.l - b.l);
  const light = idx("background") >= 0 ? idx("background") : byL.at(-1)!.i;
  const dark = idx("neutral") >= 0 && idx("neutral") !== light ? idx("neutral") : byL[0]!.i;
  const out: { cw: Colorway; caption: string }[] = [];
  const add = (cw: Colorway | null | undefined, caption: string) => cw && !out.some((x) => x.cw.id === cw.id) && out.push({ cw, caption });
  const rowL = plan.grid[light] ?? [];
  const rowD = plan.grid[dark] ?? [];
  add(rowL[0] ?? rowL.find((c) => c?.readable && c.ink === pal[idx("primary")]?.hex), "Full color");
  add(rowL[dark + 1] ?? rowL.find((c) => c?.kind === "one" && c.readable), "One color");
  add(rowD[0] ?? rowD[light + 1] ?? rowD.find((c) => c?.readable), "Reversed");
  for (const c of plan.all) if (out.length < 3 && c.readable) add(c, c.kind === "full" ? "Full color" : "One color");
  return out;
}

function useTileUrl(doc: DocT, fid: string, cw: Colorway | null, visible: boolean): string | null {
  const fontsV = useFontVersion((s) => s.v);
  const sub = useMemo(() => frameDoc(doc, fid), [doc, fid]);
  const [url, setUrl] = useState<string | null>(null);
  const key = cw ? `${cw.background}|${JSON.stringify(cw.member)}` : "";
  useEffect(() => {
    if (!cw || !visible) return;
    let u: string | null = null;
    const t = setTimeout(() => {
      try {
        u = URL.createObjectURL(new Blob([colorwaySvg(doc, fid, cw)], { type: "image/svg+xml;charset=utf-8" }));
        setUrl(u);
      } catch (e) {
        console.error("[colorways]", e);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      if (u) setTimeout(() => URL.revokeObjectURL(u!), 500);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, key, visible, fontsV]);
  return url;
}

function LogoPreviews({ doc, colors }: { doc: DocT; colors: PaletteEntryT[] }) {
  const fid = activeFrameId(doc);
  const fontsV = useFontVersion((s) => s.v);
  const sub = useMemo(() => (fid ? frameDoc(doc, fid) : null), [doc, fid]);
  useEffect(() => {
    if (sub) void prepareFonts(sub);
  }, [sub]);
  const plan = useMemo(() => (fid && colors.length >= 2 ? planColorways(doc, fid, colors, { textToPath }) : null), [sub, colors, fontsV]); // eslint-disable-line react-hooks/exhaustive-deps
  const picks = plan ? previewPicks(plan) : [];
  return (
    <section className="pl-card">
      <div className="pl-card-head">
        <span className="label">On {fid ? doc.nodes[fid]?.name : "the logo"}</span>
        {plan && plan.all.length > 0 && (
          <button className="btn small ghost" onClick={() => usePaletteUi.setState({ tab: "colorways" })}>
            All {plan.all.length} colorways →
          </button>
        )}
      </div>
      {!picks.length ? (
        <p className="muted">{colors.length < 2 ? "Add a second color to see the logo in it." : "Draw something in this version to preview it in the palette."}</p>
      ) : (
        <div className="pl-previews">
          {picks.map(({ cw, caption }) => (
            <PreviewTile key={cw.id} doc={doc} fid={fid!} cw={cw} caption={caption} />
          ))}
        </div>
      )}
    </section>
  );
}

function PreviewTile({ doc, fid, cw, caption }: { doc: DocT; fid: string; cw: Colorway; caption: string }) {
  const url = useTileUrl(doc, fid, cw, true);
  return (
    <button className="pl-prev" style={{ background: cw.background }} onClick={() => usePaletteUi.setState({ tab: "colorways" })} title={`${cw.label} · ${cw.contrast.toFixed(1)}:1`}>
      {url ? <img src={url} alt={cw.label} /> : <span className="cw-skel" style={{ color: inkOn(cw.background) }} />}
      <span className="pl-prev-cap" style={{ color: inkOn(cw.background) }}>
        {caption}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- colorways tab

function ColorwaysTab({ doc, fid }: { doc: DocT; fid: string }) {
  const colors = doc.palette?.colors ?? [];
  const fontsV = useFontVersion((s) => s.v);
  const sub = useMemo(() => frameDoc(doc, fid), [doc, fid]);
  useEffect(() => void prepareFonts(sub), [sub]);
  const plan = useMemo(() => planColorways(doc, fid, colors, { textToPath }), [sub, colors, fontsV]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hideLow, setHideLow] = useState(false);
  const [kept, setKept] = useState<Record<string, string>>({});
  const low = plan.all.filter((c) => !c.readable).length;
  const f = doc.nodes[fid]!;
  const cols = plan.columns.map((c, i) => ({ c, i })).filter((x) => x.c);

  const keep = (cw: Colorway) => {
    const cur = useStore.getState().doc;
    if (!cur) return;
    try {
      const r = keepColorwaysOps(cur, fid, [cw]);
      if (dispatch(r.ops, `Keep colorway ${cw.label}`)) {
        const name = r.frames[0]!.name;
        setKept((k) => ({ ...k, [cw.id]: name }));
        toast(`Kept as ${name} — ${cw.label}`);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (!plan.all.length)
    return (
      <div className="pl-body cw-empty">
        <p className="muted">“{f.name}” has nothing to recolor yet. Draw something, then come back.</p>
      </div>
    );

  return (
    <>
      <div className="cw-bar">
        <span>
          <b>{f.name}</b> · {plan.all.length} colorways · {plan.inks.length} ink{plan.inks.length === 1 ? "" : "s"}
          {plan.inks.some((k) => k.onMark || k.hole) ? " · details knock out in one color" : ""}
        </span>
        <div className="grow" />
        {low > 0 && (
          <label className="check">
            <input type="checkbox" checked={hideLow} onChange={(e) => setHideLow(e.target.checked)} />
            Hide {low} under 3:1
          </label>
        )}
      </div>
      <div className="cw-scroll">
        <div className="cw-grid" style={{ gridTemplateColumns: `112px repeat(${cols.length}, minmax(112px, 1fr))` }}>
          <div />
          {cols.map(({ c, i }) => (
            <div key={i} className="cw-colhead">
              {c!.kind === "full" ? (
                <>
                  <span className="cw-multi" aria-hidden>
                    {colors.slice(0, 3).map((x) => (
                      <i key={x.hex} style={{ background: x.hex }} />
                    ))}
                  </span>
                  Full color
                </>
              ) : (
                <>
                  <i className="cw-dot" style={{ background: colors[c!.index]!.hex }} />
                  {colors[c!.index]!.name}
                </>
              )}
            </div>
          ))}
          {plan.grid.map((row, r) => (
            <RowFrag key={r} label={colors[r]!} letter={String.fromCharCode(65 + r)}>
              {cols.map(({ i }) => {
                const cw = row[i];
                if (!cw) return <div key={i} className="cw-none" />;
                if (hideLow && !cw.readable) return <div key={i} className="cw-none low" title={`${cw.label} — ${cw.contrast.toFixed(1)}:1`} />;
                return <ColorwayTile key={i} doc={doc} fid={fid} cw={cw} kept={kept[cw.id]} onKeep={() => keep(cw)} />;
              })}
            </RowFrag>
          ))}
        </div>
      </div>
      <footer className="mk-foot">
        <span className="mk-hint">Rows are backgrounds · “Full color” maps every ink · the other columns use one ink, with details knocked out · Keep makes a new version (one undo step)</span>
        <div className="grow" />
        <button className="btn" onClick={() => usePaletteUi.setState({ tab: "palette" })}>
          ← Palette
        </button>
      </footer>
    </>
  );
}

function RowFrag({ label, letter, children }: { label: PaletteEntryT; letter: string; children: ReactNode }) {
  return (
    <>
      <div className="cw-rowhead">
        <i style={{ background: label.hex }} />
        <span>
          <b>
            {letter} · {label.name}
          </b>
          <span>{roleLabel(label.role)}</span>
        </span>
      </div>
      {children}
    </>
  );
}

function ColorwayTile({ doc, fid, cw, kept, onKeep }: { doc: DocT; fid: string; cw: Colorway; kept?: string; onKeep: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setVisible(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const url = useTileUrl(doc, fid, cw, visible);
  const ink = inkOn(cw.background);
  return (
    <div ref={ref} className={`cw-tile${cw.readable ? "" : " low"}${kept ? " kept" : ""}`} style={{ background: cw.background, color: ink }} title={`${cw.id} · ${cw.label}`}>
      {url ? <img src={url} alt={cw.label} draggable={false} /> : <span className="cw-skel" />}
      <span className="cw-id">{cw.id}</span>
      <span className={`cw-ratio${cw.readable ? "" : " warn"}`} title={cw.readable ? "Contrast of the main ink on this background" : "Under 3:1 — the mark won't read well"}>
        {cw.readable ? "" : "⚠ "}
        {cw.contrast.toFixed(1)}:1
      </span>
      {kept ? (
        <span className="cw-kept">✓ {kept}</span>
      ) : (
        <button className="cw-keep" onClick={onKeep} title="Keep as a new version">
          Keep
        </button>
      )}
    </div>
  );
}

