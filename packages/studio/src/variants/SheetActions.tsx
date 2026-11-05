import type { PointerEvent } from "react";
import type { FrameNodeT } from "@brusshy/core";
import { useStore } from "../lib/store";
import { askVariant } from "./requests";
import "./commands";
import "./variants.css";

const stop = (e: PointerEvent) => e.stopPropagation();

/**
 * "More like this" / "Vary this" pills on a version's sheet label. They show while the label is
 * hovered and on the active version; empty versions have nothing to vary.
 */
export function SheetActions({ frame }: { frame: FrameNodeT }) {
  const busy = useStore((s) => !!s.chat?.busy);
  if (!frame.children.length) return null;
  const title = busy ? " — your AI is busy: the request waits in the chat box" : "";
  return (
    <span className="sheet-acts">
      <button
        className="sheet-act"
        onPointerDown={stop}
        onClick={() => void askVariant("more", frame.id)}
        title={`Ask your AI for 4 new variants in the same style as ${frame.name || "this version"}${title}`}
      >
        More like this
      </button>
      <button
        className="sheet-act"
        onPointerDown={stop}
        onClick={() => void askVariant("vary", frame.id)}
        title={`Ask your AI for one copy of ${frame.name || "this version"} with a subtle change${title}`}
      >
        Vary this
      </button>
    </span>
  );
}
