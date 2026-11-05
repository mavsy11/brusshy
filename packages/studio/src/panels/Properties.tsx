import { frameOf, listFrames, MATERIALS, type DocT, type FrameNodeT, type NodeT, type OpT, type PaintT } from "@brusshy/core";
import { activeFrameId, dispatch, select, setActiveFrame, useStore } from "../lib/store";
import { localBBox, selectionBox, worldBox } from "../lib/geom";
import { movePatch, rotatePatch, scalePatch } from "../lib/transform";
import { alignSelection, convertToPath, duplicateSelection, flipSelection, topSelection, type Align } from "../lib/actions";
import { fitFrame } from "../canvas/camera";
import { animateCamera } from "../canvas/cameraAnim";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { commitDeform, previewDeform } from "../lib/nodeTools";
import type { PivotKind } from "../lib/deform";
import { FONT_FAMILIES } from "../lib/fonts";
import { ColorSwatch, CommitInput, NumField, PaintEditor, Section } from "./controls";
import { Icons } from "./icons";
import { AiLockCheck, CopyAsButtons, ReferenceRole } from "./QuickControls";
import { SmallSizesSection } from "./SmallSizes";
import { StyleSeries } from "./StyleSeries";
import { PaletteSection } from "../palette/PaletteSection";
import { LetteringSection } from "./Lettering";
import { TypeControls } from "../typeset/TypeControls";
import { LetterControls } from "../typeset/LetterControls";
import { WarpSection } from "./WarpSection";
import { EffectsSection } from "./EffectsSection";
import { makeLettering } from "../lib/lettering";
import { AnimationSection } from "./AnimationSection";
import { LockupForSelection, LockupSection, selectionMakesLockup } from "./LockupSection";
import { openVectorize } from "../vectorize/run";
import { RepeatSection } from "../explore/RepeatSection";
import { ExploreEntry } from "../explore/ExploreDialog";
import { VersionReview } from "../critique/VersionReview";
import { openMockups } from "../mockups/MockupsDialog";
import { designContext, useDesignUi, type DesignContext } from "./designGroups";
import { GROUP_PANEL_ID, GroupBar, GroupScope, groupTabId } from "./GroupBar";

const upd = (id: string, set: Record<string, unknown>, label: string) => dispatch([{ op: "update", id, set }], label);

function AlignRow() {
  const items: [Align, keyof typeof Icons][] = [
    ["left", "alignLeft"],
    ["hcenter", "alignHCenter"],
    ["right", "alignRight"],
    ["top", "alignTop"],
    ["vcenter", "alignVCenter"],
    ["bottom", "alignBottom"],
  ];
  return (
    <div className="align-row">
      {items.map(([a, icon]) => (
        <button key={a} className="icon-btn small" onClick={() => alignSelection(a)} aria-label={`Align ${a}`}>
          {Icons[icon]}
        </button>
      ))}
      <div className="vsep" />
      <button className="icon-btn small" onClick={() => flipSelection("x")} aria-label="Flip horizontal">
        {Icons.flipH}
      </button>
      <button className="icon-btn small" onClick={() => flipSelection("y")} aria-label="Flip vertical">
        {Icons.flipV}
      </button>
    </div>
  );
}

/** Position, size, rotation (+ shape specifics) — part of the always-visible layer basics. */
function TransformFields({ doc, n }: { doc: DocT; n: NodeT }) {
  const wb = worldBox(doc, n);
  // Positions read in the version's own coordinates (0,0 = artboard top-left), like the AI sees them.
  const f = frameOf(doc, n.parent);
  const b = f ? { ...wb, x: wb.x - f.transform.x, y: wb.y - f.transform.y } : wb;
  const lb = localBBox(doc, n);
  const setSize = (w: number | null, h: number | null) => {
    const fx = w !== null && lb.w ? w / (lb.w * Math.abs(n.transform.scaleX)) : 1;
    const fy = h !== null && lb.h ? h / (lb.h * Math.abs(n.transform.scaleY)) : 1;
    const f = n.type === "text" ? (w !== null ? fx : fy) : null;
    upd(n.id, scalePatch(n, [lb.x, lb.y], f ?? fx, f ?? fy) as Record<string, unknown>, "Resize");
  };
  return (
    <div className="grid2">
      <NumField label="X" value={b.x} onCommit={(v) => upd(n.id, movePatch(doc, n, v - b.x, 0) as Record<string, unknown>, "Move")} />
      <NumField label="Y" value={b.y} onCommit={(v) => upd(n.id, movePatch(doc, n, 0, v - b.y) as Record<string, unknown>, "Move")} />
      <NumField label="W" value={lb.w * Math.abs(n.transform.scaleX)} min={1} onCommit={(v) => setSize(v, null)} />
      <NumField label="H" value={lb.h * Math.abs(n.transform.scaleY)} min={1} onCommit={(v) => setSize(null, v)} />
      <NumField label="↻" value={n.transform.rotation} suffix="°" onCommit={(v) => upd(n.id, rotatePatch(doc, n, v) as Record<string, unknown>, "Rotate")} />
      {n.type === "shape" && n.shape !== "ellipse" && (
        <NumField label="◜" title="Corner radius" value={n.radius} min={0} onCommit={(v) => upd(n.id, { radius: v }, "Corner radius")} />
      )}
      {n.type === "shape" && (n.shape === "polygon" || n.shape === "star") && (
        <NumField label="#" title={n.shape === "star" ? "Points" : "Sides"} value={n.sides} min={3} max={64} precision={0} onCommit={(v) => upd(n.id, { sides: Math.round(v) }, "Sides")} />
      )}
      {n.type === "shape" && n.shape === "star" && (
        <NumField label="◎" title="Inner ratio" value={n.innerRatio * 100} min={5} max={100} suffix="%" precision={0} onCommit={(v) => upd(n.id, { innerRatio: v / 100 }, "Star ratio")} />
      )}
    </div>
  );
}

function TextSection({ n }: { n: Extract<NodeT, { type: "text" }> }) {
  return (
    <Section
      title="Type"
      right={
        <button className="btn small ghost" onClick={() => void makeLettering(n.id)} title="Split the word into one editable shape per letter (one undo step)">
          Make lettering
        </button>
      }
    >
      <CommitInput value={n.text} onCommit={(v) => v && upd(n.id, { text: v }, "Edit text")} />
      <select className="select" value={FONT_FAMILIES.includes(n.fontFamily) ? n.fontFamily : "__custom"} onChange={(e) => e.target.value !== "__custom" && upd(n.id, { fontFamily: e.target.value }, "Font")}>
        {FONT_FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        {!FONT_FAMILIES.includes(n.fontFamily) && <option value="__custom">{n.fontFamily}</option>}
      </select>
      <div className="grid2">
        <select className="select" value={n.fontWeight} onChange={(e) => upd(n.id, { fontWeight: Number(e.target.value) }, "Weight")}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <NumField label="Aa" value={n.fontSize} min={1} onCommit={(v) => upd(n.id, { fontSize: v }, "Font size")} />
        <NumField label="⇔" title="Letter spacing" value={n.letterSpacing} step={0.5} onCommit={(v) => upd(n.id, { letterSpacing: v }, "Letter spacing")} />
        <div className="seg-group">
          {(["start", "middle", "end"] as const).map((a) => (
            <button key={a} className={`seg${n.anchor === a ? " on" : ""}`} onClick={() => upd(n.id, { anchor: a }, "Text anchor")}>
              {a === "start" ? Icons.alignLeft : a === "middle" ? Icons.alignHCenter : Icons.alignRight}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function StyleSections({ n }: { n: NodeT }) {
  const s = n.style;
  const setStyle = (patch: Record<string, unknown>, label: string) => upd(n.id, { style: patch }, label);
  return (
    <>
      <Section title="Fill">
        <PaintEditor paint={s.fill} onChange={(p: PaintT) => setStyle({ fill: p }, "Fill")} />
      </Section>
      <Section title="Stroke">
        <PaintEditor paint={s.stroke} onChange={(p: PaintT) => setStyle({ stroke: p, strokeWidth: p && !s.strokeWidth ? 8 : s.strokeWidth }, "Stroke")} />
        {s.stroke !== null && (
          <div className="grid2">
            <NumField label="W" value={s.strokeWidth} min={0} step={0.5} onCommit={(v) => setStyle({ strokeWidth: v }, "Stroke width")} />
            <select className="select" value={s.strokeLinecap} onChange={(e) => setStyle({ strokeLinecap: e.target.value }, "Line cap")}>
              <option value="round">Round cap</option>
              <option value="butt">Butt cap</option>
              <option value="square">Square cap</option>
            </select>
          </div>
        )}
      </Section>
      <Section title="Opacity">
        <div className="slider-row">
          <input type="range" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(e) => setStyle({ opacity: Number(e.target.value) / 100 }, "Opacity")} />
          <span className="num">{Math.round(s.opacity * 100)}%</span>
        </div>
      </Section>
    </>
  );
}

/** Bend/Twist a whole shape about a pivot — one gesture instead of moving nodes one by one. */
function DeformSection({ n }: { n: NodeT }) {
  const [pivot, setPivot] = useState<PivotKind>("bottom");
  const [vals, setVals] = useState({ bend: 0, twist: 0 });
  const base = useRef<{ id: string; d: string } | null>(null);
  const begin = () => {
    if (base.current) return true;
    if (n.type !== "path" && !convertToPath(n.id)) return false;
    const cur = useStore.getState().doc?.nodes[n.id];
    if (cur?.type !== "path") return false;
    base.current = { id: n.id, d: cur.d };
    return true;
  };
  const change = (kind: "bend" | "twist", v: number) => {
    if (!begin()) return;
    setVals((s) => ({ ...s, [kind]: v }));
    previewDeform(base.current!.id, base.current!.d, kind, v, pivot);
  };
  const end = (kind: "bend" | "twist") => {
    const b = base.current;
    base.current = null;
    if (b) commitDeform(b.id, b.d, kind, vals[kind], pivot);
    setVals({ bend: 0, twist: 0 });
  };
  const row = (kind: "bend" | "twist", label: string, title: string) => (
    <div className="deform-row" title={title}>
      <span className="label">{label}</span>
      <input
        type="range"
        min={-180}
        max={180}
        value={vals[kind]}
        onChange={(e) => change(kind, Number(e.target.value))}
        onPointerUp={() => end(kind)}
        onKeyUp={() => end(kind)}
      />
      <span className="num">{vals[kind]}°</span>
    </div>
  );
  return (
    <Section title="Deform">
      {row("bend", "Bend", "Curl the shape — the far end bends the most (like a leaf tip)")}
      {row("twist", "Twist", "Rotate progressively from the pivot outwards")}
      <div className="paint-row">
        <span className="label">Pivot</span>
        <select className="select" value={pivot} onChange={(e) => setPivot(e.target.value as PivotKind)}>
          <option value="bottom">Bottom edge</option>
          <option value="top">Top edge</option>
          <option value="left">Left edge</option>
          <option value="right">Right edge</option>
          <option value="center">Center</option>
        </select>
      </div>
      <p className="muted">Drag a slider and release to apply (one undo step). Positive = clockwise. Shapes and text become editable paths.</p>
    </Section>
  );
}

function DepthSection({ doc, n }: { doc: DocT; n: NodeT }) {
  const e = n.extrude;
  const sc = doc.scene;
  return (
    <Section
      title="3D"
      right={
        <label className="check mini">
          <input type="checkbox" checked={!!e} onChange={(ev) => upd(n.id, { extrude: ev.target.checked ? { depth: sc.depth, bevel: sc.bevel, material: "auto" } : null }, "3D override")} />
          Custom
        </label>
      }
    >
      {!e ? (
        <p className="muted">Uses the scene look ({sc.material}, depth {sc.depth}). Tick Custom to give this part its own depth or material.</p>
      ) : (
        <div className="grid2">
          <NumField label="D" title="Depth" value={e.depth} min={0} onCommit={(v) => upd(n.id, { extrude: { depth: v } }, "Depth")} />
          <NumField label="B" title="Bevel" value={e.bevel} min={0} step={0.5} onCommit={(v) => upd(n.id, { extrude: { bevel: v } }, "Bevel")} />
          <NumField label="Z" title="Depth offset (layers parts front/back)" value={e.z} onCommit={(v) => upd(n.id, { extrude: { z: v } }, "Depth offset")} />
          <select className="select" value={e.material} onChange={(ev) => upd(n.id, { extrude: { material: ev.target.value } }, "Material")}>
            <option value="auto">Scene material</option>
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </Section>
  );
}

function SketchSection({ n }: { n: Extract<NodeT, { type: "sketch" }> }) {
  return (
    <Section title="Sketch">
      <p className="muted">
        {n.strokes.length} stroke{n.strokes.length === 1 ? "" : "s"}. Sketches are never exported — ask your AI to turn this into a clean logo.
      </p>
      <div className="slider-row">
        <span className="label">Opacity</span>
        <input type="range" min={5} max={100} value={Math.round(n.style.opacity * 100)} onChange={(e) => upd(n.id, { style: { opacity: Number(e.target.value) / 100 } }, "Sketch opacity")} />
      </div>
      <button className="btn small" onClick={() => upd(n.id, { strokes: n.strokes.slice(0, -1) }, "Undo stroke")} disabled={!n.strokes.length}>
        Remove last stroke
      </button>
    </Section>
  );
}

function ReferenceSection({ n }: { n: Extract<NodeT, { type: "reference" }> }) {
  return (
    <Section title="Reference image">
      <p className="muted">For tracing only — never exported.</p>
      <ReferenceRole n={n} />
      <div className="slider-row">
        <span className="label">Opacity</span>
        <input type="range" min={5} max={100} value={Math.round(n.style.opacity * 100)} onChange={(e) => upd(n.id, { style: { opacity: Number(e.target.value) / 100 } }, "Reference opacity")} />
        <span className="num">{Math.round(n.style.opacity * 100)}%</span>
      </div>
      <label className="check">
        <input type="checkbox" checked={n.locked} onChange={(e) => upd(n.id, { locked: e.target.checked }, e.target.checked ? "Lock" : "Unlock")} />
        Lock so I can draw over it
      </label>
      <button className="btn small vz-open" onClick={() => openVectorize(n.id)} title="Trace this image into editable vector paths, offline">
        {Icons.path} Vectorize…
      </button>
    </Section>
  );
}


/* ---------- always visible: versions, the version / layer basics ---------- */

function VersionsSection({ doc }: { doc: DocT }) {
  const active = useStore((s) => s.activeFrame);
  const frames = listFrames(doc);
  const current = activeFrameId(doc);
  void active;
  return (
    <Section title={`Versions · ${frames.length}`} id="versions" right={<ExploreEntry />}>
      <div className={`versions${frames.length > 6 ? " many" : ""}`}>
        {frames.map((f) => (
          <button
            key={f.id}
            className={`version${f.id === current ? " on" : ""}`}
            onClick={() => {
              setActiveFrame(f.id);
              animateCamera(fitFrame(doc, f.id));
            }}
            onDoubleClick={() => select([f.id])}
            title="Click to focus · double-click to select · ⌘D on a selected version branches a variant"
          >
            <span>{f.name}</span>
            <span className="dim">
              {f.children.length} layer{f.children.length === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

/** One version: name, artboard size, background, copy, duplicate, delete. */
function VersionCard({ doc, f }: { doc: DocT; f: FrameNodeT }) {
  const set = (patch: Record<string, unknown>, label: string) => upd(f.id, patch, label);
  const many = listFrames(doc).length > 1;
  return (
    <Section
      title={`Version · ${f.name}`}
      id="version"
      collapsible={false}
      className="dg-basics"
      right={
        <span className="dg-head-actions">
          <button
            className="btn small ghost"
            onClick={() => {
              select([f.id]);
              duplicateSelection();
            }}
            title="Duplicate this whole version (⌘D) to try a variant"
          >
            {Icons.copy} Duplicate
          </button>
          {many && (
            <button
              className="icon-btn small dg-delete"
              onClick={() => {
                dispatch([{ op: "remove", id: f.id }], `Delete ${f.name}`);
                select([]);
              }}
              aria-label={`Delete ${f.name}`}
              title={`Delete ${f.name} (undo with ⌘Z)`}
            >
              {Icons.trash}
            </button>
          )}
        </span>
      }
    >
      <CommitInput value={f.name} placeholder="Version name" onCommit={(v) => v && set({ name: v }, "Rename version")} />
      <div className="grid2">
        <NumField label="W" value={f.width} min={16} max={8192} precision={0} onCommit={(v) => set({ width: Math.round(v) }, "Artboard size")} />
        <NumField label="H" value={f.height} min={16} max={8192} precision={0} onCommit={(v) => set({ height: Math.round(v) }, "Artboard size")} />
      </div>
      <div className="paint-row">
        <label className="check">
          <input type="checkbox" checked={f.background === null} onChange={(e) => set({ background: e.target.checked ? null : "#ffffff" }, "Background")} />
          Transparent
        </label>
        {f.background !== null && <ColorSwatch color={f.background} onChange={(c) => set({ background: c }, "Background")} />}
      </div>
      <CopyAsButtons />
    </Section>
  );
}

/** One layer: name, position and size, alignment, AI lock. */
function LayerCard({ doc, n }: { doc: DocT; n: NodeT }) {
  return (
    <Section
      title={n.type === "shape" ? n.shape : n.type}
      id="layer"
      collapsible={false}
      className="dg-basics"
      right={
        (n.type === "shape" || n.type === "text") && (
          <button className="btn small ghost" onClick={() => convertToPath(n.id)} title="Turn into an editable path (node editing)">
            To path
          </button>
        )
      }
    >
      <CommitInput value={n.name} placeholder="Layer name" onCommit={(v) => upd(n.id, { name: v }, "Rename")} />
      {n.type !== "sketch" && <TransformFields doc={doc} n={n} />}
      <AlignRow />
      <AiLockCheck doc={doc} n={n} />
    </Section>
  );
}

function MultiCard({ doc, ids }: { doc: DocT; ids: string[] }) {
  const b = selectionBox(doc, ids)!;
  return (
    <Section title={`${ids.length} layers`} id="layers" collapsible={false} className="dg-basics">
      <AlignRow />
      <div className="grid2">
        <NumField label="X" value={b.x} onCommit={(v) => dispatch(ids.map((id) => ({ op: "update", id, set: movePatch(doc, doc.nodes[id]!, v - b.x, 0) }) as OpT), "Move")} />
        <NumField label="Y" value={b.y} onCommit={(v) => dispatch(ids.map((id) => ({ op: "update", id, set: movePatch(doc, doc.nodes[id]!, 0, v - b.y) }) as OpT), "Move")} />
      </div>
    </Section>
  );
}

/* ---------- Design group ---------- */

const partLabel = (n: NodeT) => n.name || (n.type === "text" ? `“${n.text}”` : n.type === "shape" ? n.shape : n.type);

/** Whole version selected: its parts, one click away from their design controls. */
function PartsSection({ doc, f }: { doc: DocT; f: FrameNodeT }) {
  const kids = [...f.children].reverse().filter((id) => doc.nodes[id]);
  return (
    <Section title="Parts">
      {kids.length ? (
        <div className="dg-parts">
          {kids.map((id) => {
            const n = doc.nodes[id]!;
            return (
              <button key={id} className={`dg-part${n.visible ? "" : " hidden"}`} onClick={() => select([id])} title="Select to edit its shape, type, color and effects">
                <span className="dg-part-name">{partLabel(n)}</span>
                <span className="dim">{n.type === "shape" ? n.shape : n.type}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">This version is empty. Draw on the artboard, or ask your AI.</p>
      )}
      {kids.length > 0 && <p className="muted">Select a part to edit its shape, type, color, warp and effects.</p>}
    </Section>
  );
}

function NodeDesign({ doc, n }: { doc: DocT; n: NodeT }) {
  const geometric = n.type === "path" || n.type === "shape" || n.type === "text";
  const shaped = geometric || n.type === "group";
  return (
    <>
      {n.type === "text" && <TextSection n={n} />}
      {n.type === "text" && <TypeControls doc={doc} n={n} />}
      {(n.type === "text" || n.type === "group") && <LetteringSection doc={doc} n={n} />}
      {(n.type === "group" || n.type === "path" || n.type === "shape") && <LetterControls doc={doc} n={n} />}
      {geometric && <StyleSections n={n} />}
      {n.type === "group" && (
        <Section title="Opacity">
          <div className="slider-row">
            <input type="range" min={0} max={100} value={Math.round(n.style.opacity * 100)} onChange={(e) => upd(n.id, { style: { opacity: Number(e.target.value) / 100 } }, "Opacity")} />
            <span className="num">{Math.round(n.style.opacity * 100)}%</span>
          </div>
        </Section>
      )}
      {shaped && <WarpSection doc={doc} ids={[n.id]} />}
      {shaped && <EffectsSection doc={doc} ids={[n.id]} />}
      {shaped && <RepeatSection doc={doc} ids={[n.id]} />}
      {geometric && <DeformSection n={n} />}
      {n.type === "sketch" && <SketchSection n={n} />}
      {n.type === "reference" && <ReferenceSection n={n} />}
      {shaped && <DepthSection doc={doc} n={n} />}
    </>
  );
}

function MultiDesign({ doc, ids }: { doc: DocT; ids: string[] }) {
  const fills = new Set(ids.map((id) => JSON.stringify(doc.nodes[id]!.style.fill)));
  const firstFill = doc.nodes[ids[0]!]!.style.fill;
  return (
    <>
      <Section title="Fill">
        {fills.size > 1 && <p className="muted">Mixed — setting a fill applies to all.</p>}
        <PaintEditor paint={fills.size === 1 ? firstFill : null} onChange={(p) => dispatch(ids.map((id) => ({ op: "update", id, set: { style: { fill: p } } }) as OpT), "Fill")} />
      </Section>
      <WarpSection doc={doc} ids={ids} />
      <EffectsSection doc={doc} ids={ids} />
      <RepeatSection doc={doc} ids={ids} />
    </>
  );
}

/* ---------- Brand / Motion / Review groups (always about a version) ---------- */

function MockupsSection() {
  return (
    <Section
      title="Mockups"
      right={
        <button className="btn small ghost" onClick={openMockups} title="See the logo on cards, signs, app icons and merch">
          Open…
        </button>
      }
    >
      <p className="muted">The logo in use — cards, signage, app icons, merch — rendered from this version.</p>
    </Section>
  );
}

function BrandGroup({ doc, f, ids }: { doc: DocT; f: FrameNodeT; ids: string[] }) {
  return (
    <>
      {ids.length > 1 && selectionMakesLockup(doc, ids) ? <LockupForSelection doc={doc} ids={ids} /> : <LockupSection doc={doc} f={f} />}
      <PaletteSection doc={doc} />
      <StyleSeries doc={doc} f={f} />
      <MockupsSection />
    </>
  );
}

function ReviewGroup({ doc, f }: { doc: DocT; f: FrameNodeT }) {
  const pending = Object.values(doc.annotations).filter((a) => a.status === "pending").length;
  return (
    <>
      <Section title="Review">
        <VersionReview doc={doc} f={f} />
        <p className="muted">A designer's read on small sizes, balance, contrast and spacing — or before / after with another version.</p>
      </Section>
      <SmallSizesSection />
      <Section title="Your AI">
        <AiLockCheck doc={doc} n={f} />
        {pending > 0 && (
          <p className="muted accent">
            {pending} note{pending === 1 ? "" : "s"} waiting for your AI. Tell it “check my notes”.
          </p>
        )}
        <p className="muted">
          Ask your AI (Claude Code, Cursor…) to design here. Drop brand guidelines, palettes or old logos into <code>brusshy/brand/</code> — it reads them first.
        </p>
      </Section>
    </>
  );
}

/* ---------- the Design tab ---------- */

export function Properties() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  useStore((s) => s.activeFrame); // re-render when another version becomes active
  const ctx: DesignContext = doc ? designContext(doc, selection) : "version";
  const group = useDesignUi((s) => s.group[ctx]);
  const sentinel = useRef<HTMLDivElement>(null);

  // Switching groups while the bar is stuck at the top: start the new group right under it,
  // and give the panel enough height that a shorter group can't make the scroll snap back.
  const panel = useRef<HTMLDivElement>(null);
  const lastScroll = useRef(0);
  const hasDoc = !!doc; // the panel (and its scroll box) only mounts once a document is open
  useEffect(() => {
    const box = sentinel.current?.closest(".side-body");
    if (!box) return;
    const on = () => (lastScroll.current = box.scrollTop);
    box.addEventListener("scroll", on, { passive: true });
    return () => box.removeEventListener("scroll", on);
  }, [hasDoc]);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) return void (first.current = false);
    const s = sentinel.current;
    const p = panel.current;
    const box = s?.closest(".side-body");
    if (!s || !p || !box) return;
    const top = s.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (lastScroll.current > 0 && lastScroll.current >= top - 1) {
      const bar = s.nextElementSibling as HTMLElement | null;
      p.style.minHeight = `${box.clientHeight - (bar?.offsetHeight ?? 0)}px`;
      box.scrollTop = top;
    } else p.style.minHeight = "";
    lastScroll.current = box.scrollTop;
  }, [group]);

  if (!doc) return null;
  const ids = topSelection(doc, selection);
  const n = ctx === "node" ? doc.nodes[ids[0]!]! : null;
  const picked = ids.length === 1 && doc.nodes[ids[0]!]?.type === "frame" ? (doc.nodes[ids[0]!] as FrameNodeT) : null;
  const fid = picked?.id ?? (ids.length ? frameOf(doc, ids[0])?.id : null) ?? activeFrameId(doc);
  const f = fid ? ((doc.nodes[fid] as FrameNodeT | undefined) ?? null) : null;
  const pending = Object.values(doc.annotations).some((a) => a.status === "pending");

  return (
    <>
      {ctx === "version" && <VersionsSection doc={doc} />}
      {ctx === "version" && f && <VersionCard doc={doc} f={f} />}
      {n && <LayerCard doc={doc} n={n} />}
      {ctx === "multi" && <MultiCard doc={doc} ids={ids} />}
      <div ref={sentinel} className="dg-sentinel" aria-hidden />
      <GroupBar ctx={ctx} value={group} dots={{ ...(f?.animation ? { motion: "on" as const } : {}), ...(pending ? { review: "accent" as const } : {}) }} />
      <div ref={panel} className="dg-panel" role="tabpanel" id={GROUP_PANEL_ID} aria-labelledby={groupTabId(group)}>
        {ctx !== "version" && group !== "design" && f && <GroupScope f={f} group={group} />}
        {group === "design" && (n ? <NodeDesign doc={doc} n={n} /> : ctx === "multi" ? <MultiDesign doc={doc} ids={ids} /> : f && <PartsSection doc={doc} f={f} />)}
        {group === "brand" && f && <BrandGroup doc={doc} f={f} ids={ids} />}
        {group === "motion" && f && <AnimationSection doc={doc} f={f} />}
        {group === "review" && f && <ReviewGroup doc={doc} f={f} />}
        {!f && group !== "design" && <p className="muted dg-empty">Add a version to use this.</p>}
      </div>
    </>
  );
}
