import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FrameNodeT } from "@brusshy/core";
import { useStore } from "../lib/store";
import { setRootAttrs } from "../export/raster";
import { StyleApplier, type BuiltAnimation } from "./engine";
import { player, restTime, usePlayer } from "./player";

/** The animated artwork, driven by the shared player clock (inline styles per frame). */
export function AnimSvg({ built, className }: { built: BuiltAnimation; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = setRootAttrs(built.svg, { width: "100%", height: "100%" });
    const applier = new StyleApplier(host, built.plan);
    return player.subscribe((t) => applier.apply(usePlayer.getState().mode === "off" ? restTime(built.plan) : t));
  }, [built]);
  return <div ref={ref} className={className} aria-hidden />;
}

/**
 * While previewing, the version's artwork on the canvas is swapped for the animated copy,
 * exactly on top of its artboard. Clicking the canvas or Esc returns to editing.
 */
export function CanvasOverlay({ built, frameId }: { built: BuiltAnimation; frameId: string }) {
  const mode = usePlayer((s) => s.mode);
  const view = useStore((s) => s.view);
  const camera = useStore((s) => s.camera);
  const f = useStore((s) => s.doc?.nodes[frameId]) as FrameNodeT | undefined;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const active = mode !== "off" && view !== "3d";

  useEffect(() => {
    setHost(active ? document.querySelector<HTMLElement>(".pane-2d .canvas") : null);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const style = document.createElement("style");
    style.textContent = `.canvas svg.scene [data-frame="${CSS.escape(frameId)}"] > :not(.frame-hit){visibility:hidden}`;
    document.head.appendChild(style);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") player.stop();
      else if (e.key === " " && !(e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable]")) {
        e.preventDefault();
        e.stopPropagation();
        player.toggle();
      }
    };
    const onDown = () => player.stop();
    window.addEventListener("keydown", onKey, true);
    host?.addEventListener("pointerdown", onDown);
    return () => {
      style.remove();
      window.removeEventListener("keydown", onKey, true);
      host?.removeEventListener("pointerdown", onDown);
    };
  }, [active, frameId, host]);

  if (!active || !host || !f) return null;
  const z = camera.zoom;
  return createPortal(
    <div className="anim-overlay" style={{ left: camera.x + f.transform.x * z, top: camera.y + f.transform.y * z, width: f.width * z, height: f.height * z }}>
      <AnimSvg built={built} className="anim-overlay-art" />
    </div>,
    host,
  );
}
