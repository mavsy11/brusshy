import { useEffect, useState } from "react";
import type { DocT } from "@brusshy/core";
import { useFrameDoc } from "../lib/store";
import { useQuick } from "../lib/quick";
import { buildSvg, prepareFonts } from "../export/svg";
import { svgToCanvas } from "../export/raster";
import { QIcons } from "./quickIcons";
import { Section } from "./Section";
import "../styles/quickwins.css";

export const SMALL_SIZES = [16, 24, 32, 64] as const;
const USES: Record<number, string> = { 16: "Favicon", 24: "Toolbar", 32: "Tab · taskbar", 64: "App list" };

export interface Shot {
  size: number;
  /** Rendered at size × devicePixelRatio: what the screen really shows at that CSS size. */
  screen: string;
  /** Rendered at exactly `size` px: the pixel-exact raster, shown magnified. */
  exact: string;
  w: number;
  h: number;
}

async function renderShots(doc: DocT): Promise<Shot[]> {
  await prepareFonts(doc);
  // Transparent, so the same raster is judged on light and dark.
  const svg = buildSvg(doc, { background: null });
  const { width, height } = doc.artboard;
  const long = Math.max(width, height);
  const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const out: Shot[] = [];
  for (const size of SMALL_SIZES) {
    const w = Math.max(1, Math.round((size * width) / long));
    const h = Math.max(1, Math.round((size * height) / long));
    const c1 = await svgToCanvas(svg, w * dpr, { height: h * dpr });
    const c2 = dpr === 1 ? c1 : await svgToCanvas(svg, w, { height: h });
    out.push({ size, screen: c1.toDataURL("image/png"), exact: c2.toDataURL("image/png"), w, h });
    c1.width = c1.height = 0;
    c2.width = c2.height = 0;
  }
  return out;
}

/** Re-render the active version's small sizes (debounced) while it changes. */
function useShots(): Shot[] | null {
  const doc = useFrameDoc();
  const [shots, setShots] = useState<Shot[] | null>(null);
  useEffect(() => {
    if (!doc) return;
    let dead = false;
    const t = setTimeout(() => {
      renderShots(doc)
        .then((s) => !dead && setShots(s))
        .catch(() => !dead && setShots([]));
    }, 260);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [doc]);
  return shots;
}

/** Version panel: the active version at 16/24/32/64 px on light and dark, at true size. */
export function SmallSizesSection() {
  const shots = useShots();
  return (
    <Section
      title="Small sizes"
      className="small-sizes"
      right={
        <button className="btn small ghost" onClick={() => useQuick.setState({ smallOpen: true })} title="Inspect every pixel at 16, 24, 32 and 64 px">
          {QIcons.pixels} Inspect
        </button>
      }
    >
      {(["light", "dark"] as const).map((tone) => (
        <div key={tone} className={`ss-strip ${tone}`}>
          {(shots ?? SMALL_SIZES.map((size) => ({ size }) as Shot)).map((s) => (
            <div key={s.size} className="ss-cell" title={`${s.size} px · ${USES[s.size]}`}>
              <div className="ss-img">
                {s.screen && <img src={s.screen} width={s.w} height={s.h} alt={`${s.size} px on ${tone}`} draggable={false} />}
              </div>
              {tone === "dark" && <span className="ss-size">{s.size}</span>}
            </div>
          ))}
        </div>
      ))}
      <p className="muted">True size on your screen. Details that vanish at 16 px need simplifying.</p>
    </Section>
  );
}

/** Pixel inspector: each size magnified with nearest-neighbour scaling, plus 1:1. */
export function SmallSizesModal() {
  const open = useQuick((s) => s.smallOpen);
  const shots = useShots();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useQuick.setState({ smallOpen: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const close = () => useQuick.setState({ smallOpen: false });
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal ss-modal" role="dialog" aria-label="Small sizes">
        <div className="modal-head">
          <div>
            <div className="label">Final-size check</div>
            <h2>Does it still read when it's tiny?</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ss-grid">
          {(["light", "dark"] as const).map((tone) => (
            <div key={tone} className={`ss-row ${tone}`}>
              {(shots ?? []).map((s) => {
                const k = Math.max(1, Math.floor(128 / s.size));
                return (
                  <figure key={s.size} className="ss-tile">
                    <div className="ss-zoom">
                      <img className="pixelated" src={s.exact} width={s.w * k} height={s.h * k} alt={`${s.size} px magnified ${k}×`} draggable={false} />
                    </div>
                    <figcaption>
                      <img src={s.screen} width={s.w} height={s.h} alt="" draggable={false} />
                      <span>
                        <b>{s.size} px</b> {USES[s.size]}
                      </span>
                      <span className="dim">{k}×</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ))}
        </div>
        <p className="muted ss-foot">
          Magnified views show the exact pixels (no smoothing). Watch for hairlines that disappear, gaps that fill in and text that turns to mush. Your AI runs the same check with <code>check_small_sizes</code>.
        </p>
      </div>
    </div>
  );
}
