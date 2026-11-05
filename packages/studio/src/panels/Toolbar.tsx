import { useRef } from "react";
import { setTool, useStore, type Tool } from "../lib/store";
import { addReferenceImage } from "../lib/actions";
import { Icons } from "./icons";
import { t } from "../lib/i18n";
import { ShapesButton, ShapesPanel } from "../shapes/entry";

const TOOLS: { id: Tool; key: string; icon: keyof typeof Icons }[] = [
  { id: "select", key: "V", icon: "select" },
  { id: "node", key: "A", icon: "node" },
  { id: "hand", key: "H", icon: "hand" },
  { id: "brush", key: "B", icon: "brush" },
  { id: "rect", key: "R", icon: "rect" },
  { id: "ellipse", key: "O", icon: "ellipse" },
  { id: "polygon", key: "P", icon: "polygon" },
  { id: "star", key: "S", icon: "star" },
  { id: "text", key: "T", icon: "text" },
  { id: "comment", key: "C", icon: "comment" },
  { id: "builder", key: "M", icon: "builder" },
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((x) => [x.key.toLowerCase(), x.id]));

const BRUSH_COLORS = ["#0b0c0e", "#585f63", "#ff4d1f", "#2f5bff", "#1f9d55"];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const brush = useStore((s) => s.brush);
  const file = useRef<HTMLInputElement>(null);
  if (view === "3d") return null;
  return (
    <>
      <div className="panel toolbar" data-ui>
        {TOOLS.map((x, i) => (
          <div key={x.id} className="tool-wrap">
            {(i === 3 || i === 4 || i === 9 || i === 10) && <div className="tool-sep" />}
            <button className={`icon-btn${tool === x.id ? " active" : ""}`} onClick={() => setTool(x.id)} aria-label={t(`tool.${x.id}`)}>
              {Icons[x.icon]}
              <span className="tip">
                {t(`tool.${x.id}`)} <span className="kbd">{x.key}</span>
              </span>
            </button>
          </div>
        ))}
        <div className="tool-sep" />
        <ShapesButton />
        <button className="icon-btn" onClick={() => file.current?.click()} aria-label={t("tool.image")}>
          {Icons.image}
          <span className="tip">
            {t("tool.image")} <span className="kbd">⌘V</span>
          </span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addReferenceImage(f);
            e.target.value = "";
          }}
        />
      </div>
      {tool === "brush" && (
        <div className="panel brush-bar" data-ui>
          <span className="label">{t("brush.size")}</span>
          <input type="range" min={1} max={40} value={brush.size} onChange={(e) => useStore.setState({ brush: { ...brush, size: Number(e.target.value) } })} />
          <span className="num">{brush.size}</span>
          <div className="brush-colors">
            {BRUSH_COLORS.map((c) => (
              <button key={c} className={`dot${brush.color === c ? " on" : ""}`} style={{ background: c }} onClick={() => useStore.setState({ brush: { ...brush, color: c } })} aria-label={c} />
            ))}
          </div>
          <span className="hint">{t("brush.hint")}</span>
        </div>
      )}
      <ShapesPanel />
    </>
  );
}
