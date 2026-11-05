/**
 * Dev-only harness for the export module (no daemon needed).
 * Open http://localhost:5182/src/export/harness/harness.html with `npx vite --port 5182 --strictPort`.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "../../styles/app.css";
import { Doc, type DocT, type ExportFormat } from "@brusshy/core";
import { useStore } from "../../lib/store";
import { ExportDialog } from "../ExportDialog";
import { readIcoHeader } from "../ico";
import { runExport, zipFiles, type ExportFile, type ExportItem } from "../pipeline";
import { render2D } from "../render2d";
import { formatBytes } from "../util";

const now = Date.now();
const style = (o: Record<string, unknown>) => ({
  fill: "#0b0c0e",
  stroke: null,
  strokeWidth: 0,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  opacity: 1,
  fillRule: "nonzero",
  ...o,
});

/** Compass: stroked ring, gradient needle, "NORTH" in Cinzel 700 + working layers and a pin. */
export const sampleDoc: DocT = Doc.parse({
  id: "doc_harness",
  name: "Compass Logo",
  artboard: { width: 1024, height: 1024, background: null },
  root: ["ring", "ring2", "needle", "south", "hub", "word", "sketch", "ref"],
  nodes: {
    ring: { id: "ring", type: "shape", shape: "ellipse", width: 520, height: 520, transform: { x: 252, y: 130 }, style: style({ fill: null, stroke: "#0b0c0e", strokeWidth: 28 }) },
    ring2: { id: "ring2", type: "shape", shape: "ellipse", width: 440, height: 440, transform: { x: 292, y: 170 }, style: style({ fill: null, stroke: "#8e9599", strokeWidth: 4 }) },
    needle: {
      id: "needle",
      type: "path",
      d: "M0 -210L46 0L-46 0Z",
      transform: { x: 512, y: 390, rotation: 18 },
      style: style({ fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#ff7a45" }, { offset: 1, color: "#c2260c" }] } }),
    },
    south: { id: "south", type: "path", d: "M0 210L46 0L-46 0Z", transform: { x: 512, y: 390, rotation: 18 }, style: style({ fill: "#0b0c0e" }) },
    hub: { id: "hub", type: "shape", shape: "ellipse", width: 40, height: 40, transform: { x: 492, y: 370 }, style: style({ fill: "#f4f5f5", stroke: "#0b0c0e", strokeWidth: 6 }) },
    word: {
      id: "word",
      type: "text",
      text: "NORTH",
      fontFamily: "Cinzel",
      fontWeight: 700,
      fontSize: 124,
      letterSpacing: 18,
      anchor: "middle",
      transform: { x: 512, y: 880 },
      style: style({ fill: "#0b0c0e" }),
    },
    sketch: {
      id: "sketch",
      type: "sketch",
      strokes: [
        { points: Array.from({ length: 40 }, (_, i) => [140 + i * 6, 120 + Math.sin(i / 4) * 30, 0.5]), size: 10, color: "#2a6df4" },
      ],
      style: style({ opacity: 0.8 }),
    },
    ref: {
      id: "ref",
      type: "reference",
      src:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ffe08a"/><circle cx="100" cy="100" r="70" fill="#f3b33d"/></svg>'),
      width: 160,
      height: 160,
      transform: { x: 820, y: 40 },
      style: style({ opacity: 0.6 }),
    },
  },
  annotations: {
    a1: { id: "a1", nodeId: "needle", x: 560, y: 220, note: "Sharper tip", createdAt: now, updatedAt: now },
    a2: { id: "a2", nodeId: "word", x: 300, y: 850, note: "More tracking", createdAt: now, updatedAt: now },
  },
  createdAt: now,
  updatedAt: now,
});

// Capture downloads (blob links) instead of saving them to disk.
declare global {
  interface Window {
    __downloads: { name: string; href: string }[];
    __results: Record<string, unknown>;
  }
}
window.__downloads = [];
window.__results = {};
const origClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  if (this.download && this.href.startsWith("blob:")) {
    window.__downloads.push({ name: this.download, href: this.href });
    return;
  }
  origClick.call(this);
};

useStore.setState({ doc: sampleDoc, connected: false, projectDir: "/tmp/demo" });

const ALL: ExportFormat[] = ["svg", "png", "mono", "icons", "png3d", "glb", "video", "brandkit"];

interface Out {
  name: string;
  size: number;
  url: string;
  type: string;
}

function Harness() {
  const [items, setItems] = useState<ExportItem[]>([]);
  const [files, setFiles] = useState<Out[]>([]);
  const [checks, setChecks] = useState<string[]>([]);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function runAll() {
    setBusy(true);
    setChecks([]);
    const t0 = performance.now();
    const got: ExportFile[] = await runExport(
      sampleDoc,
      { formats: ALL, pngSizes: [256, 1024, 4096], size3d: 1024, video: { seconds: 3 }, trim: false },
      setItems,
    );
    const outs = got.map((f) => ({ name: f.name, size: f.blob.size, url: URL.createObjectURL(f.blob), type: f.blob.type }));
    setFiles(outs);
    const c: string[] = [`${got.length} files in ${Math.round(performance.now() - t0)} ms`];
    const svg = got.find((f) => f.name.endsWith(".svg") && !f.name.includes("mono") && !f.name.includes("/"));
    if (svg) {
      const text = await svg.blob.text();
      window.__results.svg = text;
      c.push(`SVG: ${text.includes("<text") ? "FAIL has <text>" : "OK no <text> (outlined)"}; ${text.length} chars; gradient=${text.includes("linearGradient")}`);
    }
    const ico = got.find((f) => f.name.endsWith(".ico"));
    if (ico) {
      const h = readIcoHeader(new Uint8Array(await ico.blob.arrayBuffer()));
      window.__results.ico = h;
      c.push(`ICO: ${h.count} entries ${h.entries.map((e) => `${e.width}x${e.height}/${e.bpp}bpp png=${e.png}`).join(", ")}`);
    }
    for (const f of got.filter((f) => f.name.endsWith(".png"))) {
      const bmp = await createImageBitmap(f.blob);
      c.push(`PNG ${f.name}: ${bmp.width}x${bmp.height}`);
    }
    const pdf = got.find((f) => f.name.endsWith(".pdf"));
    if (pdf) {
      const head = new TextDecoder().decode(new Uint8Array(await pdf.blob.slice(0, 8).arrayBuffer()));
      const pages = ((await pdf.blob.text()).match(/\/Type \/Page\b/g) ?? []).length;
      c.push(`PDF: header ${head.trim()} · ${pages} pages · ${formatBytes(pdf.blob.size)}`);
      window.__results.pdfUrl = outs.find((o) => o.name === pdf.name)?.url;
    }
    const zip = await zipFiles(got);
    c.push(`ZIP: ${formatBytes(zip.size)}`);
    window.__results.zipUrl = URL.createObjectURL(zip);
    window.__results.items = items;
    window.__results.files = outs;
    setChecks(c);
    setBusy(false);
  }

  async function runRender() {
    const r = await render2D(sampleDoc, { view: "2d", width: 768, transparent: false, includeWorking: true, showAnnotations: true });
    setPreview(`data:image/png;base64,${r.png}`);
    window.__results.render2d = { width: r.width, height: r.height, bytes: r.png.length };
  }

  return (
    <div style={{ padding: 24, fontFamily: "var(--font)", height: "100vh", overflow: "auto", userSelect: "text" }}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Export harness</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="btn primary" disabled={busy} onClick={() => void runAll()} id="run-all">
          Run all formats
        </button>
        <button className="btn" onClick={() => void runRender()} id="run-render">
          render2D (working + pins)
        </button>
        <button className="btn" onClick={() => useStore.setState({ exportOpen: true })} id="open-dialog">
          Open dialog
        </button>
      </div>
      <pre id="checks" style={{ fontSize: 12, background: "#fff", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>
        {checks.join("\n") || "—"}
      </pre>
      <ul id="items" style={{ fontSize: 12 }}>
        {items.map((i) => (
          <li key={i.id}>
            {i.label}: {i.status} {i.progress !== undefined ? Math.round(i.progress * 100) + "%" : ""} {i.error ?? ""} {i.note ?? ""}
          </li>
        ))}
      </ul>
      <ul id="files" style={{ fontSize: 12, columns: 2 }}>
        {files.map((f) => (
          <li key={f.name}>
            <a href={f.url} target="_blank" rel="noreferrer">
              {f.name}
            </a>{" "}
            · {formatBytes(f.size)}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        {files
          .filter((f) => /\.(png|svg)$/.test(f.name) && !/4096/.test(f.name))
          .map((f) => (
            <figure key={f.name} style={{ margin: 0, background: f.name.includes("white") ? "#0b0c0e" : "#fff", padding: 8, borderRadius: 8, border: "1px solid #dfe2e3" }}>
              <img src={f.url} style={{ width: 120, height: 120, objectFit: "contain", display: "block", imageRendering: /-(16|32)\./.test(f.name) ? "pixelated" : "auto" }} />
              <figcaption style={{ fontSize: 10, color: "#8e9599", marginTop: 4, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</figcaption>
            </figure>
          ))}
      </div>
      {preview && <img id="render-preview" src={preview} style={{ width: 384, marginTop: 16, border: "1px solid #dfe2e3" }} />}
      <ExportDialog />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
