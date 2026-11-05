import { useEffect, useRef } from "react";
import { setGuides, useStore } from "../lib/store";
import { toWorld } from "./camera";
import { selectionBox } from "../lib/geom";

const SIZE = 20;

function niceStep(zoom: number): number {
  // Labeled tick every ~80px on screen, snapped to 1/2/5 × 10^n world units.
  const raw = 80 / zoom;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function draw(canvas: HTMLCanvasElement, axis: "x" | "y", offset: number, zoom: number, mark: [number, number] | null) {
  const dpr = window.devicePixelRatio || 1;
  const len = axis === "x" ? canvas.clientWidth : canvas.clientHeight;
  canvas.width = (axis === "x" ? len : SIZE) * dpr;
  canvas.height = (axis === "x" ? SIZE : len) * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (axis === "y") {
    ctx.translate(SIZE, 0);
    ctx.rotate(Math.PI / 2);
  }
  if (mark) {
    ctx.fillStyle = "rgba(255, 77, 31, 0.1)";
    ctx.fillRect(offset + mark[0] * zoom, 0, (mark[1] - mark[0]) * zoom, SIZE);
  }
  const step = niceStep(zoom);
  const minor = step / 5;
  const start = Math.floor(-offset / zoom / minor) * minor;
  const end = (len - offset) / zoom;
  ctx.strokeStyle = "rgba(11,12,14,0.22)";
  ctx.fillStyle = "rgba(11,12,14,0.5)";
  ctx.font = "500 9px Geist Variable, Geist, system-ui";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = start; v <= end; v += minor) {
    const s = Math.round(offset + v * zoom) + 0.5;
    const isMajor = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ctx.moveTo(s, SIZE);
    ctx.lineTo(s, isMajor ? SIZE - 9 : SIZE - 4);
    if (isMajor) ctx.fillText(String(Math.round(v)), s + 3, 9);
  }
  ctx.stroke();
}

/** Draftsman rulers along the top and left edges, in artboard units. */
export function Rulers() {
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  const camera = useStore((s) => s.camera);
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);

  useEffect(() => {
    if (!top.current || !left.current || !doc) return;
    const b = selection.length ? selectionBox(doc, selection) : null;
    draw(top.current, "x", camera.x, camera.zoom, b ? [b.x, b.x + b.w] : null);
    draw(left.current, "y", camera.y, camera.zoom, b ? [b.y, b.y + b.h] : null);
  });

  // Drag out of a ruler to place a guide; drag a guide back onto a ruler to remove it.
  const startGuide = (axis: "x" | "y", index: number | null) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const host = (e.currentTarget as HTMLElement).closest(".canvas")!.getBoundingClientRect();
    const base = useStore.getState().guides;
    const list = index === null ? [...base, { axis, at: 0 }] : [...base];
    const i = index ?? list.length - 1;
    const move = (ev: PointerEvent) => {
      const [wx, wy] = toWorld(useStore.getState().camera, ev.clientX - host.left, ev.clientY - host.top);
      list[i] = { axis, at: Math.round(axis === "x" ? wx : wy) };
      setGuides([...list]);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const onRuler = axis === "x" ? ev.clientX - host.left < 20 : ev.clientY - host.top < 20;
      if (onRuler) setGuides(list.filter((_, j) => j !== i));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const guides = useStore((s) => s.guides);
  return (
    <>
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <div key={i} data-ui className="user-guide v" style={{ left: camera.x + g.at * camera.zoom }} onPointerDown={startGuide("x", i)} />
        ) : (
          <div key={i} data-ui className="user-guide h" style={{ top: camera.y + g.at * camera.zoom }} onPointerDown={startGuide("y", i)} />
        ),
      )}
      <canvas ref={top} className="ruler ruler-x" data-ui onPointerDown={startGuide("y", null)} title="Drag down to add a guide" />
      <canvas ref={left} className="ruler ruler-y" data-ui onPointerDown={startGuide("x", null)} title="Drag right to add a guide" />
      <div className="ruler-corner" />
    </>
  );
}
