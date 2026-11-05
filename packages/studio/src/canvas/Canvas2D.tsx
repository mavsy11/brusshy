import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueWithVariantOps, listFrames, newId, type DocT, type FrameNodeT, type NodeT, type OpT, type SketchStrokeT } from "@brusshy/core";
import { activeFrameId, clearLive, dispatch, select, setActiveFrame, setLive, setTool, toast, useStore } from "../lib/store";
import { localBBox, selectionBox, worldBox, worldQuad, type Box, type Pt } from "../lib/geom";
import { movePatch, resizePatch, rotateAboutPatch, rotatePatch, scaleAboutPatch, worldCenter, type ResizeHandle } from "../lib/transform";
import { addReferenceImage, convertToPath, importSvgText, topSelection, worldToLocal } from "../lib/actions";
import { fitCamera, fitFrame, gridStep, setSplitSafe, setViewport, toScreen, toWorld, zoomAt } from "./camera";
import { animateCamera } from "./cameraAnim";
import { SceneNodes, freehandPath } from "./Scene";
import { snapBox, snapLines, type Guide } from "./snap";
import { Rulers } from "./Rulers";
import { AnnotationLayer, type DraftNote } from "./Annotations";
import { PathEditor } from "./PathEditor";
import { TextEditor } from "./TextEditor";
import { FrameEmpty } from "../panels/Help";
import { Welcome, WELCOME_SIZE } from "../panels/Welcome";
import { QuickBar } from "./QuickBar";
import { AiLockBadges } from "./AiLockBadges";
import { WarpEnvelope } from "./WarpEnvelope";
import { LockupOverlay } from "./LockupOverlay";
import { ConstructionLayer } from "../construct/ConstructionLayer";
import { CritiqueOverlay } from "../critique/CritiqueOverlay";
import { SheetActions } from "../variants/SheetActions";

type Gesture =
  | { kind: "pan"; start: Pt; cam: { x: number; y: number } }
  | { kind: "move"; ids: string[]; start: Pt; orig: Record<string, NodeT>; box: Box | null; moved: boolean }
  | { kind: "marquee"; start: Pt; additive: boolean; base: string[]; frameClick: string | null; moved: boolean }
  | { kind: "resize"; id: string; handle: ResizeHandle; orig: NodeT }
  | { kind: "rotate"; id: string; center: Pt; startAngle: number; rot0: number; orig: NodeT }
  | { kind: "mrotate"; ids: string[]; center: Pt; startAngle: number; orig: Record<string, NodeT> }
  | { kind: "mscale"; ids: string[]; anchor: Pt; startDist: number; orig: Record<string, NodeT> }
  | { kind: "create"; shape: "rect" | "ellipse" | "polygon" | "star"; start: Pt; frame: FrameNodeT | null }
  | { kind: "brush"; points: [number, number, number][]; frame: FrameNodeT | null };

const HANDLES: ResizeHandle[] = [
  { u: 0, v: 0 },
  { u: 0.5, v: 0 },
  { u: 1, v: 0 },
  { u: 1, v: 0.5 },
  { u: 1, v: 1 },
  { u: 0.5, v: 1 },
  { u: 0, v: 1 },
  { u: 0, v: 0.5 },
];

const CURSORS: Record<string, string> = {
  "0,0": "nwse-resize",
  "1,1": "nwse-resize",
  "1,0": "nesw-resize",
  "0,1": "nesw-resize",
  "0.5,0": "ns-resize",
  "0.5,1": "ns-resize",
  "0,0.5": "ew-resize",
  "1,0.5": "ew-resize",
};

/** Sheet widths on screen (px) below which the version label hides, drops its size, or floats its actions. */
const LABEL_MIN = 28;
const LABEL_DIMS = 150;
const LABEL_ROOMY = 300;

/** Find the node to select for a hit: top-level by default, or within the current selection's scope. */
function pickTarget(doc: DocT, hitId: string, deep: boolean, selection: string[]): string | null {
  let n = doc.nodes[hitId];
  if (!n) return null;
  if (deep) return n.locked ? null : n.id;
  const scopes = new Set(selection.map((id) => doc.nodes[id]?.parent ?? null));
  // Climb to the top of the current scope, but never past a frame: a frame's
  // children are the "top level" of each version.
  while (n.parent && !scopes.has(n.parent)) {
    const p = doc.nodes[n.parent];
    if (!p || p.type === "frame") break;
    n = p;
  }
  // Locked ancestors make the whole branch unselectable from the canvas.
  let cur: NodeT | undefined = n;
  while (cur) {
    if (cur.locked) return null;
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  return n.id;
}

export function Canvas2D() {
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const flashIds = useStore((s) => s.flashIds);
  const showRulers = useStore((s) => s.showRulers);
  const hoverId = useStore((s) => s.hoverId);
  const brush = useStore((s) => s.brush);
  const editingId = useStore((s) => s.editingId);
  const live = useStore((s) => s.live);
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [draftShape, setDraftShape] = useState<{ shape: string; box: Box } | null>(null);
  const [draftStroke, setDraftStroke] = useState<SketchStrokeT | null>(null);
  const [draftNote, setDraftNote] = useState<DraftNote | null>(null);
  const [space, setSpace] = useState(false);
  const fitted = useRef<string | null>(null);

  // Fit the artboard the first time each document is shown.
  useLayoutEffect(() => {
    if (!doc || fitted.current === doc.id || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setViewport(r.width, r.height);
    fitted.current = doc.id;
    useStore.setState({ camera: fitCamera(doc) });
  }, [doc]);

  // Re-fit when switching between 2D and split view (the pane changes size).
  const view = useStore((s) => s.view);
  useLayoutEffect(() => {
    const el = ref.current;
    const d = useStore.getState().doc;
    if (!el || !d) return;
    const r = el.getBoundingClientRect();
    setViewport(r.width, r.height);
    setSplitSafe(view === "split");
    const fid = activeFrameId(d);
    useStore.setState({ camera: view === "split" && fid ? fitFrame(d, fid) : fitCamera(d) });
  }, [view]);

  // Split view is about one version: follow the active one.
  const activeFrame = useStore((s) => s.activeFrame);
  const frameCount = doc ? listFrames(doc).length : 0;
  useLayoutEffect(() => {
    const d = useStore.getState().doc;
    if (view !== "split" || !d) return;
    const fid = activeFrameId(d);
    if (fid) animateCamera(fitFrame(d, fid));
  }, [view, activeFrame, frameCount]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setViewport(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Space = temporary hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")) {
        e.preventDefault();
        setSpace(true);
        document.documentElement.dataset.space = "1";
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpace(false);
      delete document.documentElement.dataset.space;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Wheel: pinch / ⌘ to zoom, otherwise pan (trackpad friendly).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)));
      } else {
        const c = useStore.getState().camera;
        useStore.setState({ camera: { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Paste: images become reference layers, SVG text becomes nodes.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input,textarea,[contenteditable]")) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void addReferenceImage(file);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (/<svg[\s>]|<path[\s>]/i.test(text)) {
        e.preventDefault();
        importSvgText(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const local = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }, []);

  if (!doc) return <div className="canvas" ref={ref} />;

  const z = camera.zoom;
  const step = gridStep(z) * z;
  const major = step * 4;
  const panning = space || tool === "hand";

  const hitId = (e: React.PointerEvent | React.MouseEvent): string | null => {
    // Pointer capture retargets events to the container, so hit-test at the point instead.
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.closest("svg.scene") && x.closest("[data-id]"));
    return el?.closest("[data-id]")?.getAttribute("data-id") ?? null;
  };

  const beginMove = (ids: string[], start: Pt) => {
    const d = useStore.getState().doc!;
    const movable = topSelection(d, ids).filter((id) => !d.nodes[id]!.locked);
    const orig: Record<string, NodeT> = {};
    for (const id of movable) orig[id] = d.nodes[id]!;
    gesture.current = { kind: "move", ids: movable, start, orig, box: selectionBox(d, movable), moved: false };
  };

  /** The version under a canvas point (top-most), else the active one. */
  const frameAt = (w: Pt, fallback = true): FrameNodeT | null => {
    const frames = listFrames(doc);
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]!;
      if (w[0] >= f.transform.x && w[0] <= f.transform.x + f.width && w[1] >= f.transform.y && w[1] <= f.transform.y + f.height) return f;
    }
    if (!fallback) return null;
    const id = activeFrameId(doc);
    return id ? (doc.nodes[id] as FrameNodeT) : null;
  };
  const toFrame = (f: FrameNodeT | null, w: Pt): Pt => (f ? [w[0] - f.transform.x, w[1] - f.transform.y] : w);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-ui]")) return;
    const s = local(e);
    const w = toWorld(camera, s[0], s[1]);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Clicking away from a note closes it (an empty draft is discarded) and does nothing else.
    if (draftNote || useStore.getState().openAnnotation) {
      setDraftNote(null);
      useStore.setState({ openAnnotation: null });
      return;
    }

    if (e.button === 1 || panning) {
      gesture.current = { kind: "pan", start: s, cam: { x: camera.x, y: camera.y } };
      return;
    }
    if (e.button !== 0) return;

    const here = frameAt(w);
    if (here) setActiveFrame(here.id);

    if (tool === "brush") {
      gesture.current = { kind: "brush", points: [[w[0], w[1], e.pointerType === "pen" ? e.pressure : 0.5]], frame: here };
      setDraftStroke({ points: [[w[0], w[1], 0.5]], size: brush.size, color: brush.color });
      return;
    }
    if (tool === "rect" || tool === "ellipse" || tool === "polygon" || tool === "star") {
      gesture.current = { kind: "create", shape: tool, start: w, frame: here };
      return;
    }
    if (tool === "text") {
      const ids = dispatch(
        [
          {
            op: "add",
            node: { type: "text", text: "Brand", fontFamily: "Geist", fontWeight: 600, fontSize: 120, transform: { x: Math.round(toFrame(here, w)[0]), y: Math.round(toFrame(here, w)[1]) }, style: { fill: "#0b0c0e" } },
            parent: here?.id ?? null,
          },
        ],
        "Add text",
      );
      if (ids?.[0]) {
        select(ids);
        setTool("select");
        useStore.setState({ textEditId: ids[0] });
      }
      return;
    }
    if (tool === "comment") {
      const id = hitId(e);
      const [lx, ly] = toFrame(here, w);
      setDraftNote({ x: lx, y: ly, frameId: here?.id ?? null, nodeId: id && doc.nodes[id]?.type !== "frame" ? id : null });
      return;
    }
    if (tool === "node") {
      // Clicks that reach here missed the path editor's handles.
      const id = hitId(e);
      const target = id ? pickTarget(doc, id, true, []) : null;
      if (target && target !== editingId && (doc.nodes[target]?.type === "path" || doc.nodes[target]?.type === "shape")) {
        if (convertToPath(target)) {
          select([target]);
          useStore.setState({ editingId: target });
        }
      } else if (!target) {
        useStore.setState({ editingId: null });
        setTool("select");
      }
      return;
    }

    // select tool
    const id = hitId(e);
    const target = id ? pickTarget(doc, id, e.metaKey || e.ctrlKey, selection) : null;
    const hitNode = target ? doc.nodes[target] : undefined;
    if (hitNode?.type === "frame" && !selection.includes(hitNode.id)) {
      // Artboard background: a click selects the whole version, a drag draws a marquee inside it.
      gesture.current = { kind: "marquee", start: w, additive: e.shiftKey, base: e.shiftKey ? selection : [], frameClick: hitNode.id, moved: false };
      if (!e.shiftKey) select([]);
      setActiveFrame(hitNode.id);
      return;
    }
    if (target) {
      let next = selection;
      if (e.shiftKey) next = selection.includes(target) ? selection.filter((x) => x !== target) : [...selection, target];
      else if (!selection.includes(target)) next = [target];
      select(next);
      if (next.includes(target)) beginMove(next, w);
    } else {
      gesture.current = { kind: "marquee", start: w, additive: e.shiftKey, base: e.shiftKey ? selection : [], frameClick: null, moved: false };
      if (!e.shiftKey) select([]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = local(e);
    const w = toWorld(camera, s[0], s[1]);
    const g = gesture.current;
    if (!g) {
      if (tool === "select" && !panning) {
        const id = hitId(e);
        const target = id ? pickTarget(doc, id, e.metaKey || e.ctrlKey, selection) : null;
        if (target !== hoverId) useStore.setState({ hoverId: target });
      }
      return;
    }
    const d = useStore.getState().doc!;
    switch (g.kind) {
      case "pan":
        useStore.setState({ camera: { ...camera, x: g.cam.x + s[0] - g.start[0], y: g.cam.y + s[1] - g.start[1] } });
        return;
      case "move": {
        let dx = w[0] - g.start[0];
        let dy = w[1] - g.start[1];
        if (!g.moved && Math.hypot(dx, dy) * z < 3) return;
        g.moved = true;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        let gs: Guide[] = [];
        if (g.box && !e.altKey) {
          const snapped = snapBox({ ...g.box, x: g.box.x + dx, y: g.box.y + dy }, snapLines(d, new Set(g.ids), useStore.getState().guides), 6 / z);
          dx += snapped.dx;
          dy += snapped.dy;
          gs = snapped.guides;
        }
        setGuides(gs);
        for (const id of g.ids) setLive(id, movePatch(d, g.orig[id]!, dx, dy));
        return;
      }
      case "marquee": {
        const box = { x: Math.min(g.start[0], w[0]), y: Math.min(g.start[1], w[1]), w: Math.abs(w[0] - g.start[0]), h: Math.abs(w[1] - g.start[1]) };
        if (!g.moved && Math.hypot(w[0] - g.start[0], w[1] - g.start[1]) * z < 3) return;
        g.moved = true;
        setMarquee(box);
        const contents = listFrames(d).flatMap((f) => f.children);
        const hits = contents.filter((id) => {
          const n = d.nodes[id];
          if (!n || !n.visible || n.locked) return false;
          const b = worldBox(d, n);
          return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
        });
        select([...new Set([...g.base, ...hits])]);
        return;
      }
      case "resize": {
        const patch = resizePatch(d, g.orig, g.handle, w, { keepRatio: e.shiftKey, fromCenter: e.altKey });
        setLive(g.id, patch);
        return;
      }
      case "rotate": {
        const a = (Math.atan2(w[1] - g.center[1], w[0] - g.center[0]) * 180) / Math.PI;
        let rot = g.rot0 + a - g.startAngle;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        setLive(g.id, rotatePatch(d, g.orig, rot));
        return;
      }
      case "mrotate": {
        let deg = (Math.atan2(w[1] - g.center[1], w[0] - g.center[0]) * 180) / Math.PI - g.startAngle;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        for (const id of g.ids) setLive(id, rotateAboutPatch(d, g.orig[id]!, g.center, deg));
        return;
      }
      case "mscale": {
        const k = Math.max(0.02, Math.hypot(w[0] - g.anchor[0], w[1] - g.anchor[1]) / g.startDist);
        for (const id of g.ids) setLive(id, scaleAboutPatch(d, g.orig[id]!, g.anchor, k));
        return;
      }
      case "create": {
        let x0 = g.start[0];
        let y0 = g.start[1];
        let ww = w[0] - x0;
        let hh = w[1] - y0;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(ww), Math.abs(hh));
          ww = Math.sign(ww || 1) * m;
          hh = Math.sign(hh || 1) * m;
        }
        if (e.altKey) {
          x0 -= ww;
          y0 -= hh;
          ww *= 2;
          hh *= 2;
        }
        setDraftShape({ shape: g.shape, box: { x: Math.min(x0, x0 + ww), y: Math.min(y0, y0 + hh), w: Math.abs(ww), h: Math.abs(hh) } });
        return;
      }
      case "brush": {
        const pr = e.pointerType === "pen" ? e.pressure : 0.5;
        const last = g.points[g.points.length - 1]!;
        if (Math.hypot(w[0] - last[0], w[1] - last[1]) * z < 1.5) return;
        g.points.push([Math.round(w[0] * 10) / 10, Math.round(w[1] * 10) / 10, pr]);
        setDraftStroke({ points: [...g.points], size: brush.size, color: brush.color });
        return;
      }
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    const d = useStore.getState().doc;
    if (!g || !d) return;
    const liveNow = useStore.getState().live;
    const commit = (label: string) => {
      const ops: OpT[] = Object.entries(liveNow).map(([id, patch]) => ({ op: "update", id, set: patch as Record<string, unknown> }));
      clearLive();
      if (ops.length) dispatch(ops, label);
    };
    switch (g.kind) {
      case "move":
        setGuides([]);
        if (g.moved) commit("Move");
        return;
      case "marquee":
        setMarquee(null);
        if (!g.moved && g.frameClick) select([g.frameClick]);
        return;
      case "resize":
        commit("Resize");
        return;
      case "rotate":
        commit("Rotate");
        return;
      case "mrotate":
        commit(`Rotate ${g.ids.length} layers`);
        return;
      case "mscale":
        commit(`Scale ${g.ids.length} layers`);
        return;
      case "create": {
        const box = draftShape?.box;
        setDraftShape(null);
        const wb = box && box.w * z > 3 && box.h * z > 3 ? box : { x: g.start[0] - 120, y: g.start[1] - 120, w: 240, h: 240 };
        const [bx, by] = toFrame(g.frame, [wb.x, wb.y]);
        const b = { ...wb, x: bx, y: by };
        const ids = dispatch(
          [
            {
              op: "add",
              node: {
                type: "shape",
                shape: g.shape,
                width: Math.round(b.w),
                height: Math.round(b.h),
                sides: g.shape === "star" ? 5 : 6,
                radius: g.shape === "rect" ? Math.round(Math.min(b.w, b.h) * 0.12) : 0,
                transform: { x: Math.round(b.x), y: Math.round(b.y) },
                style: { fill: "#0b0c0e" },
              },
              parent: g.frame?.id ?? null,
            },
          ],
          `Add ${g.shape}`,
        );
        if (ids) select(ids);
        setTool("select");
        return;
      }
      case "brush": {
        setDraftStroke(null);
        if (g.points.length < 2) return;
        // Draw into the selected sketch layer, the top-most one, or a new one.
        const selSketch = useStore.getState().selection.map((id) => d.nodes[id]).find((n) => n?.type === "sketch");
        const siblings = g.frame ? g.frame.children : d.root;
        const top = [...siblings].reverse().map((id) => d.nodes[id]).find((n) => n?.type === "sketch" && n.visible && !n.locked);
        const layer = selSketch && (!g.frame || selSketch.parent === g.frame.id) ? selSketch : top;
        if (layer && layer.type === "sketch") {
          const pts = g.points.map(([x, y, p]) => {
            const [lx, ly] = worldToLocal(d, layer.id, x, y);
            return [Math.round(lx * 10) / 10, Math.round(ly * 10) / 10, p] as [number, number, number];
          });
          dispatch([{ op: "update", id: layer.id, set: { strokes: [...layer.strokes, { points: pts, size: brush.size, color: brush.color }] } }], "Sketch");
        } else {
          dispatch(
            [
              {
                op: "add",
                node: {
                  id: newId("n"),
                  type: "sketch",
                  name: "Sketch",
                  strokes: [{ points: g.points.map(([x, y, p]) => [...toFrame(g.frame, [x, y]), p] as [number, number, number]), size: brush.size, color: brush.color }],
                  style: { opacity: 0.9, fill: null },
                },
                parent: g.frame?.id ?? null,
              },
            ],
            "Sketch",
          );
        }
        return;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== "select") return;
    const id = hitId(e);
    if (!id) return;
    const deepest = doc.nodes[id];
    const target = pickTarget(doc, id, false, selection);
    const n = target ? doc.nodes[target] : undefined;
    if (!n) return;
    if (n.type === "group") {
      // Enter the group: select the child under the pointer.
      let c: NodeT | undefined = deepest;
      while (c && c.parent !== n.id) c = c.parent ? doc.nodes[c.parent] : undefined;
      if (c) select([c.id]);
      return;
    }
    if (n.type === "text") return useStore.setState({ textEditId: n.id });
    if ((n.type === "path" || n.type === "shape") && convertToPath(n.id)) {
      select([n.id]);
      useStore.setState({ editingId: n.id, tool: "node" });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const s = local(e);
    const w = toWorld(camera, s[0], s[1]);
    for (const f of e.dataTransfer.files) {
      const fr = frameAt(w);
      if (f.type === "image/svg+xml" || f.name.endsWith(".svg")) void f.text().then((t) => importSvgText(t, fr?.id));
      else if (f.type.startsWith("image/")) void addReferenceImage(f, toFrame(fr, w), fr?.id);
      else toast(`Can't use ${f.name}`, "error");
    }
  };

  // ---- overlays in screen space ----
  const sx = (p: Pt) => toScreen(camera, p[0], p[1]);
  const single = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
  const showHandles = tool === "select" && !!single && single.type !== "frame" && !single.locked && !gesture.current?.kind.startsWith("m");
  const liveDoc: DocT = Object.keys(live).length
    ? { ...doc, nodes: { ...doc.nodes, ...Object.fromEntries(Object.entries(live).filter(([k]) => doc.nodes[k]).map(([k, v]) => [k, { ...doc.nodes[k]!, ...v } as NodeT])) } }
    : doc;
  const singleQuad = single && liveDoc.nodes[single.id] ? worldQuad(liveDoc, liveDoc.nodes[single.id]!).map(sx) : null;
  const multiBox = selection.length > 1 ? selectionBox(liveDoc, selection) : null;

  const startResize = (h: ResizeHandle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ref.current?.setPointerCapture(e.pointerId);
    gesture.current = { kind: "resize", id: single!.id, handle: h, orig: single! };
  };
  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    ref.current?.setPointerCapture(e.pointerId);
    const s = local(e);
    const w = toWorld(camera, s[0], s[1]);
    const center = worldCenter(doc, single!);
    gesture.current = {
      kind: "rotate",
      id: single!.id,
      center,
      startAngle: (Math.atan2(w[1] - center[1], w[0] - center[0]) * 180) / Math.PI,
      rot0: single!.transform.rotation,
      orig: single!,
    };
  };

  const quadPath = (q: Pt[]) => `M${q.map((p) => `${p[0]} ${p[1]}`).join("L")}Z`;
  const cursor = panning
    ? gesture.current?.kind === "pan"
      ? "grabbing"
      : "grab"
    : tool === "brush"
      ? "crosshair"
      : tool === "comment"
        ? "copy"
        : ["rect", "ellipse", "polygon", "star"].includes(tool)
          ? "crosshair"
          : tool === "text"
            ? "text"
            : "default";

  return (
    <div
      className="canvas"
      ref={ref}
      style={{
        cursor,
        backgroundSize: `${step}px ${step}px, ${major}px ${major}px, ${major}px ${major}px`,
        backgroundPosition: `${camera.x % step}px ${camera.y % step}px, ${camera.x % major}px ${camera.y % major}px, ${camera.x % major}px ${camera.y % major}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => !gesture.current && hoverId && useStore.setState({ hoverId: null })}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {listFrames(doc).map((f) => {
        const lf = (liveDoc.nodes[f.id] as FrameNodeT | undefined) ?? f;
        const [fx, fy] = sx([lf.transform.x, lf.transform.y]);
        const active = f.id === activeFrameId(doc);
        // The label never grows past its sheet, so neighbours never overlap when zoomed out:
        // the name truncates, the size drops first, and the actions float above on hover.
        const sw = f.width * z;
        const fit = sw < LABEL_MIN ? " gone" : sw < LABEL_ROOMY ? " tight" : "";
        return (
          <div
            key={f.id}
            className={`sheet${active ? " active" : ""}${selection.includes(f.id) ? " selected" : ""}`}
            style={{ left: fx, top: fy, width: sw, height: f.height * z, background: f.background ?? undefined }}
          >
            <div
              className={`sheet-label${fit}`}
              style={{ maxWidth: sw }}
              data-ui
              title={`${f.name || "Untitled"} — click to select this version, drag to move it`}
              onPointerDown={(e) => {
                e.stopPropagation();
                ref.current?.setPointerCapture(e.pointerId);
                const s0 = local(e);
                select([f.id]);
                beginMove([f.id], toWorld(camera, s0[0], s0[1]));
              }}
            >
              <span className="sheet-title">
                <span className="sheet-name">{f.name || "Untitled"}</span>
                {sw >= LABEL_DIMS && (
                  <span className="dim">
                    {f.width} × {f.height}
                  </span>
                )}
              </span>
              {f.batch && (
                <button
                  className="sheet-pick"
                  title="Keep this variant and remove the others"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    dispatch(continueWithVariantOps(doc, f.id), `Continue with ${f.name}`);
                    setActiveFrame(f.id);
                  }}
                >
                  Continue with this
                </button>
              )}
              <SheetActions frame={f} />
            </div>
          </div>
        );
      })}

      <svg className="scene" width="100%" height="100%">
        <g transform={`translate(${camera.x} ${camera.y}) scale(${z})`}>
          <SceneNodes doc={doc} />
          {draftStroke && <path d={freehandPath(draftStroke, false)} fill={draftStroke.color} opacity={0.9} />}
        </g>
      </svg>
      <ConstructionLayer />

      <svg className="overlay" width="100%" height="100%">
        {/* hover outline */}
        {hoverId && !selection.includes(hoverId) && doc.nodes[hoverId] && tool === "select" && (
          <path d={quadPath(worldQuad(doc, doc.nodes[hoverId]!).map(sx))} className="hover-outline" />
        )}
        {/* agent flash */}
        {flashIds.map((id) =>
          doc.nodes[id] ? <path key={id} d={quadPath(worldQuad(doc, doc.nodes[id]!).map(sx))} className="flash-outline" /> : null,
        )}
        {/* multi selection */}
        {selection.length > 1 &&
          selection.map((id) => (liveDoc.nodes[id] ? <path key={id} d={quadPath(worldQuad(liveDoc, liveDoc.nodes[id]!).map(sx))} className="sel-thin" /> : null))}
        {multiBox && <rect x={sx([multiBox.x, multiBox.y])[0]} y={sx([multiBox.x, multiBox.y])[1]} width={multiBox.w * z} height={multiBox.h * z} className="sel-box" />}
        {multiBox && tool === "select" && !gesture.current && (() => {
          // Rotate / scale several layers together (a whole section of the logo).
          const ids = topSelection(doc, selection).filter((id) => !doc.nodes[id]!.locked && doc.nodes[id]!.type !== "frame");
          if (ids.length < 2) return null;
          const orig = Object.fromEntries(ids.map((id) => [id, doc.nodes[id]!]));
          const center: Pt = [multiBox.x + multiBox.w / 2, multiBox.y + multiBox.h / 2];
          const cs: Pt[] = [
            [multiBox.x, multiBox.y],
            [multiBox.x + multiBox.w, multiBox.y],
            [multiBox.x + multiBox.w, multiBox.y + multiBox.h],
            [multiBox.x, multiBox.y + multiBox.h],
          ];
          const top = sx([center[0], multiBox.y]);
          const startRot = (e: React.PointerEvent) => {
            e.stopPropagation();
            ref.current?.setPointerCapture(e.pointerId);
            const s0 = local(e);
            const w0 = toWorld(camera, s0[0], s0[1]);
            gesture.current = { kind: "mrotate", ids, center, startAngle: (Math.atan2(w0[1] - center[1], w0[0] - center[0]) * 180) / Math.PI, orig };
          };
          const startScale = (i: number) => (e: React.PointerEvent) => {
            e.stopPropagation();
            ref.current?.setPointerCapture(e.pointerId);
            const anchor = e.altKey ? center : cs[(i + 2) % 4]!;
            const s0 = local(e);
            const w0 = toWorld(camera, s0[0], s0[1]);
            gesture.current = { kind: "mscale", ids, anchor, startDist: Math.hypot(w0[0] - anchor[0], w0[1] - anchor[1]) || 1, orig };
          };
          return (
            <g data-ui>
              <line x1={top[0]} y1={top[1]} x2={top[0]} y2={top[1] - 26} className="sel-thin" />
              <circle cx={top[0]} cy={top[1] - 26} r={5} className="rot-handle" onPointerDown={startRot} />
              {cs.map((c, i) => {
                const p = sx(c);
                return <rect key={i} x={p[0] - 4} y={p[1] - 4} width={8} height={8} rx={1.5} className="handle" style={{ cursor: i % 2 ? "nesw-resize" : "nwse-resize" }} onPointerDown={startScale(i)} />;
              })}
            </g>
          );
        })()}
        {/* single selection with handles */}
        {singleQuad && tool !== "node" && <path d={quadPath(singleQuad)} className="sel-box" />}
        {showHandles && singleQuad && localBBox(doc, single!).w > 0 && (
          <g data-ui>
            {(() => {
              const [a, b, , d] = singleQuad;
              const ux: Pt = [(b![0] - a![0]), (b![1] - a![1])];
              const vy: Pt = [(d![0] - a![0]), (d![1] - a![1])];
              const at = (h: ResizeHandle): Pt => [a![0] + ux[0] * h.u + vy[0] * h.v, a![1] + ux[1] * h.u + vy[1] * h.v];
              const vlen = Math.hypot(vy[0], vy[1]) || 1;
              const top = at({ u: 0.5, v: 0 });
              const rot: Pt = [top[0] - (vy[0] / vlen) * 26, top[1] - (vy[1] / vlen) * 26];
              const small = Math.hypot(ux[0], ux[1]) < 24 || vlen < 24;
              return (
                <>
                  <line x1={top[0]} y1={top[1]} x2={rot[0]} y2={rot[1]} className="sel-thin" />
                  <circle cx={rot[0]} cy={rot[1]} r={5} className="rot-handle" onPointerDown={startRotate} />
                  {HANDLES.filter((h) => !small || (h.u !== 0.5 && h.v !== 0.5)).map((h) => {
                    const p = at(h);
                    return (
                      <rect
                        key={`${h.u},${h.v}`}
                        x={p[0] - 4}
                        y={p[1] - 4}
                        width={8}
                        height={8}
                        rx={1.5}
                        className="handle"
                        style={{ cursor: CURSORS[`${h.u},${h.v}`] }}
                        onPointerDown={startResize(h)}
                      />
                    );
                  })}
                </>
              );
            })()}
          </g>
        )}
        {/* snap guides */}
        {/* keyed by line so a newly engaged snap remounts and flashes once (styles/polish.css) */}
        {guides.map((g) =>
          g.axis === "x" ? (
            <line key={`x${g.at}`} x1={sx([g.at, 0])[0]} x2={sx([g.at, 0])[0]} y1={0} y2="100%" className="guide" />
          ) : (
            <line key={`y${g.at}`} y1={sx([0, g.at])[1]} y2={sx([0, g.at])[1]} x1={0} x2="100%" className="guide" />
          ),
        )}
        {marquee && <rect x={sx([marquee.x, marquee.y])[0]} y={sx([marquee.x, marquee.y])[1]} width={marquee.w * z} height={marquee.h * z} className="marquee" />}
        {draftShape && (
          <rect
            x={sx([draftShape.box.x, draftShape.box.y])[0]}
            y={sx([draftShape.box.x, draftShape.box.y])[1]}
            width={draftShape.box.w * z}
            height={draftShape.box.h * z}
            rx={draftShape.shape === "ellipse" ? (Math.min(draftShape.box.w, draftShape.box.h) * z) / 2 : 2}
            className="draft-shape"
          />
        )}
        {draftShape && (
          <text x={sx([draftShape.box.x + draftShape.box.w, draftShape.box.y + draftShape.box.h])[0] + 8} y={sx([draftShape.box.x + draftShape.box.w, draftShape.box.y + draftShape.box.h])[1] + 16} className="dim-label">
            {Math.round(draftShape.box.w)} × {Math.round(draftShape.box.h)}
          </text>
        )}
        {tool === "node" && editingId && <PathEditor id={editingId} />}
        <WarpEnvelope />
      </svg>

      {(() => {
        // Empty-state card over the active version (above the scene so its button is clickable).
        const fid = activeFrameId(doc);
        const f = fid ? (doc.nodes[fid] as FrameNodeT) : null;
        if (!f || f.children.length || tool !== "select") return null;
        const [fx, fy] = sx([f.transform.x, f.transform.y]);
        // A brand-new document gets the full start screen (scaled with the artboard); empty extra versions the small card.
        const blank = doc.root.every((id) => doc.nodes[id]?.type === "frame") && listFrames(doc).every((fr) => !fr.children.length);
        const k = Math.min(1, (f.width * z - 48) / WELCOME_SIZE.w, (f.height * z - 48) / WELCOME_SIZE.h);
        return (
          <div className="frame-empty-wrap" style={{ left: fx, top: fy, width: f.width * z, height: f.height * z }}>
            {blank && k >= 0.5 ? <Welcome scale={k} /> : <FrameEmpty />}
          </div>
        );
      })()}
      <LockupOverlay />
      <CritiqueOverlay />
      <AiLockBadges />
      <AnnotationLayer draft={draftNote} onDraftDone={() => setDraftNote(null)} />
      {!marquee && !draftShape && <QuickBar />}
      <TextEditor />
      {showRulers && <Rulers />}
    </div>
  );
}
