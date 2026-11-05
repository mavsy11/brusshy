import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MockupKind } from "@brusshy/core";
import { activeFrameId, toast, useStore } from "../lib/store";
import { setRootAttrs } from "../export/raster";
import { downloadBlob, slug } from "../export/util";
import { buildAnimation, StyleApplier } from "../animation/engine";
import { SMALL_SIZES } from "../panels/SmallSizes";
import { loadTimelapse, formatElapsed, type TLModel } from "../timelapse/data";
import { overlayFontsReady, TimelapseCompositor } from "../timelapse/compose";
import { mockupLoader, prepareDeck, releaseDeckUrls, type DeckAssets } from "./assets";
import { buildDeckPdf } from "./pdf";
import { closePresentation, initialTheme, saveTheme, usePresentUI, type PresentTheme } from "./state";
import "./commands";
import "./present.css";

/**
 * Present to a client: the active version as a short full-screen deck generated from the
 * work itself. Slides are laid out on a 1600×900 stage scaled to the window.
 */

const SW = 1600;
const SH = 900;
const USES: Record<number, string> = { 16: "Favicon", 24: "Toolbar", 32: "Browser tab", 64: "App list" };

type SlideId = "cover" | "surfaces" | "small" | "palette" | "type" | "versions" | "mockups" | "process" | "closing";

interface SlideDef {
  id: SlideId;
  title: string;
}

export function Presentation() {
  const open = usePresentUI((s) => s.open);
  return open ? <Deck /> : null;
}

function Deck() {
  const docAll = useStore((s) => s.doc);
  const [assets, setAssets] = useState<DeckAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timelapse, setTimelapse] = useState<TLModel | null>(null);
  const [theme, setTheme] = useState<PresentTheme>(initialTheme);
  const [index, setIndex] = useState(0);
  const [mock, setMock] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [pdfBusy, setPdfBusy] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Snapshot the document when the deck opens (live edits don't reshuffle the slides).
  const [doc] = useState(docAll);
  const frameId = useMemo(() => (doc ? activeFrameId(doc) : null), [doc]);

  useEffect(() => {
    if (!doc || !frameId) return;
    let alive = true;
    prepareDeck(doc, frameId).then(
      (a) => alive && setAssets(a),
      (e: Error) => alive && setError(e.message || "Could not prepare the presentation"),
    );
    loadTimelapse(frameId).then(
      (m) => alive && m.data.steps.length > 1 && setTimelapse(m),
      () => undefined,
    );
    return () => {
      alive = false;
      releaseDeckUrls();
    };
  }, [doc, frameId]);

  const slides: SlideDef[] = useMemo(() => {
    if (!assets) return [];
    const out: SlideDef[] = [
      { id: "cover", title: "Logo" },
      { id: "surfaces", title: "Light and dark" },
      { id: "small", title: "Small sizes" },
    ];
    if (assets.colors.length) out.push({ id: "palette", title: "Color" });
    if (assets.type) out.push({ id: "type", title: "Typography" });
    if (assets.versions.length > 1) out.push({ id: "versions", title: "Versions" });
    out.push({ id: "mockups", title: "In use" });
    if (timelapse) out.push({ id: "process", title: "How it was made" });
    out.push({ id: "closing", title: "Thank you" });
    return out;
  }, [assets, timelapse]);

  const loadMockup = useMemo(() => (assets ? mockupLoader(assets.doc) : null), [assets]);
  const kinds = assets?.mockupKinds ?? [];

  const go = useCallback(
    (dir: 1 | -1) => {
      const cur = slides[index];
      // The mockup slide is a carousel: arrows move through it first.
      if (cur?.id === "mockups") {
        const next = mock + dir;
        if (next >= 0 && next < kinds.length) return setMock(next);
      }
      const ni = Math.max(0, Math.min(slides.length - 1, index + dir));
      if (ni !== index && slides[ni]?.id === "mockups") setMock(dir === 1 ? 0 : kinds.length - 1);
      setIndex(ni);
    },
    [index, slides, mock, kinds.length],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen?.().catch(() => toast("Full screen isn't available here", "error"));
  }, []);

  const flipTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === "light" ? "dark" : "light";
      saveTheme(n);
      return n;
    });
  }, []);

  const exportPdf = useCallback(async () => {
    if (!assets || pdfBusy !== null || !loadMockup) return;
    setPdfBusy(0);
    try {
      const blob = await buildDeckPdf(assets, { theme, mockup: loadMockup, timelapse, onProgress: (p) => setPdfBusy(p) });
      const name = `${slug(assets.brand)}-presentation.pdf`;
      downloadBlob(blob, name);
      toast(`Downloaded ${name}`);
    } catch (e) {
      toast((e as Error).message || "PDF export failed", "error");
    } finally {
      setPdfBusy(null);
    }
  }, [assets, pdfBusy, loadMockup, theme, timelapse]);

  // Keyboard: ←/→ (also Space, PageUp/PageDown), Home/End, F full screen, T theme, Esc exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable]")) return;
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "Escape") closePresentation();
      else if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (k === "ArrowLeft" || k === "PageUp" || k === "ArrowUp") {
        e.preventDefault();
        go(-1);
      } else if (k === "Home") setIndex(0);
      else if (k === "End") setIndex(Math.max(0, slides.length - 1));
      else if (k === "f" || k === "F") toggleFullscreen();
      else if (k === "t" || k === "T") flipTheme();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, slides.length, toggleFullscreen, flipTheme]);

  // Minimal chrome: hide the controls when the pointer rests.
  useEffect(() => {
    let t = 0;
    const wake = () => {
      setChrome(true);
      clearTimeout(t);
      t = window.setTimeout(() => setChrome(false), 2600);
    };
    wake();
    window.addEventListener("pointermove", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  // Fit the 1600×900 stage to the window.
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / SW, window.innerHeight / SH));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const cur = slides[index];
  return (
    <div ref={rootRef} className={`pr-root${chrome ? "" : " pr-idle"}`} data-theme={theme} role="dialog" aria-modal="true" aria-label="Presentation">
      {!assets ? (
        <div className="pr-loading">
          {error ? (
            <>
              <b>Couldn't prepare the presentation</b>
              <span>{error}</span>
            </>
          ) : (
            <>
              <span className="pr-spinner" aria-hidden />
              <span>Preparing slides…</span>
            </>
          )}
        </div>
      ) : (
        <div className="pr-stage" style={{ width: SW, height: SH, transform: `translate(-50%, -50%) scale(${scale})` }}>
          {slides.map((s, i) => (
            <section key={s.id} className={`pr-slide pr-s-${s.id} ${i === index ? "is-active" : i < index ? "is-before" : "is-after"}`} aria-hidden={i !== index}>
              {Math.abs(i - index) <= 1 && (
                <SlideBody id={s.id} a={assets} active={i === index} theme={theme} mock={mock} setMock={setMock} loadMockup={loadMockup!} timelapse={timelapse} />
              )}
            </section>
          ))}
        </div>
      )}

      <div className="pr-top">
        <button className="pr-btn" onClick={flipTheme} title="Light / dark (T)" aria-label="Switch light or dark">
          {theme === "light" ? Glyph.moon : Glyph.sun}
        </button>
        <button className="pr-btn" onClick={() => void exportPdf()} disabled={!assets || pdfBusy !== null} title="Download the slides as a PDF">
          {Glyph.pdf}
          <span>{pdfBusy !== null ? `${Math.round(pdfBusy * 100)}%` : "PDF"}</span>
        </button>
        <button className="pr-btn" onClick={toggleFullscreen} title="Full screen (F)" aria-label="Full screen">
          {Glyph.full}
        </button>
        <button className="pr-btn" onClick={closePresentation} title="Exit (Esc)" aria-label="Exit presentation">
          {Glyph.close}
        </button>
      </div>

      {assets && cur && (
        <div className="pr-foot">
          <span className="pr-foot-brand">
            {assets.brand} <i>·</i> {cur.title}
          </span>
          <div className="pr-dots" role="tablist" aria-label="Slides">
            {slides.map((s, i) => (
              <button key={s.id} role="tab" aria-selected={i === index} aria-label={s.title} className={i === index ? "on" : ""} onClick={() => setIndex(i)} />
            ))}
          </div>
          <span className="pr-count">
            {String(index + 1).padStart(2, "0")} <i>/</i> {String(slides.length).padStart(2, "0")}
          </span>
        </div>
      )}
      <button className="pr-hit prev" aria-label="Previous" onClick={() => go(-1)} />
      <button className="pr-hit next" aria-label="Next" onClick={() => go(1)} />
    </div>
  );
}

/* ---------------- slides ---------------- */

const R = ({ i, children, className = "", style }: { i: number; children: ReactNode; className?: string; style?: CSSProperties }) => (
  <div className={`pr-r ${className}`} style={{ ...style, ["--i" as string]: i }}>
    {children}
  </div>
);

function Head({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <header className="pr-head">
      <R i={0}>
        <span className="pr-kicker">{kicker}</span>
      </R>
      <R i={1}>
        <h2>{title}</h2>
      </R>
      {sub && (
        <R i={2}>
          <p>{sub}</p>
        </R>
      )}
    </header>
  );
}

function SlideBody(p: {
  id: SlideId;
  a: DeckAssets;
  active: boolean;
  theme: PresentTheme;
  mock: number;
  setMock: (i: number) => void;
  loadMockup: (k: MockupKind) => Promise<{ url: string }>;
  timelapse: TLModel | null;
}) {
  const { a } = p;
  switch (p.id) {
    case "cover":
      return (
        <>
          <div className="pr-cover-text">
            <R i={0}>
              <span className="pr-kicker">Brand identity</span>
            </R>
            <R i={1}>
              <h1>{a.brand}</h1>
            </R>
            <R i={2}>
              <p>
                Logo · {a.frameName} · {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </p>
            </R>
          </div>
          <R i={2} className="pr-cover-tile" style={{ background: a.tileBg ?? "#ffffff" }}>
            <CoverArt a={a} active={p.active} />
          </R>
        </>
      );
    case "surfaces":
      return (
        <>
          <Head kicker="Logo" title="On light and dark" sub="The same mark, adjusted so every part stays readable on either surface." />
          <div className="pr-surfaces">
            <R i={2} className="pr-surface light">
              <img src={a.light.url} alt="Logo on a light surface" style={artStyle(a.light.aspect, 0.62, 0.5)} draggable={false} />
              <span>On light · #FFFFFF</span>
            </R>
            <R i={3} className="pr-surface dark">
              <img src={a.dark.url} alt="Logo on a dark surface" style={artStyle(a.dark.aspect, 0.62, 0.5)} draggable={false} />
              <span>On dark · #0B0C0E</span>
            </R>
          </div>
          <div className="pr-monos">
            <R i={4} className="pr-mono light">
              <img src={a.mono.black} alt="One-color logo, black" draggable={false} />
            </R>
            <R i={5} className="pr-mono dark">
              <img src={a.mono.white} alt="One-color logo, white" draggable={false} />
            </R>
            <R i={6} className="pr-mono-label">
              One color, for stamps, engraving and single-ink print
            </R>
          </div>
        </>
      );
    case "small":
      return (
        <>
          <Head kicker="Legibility" title="Clear at every size" sub="Rendered at true size — the way it shows in a browser tab, a toolbar and an app list." />
          {(["light", "dark"] as const).map((tone, ti) => (
            <R key={tone} i={2 + ti} className={`pr-band ${tone}`}>
              {(a.shots[tone].length ? a.shots[tone] : SMALL_SIZES.map((size) => ({ size, screen: "", exact: "", w: size, h: size }))).map((s) => (
                <div key={s.size} className="pr-size">
                  <div className="pr-zoom">{s.exact && <img src={s.exact} alt="" style={{ width: (s.w / s.size) * 112, height: (s.h / s.size) * 112 }} draggable={false} />}</div>
                  <div className="pr-true">{s.screen && <img src={s.screen} width={s.w} height={s.h} alt={`${s.size} px`} draggable={false} />}</div>
                  <span>
                    <b>{s.size} px</b> {USES[s.size]}
                  </span>
                </div>
              ))}
            </R>
          ))}
        </>
      );
    case "palette": {
      const cols = a.colors.slice(0, 8);
      return (
        <>
          <Head kicker="Color" title={a.paletteIsBrand ? "Brand palette" : "Colors in the logo"} />
          <div className="pr-swatches" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
            {cols.map((c, i) => (
              <R key={c.hex + i} i={2 + i} className="pr-swatch">
                <div className="pr-chip" style={{ background: c.hex }} />
                <b>{c.name}</b>
                <code>{c.hex}</code>
                <code className="dim">{c.rgb.replace(/^rgb\(|\)$/g, "").replace(/,\s*/g, " · ")}</code>
                {c.role && <span className="pr-role">{c.role}</span>}
              </R>
            ))}
          </div>
        </>
      );
    }
    case "type": {
      const t = a.type!;
      const h = t.heading;
      const fam = (f: { css: string | null }) => (f.css ? `"${f.css}", var(--font)` : "var(--font)");
      return (
        <>
          <Head kicker="Typography" title={t.fromLogo ? "The wordmark typeface" : "Type system"} />
          <div className="pr-type">
            <R i={2} className="pr-type-main">
              <div className="pr-specimen" style={{ fontFamily: fam(h), fontWeight: h.weight, fontSize: t.sampleSize, letterSpacing: h.tracking ? `${h.tracking / 1000}em` : undefined }}>
                {t.sample}
              </div>
              <div className="pr-type-meta">
                <span className="pr-kicker">Heading</span>
                <b>
                  {h.family} <i>{h.weight}</i>
                </b>
              </div>
              <div className="pr-glyphs" style={{ fontFamily: fam(h), fontWeight: h.weight }}>
                Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk 0123456789
              </div>
            </R>
            {t.body ? (
              <R i={3} className="pr-type-body">
                <span className="pr-kicker">Body</span>
                <b>
                  {t.body.family} <i>{t.body.weight}</i>
                </b>
                <p style={{ fontFamily: fam(t.body), fontWeight: t.body.weight }}>
                  {a.brand} is set in {h.family} for headlines and {t.body.family} for everything people read at length — menus, letters, labels and the website. Both are free, open fonts.
                </p>
                {t.note && <p className="pr-note">{t.note}</p>}
              </R>
            ) : (
              <R i={3} className="pr-type-body">
                <p className="pr-note">{t.fromLogo ? "Taken from the wordmark. Pair it with a body font in the Fonts dialog." : t.note}</p>
              </R>
            )}
          </div>
        </>
      );
    }
    case "versions":
      return (
        <>
          <Head kicker="Exploration" title="Versions side by side" sub={`${a.versions.length} directions explored — this presentation shows ${a.frameName}.`} />
          <div className={`pr-versions n${Math.min(a.versions.length, 5)}`}>
            {a.versions.slice(0, 10).map((v, i) => (
              <R key={v.id} i={2 + i} className={`pr-version${v.active ? " on" : ""}`}>
                <div className="pr-version-tile" style={{ background: v.bg ?? "#ffffff" }}>
                  <img src={v.url} alt={v.name} style={artStyle(v.aspect, 0.86, 0.86)} draggable={false} />
                </div>
                <span>
                  {v.name}
                  {v.active && <em>Presented</em>}
                </span>
              </R>
            ))}
          </div>
        </>
      );
    case "mockups":
      return <Mockups a={a} active={p.active} index={p.mock} setIndex={p.setMock} load={p.loadMockup} />;
    case "process":
      return <Process a={a} model={p.timelapse!} active={p.active} />;
    case "closing":
      return (
        <div className="pr-closing">
          <R i={0} className="pr-closing-art">
            <img src={p.theme === "dark" ? a.dark.url : a.light.url} alt={a.brand} style={artStyle(p.theme === "dark" ? a.dark.aspect : a.light.aspect, 0.42, 0.42)} draggable={false} />
          </R>
          <R i={1}>
            <h2>Thank you</h2>
          </R>
          <R i={2}>
            <p>{a.brand} — logo, colors and type, ready for every use.</p>
          </R>
        </div>
      );
  }
}

/** Contain an artwork of `aspect` in a box (fractions of the parent). */
function artStyle(aspect: number, w: number, h: number): CSSProperties {
  return aspect >= w / h ? { width: `${w * 100}%`, height: "auto" } : { height: `${h * 100}%`, width: "auto" };
}

/** The logo on its tile; plays its entrance animation each time the slide comes in. */
function CoverArt({ a, active }: { a: DeckAssets; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || !a.animation || !active) return;
    let raf = 0;
    try {
      const built = buildAnimation(a.doc, a.animation, { animate: false });
      host.innerHTML = setRootAttrs(built.svg, { width: "100%", height: "100%" });
      const applier = new StyleApplier(host, built.plan);
      applier.apply(0);
      const start = performance.now() + 450;
      const loopEnd = built.plan.loop ? Infinity : built.plan.total;
      const tick = (now: number) => {
        const t = Math.max(0, now - start);
        applier.apply(Math.min(t, loopEnd));
        if (t < loopEnd) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      host.innerHTML = "";
    }
    return () => cancelAnimationFrame(raf);
  }, [a, active]);
  if (a.animation) return <div ref={ref} className="pr-cover-anim" aria-label={a.brand} />;
  return <img src={a.tileUrl} alt={a.brand} draggable={false} />;
}

function Mockups({ a, active, index, setIndex, load }: { a: DeckAssets; active: boolean; index: number; setIndex: (i: number) => void; load: (k: MockupKind) => Promise<{ url: string }> }) {
  const [urls, setUrls] = useState<Partial<Record<MockupKind, string>>>({});
  const [failed, setFailed] = useState<Partial<Record<MockupKind, boolean>>>({});
  useEffect(() => {
    let alive = true;
    // Current first, then neighbours, then the rest — one at a time (3D scenes are heavy).
    const order = [...a.mockupKinds.keys()].sort((x, y) => Math.abs(x - index) - Math.abs(y - index));
    void (async () => {
      for (const i of order) {
        if (!alive) return;
        const k = a.mockupKinds[i]!.kind;
        if (urls[k] || failed[k]) continue;
        try {
          const r = await load(k);
          if (alive) setUrls((u) => ({ ...u, [k]: r.url }));
        } catch {
          if (alive) setFailed((f) => ({ ...f, [k]: true }));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, index]);
  const cur = a.mockupKinds[index];
  return (
    <>
      <Head kicker="In use" title="The logo at work" />
      <div className="pr-carousel">
        {a.mockupKinds.map((m, i) => {
          const off = i - index;
          if (Math.abs(off) > 2) return null;
          const url = urls[m.kind];
          return (
            <button
              key={m.kind}
              className={`pr-card${off === 0 ? " on" : ""}`}
              style={{ ["--off" as string]: off }}
              onClick={() => off !== 0 && setIndex(i)}
              tabIndex={active && off !== 0 ? 0 : -1}
              aria-label={m.label}
            >
              {url ? <img src={url} alt={m.label} draggable={false} /> : <span className={failed[m.kind] ? "pr-card-failed" : "pr-spinner"}>{failed[m.kind] ? "Couldn't render this one" : ""}</span>}
            </button>
          );
        })}
      </div>
      <div className="pr-carousel-foot">
        <b>{cur?.label}</b>
        <span>
          {index + 1} / {a.mockupKinds.length}
        </span>
      </div>
    </>
  );
}

/** "How it was made": the design timelapse, playing in the slide. */
function Process({ a, model, active }: { a: DeckAssets; model: TLModel; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const d = model.data;
  const ai = d.steps.filter((s) => s.author === "agent").length;
  useEffect(() => {
    const c = ref.current;
    if (!c || !active) return;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return;
    let raf = 0;
    let alive = true;
    const comp = new TimelapseCompositor(model, { aspect: "square", captions: true, clock: false, sketches: true, stage: true }, c.width, c.height, undefined, 10);
    void overlayFontsReady();
    let busy = false;
    const start = performance.now() + 600;
    const tick = (now: number) => {
      if (!alive) return;
      const t = Math.min(comp.plan.cardAt - 1, Math.max(0, now - start));
      if (!busy) {
        busy = true;
        void comp.draw(ctx, t).finally(() => (busy = false));
      }
      if (t < comp.plan.cardAt - 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      comp.dispose();
    };
  }, [model, active, run]);
  return (
    <>
      <div className="pr-process-text">
        <Head kicker="Process" title="How it was made" />
        <R i={2} className="pr-stats">
          <div>
            <b>{d.steps.length}</b>
            <span>steps</span>
          </div>
          <div>
            <b>{formatElapsed(d.endedAt - d.startedAt)}</b>
            <span>of work</span>
          </div>
          <div>
            <b>{ai}</b>
            <span>by the AI</span>
          </div>
          <div>
            <b>{d.steps.length - ai}</b>
            <span>by hand</span>
          </div>
        </R>
        <R i={3}>
          <button className="pr-replay" onClick={() => setRun((r) => r + 1)}>
            Replay
          </button>
        </R>
      </div>
      <R i={2} className="pr-process-stage">
        <canvas ref={ref} width={1280} height={1280} aria-label={`Timelapse of ${a.brand}`} />
      </R>
    </>
  );
}

const Glyph = {
  sun: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" />
    </svg>
  ),
  full: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  ),
  pdf: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5h10" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
};
