import { useEffect, useRef, useState } from "react";
import { worldMatrix, apply } from "@brusshy/core";
import { dispatch, setLive, useStore } from "../lib/store";
import { toScreen } from "./camera";

/** In-place text editing: an input over the text node, committed on Enter/blur. */
export function TextEditor() {
  const id = useStore((s) => s.textEditId);
  const doc = useStore((s) => s.doc);
  const camera = useStore((s) => s.camera);
  const node = id && doc ? doc.nodes[id] : null;
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (node?.type === "text") {
      setValue(node.text);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.select();
      });
    }
    // Only when the edited node changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!doc || !node || node.type !== "text") return null;
  const m = worldMatrix(doc, node.id);
  const [wx, wy] = apply(m, 0, 0);
  const [x, y] = toScreen(camera, wx, wy);
  const scale = Math.hypot(m[0], m[1]) * camera.zoom;
  const size = node.fontSize * scale;

  const finish = (commit: boolean) => {
    setLive(node.id, null);
    useStore.setState({ textEditId: null });
    const text = value.trim();
    if (commit && text && text !== node.text) dispatch([{ op: "update", id: node.id, set: { text } }], "Edit text");
  };

  return (
    <input
      ref={ref}
      data-ui
      className="text-edit"
      value={value}
      style={{
        left: x,
        top: y - size * 0.82,
        fontSize: size,
        lineHeight: `${size}px`,
        fontFamily: `"${node.fontFamily}", var(--font)`,
        fontWeight: node.fontWeight,
        letterSpacing: node.letterSpacing * scale,
        transform: node.anchor === "middle" ? "translateX(-50%)" : node.anchor === "end" ? "translateX(-100%)" : undefined,
        width: `${Math.max(2, value.length + 1)}ch`,
      }}
      onChange={(e) => {
        setValue(e.target.value);
        setLive(node.id, { text: e.target.value || " " });
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
