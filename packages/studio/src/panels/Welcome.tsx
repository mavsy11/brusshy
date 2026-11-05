import { useRef, type ReactNode } from "react";
import { setTool, toast, useStore } from "../lib/store";
import { addReferenceImage, importSvgText } from "../lib/actions";
import { setChatDraft } from "../lib/chatBridge";
import { copyText } from "../lib/notes";
import { useQuick } from "../lib/quick";
import { Icons } from "./icons";
import { QIcons } from "./quickIcons";
import "../styles/welcome.css";
import { GuidedStart } from "../guided/GuidedStart";
import { openGuided, useGuided } from "../guided/state";

/**
 * The start screen drawn on an empty document: style starters that pre-fill a precise
 * prompt in the canvas chat, plus the other ways in (sketch, trace, import, brief).
 */

const BRAND = "[your brand]";

interface Starter {
  id: string;
  name: string;
  hint: string;
  prompt: (brand: string) => string;
  art: ReactNode;
}

const INK = "#0b0c0e";
const RED = "#ff4d1f";
const GOLD = "#b08d57";

/** Mini marks, drawn in code on a 120 × 72 tile. */
const STARTERS: Starter[] = [
  {
    id: "geometric",
    name: "Minimal geometric",
    hint: "Shapes on a strict grid",
    prompt: (b) =>
      `A minimal geometric logo for ${b}: one bold mark built from 2–3 primitive shapes (circle, square, triangle) on a strict grid, flat ink fill with a single accent color, generous negative space, no gradients. Pair it with a clean geometric sans wordmark. It must read at 16 px.`,
    art: (
      <>
        <circle cx="50" cy="38" r="17" fill={INK} />
        <path d="M58 55 72 21 86 55Z" fill={RED} style={{ mixBlendMode: "multiply" }} />
      </>
    ),
  },
  {
    id: "serif",
    name: "Luxury serif",
    hint: "High contrast, refined",
    prompt: (b) =>
      `A luxury serif wordmark for ${b}: a high-contrast Didone-style serif in spaced capitals, refined hairlines, an optional fine monogram crest above it. Ink on ivory with a warm gold accent (#b08d57). Quiet, expensive, perfectly kerned.`,
    art: (
      <>
        <text x="60" y="41" textAnchor="middle" fontFamily="Didot, 'Bodoni 72', 'Playfair Display', Georgia, serif" fontSize="30" fill={INK}>
          Aa
        </text>
        <path d="M28 50h64" stroke={GOLD} strokeWidth="0.8" />
        <path d="M36 19h48" stroke={GOLD} strokeWidth="0.8" />
        <circle cx="60" cy="19" r="2.2" fill={GOLD} />
      </>
    ),
  },
  {
    id: "playful",
    name: "Playful rounded",
    hint: "Soft, bright, friendly",
    prompt: (b) =>
      `A playful, friendly logo for ${b}: soft rounded shapes with big corner radii, a cheerful character or symbol, 2–3 bright colors (warm yellow, coral, a clear blue) on white. Pair it with a rounded, chunky sans wordmark. Bouncy but still simple enough for an app icon.`,
    art: (
      <>
        <circle cx="47" cy="40" r="15" fill="#ffc53d" />
        <rect x="58" y="20" width="26" height="26" rx="9" fill={RED} transform="rotate(12 71 33)" />
        <circle cx="83" cy="52" r="6" fill="#2f5bff" />
        <path d="M41 42q6 6 12 0" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "badge",
    name: "Retro badge",
    hint: "Seal, ribbon, est. date",
    prompt: (b) =>
      `A retro badge logo for ${b}: a circular seal with the name set around the ring, a simple central icon, a ribbon banner and "EST." year, small stars as separators. Two inks (deep ink and a warm vermilion) with a slightly vintage feel, but clean vector lines that still work at small size.`,
    art: (
      <>
        <circle cx="60" cy="36" r="26" fill="none" stroke={INK} strokeWidth="2.4" />
        <circle cx="60" cy="36" r="20.5" fill="none" stroke={INK} strokeWidth="0.9" strokeDasharray="1.4 2.2" />
        <path d="M60 19.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" fill={INK} />
        <path d="M28 37h64l-4 5 4 5H28l4-5z" fill={RED} />
        <text x="60" y="44.6" textAnchor="middle" fontFamily="var(--font)" fontSize="6.4" fontWeight="700" letterSpacing="1.4" fill="#fff">
          EST. 1974
        </text>
      </>
    ),
  },
  {
    id: "monogram",
    name: "Tech monogram",
    hint: "Initials, one stroke",
    prompt: (b) =>
      `A tech monogram for ${b}: the initials built from one consistent stroke width with 45° cuts and precise joins, set in a rounded-square container, monochrome ink with one electric accent (#2f5bff). Pixel-crisp at 16 px, works as an app icon and favicon.`,
    art: (
      <>
        <defs>
          <linearGradient id="wl-tech" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2f5bff" />
            <stop offset="1" stopColor="#00b8e6" />
          </linearGradient>
        </defs>
        <rect x="38" y="14" width="44" height="44" rx="12" fill={INK} />
        <path d="M49 47V25l22 22V25" fill="none" stroke="url(#wl-tech)" strokeWidth="5.2" strokeLinejoin="miter" />
      </>
    ),
  },
  {
    id: "hand",
    name: "Hand-drawn",
    hint: "Brush energy, human",
    prompt: (b) =>
      `A hand-drawn logo for ${b}: lively brush or marker lettering with natural stroke variation, a small doodled symbol beside it, imperfect but confident. One ink color on warm paper. Keep the outline count low so it stays clean as vector.`,
    art: (
      <>
        <path
          d="M31 46c3-12 8-22 12-22 3 0 1 10-1 16 4-8 9-13 12-12 3 1 0 9-1 14 3-6 8-11 11-10 4 1 2 10 6 10 3 0 7-6 10-11"
          fill="none"
          stroke={INK}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M33 55c14-3 34-4 56-1" fill="none" stroke={RED} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M90 18l2 5M96 22l-4 2M85 22l3 2" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "deco",
    name: "Art Deco",
    hint: "Sunburst and gold",
    prompt: (b) =>
      `An Art Deco logo for ${b}: a symmetric emblem with a sunburst or stepped fan, thin parallel lines and a tall geometric display wordmark in capitals. Gold (#b08d57) on deep ink, strong vertical rhythm, timeless and glamorous.`,
    art: (
      <>
        <path d="M30 54a30 30 0 0 1 60 0" fill="none" stroke={GOLD} strokeWidth="1.8" />
        {Array.from({ length: 9 }, (_, i) => {
          const a = Math.PI * (0.1 + (0.8 * i) / 8);
          return <path key={i} d={`M60 54L${60 - Math.cos(a) * 25} ${54 - Math.sin(a) * 25}`} stroke={GOLD} strokeWidth={i % 2 ? 0.9 : 1.8} />;
        })}
        <path d="M24 54h72M30 58h60" stroke={INK} strokeWidth="1.4" />
        <circle cx="60" cy="54" r="5" fill={INK} />
      </>
    ),
  },
  {
    id: "botanical",
    name: "Botanical line",
    hint: "Monoline, organic",
    prompt: (b) =>
      `A botanical monoline logo for ${b}: a single continuous-line leaf or sprig with even stroke weight and rounded ends, airy and organic, in a deep green (#1f6f4a) with a light serif or humanist sans wordmark. Calm, natural, premium.`,
    art: (
      <>
        <path d="M60 60C41 49 42 25 60 12c18 13 19 37 0 48z" fill="none" stroke="#1f6f4a" strokeWidth="2" strokeLinejoin="round" />
        <path d="M60 64V20M60 34l-8-6M60 43l9-7M60 51l-9-6" fill="none" stroke="#1f6f4a" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
];

function brandName(name: string | undefined): string {
  const n = (name ?? "").trim();
  return !n || /^untitled/i.test(n) ? BRAND : `“${n}”`;
}

function useStart() {
  const docName = useStore((s) => s.doc?.name);
  return (s: Starter) => {
    const brand = brandName(docName);
    const text = s.prompt(brand);
    const at = brand === BRAND ? text.indexOf(BRAND) : -1;
    if (setChatDraft(text, at >= 0 ? [at, at + BRAND.length] : undefined)) return;
    void copyText(text);
    toast("Prompt copied — paste it in your AI");
  };
}

const svgIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3.5H7a2 2 0 00-2 2v13a2 2 0 002 2h10a2 2 0 002-2V8.5z" />
    <path d="M14 3.5v5h5" />
    <path d="M9.5 13.5l-1.8 2 1.8 2M14.5 13.5l1.8 2-1.8 2" />
  </svg>
);

/** Full start screen, shown while the whole document is empty. */
export function Welcome({ scale }: { scale: number }) {
  const start = useStart();
  const busy = useStore((s) => !!s.chat?.busy || s.agent.state === "working");
  const imageInput = useRef<HTMLInputElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);
  const guided = useGuided((s) => s.open);
  const docName = useStore((s) => s.doc?.name ?? "");

  if (guided && !busy) {
    return (
      <div className="empty" data-ui>
        <div className="wl" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
          <GuidedStart />
        </div>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="empty" data-ui>
        <div className="wl-drafting" role="status">
          <span className="wl-pencil" aria-hidden />
          Your AI is drafting the first sketch…
        </div>
      </div>
    );
  }

  return (
    <div className="empty" data-ui>
      <div className="wl" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="wl-head">
          <div className="label">New logo</div>
          <h2 className="wl-title">Start with a direction</h2>
          <p className="wl-sub">Pick a style and your AI drafts it here — or sketch, trace and import your own.</p>
          <button
            className="wl-guided"
            onClick={() => openGuided({ name: /^untitled/i.test(docName.trim()) ? "" : docName.trim() })}
            title="Answer three quick questions — your AI drafts 4 distinct directions"
          >
            Guided start <span className="wl-guided-n">3 questions</span>
          </button>
        </div>

        <div className="wl-grid">
          {STARTERS.map((s, i) => (
            <button key={s.id} className="wl-card" style={{ animationDelay: `${60 + i * 35}ms` }} onClick={() => start(s)} title="Puts a detailed prompt in the chat — edit it, then press Enter">
              <span className="wl-art">
                <svg viewBox="0 0 120 72" aria-hidden>
                  {s.art}
                </svg>
              </span>
              <span className="wl-name">{s.name}</span>
              <span className="wl-hint">{s.hint}</span>
            </button>
          ))}
        </div>

        <div className="wl-actions">
          <button className="wl-action" onClick={() => setTool("brush")} title="Sketch brush (B)">
            {Icons.brush}
            <span>Sketch it</span>
            <span className="kbd">B</span>
          </button>
          <button className="wl-action" onClick={() => imageInput.current?.click()} title="Add a reference image to trace over (or paste one with ⌘V)">
            {Icons.image}
            <span>Trace an image</span>
          </button>
          <button className="wl-action" onClick={() => svgInput.current?.click()} title="Import an SVG file as editable layers (or paste SVG code with ⌘V)">
            {svgIcon}
            <span>Import SVG</span>
          </button>
          <button className="wl-action" onClick={() => useQuick.setState({ briefOpen: true })} title="Name, audience, style and colors your AI follows">
            {QIcons.brief}
            <span>Write a brief</span>
          </button>
        </div>

        <div className="wl-foot">
          Press <span className="kbd">/</span> to ask your AI anything ·{" "}
          <button className="wl-link" onClick={() => useStore.setState({ helpOpen: true })}>
            How to connect your AI
          </button>
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addReferenceImage(f);
            e.target.value = "";
          }}
        />
        <input
          ref={svgInput}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((t) => importSvgText(t));
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/** Design size of the welcome block; it scales down with the artboard on screen. */
export const WELCOME_SIZE = { w: 640, h: 560 };
