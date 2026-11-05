import { useEffect } from "react";
import { toggleRulers, activeFrameId, redo, select, setTool, setView, undo, useStore } from "./store";
import {
  convertToPath,
  copySelection,
  selectAllInFrame,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  nudge,
  pasteInternal,
  reorder,
  ungroupSelection,
} from "./actions";
import { fitCamera, fitFrame } from "../canvas/camera";
import { animateCamera, targetZoom, zoomToAnimated } from "../canvas/cameraAnim";
import { contentBox, selectionBox } from "./geom";
import { TOOL_KEYS } from "../panels/Toolbar";
import { copyAsPng, copyAsSvg, toggleOutlines } from "./quick";

/** Global keyboard shortcuts (ignored while typing in inputs). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const s = useStore.getState();
      const doc = s.doc;
      if (!doc) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      // ⌘Y = Outlines view (redo stays on ⇧⌘Z); Ctrl+Y still redoes on Windows/Linux.
      if (mod && k === "y") return (e.preventDefault(), e.metaKey ? toggleOutlines() : redo());
      if (mod && k === "a") return (e.preventDefault(), selectAllInFrame());
      if (mod && k === "d") return (e.preventDefault(), duplicateSelection());
      if (mod && k === "g") return (e.preventDefault(), e.shiftKey ? ungroupSelection() : groupSelection());
      if (mod && e.shiftKey && e.code === "KeyC") return (e.preventDefault(), void (e.altKey ? copyAsPng() : copyAsSvg()));
      if (mod && k === "c") return copySelection();
      if (mod && k === "x") return (copySelection(), deleteSelection());
      if (mod && k === "v") {
        // System paste (images/SVG) is handled by the canvas paste listener; internal clipboard first.
        if (pasteInternal()) e.preventDefault();
        return;
      }
      if (mod && k === "]") return (e.preventDefault(), reorder(e.altKey ? "top" : "up"));
      if (mod && k === "[") return (e.preventDefault(), reorder(e.altKey ? "bottom" : "down"));
      if (mod && (k === "0" || k === "1" || k === "2")) {
        e.preventDefault();
        if (k === "0") animateCamera(fitCamera(doc));
        if (k === "1") zoomToAnimated(1);
        if (k === "2") {
          const b = s.selection.length ? selectionBox(doc, s.selection) : contentBox(doc);
          if (b) animateCamera(fitCamera(doc, b, 80));
        }
        return;
      }
      if (mod && (k === "=" || k === "+")) return (e.preventDefault(), zoomToAnimated(targetZoom() * 1.25));
      if (mod && k === "-") return (e.preventDefault(), zoomToAnimated(targetZoom() / 1.25));
      if (mod) return;

      if (k === "backspace" || k === "delete") return (e.preventDefault(), deleteSelection());
      if (k === "escape") {
        if (s.exportOpen || s.helpOpen) return useStore.setState({ exportOpen: false, helpOpen: false });
        if (s.openAnnotation) return useStore.setState({ openAnnotation: null });
        if (s.tool !== "select") return setTool("select");
        return select([]);
      }
      if (k.startsWith("arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        return nudge(k === "arrowleft" ? -d : k === "arrowright" ? d : 0, k === "arrowup" ? -d : k === "arrowdown" ? d : 0);
      }
      if (k === "?" || (e.shiftKey && k === "/")) return useStore.setState({ helpOpen: true });
      // ⇧1 / ⇧2 by physical key: with Shift held, e.key is "!" / "@" on most layouts.
      if (e.shiftKey && e.code === "Digit1") return animateCamera(fitCamera(doc));
      if (e.shiftKey && e.code === "Digit2") {
        const fid = activeFrameId(doc);
        if (fid) animateCamera(fitFrame(doc, fid));
        return;
      }
      if (k === "2" && !e.shiftKey) return setView("2d");
      if (k === "3" && !e.shiftKey) return setView("3d");
      if (k === "4" && !e.shiftKey) return setView("split");
      if (k === "n") return useStore.setState({ showAnnotations: !s.showAnnotations });
      if (k === "r" && e.shiftKey) return toggleRulers();
      if (k === "e" && !e.shiftKey) return useStore.setState({ exportOpen: true });
      const tool = TOOL_KEYS[k];
      if (tool) {
        if (tool === "node") {
          const id = s.selection[0];
          const n = id ? doc.nodes[id] : undefined;
          if (n && (n.type === "path" || n.type === "shape") && convertToPath(n.id)) useStore.setState({ editingId: id });
        }
        setTool(tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
