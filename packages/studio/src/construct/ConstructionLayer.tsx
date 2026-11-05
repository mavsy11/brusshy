import { useEffect, useMemo, useRef, useState } from "react";
import {
  constructionSnapPoints,
  faceAt,
  guideAt,
  listFrames,
  moveGuide,
  newId,
  polyPath,
  snapRadius,
  snapToConstruction,
  windingAt,
  type ConstructionT,
  type DocT,
  type Face,
  type FrameNodeT,
  type GuideT,
  type P,
  type SnapPoint,
} from "@brusshy/core";
import { activeFrameId, select, setActiveFrame, useStore } from "../lib/store";
import { toScreen, toWorld } from "../canvas/camera";
import { addGuide, arrangementFor, deleteGuide, fillColor, fillFaces, replaceGuide, subtractAt } from "./actions";
import { toggleConstruction, useConstruct } from "./state";
import { ConstructBar } from "./ConstructBar";
import "./commands";
import "./construct.css";

type Gesture =
  | { kind: "fill"; frame: string; faces: Face[]; start: P; last?: P; moved: boolean; shift: boolean }
  | { kind: "circle"; frame: string; c: P; r: number; snapped: string | null }
  | { kind: "line"; frame: string; a: P; b: P }
  | { kind: "move"; frame: string; guide: GuideT; start: P; moved: GuideT | null };

const snapCache = new WeakMap<ConstructionT, SnapPoint[]>();
const snapsOf = (c: ConstructionT | null | undefined) => {
  if (!c) return [];
  let s = snapCache.get(c);
  if (!s) snapCache.set(c, (s = constructionSnapPoints(c)));
  return s;
};

const SNAP_LABEL: Record<string, string> = { centre: "centre", intersection: "intersection", tangent: "tangent point", end: "end point", on: "on guide", through: "through point" };

function GuideShape({ g, cls }: { g: GuideT; cls: string }) {
  if (g.kind === "circle") return <circle cx={g.cx} cy={g.cy} r={g.r} className={cls} />;
  if (g.kind === "line") return <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className={cls} />;
  return <polygon points={g.points.map((q) => q.join(",")).join(" ")} className={cls} />;
}

/**
 * Construction layer on the 2D canvas (thin vermilion guides, never exported) and the
 * shape builder tool: hover a region to see it, click to fill it, drag to merge several,
 * ⌥-click to cut it out of a shape; circle/line modes draw guides with snapping.
 */
export function ConstructionLayer() {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const visible = useConstruct((s) => s.visible);
  const mode = useConstruct((s) => s.mode);
  const selGuide = useConstruct((s) => s.guide);
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);
  const [hover, setHover] = useState<{ frame: string; face: Face } | null>(null);
  const [hoverGuide, setHoverGuide] = useState<{ frame: string; id: string } | null>(null);
  const [snap, setSnap] = useState<{ p: P; kind: string } | null>(null);
  const [draft, setDraft] = useState<Gesture | null>(null);
  const lastRegion = useRef<string | null>(null);
  const builder = tool === "builder";

  // ⇧G shows/hides the construction; Delete removes the selected guide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyG") {
        e.preventDefault();
        toggleConstruction();
        return;
      }
      const sel = useConstruct.getState().guide;
      if (useStore.getState().tool !== "builder") return;
      if (sel && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        deleteGuide(sel.frame, sel.id);
      }
      if (e.key === "Escape") {
        g.current = null;
        setDraft(null);
        useConstruct.setState({ guide: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Leaving the tool clears transient state.
  useEffect(() => {
    if (!builder) {
      setHover(null);
      setSnap(null);
      setDraft(null);
      g.current = null;
      lastRegion.current = null;
    }
  }, [builder]);

  const frames = useMemo(() => (doc ? listFrames(doc) : []), [doc]);
  if (!doc) return null;
  const z = camera.zoom;
  const show = visible || builder;

  const local = (e: { clientX: number; clientY: number }): P => {
    const r = ref.current!.getBoundingClientRect();
    return toWorld(camera, e.clientX - r.left, e.clientY - r.top);
  };
  const frameAt = (w: P): FrameNodeT | null => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]!;
      if (w[0] >= f.transform.x && w[0] <= f.transform.x + f.width && w[1] >= f.transform.y && w[1] <= f.transform.y + f.height) return f;
    }
    const id = activeFrameId(doc);
    return id ? (doc.nodes[id] as FrameNodeT) : null;
  };
  const toF = (f: FrameNodeT, w: P): P => [w[0] - f.transform.x, w[1] - f.transform.y];
  const cur = (d: DocT, id: string) => d.nodes[id] as FrameNodeT;

  const snapPoint = (f: FrameNodeT, q: P, exclude?: string): { p: P; kind: string } | null => {
    const c = f.construction;
    if (!c) return null;
    const cc = exclude ? { ...c, guides: c.guides.filter((x) => x.id !== exclude) } : c;
    return snapToConstruction(cc, q, 9 / z, exclude ? constructionSnapPoints(cc) : snapsOf(c));
  };

  const updateHover = (f: FrameNodeT, q: P) => {
    if (hover && hover.frame === f.id && windingAt(hover.face.paths, q) !== 0) return hover;
    const face = faceAt(arrangementFor(useStore.getState().doc!, f.id), q);
    const h = face ? { frame: f.id, face } : null;
    setHover(h);
    return h;
  };

  const onDown = (e: React.PointerEvent) => {
    // Space / middle button pans: let the canvas handle it.
    if (e.button === 1 || document.documentElement.dataset.space) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    ref.current?.setPointerCapture(e.pointerId);
    const w = local(e);
    const f = frameAt(w);
    if (!f) return;
    setActiveFrame(f.id);
    const q = toF(f, w);
    if (mode === "fill") {
      if (e.altKey) return subtractAt(f.id, q);
      const h = updateHover(f, q);
      g.current = { kind: "fill", frame: f.id, faces: h ? [h.face] : [], start: q, moved: false, shift: e.shiftKey };
      setDraft(g.current);
      return;
    }
    // Circle / line modes: draw from a construction point (centre, intersection…), else grab the
    // guide under the pointer, else draw from where the pointer is.
    const special = snapPoint(f, q);
    const hit = special && special.kind !== "on" ? null : guideAt(f.construction, q, 6 / z);
    if (hit) {
      useConstruct.setState({ guide: { frame: f.id, id: hit.id } });
      select([]);
      g.current = { kind: "move", frame: f.id, guide: hit, start: q, moved: null };
      return;
    }
    useConstruct.setState({ guide: null });
    const p = special && special.kind !== "on" ? special.p : q;
    g.current = mode === "circle" ? { kind: "circle", frame: f.id, c: p, r: 0, snapped: null } : { kind: "line", frame: f.id, a: p, b: p };
    setDraft(g.current);
  };

  const onMove = (e: React.PointerEvent) => {
    if (document.documentElement.dataset.space && !g.current) return;
    const w = local(e);
    const ges = g.current;
    const d = useStore.getState().doc!;
    if (!ges) {
      const f = frameAt(w);
      if (!f) return;
      const q = toF(f, w);
      if (mode === "fill") {
        updateHover(f, q);
        setSnap(null);
      } else {
        const sp = snapPoint(f, q);
        const special = sp && sp.kind !== "on" ? sp : null;
        const hit = special ? null : guideAt(f.construction, q, 6 / z);
        setHoverGuide(hit ? { frame: f.id, id: hit.id } : null);
        const s = special;
        setSnap(s ? { p: [s.p[0] + f.transform.x, s.p[1] + f.transform.y], kind: s.kind } : null);
      }
      return;
    }
    const f = cur(d, ges.frame);
    const q = toF(f, w);
    switch (ges.kind) {
      case "fill": {
        if (!ges.moved && Math.hypot(q[0] - ges.start[0], q[1] - ges.start[1]) * z < 4) return;
        ges.moved = true;
        // Sample the path since the last event (fast drags skip over small regions otherwise).
        const from = ges.last ?? ges.start;
        const steps = Math.min(64, Math.max(1, Math.ceil((Math.hypot(q[0] - from[0], q[1] - from[1]) * z) / 6)));
        const arr = arrangementFor(d, f.id);
        let added: Face | null = null;
        for (let i = 1; i <= steps; i++) {
          const p: P = [from[0] + ((q[0] - from[0]) * i) / steps, from[1] + ((q[1] - from[1]) * i) / steps];
          if (ges.faces.some((fc) => windingAt(fc.paths, p) !== 0)) continue;
          const face = faceAt(arr, p);
          if (face) {
            ges.faces = [...ges.faces, face];
            added = face;
          }
        }
        ges.last = q;
        if (added) {
          setDraft({ ...ges });
          setHover({ frame: f.id, face: added });
        }
        return;
      }
      case "circle": {
        let r = Math.hypot(q[0] - ges.c[0], q[1] - ges.c[1]);
        let kind: string | null = null;
        const s = snapRadius(f.construction, ges.c, r, 8 / z, snapsOf(f.construction));
        if (s && !e.altKey) {
          r = s.r;
          kind = s.kind;
        } else if (!e.altKey) {
          // Round to whole units (half units when zoomed in).
          const step = z > 4 ? 0.5 : 1;
          r = Math.round(r / step) * step;
        }
        ges.r = r;
        ges.snapped = kind;
        setDraft({ ...ges });
        return;
      }
      case "line": {
        let b = q;
        if (e.shiftKey) {
          const a = Math.atan2(q[1] - ges.a[1], q[0] - ges.a[0]);
          const step = Math.PI / 12;
          const ang = Math.round(a / step) * step;
          const L = Math.hypot(q[0] - ges.a[0], q[1] - ges.a[1]);
          b = [ges.a[0] + Math.cos(ang) * L, ges.a[1] + Math.sin(ang) * L];
        } else if (!e.altKey) b = snapPoint(f, q)?.p ?? q;
        ges.b = b;
        setDraft({ ...ges });
        return;
      }
      case "move": {
        let dx = q[0] - ges.start[0];
        let dy = q[1] - ges.start[1];
        if (!ges.moved && Math.hypot(dx, dy) * z < 3) return;
        const anchor: P = ges.guide.kind === "circle" ? [ges.guide.cx, ges.guide.cy] : ges.guide.kind === "line" ? [ges.guide.x1, ges.guide.y1] : (ges.guide.points[0] as P);
        if (!e.altKey) {
          const s = snapPoint(f, [anchor[0] + dx, anchor[1] + dy], ges.guide.id);
          if (s) {
            dx = s.p[0] - anchor[0];
            dy = s.p[1] - anchor[1];
          }
        }
        ges.moved = moveGuide(ges.guide, dx, dy);
        setDraft({ ...ges });
        return;
      }
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const ges = g.current;
    g.current = null;
    setDraft(null);
    if (!ges) return;
    e.stopPropagation();
    switch (ges.kind) {
      case "fill": {
        if (!ges.faces.length) return;
        const into = !ges.moved && ges.shift ? lastRegion.current : null;
        const id = fillFaces(ges.frame, ges.faces, into);
        if (id) lastRegion.current = id;
        return;
      }
      case "circle":
        if (ges.r * z > 4) {
          const id = newId("g");
          addGuide(ges.frame, { id, kind: "circle", cx: Math.round(ges.c[0] * 100) / 100, cy: Math.round(ges.c[1] * 100) / 100, r: Math.round(ges.r * 100) / 100, role: "key" }, "Add guide circle");
          useConstruct.setState({ guide: { frame: ges.frame, id } });
        }
        return;
      case "line":
        if (Math.hypot(ges.b[0] - ges.a[0], ges.b[1] - ges.a[1]) * z > 4) {
          const id = newId("g");
          const r2 = (n: number) => Math.round(n * 100) / 100;
          addGuide(ges.frame, { id, kind: "line", x1: r2(ges.a[0]), y1: r2(ges.a[1]), x2: r2(ges.b[0]), y2: r2(ges.b[1]), role: "key" }, "Add guide line");
          useConstruct.setState({ guide: { frame: ges.frame, id } });
        }
        return;
      case "move":
        if (ges.moved) replaceGuide(ges.frame, ges.moved, "Move guide");
        return;
    }
  };

  const sx = (p: P) => toScreen(camera, p[0], p[1]);
  const color = builder ? fillColor(doc) : "#000";
  const movingId = draft?.kind === "move" && draft.moved ? draft.guide.id : null;

  return (
    <>
      {show && (
        <svg className={`construct-layer${builder ? " active" : ""}`} width="100%" height="100%" aria-hidden>
          <g transform={`translate(${camera.x} ${camera.y}) scale(${z})`}>
            {frames.map((f) => {
              const c = f.construction;
              const faceHere = hover && hover.frame === f.id && builder && mode === "fill" ? hover.face : null;
              const sweep = draft?.kind === "fill" && draft.frame === f.id ? draft.faces : [];
              return (
                <g key={f.id} transform={`translate(${f.transform.x} ${f.transform.y})`}>
                  {sweep.length > 1 && <path d={sweep.map((x) => polyPath(x.paths)).join("")} className="cs-sweep" style={{ fill: color }} />}
                  {faceHere && !sweep.length && <path d={polyPath(faceHere.paths)} className="cs-face" style={{ fill: color }} />}
                  {c?.guides.map((x) => {
                    if (x.id === movingId) return null;
                    const sel = selGuide?.frame === f.id && selGuide.id === x.id;
                    const hov = hoverGuide?.frame === f.id && hoverGuide.id === x.id && builder && mode !== "fill";
                    return <GuideShape key={x.id} g={x} cls={`cs-guide role-${x.role}${sel ? " sel" : ""}${hov ? " hov" : ""}`} />;
                  })}
                  {c?.guides.map((x) =>
                    x.kind === "circle" && x.role !== "radial" ? (
                      <path key={`c${x.id}`} d={`M${x.cx - 3 / z} ${x.cy}H${x.cx + 3 / z}M${x.cx} ${x.cy - 3 / z}V${x.cy + 3 / z}`} className="cs-centre" />
                    ) : null,
                  )}
                  {draft?.kind === "move" && draft.frame === f.id && draft.moved && <GuideShape g={draft.moved} cls="cs-guide sel" />}
                  {draft?.kind === "circle" && draft.frame === f.id && draft.r > 0 && (
                    <>
                      <circle cx={draft.c[0]} cy={draft.c[1]} r={draft.r} className="cs-guide draft" />
                      <line x1={draft.c[0]} y1={draft.c[1]} x2={draft.c[0] + draft.r} y2={draft.c[1]} className="cs-guide draft dim" />
                    </>
                  )}
                  {draft?.kind === "line" && draft.frame === f.id && <line x1={draft.a[0]} y1={draft.a[1]} x2={draft.b[0]} y2={draft.b[1]} className="cs-guide draft" />}
                </g>
              );
            })}
          </g>
          {/* screen-space readouts */}
          {snap && builder && mode !== "fill" && !draft && (
            <g transform={`translate(${sx(snap.p)[0]} ${sx(snap.p)[1]})`}>
              <rect x={-4.5} y={-4.5} width={9} height={9} className="cs-snap" transform="rotate(45)" />
              <text x={10} y={-8} className="cs-snap-label">
                {SNAP_LABEL[snap.kind] ?? snap.kind}
              </text>
            </g>
          )}
          {draft?.kind === "circle" && draft.r > 0 && (() => {
            const f = doc.nodes[draft.frame] as FrameNodeT;
            const [x, y] = sx([draft.c[0] + f.transform.x + draft.r / 2, draft.c[1] + f.transform.y]);
            return (
              <text x={x} y={y - 8} className="cs-readout" textAnchor="middle">
                r = {Math.round(draft.r * 100) / 100}
                {draft.snapped ? ` · ${SNAP_LABEL[draft.snapped]}` : ""}
              </text>
            );
          })()}
          {draft?.kind === "line" && (() => {
            const f = doc.nodes[draft.frame] as FrameNodeT;
            const [x, y] = sx([draft.b[0] + f.transform.x, draft.b[1] + f.transform.y]);
            const L = Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]);
            const ang = (Math.atan2(draft.a[1] - draft.b[1], draft.b[0] - draft.a[0]) * 180) / Math.PI;
            return (
              <text x={x + 12} y={y - 10} className="cs-readout">
                {Math.round(L * 10) / 10} · {Math.round(ang * 10) / 10}°
              </text>
            );
          })()}
        </svg>
      )}
      {builder && (
        <div
          ref={ref}
          className={`construct-capture mode-${mode}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => {
            if (!g.current) {
              setHover(null);
              setSnap(null);
            }
          }}
        />
      )}
      {builder && <ConstructBar />}
    </>
  );
}
