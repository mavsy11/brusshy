import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { MOCKUPS, colorwayDoc, type Colorway, type DocT, type MockupKind, type MockupTheme } from "@brusshy/core";
import { blobToBase64, registerRequest } from "../lib/requests";
import { activeFrameId, frameDocFor, toast, useFrameDoc, useStore } from "../lib/store";
import { saveToProject, zipFiles } from "../export/pipeline";
import { downloadBlob, slug } from "../export/util";
import { brandOf, renderMockupPng } from "./render";
import { useLiveThumbs } from "./live";
import { PaletteStrip } from "./PaletteStrip";
import { usePaletteUi } from "../palette/state";
import "./mockups.css";

export const useMockups = create<{ open: boolean }>(() => ({ open: false }));
export const openMockups = () => useMockups.setState({ open: true });
const close = () => useMockups.setState({ open: false });

/** The daemon (and so the agent's render_mockup tool) asks the studio for mockups. */
registerRequest("mockup", async (p) => {
  const doc = frameDocFor(p.frame);
  if (!doc) throw new Error("No document is open in the studio");
  const r = await renderMockupPng(doc, p.kind, { width: p.width ?? 1600, theme: p.theme ?? "auto" });
  return { png: await blobToBase64(r.blob), width: r.width, height: r.height, theme: r.theme };
});

const EXPORT_W = 2400;
const THUMB_W = 960;

export function MockupsDialog() {
  const open = useMockups((s) => s.open);
  const doc = useFrameDoc();
  if (!open || !doc) return null;
  return <Gallery doc={doc} />;
}

function Gallery({ doc: frameDocument }: { doc: DocT }) {
  const connected = useStore((s) => s.connected);
  const full = useStore((s) => s.doc);
  const fid = useStore((s) => (s.doc ? activeFrameId(s.doc) : null));
  const [theme, setTheme] = useState<MockupTheme>("auto");
  const [zoom, setZoom] = useState<MockupKind | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A colorway previewed from the strip: every mockup shows it, nothing is committed.
  const [preview, setPreview] = useState<Colorway | null>(null);
  useEffect(() => setPreview(null), [fid]);
  const doc = useMemo(() => (preview && full && fid ? colorwayDoc(full, fid, preview) : frameDocument), [preview, full, fid, frameDocument]);
  const scroller = useRef<HTMLDivElement>(null);
  const thumbs = useLiveThumbs(doc, theme, THUMB_W, scroller);
  const base = slug(brandOf(doc));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || usePaletteUi.getState().open) return;
      e.stopPropagation();
      if (zoom) setZoom(null);
      else close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const exportOne = async (kind: MockupKind) => {
    setBusy(kind);
    try {
      const r = await renderMockupPng(doc, kind, { width: EXPORT_W, theme });
      downloadBlob(r.blob, `${base}-mockup-${kind}.png`);
    } catch (e) {
      toast((e as Error).message || "Mockup failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const exportAll = async (mode: "save" | "zip") => {
    setBusy("all");
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const m of MOCKUPS) {
        const r = await renderMockupPng(doc, m.id, { width: EXPORT_W, theme });
        files.push({ name: `mockups/${base}-${m.id}.png`, blob: r.blob });
      }
      if (mode === "zip") {
        downloadBlob(await zipFiles(files), `${base}-mockups.zip`);
        toast(`Downloaded ${files.length} mockups`);
      } else {
        const r = await saveToProject(files, undefined, `${doc.name} mockups`);
        toast(`Saved ${r.files.length} mockups to ${r.dir.split(/[\\/]/).slice(-2).join("/")}`);
      }
    } catch (e) {
      toast((e as Error).message || "Export failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const zoomed = zoom ? thumbs[zoom] : null;
  const info = zoom ? MOCKUPS.find((m) => m.id === zoom) : null;

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal mk" role="dialog" aria-modal="true" aria-labelledby="mk-title" data-ui>
        <header className="mk-head">
          <div className="grow">
            <div className="mk-title" id="mk-title">
              Mockups
            </div>
            <div className="mk-sub">{doc.name} on real applications — drawn on this computer, no stock photos</div>
          </div>
          <div className="mk-seg" role="group" aria-label="Surroundings">
            {(["auto", "light", "dark"] as MockupTheme[]).map((t) => (
              <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>
                {t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {full && <PaletteStrip doc={full} fid={fid} preview={preview} onPreview={setPreview} />}

        <div className="mk-grid" ref={scroller}>
          {MOCKUPS.map((m, i) => {
            const t = thumbs[m.id];
            return (
              <figure key={m.id} data-kind={m.id} className="mk-card" style={{ animationDelay: `${i * 30}ms` }}>
                <button className={`mk-shot${t?.stale ? " updating" : ""}`} onClick={() => t && "url" in t && setZoom(m.id)} aria-label={`Open ${m.label}`}>
                  {t && "url" in t ? (
                    <>
                      {t.prev && <img className="mk-prev" src={t.prev} alt="" aria-hidden />}
                      <img key={t.url} className="mk-cur" src={t.url} alt={m.label} />
                    </>
                  ) : t && "error" in t ? (
                    <span className="mk-err">{t.error}</span>
                  ) : (
                    <span className="mk-skel" />
                  )}
                  {m.engine === "3d" && <span className="mk-badge">3D</span>}
                </button>
                <figcaption>
                  <div>
                    <b>{m.label}</b>
                    <span>{m.description}</span>
                  </div>
                  <button className="btn small ghost" disabled={!!busy} onClick={() => void exportOne(m.id)} title={`Download a ${EXPORT_W} px PNG`}>
                    {busy === m.id ? "…" : "PNG"}
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>

        <footer className="mk-foot">
          <span className="mk-hint">
            {MOCKUPS.length} scenes · {EXPORT_W} × {(EXPORT_W * 3) / 4} px PNG · also in Export → Mockups and the brand kit
          </span>
          <div className="grow" />
          <button className="btn" disabled={!!busy} onClick={() => void exportAll("zip")}>
            Download .zip
          </button>
          <button className="btn primary" disabled={!!busy || !connected} onClick={() => void exportAll("save")}>
            {busy === "all" ? "Rendering…" : "Save all to project"}
          </button>
        </footer>

        {zoom && zoomed && "url" in zoomed && (
          <div className="mk-zoom" onPointerDown={(e) => e.target === e.currentTarget && setZoom(null)}>
            <img src={zoomed.url} alt={info?.label} />
            <div className="mk-zoom-bar">
              <b>{info?.label}</b>
              <span>{info?.description}</span>
              <div className="grow" />
              <button className="btn small" onClick={() => void exportOne(zoom)} disabled={!!busy}>
                Download PNG
              </button>
              <button className="btn small ghost" onClick={() => setZoom(null)}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
