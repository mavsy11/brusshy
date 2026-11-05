import { useEffect, useMemo, useRef, useState } from "react";
import { apply, invert, multiply, worldMatrix, type Mat } from "@brusshy/core";
import { dispatch, select, setLive, setTool, useStore } from "../lib/store";
import { isSmooth, nearestOnPath, parsePath, serializePath, splitSegment, toggleSmooth, type P, type SubPath } from "../lib/pathmodel";
import { bounds, moveNodes, softField, transformNodes } from "../lib/deform";
import { selectAllNodes } from "../lib/nodeTools";

const key = (s: number, i: number) => `${s}:${i}`;

/**
 * Bézier node editing for one path:
 * - drag anchors/handles; double-click a segment to add a node, an anchor to toggle smooth/corner
 * - drag on empty canvas to box-select nodes; with 2+ nodes selected, rotate/scale them together
 *   around a movable pivot (e.g. put the pivot at a leaf's base and rotate its tip to bend it)
 * - soft selection (radius > 0): nearby nodes follow with a smooth falloff
 */
export function PathEditor({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)!;
  const camera = useStore((s) => s.camera);
  const live = useStore((s) => s.live[id]);
  const selArr = useStore((s) => s.nodeSel);
  const softRadius = useStore((s) => s.softRadius);
  const node = doc.nodes[id];
  const d = (live as { d?: string } | undefined)?.d ?? (node?.type === "path" ? node.d : "");
  const subs = useMemo(() => parsePath(d), [d]);
  const sel = useMemo(() => new Set(selArr), [selArr]);
  const setSel = (s: Set<string>) => useStore.setState({ nodeSel: [...s] });
  const [marquee, setMarquee] = useState<{ a: P; b: P } | null>(null);
  /** Pivot for rotating/scaling selected nodes (local coords); null = selection center. */
  const [pivot, setPivot] = useState<P | null>(null);
  const busy = useRef(false);

  // Fresh selection when switching paths; keep the pivot only for the same selection.
  useEffect(() => {
    useStore.setState({ nodeSel: [] });
  }, [id]);
  useEffect(() => setPivot(null), [selArr]);

  // local → screen
  const M: Mat = useMemo(() => multiply([camera.zoom, 0, 0, camera.zoom, camera.x, camera.y], worldMatrix(doc, id)), [doc, id, camera]);
  const inv = useMemo(() => invert(M), [M]);
  const toS = (p: P): P => apply(M, p[0], p[1]);
  const toL = (x: number, y: number): P => apply(inv, x, y);
  // Soft radius is set in screen-independent artboard units; convert to this path's local units.
  const localScale = Math.hypot(M[0], M[1]) / camera.zoom || 1;
  const radius = softRadius > 0 ? softRadius / localScale : null;

  const commit = (next: SubPath[], label: string) => {
    setLive(id, null);
    dispatch([{ op: "update", id, set: { d: serializePath(next) } }], label);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel.size) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const next = subs
          .map((sp, si) => ({ ...sp, anchors: sp.anchors.filter((_, i) => !sel.has(key(si, i))) }))
          .filter((sp) => sp.anchors.length >= 2);
        setSel(new Set());
        if (!next.length) return;
        commit(next, "Delete node");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectAllNodes();
      }
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopImmediatePropagation();
        if (e.key === "Escape" && sel.size) return setSel(new Set());
        useStore.setState({ editingId: null, nodeSel: [] });
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!node || node.type !== "path") return null;

  const rect = () => document.querySelector(".canvas")!.getBoundingClientRect();
  const screenPt = (e: { clientX: number; clientY: number }): P => {
    const r = rect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const track = (onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    busy.current = true;
    const move = (e: PointerEvent) => onMove(e);
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      busy.current = false;
      onUp(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- anchors & handles ----------
  const onAnchorDown = (s: number, i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const k = key(s, i);
    let next = sel;
    if (e.shiftKey) {
      next = new Set(sel);
      next.has(k) ? next.delete(k) : next.add(k);
    } else if (!sel.has(k)) next = new Set([k]);
    setSel(next);
    const start = toL(...screenPt(e));
    const field = softField(subs, next, radius);
    let last: SubPath[] = subs;
    track(
      (ev) => {
        const p = toL(...screenPt(ev));
        last = moveNodes(subs, field, p[0] - start[0], p[1] - start[1]);
        setLive(id, { d: serializePath(last) });
      },
      () => {
        if (last !== subs) commit(last, radius ? "Move nodes (soft)" : next.size > 1 ? "Move nodes" : "Move node");
      },
    );
  };

  const onHandleDown = (s: number, i: number, which: "cin" | "cout") => (e: React.PointerEvent) => {
    e.stopPropagation();
    const smooth = isSmooth(subs[s]!.anchors[i]!);
    let last: SubPath[] = subs;
    track(
      (ev) => {
        const p = toL(...screenPt(ev));
        last = subs.map((sp, si) => {
          if (si !== s) return sp;
          const anchors = sp.anchors.map((a) => ({ ...a }));
          const a = anchors[i]!;
          a[which] = p;
          const other = which === "cin" ? "cout" : "cin";
          if (smooth && !ev.altKey && a[other]) {
            const len = Math.hypot(a[other]![0] - a.p[0], a[other]![1] - a.p[1]);
            const v: P = [a.p[0] - p[0], a.p[1] - p[1]];
            const vl = Math.hypot(...v) || 1;
            a[other] = [a.p[0] + (v[0] / vl) * len, a.p[1] + (v[1] / vl) * len];
          }
          return { ...sp, anchors };
        });
        setLive(id, { d: serializePath(last) });
      },
      () => {
        if (last !== subs) commit(last, "Edit curve");
      },
    );
  };

  const onPathDouble = (e: React.MouseEvent) => {
    e.stopPropagation();
    const q = toL(...screenPt(e));
    const hit = nearestOnPath(subs, q);
    if (!hit || hit.t <= 0.001 || hit.t >= 0.999) return;
    const next = subs.map((sp, si) => (si === hit.s ? splitSegment(sp, hit.i, hit.t) : sp));
    setSel(new Set([key(hit.s, hit.i + 1)]));
    commit(next, "Add node");
  };

  const onAnchorDouble = (s: number, i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    commit(
      subs.map((sp, si) => (si === s ? toggleSmooth(sp, i) : sp)),
      "Toggle smooth",
    );
  };

  // ---------- box selection on empty canvas ----------
  const onBackgroundDown = (e: React.PointerEvent) => {
    // Space-drag and middle-drag still pan the canvas.
    if (e.button !== 0 || document.documentElement.dataset.space) return;
    e.stopPropagation();
    const a = screenPt(e);
    let moved = false;
    track(
      (ev) => {
        const b = screenPt(ev);
        if (!moved && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return;
        moved = true;
        setMarquee({ a, b });
      },
      (ev) => {
        setMarquee(null);
        if (!moved) {
          // A plain click: edit another path under the pointer, or leave node editing.
          const hit = document
            .elementsFromPoint(ev.clientX, ev.clientY)
            .find((x) => x.closest("svg.scene") && x.closest("[data-id]"))
            ?.closest("[data-id]")
            ?.getAttribute("data-id");
          const n = hit ? useStore.getState().doc?.nodes[hit] : undefined;
          if (n?.type === "path" && n.id !== id) {
            select([n.id]);
            useStore.setState({ editingId: n.id, nodeSel: [] });
          } else if (sel.size) setSel(new Set());
          else {
            useStore.setState({ editingId: null, nodeSel: [] });
            setTool("select");
          }
          return;
        }
        const b = screenPt(ev);
        const x0 = Math.min(a[0], b[0]);
        const x1 = Math.max(a[0], b[0]);
        const y0 = Math.min(a[1], b[1]);
        const y1 = Math.max(a[1], b[1]);
        const hits = new Set(ev.shiftKey ? sel : []);
        subs.forEach((sp, si) =>
          sp.anchors.forEach((an, ai) => {
            const p = toS(an.p);
            if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) hits.add(key(si, ai));
          }),
        );
        setSel(hits);
      },
    );
  };

  // ---------- rotate / scale selected nodes ----------
  const selPts: P[] = [];
  subs.forEach((sp, si) => sp.anchors.forEach((an, ai) => sel.has(key(si, ai)) && selPts.push(an.p)));
  const box = selPts.length >= 2 ? bounds(selPts) : null;
  const piv: P | null = box ? pivot ?? [box.x + box.w / 2, box.y + box.h / 2] : null;

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!piv) return;
    const pS = toS(piv);
    const a0 = Math.atan2(screenPt(e)[1] - pS[1], screenPt(e)[0] - pS[0]);
    const field = softField(subs, sel, radius);
    let last = subs;
    let deg = 0;
    track(
      (ev) => {
        const p = screenPt(ev);
        deg = ((Math.atan2(p[1] - pS[1], p[0] - pS[0]) - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        // Screen rotation → local rotation (flip sign if the path is mirrored).
        const det = M[0] * M[3] - M[1] * M[2];
        last = transformNodes(subs, field, piv, det < 0 ? -deg : deg);
        setLive(id, { d: serializePath(last) });
      },
      () => {
        if (last !== subs) commit(last, `Rotate nodes ${Math.round(deg)}°`);
      },
    );
  };

  const startScale = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!piv) return;
    const pS = toS(piv);
    const d0 = Math.hypot(screenPt(e)[0] - pS[0], screenPt(e)[1] - pS[1]) || 1;
    const field = softField(subs, sel, radius);
    let last = subs;
    track(
      (ev) => {
        const p = screenPt(ev);
        const k = Math.max(0.05, Math.hypot(p[0] - pS[0], p[1] - pS[1]) / d0);
        last = transformNodes(subs, field, piv, 0, k);
        setLive(id, { d: serializePath(last) });
      },
      () => {
        if (last !== subs) commit(last, "Scale nodes");
      },
    );
  };

  const startPivot = (e: React.PointerEvent) => {
    e.stopPropagation();
    track(
      (ev) => setPivot(toL(...screenPt(ev))),
      () => {},
    );
  };

  const screenD = serializePath(subs.map((sp) => ({ ...sp, anchors: sp.anchors.map((a) => ({ p: toS(a.p), cin: a.cin && toS(a.cin), cout: a.cout && toS(a.cout) })) })));
  const boxS = box ? [toS([box.x, box.y]), toS([box.x + box.w, box.y]), toS([box.x + box.w, box.y + box.h]), toS([box.x, box.y + box.h])] : null;
  const softS = radius && sel.size ? radius * localScale * camera.zoom : 0;

  return (
    <g data-ui className="path-editor">
      <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="transparent" onPointerDown={onBackgroundDown} />
      <path d={screenD} className="pe-outline" />
      <path d={screenD} className="pe-hit" onDoubleClick={onPathDouble} onPointerDown={(e) => e.stopPropagation()} />
      {softS > 0 &&
        selPts.map((p, i) => {
          const s = toS(p);
          return <circle key={i} cx={s[0]} cy={s[1]} r={softS} className="pe-soft" />;
        })}
      {subs.map((sp, si) =>
        sp.anchors.map((a, ai) => {
          const k = key(si, ai);
          const on = sel.has(k);
          const p = toS(a.p);
          const neighborOn = sel.has(key(si, (ai + 1) % sp.anchors.length)) || sel.has(key(si, (ai - 1 + sp.anchors.length) % sp.anchors.length));
          const showHandles = on || neighborOn || sel.size === 0;
          return (
            <g key={k}>
              {showHandles &&
                (["cin", "cout"] as const).map((w) => {
                  const c = a[w];
                  if (!c) return null;
                  const cp = toS(c);
                  return (
                    <g key={w}>
                      <line x1={p[0]} y1={p[1]} x2={cp[0]} y2={cp[1]} className="pe-arm" />
                      <circle cx={cp[0]} cy={cp[1]} r={3.5} className="pe-handle" onPointerDown={onHandleDown(si, ai, w)} />
                    </g>
                  );
                })}
              <rect
                x={p[0] - 4.5}
                y={p[1] - 4.5}
                width={9}
                height={9}
                rx={isSmooth(a) ? 4.5 : 1.5}
                className={`pe-anchor${on ? " on" : ""}`}
                onPointerDown={onAnchorDown(si, ai)}
                onDoubleClick={onAnchorDouble(si, ai)}
              />
            </g>
          );
        }),
      )}
      {boxS && piv && (
        <g>
          <path d={`M${boxS.map((p) => `${p[0]} ${p[1]}`).join("L")}Z`} className="pe-selbox" />
          {(() => {
            const top: P = [(boxS[0]![0] + boxS[1]![0]) / 2, (boxS[0]![1] + boxS[1]![1]) / 2];
            const rotP: P = [top[0], top[1] - 26];
            const pS = toS(piv);
            return (
              <>
                <line x1={top[0]} y1={top[1]} x2={rotP[0]} y2={rotP[1]} className="pe-arm" />
                <circle cx={rotP[0]} cy={rotP[1]} r={6} className="rot-handle" onPointerDown={startRotate}>
                  <title>Rotate selected nodes around the pivot (⇧ snaps 15°)</title>
                </circle>
                {boxS.map((c, i) => (
                  <rect key={i} x={c[0] - 4} y={c[1] - 4} width={8} height={8} rx={1.5} className="handle" style={{ cursor: "nwse-resize" }} onPointerDown={startScale} />
                ))}
                <g className="pe-pivot" onPointerDown={startPivot} transform={`translate(${pS[0]} ${pS[1]})`}>
                  <title>Pivot — drag it (e.g. to the base of a petal) and rotate to bend</title>
                  <circle r={7} />
                  <path d="M-11 0H11M0 -11V11" />
                </g>
              </>
            );
          })()}
        </g>
      )}
      {marquee && (
        <rect
          x={Math.min(marquee.a[0], marquee.b[0])}
          y={Math.min(marquee.a[1], marquee.b[1])}
          width={Math.abs(marquee.b[0] - marquee.a[0])}
          height={Math.abs(marquee.b[1] - marquee.a[1])}
          className="marquee"
        />
      )}
    </g>
  );
}
