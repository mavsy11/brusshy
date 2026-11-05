import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocT, ExportFormat } from "@brusshy/core";
import { toast, useFrameDoc, useStore } from "../lib/store";
import { useFontVersion } from "../lib/fonts";
import { planExport, runExport, saveToProject, zipFiles, type ExportItem, type ExportOptions } from "./pipeline";
import { MAX_SIDE } from "./raster";
import { buildSvg, prepareFonts } from "./svg";
import { showExportDone } from "./success";
import { downloadBlob, formatBytes, slug } from "./util";
import { symbolDoc } from "./variants";
import { hasAnimation, MOCKUPS } from "@brusshy/core";
import { frameAnimation } from "../animation/engine";
import "./export.css";

/* ---------------- choices (remembered per browser) ---------------- */

interface Choices {
  svg: boolean;
  png: boolean;
  pngSizes: number[];
  custom: string;
  pngTransparent: boolean;
  mono: boolean;
  trim: boolean;
  icons: boolean;
  png3d: boolean;
  size3d: number;
  transparent3d: boolean;
  glb: boolean;
  video: boolean;
  seconds: number;
  brandkit: boolean;
  mockups: boolean;
  kitMockups: boolean;
  animSvg: boolean;
  animVideo: boolean;
  gif: boolean;
  animSize: number;
  gifSize: number;
  animTransparent: boolean;
  tlVideo: boolean;
  tlGif: boolean;
  construction: boolean;
  constructionDark: boolean;
  /** 1 = square, 2 = vertical, 3 = both. */
  tlAspect: number;
  /** Build length in seconds, 0 = auto. */
  tlSeconds: number;
}

const DEFAULTS: Choices = {
  svg: true,
  png: true,
  pngSizes: [512, 1024, 2048],
  custom: "",
  pngTransparent: true,
  mono: false,
  trim: false,
  icons: true,
  png3d: false,
  size3d: 2048,
  transparent3d: true,
  glb: false,
  video: false,
  seconds: 5,
  brandkit: false,
  mockups: false,
  kitMockups: true,
  animSvg: true,
  animVideo: false,
  gif: false,
  animSize: 1080,
  gifSize: 480,
  animTransparent: false,
  tlVideo: false,
  tlGif: false,
  construction: false,
  constructionDark: false,
  tlAspect: 1,
  tlSeconds: 0,
};

const STORE_KEY = "brusshy:export:v1";
const PNG_PRESETS = [256, 512, 1024, 2048, 4096];
const SIZES_3D = [1024, 2048, 4096];
const SECONDS = [3, 5, 8];

function loadChoices(): Choices {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Choices>) };
  } catch {
    /* private mode / blocked storage */
  }
  return DEFAULTS;
}

function saveChoices(c: Choices) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

const customSize = (c: Choices): number | null => {
  const n = Math.round(Number(c.custom));
  return c.custom.trim() && Number.isFinite(n) && n >= 16 && n <= MAX_SIDE ? n : null;
};

const GIF_SIZES = [320, 480, 720];
const ANIM_SIZES = [720, 1080, 2160];

function toOptions(c: Choices, animated = false): ExportOptions {
  const formats: ExportFormat[] = [];
  if (c.svg) formats.push("svg");
  const sizes = [...c.pngSizes];
  const cs = customSize(c);
  if (cs && !sizes.includes(cs)) sizes.push(cs);
  if (c.png && sizes.length) formats.push("png");
  if (c.mono) formats.push("mono");
  if (c.icons) formats.push("icons");
  if (c.png3d) formats.push("png3d");
  if (c.glb) formats.push("glb");
  if (c.video) formats.push("video");
  if (c.mockups) formats.push("mockups");
  if (c.brandkit) formats.push("brandkit");
  if (animated && c.animSvg) formats.push("anim-svg");
  if (animated && c.gif) formats.push("gif");
  if (animated && c.animVideo) formats.push("anim-video");
  if (c.tlVideo) formats.push("timelapse");
  if (c.tlGif) formats.push("timelapse-gif");
  if (c.construction) formats.push("construction");
  return {
    formats,
    pngSizes: sizes.sort((a, b) => a - b),
    pngTransparent: c.pngTransparent,
    trim: c.trim,
    size3d: c.size3d,
    transparent3d: c.transparent3d,
    video: { seconds: c.seconds, size: 1080, motion: "turntable" },
    anim: { size: c.animSize, gifSize: c.gifSize, transparent: c.animTransparent },
    mockups: { inBrandKit: c.brandkit && c.kitMockups },
    construction: { dark: c.constructionDark },
    timelapse: { aspects: c.tlAspect === 3 ? ["square", "vertical"] : c.tlAspect === 2 ? ["vertical"] : ["square"], seconds: c.tlSeconds || undefined },
  };
}

function fileCount(o: ExportOptions, hasSymbol: boolean): number {
  const variants = hasSymbol ? 8 : 4;
  const want = new Set(o.formats);
  const per: Record<ExportFormat, number> = {
    svg: 1,
    png: o.pngSizes?.length ?? 0,
    // Every variant but the logo as drawn, SVG + PNG.
    mono: (variants - 1) * 2,
    icons: 9,
    png3d: 1,
    glb: 1,
    video: 1,
    // PDF + brand.md + the variant SVGs this export would not have otherwise.
    brandkit: 2 + (want.has("mono") ? 0 : variants - (want.has("svg") ? 1 : 0)),
    mockups: MOCKUPS.length,
    "anim-svg": 1,
    "anim-video": 1,
    gif: 1,
    timelapse: o.timelapse?.aspects?.length ?? 1,
    "timelapse-gif": o.timelapse?.aspects?.length ?? 1,
    construction: o.construction?.dark ? 4 : 2,
  };
  return o.formats.reduce((s, f) => s + per[f], 0);
}

/* ---------------- small UI atoms ---------------- */

const Check = () => (
  <span className="xp-check" aria-hidden>
    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5.2 4.1 7.2 8 3" />
    </svg>
  </span>
);

function Row(props: { on: boolean; onToggle: () => void; name: string; ext?: string; desc: string; opts?: ReactNode; sub?: ReactNode }) {
  return (
    <div
      className={`xp-row ${props.on ? "on" : "off"}`}
      role="checkbox"
      aria-checked={props.on}
      tabIndex={0}
      onClick={props.onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          props.onToggle();
        }
      }}
    >
      <Check />
      <div>
        <div className="xp-name">
          {props.name}
          {props.ext && <span className="xp-ext">{props.ext}</span>}
        </div>
        <div className="xp-desc">{props.desc}</div>
      </div>
      <div className="xp-opts" onClick={(e) => e.stopPropagation()}>
        {props.opts}
      </div>
      {props.sub && (
        <div className="xp-sub-row" onClick={(e) => e.stopPropagation()}>
          {props.sub}
        </div>
      )}
    </div>
  );
}

function Seg<T extends number>(props: { values: T[]; selected: (v: T) => boolean; onPick: (v: T) => void; format?: (v: T) => string; label: string }) {
  return (
    <div className="xp-seg" role="group" aria-label={props.label}>
      {props.values.map((v) => (
        <button key={v} type="button" className="xp-chip" aria-pressed={props.selected(v)} onClick={() => props.onPick(v)}>
          {props.format ? props.format(v) : v}
        </button>
      ))}
    </div>
  );
}

function Switch(props: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={props.on} className="xp-switch" onClick={() => props.onChange(!props.on)}>
      <i />
      {props.children}
    </button>
  );
}

const Icon = {
  close: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  queued: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2.2" />
    </svg>
  ),
  running: (
    <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.5" stroke="var(--rule)" />
      <path className="xp-spin" d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" />
    </svg>
  ),
  done: (
    <svg viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" fill="currentColor" />
      <path d="M5.2 8.2 7.1 10 10.9 6.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  failed: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.4M8 10.8v.1" />
    </svg>
  ),
  skipped: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8h5" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M2 4.5c0-.6.4-1 1-1h3.2l1.4 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
    </svg>
  ),
  zip: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5v8M4.8 7.6 8 10.8l3.2-3.2M3 13.2h10" />
    </svg>
  ),
};

/* ---------------- dialog ---------------- */

type Phase = "pick" | "running" | "done";
type Mode = "save" | "zip";

function useThumb(doc: DocT | null): string {
  const fontV = useFontVersion((s) => s.v);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    void prepareFonts(doc).then(() => {
      if (!alive) return;
      try {
        const svg = buildSvg(doc, { trim: { pad: 0.06, square: true }, background: null });
        setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      } catch {
        setUrl("");
      }
    });
    return () => {
      alive = false;
    };
  }, [doc, fontV]);
  return url;
}

export function ExportDialog() {
  const open = useStore((s) => s.exportOpen);
  const doc = useFrameDoc();
  const connected = useStore((s) => s.connected);
  const projectDir = useStore((s) => s.projectDir);

  const [c, setC] = useState<Choices>(loadChoices);
  const [phase, setPhase] = useState<Phase>("pick");
  const [mode, setMode] = useState<Mode>("save");
  const [items, setItems] = useState<ExportItem[]>([]);
  const [writing, setWriting] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ count: number; bytes: number; where: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const thumb = useThumb(open ? doc : null);

  const set = (patch: Partial<Choices>) =>
    setC((prev) => {
      const next = { ...prev, ...patch };
      saveChoices(next);
      return next;
    });

  const docAll = useStore((s) => s.doc);
  const activeId = useStore((s) => s.activeFrame);
  const animated = useMemo(() => hasAnimation(frameAnimation(activeId, docAll)), [docAll, activeId]);
  const opts = useMemo(() => toOptions(c, animated), [c, animated]);
  const hasSymbol = useMemo(() => (doc ? !!symbolDoc(doc) : true), [doc]);
  const count = fileCount(opts, hasSymbol);
  const has3d = c.png3d || c.glb || c.video;
  const busy = phase === "running";

  const close = () => {
    if (busy) return;
    useStore.setState({ exportOpen: false });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (phase === "running") abort.current?.abort();
        else close();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && phase === "pick" && count > 0) {
        e.preventDefault();
        void start(connected ? "save" : "zip");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Reset to the picker each time the dialog opens.
  useEffect(() => {
    if (open) {
      setPhase("pick");
      setItems([]);
      setResult(null);
      setWriting(null);
    }
  }, [open]);

  if (!open || !doc) return null;

  const base = slug(doc.name);

  async function start(m: Mode) {
    if (!doc || count === 0) return;
    setMode(m);
    setPhase("running");
    setResult(null);
    setWriting(null);
    setItems(planExport(opts));
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      let latest: ExportItem[] = [];
      const files = await runExport(
        doc,
        opts,
        (i) => {
          latest = i;
          setItems(i);
        },
        ctrl.signal,
      );
      const failedNow = latest.filter((i) => i.status === "failed").length;
      // A clean export closes the dialog into the success card; failures stay here so they can be read.
      const finish = (info: { count: number; bytes: number; where: string; dir: string | null }) => {
        if (failedNow) return toast(`Exported ${info.count} files · ${failedNow} failed`, "error");
        useStore.setState({ exportOpen: false });
        showExportDone(doc, { ...info, mode: m, by: "you", failed: 0 });
      };
      if (!files.length) {
        setPhase("done");
        toast("Nothing was exported", "error");
        return;
      }
      const bytes = files.reduce((s, f) => s + f.blob.size, 0);
      if (m === "zip") {
        const zip = await zipFiles(files);
        const name = `${base}-export.zip`;
        downloadBlob(zip, name);
        setResult({ count: files.length, bytes: zip.size, where: name });
        finish({ count: files.length, bytes: zip.size, where: name, dir: null });
      } else {
        setWriting({ done: 0, total: files.length });
        const r = await saveToProject(files, (done, total) => setWriting({ done, total }), doc.name);
        const rel = projectDir && r.dir.startsWith(projectDir) ? r.dir.slice(projectDir.length).replace(/^[\\/]/, "") : r.dir;
        setResult({ count: r.files.length, bytes, where: rel });
        finish({ count: r.files.length, bytes, where: rel, dir: r.dir });
      }
      setPhase("done");
    } catch (e) {
      toast((e as Error).message || "Export failed", "error");
      setPhase("done");
    } finally {
      abort.current = null;
      setWriting(null);
    }
  }

  const failed = items.filter((i) => i.status === "failed").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const running = items.find((i) => i.status === "running");

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal xp" role="dialog" aria-modal="true" aria-labelledby="xp-title">
        <header className="xp-head">
          <div className="xp-thumb">{thumb ? <img src={thumb} alt="" /> : null}</div>
          <div className="grow">
            <div className="xp-title" id="xp-title">
              Export
            </div>
            <div className="xp-sub">
              {base} · {doc.artboard.width} × {doc.artboard.height}
            </div>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={close} disabled={busy}>
            {Icon.close}
          </button>
        </header>

        {phase === "pick" ? (
          <div className="xp-body">
            <section className="xp-section">
              <div className="label">Vector &amp; raster</div>
              <div className="xp-card">
                <Row on={c.svg} onToggle={() => set({ svg: !c.svg })} name="SVG" ext=".svg" desc="Text outlined to paths — no font dependency" />
                <Row
                  on={c.png}
                  onToggle={() => set({ png: !c.png })}
                  name="PNG"
                  ext=".png"
                  desc="Crisp raster at every size you pick"
                  opts={
                    <Switch on={c.pngTransparent} onChange={(v) => set({ pngTransparent: v, png: true })}>
                      Transparent
                    </Switch>
                  }
                  sub={
                    <>
                      <Seg
                        label="PNG sizes"
                        values={PNG_PRESETS}
                        selected={(v) => c.pngSizes.includes(v)}
                        onPick={(v) =>
                          set({
                            png: true,
                            pngSizes: c.pngSizes.includes(v) ? c.pngSizes.filter((s) => s !== v) : [...c.pngSizes, v].sort((a, b) => a - b),
                          })
                        }
                      />
                      <label className={`xp-custom ${c.custom && !customSize(c) ? "bad" : ""}`} title={`Custom width, 16–${MAX_SIDE} px`}>
                        <input
                          inputMode="numeric"
                          placeholder="Custom"
                          value={c.custom}
                          onChange={(e) => set({ custom: e.target.value.replace(/[^\d]/g, "").slice(0, 4), png: true })}
                        />
                        <span>px</span>
                      </label>
                    </>
                  }
                />
                <Row
                  on={c.mono}
                  onToggle={() => set({ mono: !c.mono })}
                  name="Variants"
                  ext="light · dark"
                  desc="Full color on dark, black and white, for the logo and its symbol — SVG + 1024 px PNG each"
                />
                <div className="xp-foot">
                  <span>Trim to content — crop to the artwork instead of the artboard</span>
                  <Switch on={c.trim} onChange={(v) => set({ trim: v })}>
                    {c.trim ? "On" : "Off"}
                  </Switch>
                </div>
              </div>
            </section>

            <section className="xp-section">
              <div className="label">App &amp; web icons</div>
              <div className="xp-card">
                <Row
                  on={c.icons}
                  onToggle={() => set({ icons: !c.icons })}
                  name="Icon kit"
                  ext=".ico · .png · .webmanifest"
                  desc="favicon.ico (16, 32, 48), PNG 16 · 32 · 180 · 192 · 512, apple-touch-icon, favicon.svg, manifest and the <link> tags"
                />
              </div>
            </section>

            <section className="xp-section">
              <div className="label">
                <span>3D</span>
                {has3d && <span style={{ textTransform: "none", letterSpacing: 0 }}>Rendered from the current 3D scene</span>}
              </div>
              <div className="xp-card">
                <Row
                  on={c.png3d}
                  onToggle={() => set({ png3d: !c.png3d })}
                  name="Render"
                  ext=".png"
                  desc="High-resolution still of the 3D logo"
                  opts={
                    <Switch on={c.transparent3d} onChange={(v) => set({ transparent3d: v, png3d: true })}>
                      Transparent
                    </Switch>
                  }
                  sub={<Seg label="3D render size" values={SIZES_3D} selected={(v) => c.size3d === v} onPick={(v) => set({ size3d: v, png3d: true })} format={(v) => `${v / 1024}K`} />}
                />
                <Row on={c.glb} onToggle={() => set({ glb: !c.glb })} name="Model" ext=".glb" desc="glTF binary for three.js, Blender, Spline and AR" />
                <Row
                  on={c.video}
                  onToggle={() => set({ video: !c.video })}
                  name="Turntable video"
                  ext=".mp4"
                  desc="A seamless spin, 1080 × 1080 — takes a little while"
                  opts={<Seg label="Video duration" values={SECONDS} selected={(v) => c.seconds === v} onPick={(v) => set({ seconds: v, video: true })} format={(v) => `${v}s`} />}
                />
              </div>
            </section>

            <section className="xp-section">
              <div className="label">
                <span>Animation</span>
                {!animated && <span style={{ textTransform: "none", letterSpacing: 0 }}>Set one up in the Animation panel first</span>}
              </div>
              <div className={`xp-card${animated ? "" : " xp-disabled"}`} style={animated ? undefined : { opacity: 0.5, pointerEvents: "none" }} aria-disabled={!animated}>
                <Row on={animated && c.animSvg} onToggle={() => set({ animSvg: !c.animSvg })} name="Animated SVG" ext=".svg" desc="CSS keyframes in one file — plays in any browser, scales forever" />
                <Row
                  on={animated && c.gif}
                  onToggle={() => set({ gif: !c.gif })}
                  name="GIF"
                  ext=".gif"
                  desc="Loops everywhere: chats, email, slides"
                  opts={<Seg label="GIF width" values={GIF_SIZES} selected={(v) => c.gifSize === v} onPick={(v) => set({ gifSize: v, gif: true })} format={(v) => `${v}`} />}
                />
                <Row
                  on={animated && c.animVideo}
                  onToggle={() => set({ animVideo: !c.animVideo })}
                  name="Video"
                  ext={c.animTransparent ? ".webm" : ".mp4"}
                  desc={c.animTransparent ? "WebM with transparency (VP9 alpha)" : "H.264 MP4 for reels, sites and decks"}
                  opts={<Seg label="Video size" values={ANIM_SIZES} selected={(v) => c.animSize === v} onPick={(v) => set({ animSize: v, animVideo: true })} format={(v) => (v === 2160 ? "4K" : `${v}p`)} />}
                />
                <div className="xp-foot">
                  <span>Transparent background — GIF (hard edges) and video as WebM</span>
                  <Switch on={c.animTransparent} onChange={(v) => set({ animTransparent: v })}>
                    {c.animTransparent ? "On" : "Off"}
                  </Switch>
                </div>
              </div>
            </section>

            <section className="xp-section">
              <div className="label">Design timelapse</div>
              <div className="xp-card">
                <Row
                  on={c.tlVideo}
                  onToggle={() => set({ tlVideo: !c.tlVideo })}
                  name="Timelapse video"
                  ext=".mp4"
                  desc="How this version was made, step by step from its history — ends on a branded card"
                  opts={<Seg label="Timelapse format" values={[1, 2, 3]} selected={(v) => c.tlAspect === v} onPick={(v) => set({ tlAspect: v })} format={(v) => (v === 1 ? "1:1" : v === 2 ? "9:16" : "Both")} />}
                />
                <Row on={c.tlGif} onToggle={() => set({ tlGif: !c.tlGif })} name="Timelapse GIF" ext=".gif" desc="The same replay as a looping GIF, 540 px wide" />
                <div className="xp-foot">
                  <span>Length of the build (plus the final hold and end card)</span>
                  <Seg label="Timelapse length" values={[0, 10, 20, 30]} selected={(v) => c.tlSeconds === v} onPick={(v) => set({ tlSeconds: v })} format={(v) => (v ? `${v}s` : "Auto")} />
                </div>
              </div>
            </section>

            <section className="xp-section">
              <div className="label">Guidelines</div>
              <div className="xp-card">
                <Row
                  on={c.brandkit}
                  onToggle={() => set({ brandkit: !c.brandkit })}
                  name="Brand kit"
                  ext=".pdf"
                  desc="Variants, clear space, minimum size, don'ts, color and typography — A4 landscape PDF, plus brand.md for AI agents"
                  opts={
                    <Switch on={c.kitMockups} onChange={(v) => set({ kitMockups: v, brandkit: true })}>
                      Mockups page
                    </Switch>
                  }
                />
                <Row
                  on={c.mockups}
                  onToggle={() => set({ mockups: !c.mockups })}
                  name="Mockups"
                  ext=".png"
                  desc={`The logo on ${MOCKUPS.length} applications — cards, app icon, favicon, avatar, sign, tote, letterhead and 3D — 2400 px each`}
                />
                <Row
                  on={c.construction}
                  onToggle={() => set({ construction: !c.construction })}
                  name="Construction sheet"
                  ext=".png .svg"
                  desc="The mark on its grid — construction lines, hatched regions, ratio labels — beside the clean mark, 2048 px (derived from the curves when no grid was drawn)"
                  opts={
                    <Switch on={c.constructionDark} onChange={(v) => set({ constructionDark: v, construction: true })}>
                      Dark too
                    </Switch>
                  }
                />
              </div>
            </section>
          </div>
        ) : (
          <div className="xp-body xp-prog" aria-live="polite">
            <div className="xp-card">
              {items.map((it) => (
                <div key={it.id} className="xp-row">
                  <span className={`xp-state ${it.status}`}>{Icon[it.status === "queued" ? "queued" : it.status]}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="xp-name">
                      {it.label}
                      <span className="xp-ext">{it.detail}</span>
                    </div>
                    {it.error && <div className="xp-err">{it.error}</div>}
                    {it.note && <div className="xp-note">{it.note}</div>}
                    {it.status === "done" && it.files.length > 0 && (
                      <div className="xp-files">{it.files.length <= 3 ? it.files.join("  ") : `${it.files.slice(0, 3).join("  ")}  +${it.files.length - 3} more`}</div>
                    )}
                  </div>
                  <div className="xp-meta">
                    {it.status === "running" && it.progress !== undefined && it.progress > 0
                      ? `${Math.round(it.progress * 100)}%`
                      : it.status === "done"
                        ? `${it.files.length} ${it.files.length === 1 ? "file" : "files"}`
                        : it.status === "failed"
                          ? "Failed"
                          : it.status === "skipped"
                            ? "Skipped"
                            : it.status === "running"
                              ? "Working"
                              : "Queued"}
                  </div>
                  {it.status === "running" && (
                    <div className={`xp-bar ${it.progress ? "" : "indeterminate"}`}>
                      <i style={{ width: `${Math.round((it.progress ?? 0) * 100)}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="xp-footer">
          {phase === "pick" ? (
            <>
              <div className="xp-summary">
                {count ? (
                  <>
                    <b>{count}</b> {count === 1 ? "file" : "files"}
                    {c.video ? " · video takes a moment" : has3d ? " · includes 3D" : ""}
                  </>
                ) : (
                  "Pick at least one format"
                )}
              </div>
              <button className="btn" disabled={!count} onClick={() => void start("zip")}>
                {Icon.zip}
                Download .zip
              </button>
              <button
                className="btn primary"
                disabled={!count || !connected}
                title={connected ? "Writes into brusshy/exports/ in your project (⌘↵)" : "The studio is not connected to the daemon"}
                onClick={() => void start("save")}
              >
                {Icon.folder}
                Save to project
              </button>
            </>
          ) : phase === "running" ? (
            <>
              <div className="xp-summary">
                {writing ? (
                  <>
                    Writing <b>{writing.done}</b> / {writing.total} to the project…
                  </>
                ) : running ? (
                  <>
                    <b>{doneCount + 1}</b> of {items.length} · {running.label}…
                  </>
                ) : mode === "zip" ? (
                  "Packing the .zip…"
                ) : (
                  "Preparing…"
                )}
              </div>
              <button className="btn" onClick={() => abort.current?.abort()} disabled={!!writing}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <div className="xp-summary">
                {result ? (
                  <>
                    <b>{result.count}</b> files · {formatBytes(result.bytes)} {mode === "zip" ? "· downloaded " : "· saved to "}
                    <code>{result.where}</code>
                  </>
                ) : (
                  "Export stopped"
                )}
                {failed > 0 && <> · {failed} failed</>}
              </div>
              <button className="btn" onClick={() => setPhase("pick")}>
                Back
              </button>
              <button className="btn primary" onClick={close}>
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
