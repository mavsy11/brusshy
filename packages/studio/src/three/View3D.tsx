import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIGHTING, MATERIALS, STYLES, type DocT, type SceneT, type StylePreset } from "@brusshy/core";
import { activeFrameId, dispatch, toast, useFrameDoc, useStore } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import { ViewEngine } from "./viewEngine";
import "./view3d.css";

/** CSS stand-ins for each material, used by the style picker swatches. */
const SWATCH: Record<string, string> = {
  "soft-plastic": "radial-gradient(circle at 32% 28%, #ffffff 0 7%, #eceef0 28%, #b9bec3 100%)",
  "glossy-enamel": "radial-gradient(circle at 30% 26%, #ffffff 0 9%, #ff6a3d 26%, #b32c0b 100%)",
  "frosted-glass": "radial-gradient(circle at 34% 30%, rgba(255,255,255,.98) 0 10%, rgba(226,233,240,.85) 40%, rgba(160,174,190,.9) 100%)",
  "clear-glass": "radial-gradient(circle at 30% 26%, #ffffff 0 7%, #bfe0ff 24%, #24303d 72%, #0b0c0e 100%)",
  "polished-chrome": "linear-gradient(165deg, #ffffff 0%, #7d848b 36%, #f6f8fa 50%, #2f3439 68%, #cfd4d8 100%)",
  "brushed-metal":
    "repeating-linear-gradient(90deg, rgba(255,255,255,.18) 0 1px, transparent 1px 3px), linear-gradient(140deg, #e6e9ec, #9aa1a8 52%, #d7dbde)",
  gold: "linear-gradient(150deg, #fff3c9 0%, #e6b85c 34%, #9c6a1c 66%, #f7d88e 100%)",
  copper: "linear-gradient(150deg, #ffd9bd 0%, #d08a5b 38%, #86451f 70%, #eaa97d 100%)",
  iridescent: "conic-gradient(from 210deg, #ffd3f1, #c9d9ff, #c6ffe9, #fff2c2, #ffd3f1)",
  neon: "radial-gradient(circle, #ffe3fb 0 12%, #ff4dd8 30%, #7a2cff 52%, #120a24 74%)",
  ceramic: "radial-gradient(circle at 32% 28%, #ffffff 0 12%, #f4f2ed 42%, #cdc8be 100%)",
  stone: "radial-gradient(circle at 34% 30%, #ebe8e2 0%, #b8b1a5 60%, #8c8478 100%)",
};

const BACKGROUNDS: { label: string; value: string | null }[] = [
  { label: "Transparent", value: null },
  { label: "Paper", value: "#f4f5f5" },
  { label: "White", value: "#ffffff" },
  { label: "Stone", value: "#e9e6e0" },
  { label: "Ink", value: "#0b0c0e" },
  { label: "Umber", value: "#14110d" },
  { label: "Night", value: "#07070a" },
];

type Live = Partial<Pick<SceneT, "depth" | "bevel" | "bloom">>;

function currentStyle(sc: SceneT): StylePreset | undefined {
  return STYLES.find(
    (s) =>
      s.material === sc.material &&
      s.lighting === sc.lighting &&
      s.depth === sc.depth &&
      s.bevel === sc.bevel &&
      s.bloom === sc.bloom &&
      s.background === sc.background,
  );
}

function Swatch({ material, bg, size = 26 }: { material: string; bg?: string | null; size?: number }) {
  return (
    <span className="v3d-swatch" style={{ width: size, height: size, background: bg ?? undefined }} data-empty={bg ? undefined : ""}>
      <i style={{ background: SWATCH[material] ?? SWATCH["soft-plastic"] }} data-neon={material === "neon" ? "" : undefined} />
    </span>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onLive: (v: number) => void;
  onCommit: () => void;
}) {
  const { label, value, min, max, step, format, onLive, onCommit } = props;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="v3d-slider" title={label}>
      <span className="v3d-slider-head">
        <span className="label">{label}</span>
        <span className="v3d-val">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </label>
  );
}

const Icon = {
  camera: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.2c0-.9.7-1.6 1.6-1.6h1.7l1.2-1.8h5l1.2 1.8h1.7c.9 0 1.6.7 1.6 1.6v7.2c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6z" />
      <circle cx="10" cy="10.6" r="2.9" />
    </svg>
  ),
  reset: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 9.5a5.6 5.6 0 1 1 1.6 4.4" />
      <path d="M4.2 5.4v4.2h4.2" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5 6 4.5l3 3" />
    </svg>
  ),
};

/** Interactive 3D view of the active document (owned by the 3D module). Fills its container. */
export function View3D(props: { doc?: DocT | null } = {}) {
  const storeDoc = useFrameDoc();
  const doc = props.doc !== undefined ? props.doc : storeDoc;
  const fontV = useFontVersion((s) => s.v);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewEngine | null>(null);
  const [live, setLive] = useState<Live>({});
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "styles" | "bg">(null);
  const built = useRef(false);

  // Engine lifecycle.
  useEffect(() => {
    const host = hostRef.current!;
    try {
      engineRef.current = new ViewEngine(host);
    } catch (e) {
      setError("WebGL isn't available in this browser.");
      console.error(e);
    }
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      built.current = false;
      lastBuild.current = null;
    };
  }, []);

  // Rebuild (debounced) whenever the doc, bevel preview or fonts change. Depth and
  // glow drags preview instantly by stretching/retuning the built scene.
  const lastBuild = useRef<{ doc: DocT; fontV: number; bevel?: number } | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !doc) return;
    const prev = lastBuild.current;
    if (built.current && prev && prev.doc === doc && prev.fontV === fontV && prev.bevel === live.bevel) {
      engine.preview({ depth: live.depth, bloom: live.bloom });
      return;
    }
    const run = () => {
      try {
        const res = engine.setDoc(doc, live.bevel !== undefined ? { bevel: live.bevel } : {});
        lastBuild.current = { doc, fontV, bevel: live.bevel };
        engine.preview({ depth: live.depth, bloom: live.bloom });
        setEmpty(res.meshCount === 0 && !res.pendingFonts);
        built.current = true;
      } catch (e) {
        console.error("[3d] build failed", e);
      }
    };
    if (!built.current) {
      run();
      return;
    }
    const t = window.setTimeout(run, 40);
    return () => window.clearTimeout(t);
  }, [doc, live, fontV]);

  // Close popovers on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".v3d-pop, .v3d-pop-trigger")) setOpen(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const sc = doc?.scene;
  // Each version (frame) has its own 3D look.
  const setScene = useCallback((set: Record<string, unknown>, label: string) => {
    const fid = activeFrameId();
    if (fid) dispatch([{ op: "update", id: fid, set: { scene: set } }], label);
  }, []);

  const liveRef = useRef<Live>({});
  liveRef.current = live;
  const commitLive = useCallback(() => {
    const l = liveRef.current;
    if (!Object.keys(l).length) return;
    liveRef.current = {};
    setScene(l as Record<string, unknown>, "3D settings");
    setLive({});
  }, [setScene]);

  const applyStyle = (s: StylePreset) => {
    setScene({ material: s.material, lighting: s.lighting, depth: s.depth, bevel: s.bevel, bloom: s.bloom, background: s.background }, `Style: ${s.label}`);
    setOpen(null);
  };

  const saveCamera = () => {
    const c = engineRef.current?.readCamera();
    if (!c) return;
    const r = (n: number) => Math.round(n * 10) / 10;
    setScene({ camera: { azimuth: r(c.azimuth), elevation: r(c.elevation), distance: Math.round(c.distance * 100) / 100 } }, "Save camera");
    toast("Camera saved");
  };

  const style = useMemo(() => (sc ? currentStyle(sc) : undefined), [sc]);
  const v = { depth: live.depth ?? sc?.depth ?? 24, bevel: live.bevel ?? sc?.bevel ?? 3, bloom: live.bloom ?? sc?.bloom ?? 0 };

  return (
    <div className="v3d" data-bg={sc?.background ? "solid" : "none"}>
      <div className="v3d-host" ref={hostRef} />
      {error && <div className="v3d-note">{error}</div>}
      {!error && doc && empty && <div className="v3d-note">Nothing to extrude yet — draw a shape, path or text.</div>}

      {sc && !error && (
        <div className="v3d-bar panel" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className={"v3d-style v3d-pop-trigger" + (open === "styles" ? " on" : "")}
            onClick={() => setOpen(open === "styles" ? null : "styles")}
            title="Style presets"
          >
            <Swatch material={sc.material} bg={sc.background} size={22} />
            <span className="v3d-style-name">{style?.label ?? "Custom"}</span>
            <span className="v3d-chev">{Icon.chevron}</span>
          </button>

          <span className="v3d-sep" />

          <label className="v3d-sel" title="Material">
            <span className="label">Material</span>
            <select value={sc.material} onChange={(e) => setScene({ material: e.target.value }, "Material")}>
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="v3d-sel" title="Lighting">
            <span className="label">Light</span>
            <select value={sc.lighting} onChange={(e) => setScene({ lighting: e.target.value }, "Lighting")}>
              {LIGHTING.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <span className="v3d-sep" />

          <Slider label="Depth" value={v.depth} min={0} max={120} step={1} onLive={(x) => setLive((l) => ({ ...l, depth: x }))} onCommit={commitLive} />
          <Slider label="Bevel" value={v.bevel} min={0} max={16} step={0.5} onLive={(x) => setLive((l) => ({ ...l, bevel: x }))} onCommit={commitLive} />
          <Slider
            label="Glow"
            value={v.bloom}
            min={0}
            max={3}
            step={0.05}
            format={(x) => x.toFixed(2)}
            onLive={(x) => setLive((l) => ({ ...l, bloom: x }))}
            onCommit={commitLive}
          />

          <span className="v3d-sep" />

          <button
            className={"v3d-bgbtn v3d-pop-trigger" + (open === "bg" ? " on" : "")}
            title="Background"
            onClick={() => setOpen(open === "bg" ? null : "bg")}
          >
            <span className="v3d-chip" data-empty={sc.background ? undefined : ""} style={{ background: sc.background ?? undefined }} />
          </button>
          <button className="icon-btn" title="Reset to saved camera" onClick={() => engineRef.current?.resetCamera()}>
            {Icon.reset}
          </button>
          <button className="btn small v3d-save" title="Save the current angle as the render camera" onClick={saveCamera}>
            {Icon.camera}
            <span>Save camera</span>
          </button>

          {open === "styles" && (
            <div className="v3d-pop v3d-styles">
              <div className="v3d-pop-head label">Style</div>
              <div className="v3d-grid">
                {STYLES.map((s) => (
                  <button key={s.id} className={"v3d-card" + (style?.id === s.id ? " on" : "")} onClick={() => applyStyle(s)}>
                    <Swatch material={s.material} bg={s.background} size={44} />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {open === "bg" && (
            <div className="v3d-pop v3d-bgpop">
              <div className="v3d-pop-head label">Background</div>
              <div className="v3d-bgrow">
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b.label}
                    title={b.label}
                    className={"v3d-chip big" + (sc.background === b.value ? " on" : "")}
                    data-empty={b.value ? undefined : ""}
                    style={{ background: b.value ?? undefined }}
                    onClick={() => setScene({ background: b.value }, "Background")}
                  />
                ))}
                <label className="v3d-chip big v3d-custom" title="Custom color">
                  <input
                    type="color"
                    value={sc.background ?? "#f4f5f5"}
                    onChange={(e) => setScene({ background: e.target.value }, "Background")}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
