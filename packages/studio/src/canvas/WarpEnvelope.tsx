import { useEffect, useMemo, useRef } from "react";
import { apply, envelopeAt, envIndex, invert, type EnvelopeNodeT, type EnvelopeT, type P } from "@brusshy/core";
import { useStore } from "../lib/store";
import { dragEnvelope, endEnvelope, envelopeTarget, releaseEnvelope, syncEnvelope, useTypeLab } from "../lib/typelab";
import { toScreen, toWorld } from "./camera";
import "../styles/typelab.css";

type HandleKey = "l" | "r" | "u" | "d";

/**
 * Free-envelope editor on the canvas: a mesh of Coons patches over the warped selection.
 * Drag a node (its handles follow) or a handle to bend an edge; every release is one undo step.
 */
export function WarpEnvelope() {
  const session = useTypeLab((s) => s.envelope);
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const selection = useStore((s) => s.selection);
  const drag = useRef<{ i: number; key: "p" | HandleKey; start: P; env: EnvelopeT; moved: boolean } | null>(null);

  // Follow undo/redo and AI edits; leave when the selection moves elsewhere.
  useEffect(() => {
    if (!drag.current) syncEnvelope();
  }, [doc]);
  useEffect(() => {
    const s = useTypeLab.getState().envelope;
    if (s && !s.members.some((m) => selection.includes(m))) endEnvelope();
  }, [selection]);
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input,textarea,[contenteditable]")) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopImmediatePropagation();
        endEnvelope();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [!!session]);

  const target = useMemo(() => (session ? envelopeTarget(session) : null), [session, doc]);
  if (!session || !target) return null;
  const env = session.env;
  const { box, space } = target;
  const toS = (q: P): P => {
    const w = apply(space, box.x + q[0] * box.w, box.y + q[1] * box.h);
    return toScreen(camera, w[0], w[1]);
  };
  const inv = invert(space);
  const toN = (sx: number, sy: number): P => {
    const w = toWorld(camera, sx, sy);
    const c = apply(inv, w[0], w[1]);
    return [(c[0] - box.x) / box.w, (c[1] - box.y) / box.h];
  };
  const local = (e: { clientX: number; clientY: number }, el: Element): P => {
    const r = (el.closest(".canvas") ?? el).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const begin = (i: number, key: "p" | HandleKey) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as Element;
    const s0 = local(e, el);
    drag.current = { i, key, start: toN(s0[0], s0[1]), env: structuredClone(session.env), moved: false };
    const move = (ev: PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      const s = local(ev, el);
      const q = toN(s[0], s[1]);
      let dx = q[0] - g.start[0];
      let dy = q[1] - g.start[1];
      // Shift: constrain to the dominant axis.
      if (ev.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const next = structuredClone(g.env);
      const n0 = g.env.nodes[g.i]!;
      const n = next.nodes[g.i]!;
      const sh = (p: P): P => [p[0] + dx, p[1] + dy];
      if (g.key === "p") {
        (["p", "l", "r", "u", "d"] as const).forEach((k) => (n[k] = sh(n0[k])));
      } else {
        n[g.key] = sh(n0[g.key]);
        // Alt: mirror the opposite handle so the node stays smooth.
        if (ev.altKey) {
          const opp: Record<HandleKey, HandleKey> = { l: "r", r: "l", u: "d", d: "u" };
          const o = opp[g.key];
          const v: P = [n[g.key][0] - n.p[0], n[g.key][1] - n.p[1]];
          const len0 = Math.hypot(n0[o][0] - n0.p[0], n0[o][1] - n0.p[1]);
          const lv = Math.hypot(v[0], v[1]) || 1;
          n[o] = [n.p[0] - (v[0] / lv) * len0, n.p[1] - (v[1] / lv) * len0];
        }
      }
      g.moved = true;
      dragEnvelope(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const g = drag.current;
      drag.current = null;
      if (g?.moved) releaseEnvelope(useTypeLab.getState().envelope?.env ?? g.env);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pt = (q: P) => {
    const s = toS(q);
    return `${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
  };
  // Iso-curves of the mesh (faint) and the patch edges (exact cubics).
  const iso: string[] = [];
  const steps = 4;
  for (let k = 1; k < steps * env.cols; k++) {
    if (k % steps === 0) continue;
    const u = k / (steps * env.cols);
    iso.push("M" + Array.from({ length: 25 }, (_, j) => pt(envelopeAt(env, u, j / 24))).join("L"));
  }
  for (let k = 1; k < steps * env.rows; k++) {
    if (k % steps === 0) continue;
    const v = k / (steps * env.rows);
    iso.push("M" + Array.from({ length: 41 }, (_, j) => pt(envelopeAt(env, j / 40, v))).join("L"));
  }
  const edges: string[] = [];
  const node = (r: number, c: number) => env.nodes[envIndex(env, r, c)]!;
  for (let r = 0; r <= env.rows; r++)
    for (let c = 0; c < env.cols; c++) {
      const a = node(r, c), b = node(r, c + 1);
      edges.push(`M${pt(a.p)}C${pt(a.r)} ${pt(b.l)} ${pt(b.p)}`);
    }
  for (let c = 0; c <= env.cols; c++)
    for (let r = 0; r < env.rows; r++) {
      const a = node(r, c), b = node(r + 1, c);
      edges.push(`M${pt(a.p)}C${pt(a.d)} ${pt(b.u)} ${pt(b.p)}`);
    }

  const handlesOf = (r: number, c: number): HandleKey[] => [
    ...(c > 0 ? (["l"] as const) : []),
    ...(c < env.cols ? (["r"] as const) : []),
    ...(r > 0 ? (["u"] as const) : []),
    ...(r < env.rows ? (["d"] as const) : []),
  ];

  return (
    <g className="warp-env" data-ui>
      {/* While the envelope is open, the regular resize/rotate handles step aside. */}
      <style>{`svg.overlay .handle, svg.overlay .rot-handle, svg.overlay .sel-box, svg.overlay .sel-thin { display: none; }`}</style>
      <path className="warp-env-iso" d={iso.join("")} />
      <path className="warp-env-edge" d={edges.join("")} />
      {Array.from({ length: env.rows + 1 }, (_, r) =>
        Array.from({ length: env.cols + 1 }, (_, c) => {
          const i = envIndex(env, r, c);
          const n: EnvelopeNodeT = env.nodes[i]!;
          const p = toS(n.p);
          return (
            <g key={i}>
              {handlesOf(r, c).map((k) => {
                const h = toS(n[k]);
                return (
                  <g key={k}>
                    <line x1={p[0]} y1={p[1]} x2={h[0]} y2={h[1]} className="warp-env-arm" />
                    <circle cx={h[0]} cy={h[1]} r={4} className="warp-env-handle" onPointerDown={begin(i, k)}>
                      <title>Drag to bend this edge · ⌥ keeps the node smooth · ⇧ constrains</title>
                    </circle>
                  </g>
                );
              })}
              <rect x={p[0] - 5} y={p[1] - 5} width={10} height={10} rx={2} className="warp-env-node" onPointerDown={begin(i, "p")}>
                <title>Drag to move this point of the envelope (handles follow)</title>
              </rect>
            </g>
          );
        }),
      )}
    </g>
  );
}
