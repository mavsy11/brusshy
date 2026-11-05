/** Dev-only harness for the 3D module: a sample compass doc in the real View3D. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "../../styles/app.css";
import { Doc, STYLES, applyOps, type DocT } from "@brusshy/core";
import { useStore } from "../../lib/store";
import { View3D } from "../View3D";
import { exportGLB, render3D, renderVideo } from "../api";

const C = { x: 512, y: 440 };
const now = Date.now();
const node = (n: Record<string, unknown>) => n;

const sample: DocT = Doc.parse({
  id: "harness",
  name: "Compass",
  createdAt: now,
  updatedAt: now,
  root: ["ring", "ticks", "rose", "needleN", "needleS", "hub", "word"],
  nodes: {
    ring: node({
      id: "ring", type: "shape", shape: "ellipse", width: 560, height: 560,
      transform: { x: C.x - 280, y: C.y - 280, rotation: 0, scaleX: 1, scaleY: 1 },
      style: { fill: null, stroke: "#0b0c0e", strokeWidth: 30 },
    }),
    ticks: node({
      id: "ticks", type: "path",
      d: `M${C.x} ${C.y - 238}V${C.y - 200}M${C.x} ${C.y + 200}V${C.y + 238}M${C.x - 238} ${C.y}H${C.x - 200}M${C.x + 200} ${C.y}H${C.x + 238}`,
      style: { fill: null, stroke: "#0b0c0e", strokeWidth: 14, strokeLinecap: "round" },
    }),
    rose: node({
      id: "rose", type: "shape", shape: "star", sides: 4, innerRatio: 0.32, width: 330, height: 330,
      transform: { x: C.x - 165, y: C.y - 165, rotation: 0, scaleX: 1, scaleY: 1 },
      style: { fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#ffb199" }, { offset: 1, color: "#ff4d1f" }] } },
    }),
    needleN: node({
      id: "needleN", type: "path",
      d: `M${C.x} ${C.y - 180}L${C.x + 34} ${C.y}H${C.x - 34}Z`,
      style: { fill: "#ff4d1f" },
      extrude: { depth: 30, bevel: 4, z: 14 },
    }),
    needleS: node({
      id: "needleS", type: "path",
      d: `M${C.x} ${C.y + 180}L${C.x + 34} ${C.y}H${C.x - 34}Z`,
      style: { fill: "#0b0c0e" },
      extrude: { depth: 30, bevel: 4, z: 14 },
    }),
    hub: node({
      id: "hub", type: "shape", shape: "ellipse", width: 40, height: 40,
      transform: { x: C.x - 20, y: C.y - 20, rotation: 0, scaleX: 1, scaleY: 1 },
      style: { fill: "#f4f5f5" },
      extrude: { depth: 30, bevel: 5, z: 22 },
    }),
    word: node({
      id: "word", type: "text", text: "NORTH", fontFamily: "Geist", fontSize: 92, fontWeight: 700, letterSpacing: 18, anchor: "middle",
      transform: { x: C.x, y: C.y + 400, rotation: 0, scaleX: 1, scaleY: 1 },
      style: { fill: "#0b0c0e" },
    }),
  },
});

useStore.setState({ doc: sample });
(window as unknown as Record<string, unknown>).__store = useStore;

function applyStyle(id: string) {
  const s = STYLES.find((x) => x.id === id)!;
  const doc = useStore.getState().doc!;
  const r = applyOps(doc, [{ op: "doc", set: { scene: { material: s.material, lighting: s.lighting, depth: s.depth, bevel: s.bevel, bloom: s.bloom, background: s.background } } }]);
  useStore.setState({ doc: r.doc });
}
(window as unknown as Record<string, unknown>).__style = applyStyle;
(window as unknown as Record<string, unknown>).__grid = async (ids: string[], w = 400, o: Record<string, unknown> = {}) => {
  const base = useStore.getState().doc!;
  const cols = Math.min(ids.length, 3);
  const rows = Math.ceil(ids.length / cols);
  const c = document.createElement("canvas");
  c.width = cols * w;
  c.height = rows * w;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < ids.length; i++) {
    const st = STYLES.find((x) => x.id === ids[i])!;
    const d = applyOps(base, [{ op: "doc", set: { scene: { material: st.material, lighting: st.lighting, depth: st.depth, bevel: st.bevel, bloom: st.bloom, background: st.background } } }]).doc;
    const b = await render3D(d, { width: w, ...o });
    const bmp = await createImageBitmap(b);
    const x = (i % cols) * w, y = Math.floor(i / cols) * w;
    ctx.fillStyle = (i + Math.floor(i / cols)) % 2 ? "#e9ebec" : "#f6f7f7";
    ctx.fillRect(x, y, w, w);
    ctx.drawImage(bmp, x, y);
  }
  const img = document.createElement("img");
  img.id = "__shot";
  img.src = c.toDataURL();
  img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;z-index:999;background:#fff";
  img.onclick = () => img.remove();
  document.getElementById("__shot")?.remove();
  document.body.appendChild(img);
};
(window as unknown as Record<string, unknown>).__render = async (w = 1024, o: Record<string, unknown> = {}) => {
  const b = await render3D(useStore.getState().doc!, { width: w, ...o });
  const img = document.createElement("img");
  img.id = "__shot";
  img.src = URL.createObjectURL(b);
  img.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;z-index:999;background:repeating-conic-gradient(#e4e4e4 0 25%, #fff 0 50%) 0 0/20px 20px";
  img.onclick = () => img.remove();
  document.getElementById("__shot")?.remove();
  document.body.appendChild(img);
  return b.size;
};

const download = (b: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
};

function Harness() {
  const [img, setImg] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const doc = useStore((s) => s.doc)!;
  const run = async (label: string, f: () => Promise<void>) => {
    setMsg(label + "…");
    const t = performance.now();
    try {
      await f();
      setMsg(`${label} done in ${Math.round(performance.now() - t)} ms`);
    } catch (e) {
      setMsg(`${label} failed: ${(e as Error).message}`);
      console.error(e);
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
      <div style={{ display: "flex", gap: 6, padding: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--rule)" }}>
        {STYLES.map((s) => (
          <button key={s.id} className="btn small" onClick={() => applyStyle(s.id)}>
            {s.label}
          </button>
        ))}
        <span style={{ width: 12 }} />
        <button className="btn small" onClick={() => run("PNG 1024", async () => setImg(URL.createObjectURL(await render3D(doc, { width: 1024 }))))}>PNG 1024</button>
        <button className="btn small" onClick={() => run("PNG 4096", async () => setImg(URL.createObjectURL(await render3D(doc, { width: 4096 }))))}>PNG 4096</button>
        <button className="btn small" onClick={() => run("GLB", async () => download(await exportGLB(doc), "logo.glb"))}>GLB</button>
        <button
          className="btn small"
          onClick={() => run("Video", async () => {
            const r = await renderVideo(doc, { seconds: 3, fps: 30, size: 720, onProgress: (p) => setMsg(`Video ${Math.round(p * 100)}%`) });
            setImg(null);
            (window as unknown as Record<string, unknown>).__video = r;
            setMsg(`Video ${r.ext} ${(r.blob.size / 1e6).toFixed(2)} MB`);
          })}
        >
          Video
        </button>
        <span className="label" id="msg">{msg}</span>
      </div>
      <div style={{ position: "relative" }}>
        <View3D />
        {img && (
          <img
            src={img}
            onClick={() => setImg(null)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/16px 16px", border: "1px solid var(--rule)", borderRadius: 8, cursor: "pointer" }}
          />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
