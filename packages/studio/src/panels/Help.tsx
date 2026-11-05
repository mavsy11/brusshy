import { useState } from "react";
import { useStore } from "../lib/store";

const PROMPTS = [
  "Design a logo for “Northwind”, a coffee roaster. Modern, warm, works at favicon size.",
  "Turn my sketch into a clean vector logo, 1800s engraved style, then make it gold in 3D.",
  "Check my notes on the canvas and apply them.",
  "Give me 3 directions for a fintech logo called Ledgerly, then refine the best one.",
  "Export the logo as SVG, PNG and a favicon kit.",
];

const KEYS: [string, string][] = [
  ["V", "Select · drag to move, handles to resize/rotate"],
  ["A", "Edit nodes · double-click a path to add a node"],
  ["B", "Sketch brush · your AI cleans it up"],
  ["R  O  P  S", "Rectangle, ellipse, polygon, star"],
  ["T", "Text (real fonts, outlined on export)"],
  ["C", "Pin a note for your AI on any part"],
  ["M", "Shape builder · click regions between guide circles to fill, ⌥-click to cut"],
  ["⇧G", "Show / hide construction guides"],
  ["Space / H", "Pan · pinch or ⌘ + scroll to zoom"],
  ["⌘0  ⌘1  ⌘2", "Fit all versions · 100% · zoom to selection"],
  ["2  3  4", "2D · 3D · split view"],
  ["⌘D  ⌘G  ⇧⌘G", "Duplicate · group · ungroup"],
  ["Click artboard", "Select a whole version · ⌘D makes V2 next to it"],
  ["⇧1  ⇧2", "Fit all versions · zoom to the active version"],
  ["⌘[  ⌘]", "Send backward · bring forward"],
  ["⌘V", "Paste an image to trace, or SVG code"],
  ["⌘Y", "Outlines view (wireframe, still editable)"],
  ["⇧⌘C  ⌥⇧⌘C", "Copy selection or version as SVG · as PNG"],
  ["N", "Show / hide notes"],
  ["⇧R", "Show / hide rulers"],
  ["E", "Export"],
  ["⇧S  \\", "Stage · only the logo for recording (B background, ←/→ versions, Esc exits)"],
  ["⌘K", "Command palette · every tool, action, version and layer — or ask your AI"],
];

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="copy-line"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        });
      }}
    >
      <code>{text}</code>
      <span className="dim">{ok ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** Onboarding + shortcuts: how to connect an AI and what to ask it. */
export function Help() {
  const open = useStore((s) => s.helpOpen);
  const projectDir = useStore((s) => s.projectDir);
  if (!open) return null;
  const close = () => useStore.setState({ helpOpen: false });
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal help">
        <div className="modal-head">
          <div>
            <div className="label">Brusshy</div>
            <h2>Design logos with your own AI</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <ol className="steps">
          <li>
            <strong>Connect your AI once</strong> — in this folder run:
            <Copy text="npx brusshy init" />
            <span className="muted">Then restart Claude Code (or enable “brusshy” in Cursor → MCP). Works with any MCP client.</span>
          </li>
          <li>
            <strong>Give it context</strong> — drop brand guidelines (.md), palettes or old logos into <code>brusshy/brand/</code>. Sketch with <span className="kbd">B</span> or paste a reference image to trace.
          </li>
          <li>
            <strong>Ask</strong> — it draws here while you watch. Try:
            <div className="prompts">
              {PROMPTS.map((p) => (
                <Copy key={p} text={p} />
              ))}
            </div>
          </li>
          <li>
            <strong>Point and refine</strong> — press <span className="kbd">C</span>, click any part and write what to change. Fine-tune by hand anytime: it costs no tokens.
          </li>
        </ol>
        <div className="label section-label">Shortcuts</div>
        <div className="keys">
          {KEYS.map(([k, v]) => (
            <div key={k} className="key-row">
              <span className="kbd">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        {projectDir && <div className="foot muted">Project: {projectDir}</div>}
      </div>
    </div>
  );
}

/** Shown centered on the active version while it is empty. */
export function FrameEmpty() {
  return (
    <div className="empty" data-ui>
      <div className="empty-card">
        <div className="label">New logo</div>
        <h3>Start with an idea</h3>
        <div className="empty-ways">
          <div>
            <span className="kbd">B</span> Sketch it
          </div>
          <div>
            <span className="kbd">⌘V</span> Paste a reference
          </div>
          <div>
            <span className="kbd">AI</span> Ask your agent
          </div>
        </div>
        <button className="btn small" onClick={() => useStore.setState({ helpOpen: true })}>
          How to connect your AI
        </button>
      </div>
    </div>
  );
}
