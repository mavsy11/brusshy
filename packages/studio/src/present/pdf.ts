import { PDFDocument } from "pdf-lib";
import type { MockupKind } from "@brusshy/core";
import { canvasToBlob, svgToCanvas } from "../export/raster";
import { ensureFont, textToPath, textWidth } from "../lib/fonts";
import { SMALL_SIZES } from "../panels/SmallSizes";
import { formatElapsed, type TLModel } from "../timelapse/data";
import { TimelapseCompositor } from "../timelapse/compose";
import type { DeckAssets } from "./assets";
import type { PresentTheme } from "./state";

/**
 * "Export as PDF": the same slides, one 16:9 page each (mockups get a page each). Every page is
 * composed as a 1600×900 SVG — text outlined with the studio's fonts, artwork embedded — and
 * rasterized at 2× into the PDF, so the file looks exactly like the deck on any machine.
 */

const W = 1600;
const H = 900;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const n = (v: number) => Math.round(v * 100) / 100;
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const svgData = (svg: string) => `data:image/svg+xml;base64,${b64(svg)}`;
const blobData = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

interface Palette {
  bg: string;
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
}
const THEMES: Record<PresentTheme, Palette> = {
  light: { bg: "#f4f5f5", surface: "#ffffff", ink: "#0b0c0e", ink2: "#585f63", ink3: "#8e9599", rule: "#dfe2e3" },
  dark: { bg: "#0b0c0e", surface: "#141518", ink: "#f4f5f5", ink2: "#b9bec1", ink3: "#7b8286", rule: "#26282c" },
};

interface TextOpts {
  size: number;
  weight?: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  family?: string;
  /** em */
  tracking?: number;
  upper?: boolean;
}

function text(s: string, x: number, y: number, o: TextOpts): string {
  const str = o.upper ? s.toUpperCase() : s;
  const node = { text: str, fontFamily: o.family ?? "Geist", fontWeight: o.weight ?? 500, fontSize: o.size, letterSpacing: (o.tracking ?? 0) * o.size, anchor: o.anchor ?? "start" } as const;
  const d = textToPath(node);
  if (!d) return "";
  return `<path d="${d}" transform="translate(${n(x)} ${n(y)})" fill="${esc(o.fill)}"/>`;
}
const width = (s: string, o: TextOpts) => textWidth({ text: o.upper ? s.toUpperCase() : s, fontFamily: o.family ?? "Geist", fontWeight: o.weight ?? 500, fontSize: o.size, letterSpacing: (o.tracking ?? 0) * o.size });

/** Greedy word wrap with the real font metrics. */
function wrap(s: string, max: number, o: TextOpts): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of s.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (line && width(next, o) > max) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const image = (href: string, x: number, y: number, w: number, h: number, extra = "") =>
  `<image href="${href}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet"${extra}/>`;
const rect = (x: number, y: number, w: number, h: number, r: number, fill: string, extra = "") => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${esc(fill)}"${extra}/>`;

function page(t: Palette, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#0b0c0e" flood-opacity="0.16"/></filter></defs>${rect(0, 0, W, H, 0, t.bg)}${body}</svg>`;
}

function head(t: Palette, kicker: string, title: string, sub?: string): string {
  let s = text(kicker, 120, 112, { size: 14, weight: 500, fill: t.ink3, tracking: 0.2, upper: true });
  s += text(title, 120, 176, { size: 52, weight: 600, fill: t.ink, tracking: -0.025 });
  if (sub) wrap(sub, 860, { size: 20, fill: t.ink2 }).forEach((l, i) => (s += text(l, 120, 222 + i * 29, { size: 20, weight: 400, fill: t.ink2 })));
  return s;
}

function foot(t: Palette, a: DeckAssets, title: string, i: number, total: number): string {
  return (
    text(`${a.brand}  ·  ${title}`, 28, H - 22, { size: 13, weight: 400, fill: t.ink3 }) +
    text(`${String(i).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, W - 28, H - 22, { size: 12, weight: 500, fill: t.ink3, anchor: "end" })
  );
}

/** Contain an artwork of `aspect` in a box. */
function contain(aspect: number, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / aspect, h);
  const ww = k * aspect;
  return { x: x + (w - ww) / 2, y: y + (h - k) / 2, w: ww, h: k };
}

export interface DeckPdfOptions {
  theme: PresentTheme;
  mockup: (k: MockupKind) => Promise<{ url: string; blob: Blob }>;
  timelapse: TLModel | null;
  onProgress?: (p: number) => void;
}

export async function buildDeckPdf(a: DeckAssets, o: DeckPdfOptions): Promise<Blob> {
  const t = THEMES[o.theme];
  await Promise.all([ensureFont("Geist", 400), ensureFont("Geist", 500), ensureFont("Geist", 600)]);
  if (a.type) await Promise.all([ensureFont(a.type.heading.family, a.type.heading.weight), a.type.body ? ensureFont(a.type.body.family, a.type.body.weight) : null]);

  const tile = svgData(a.tileSvg);
  const light = svgData(a.light.svg);
  const dark = svgData(a.dark.svg);
  const pages: { title: string; svg: () => Promise<string> }[] = [];

  pages.push({
    title: "Logo",
    svg: async () => {
      const date = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
      let s = text("Brand identity", 120, 352, { size: 14, weight: 500, fill: t.ink3, tracking: 0.2, upper: true });
      const big = { size: 104, weight: 600, fill: t.ink, tracking: -0.04 };
      const lines = wrap(a.brand, 640, big).slice(0, 2);
      lines.forEach((l, i) => (s += text(l, 116, 462 + i * 102, big)));
      s += text(`Logo · ${a.frameName} · ${date}`, 120, 462 + (lines.length - 1) * 102 + 62, { size: 21, weight: 400, fill: t.ink2 });
      s += rect(880, 150, 600, 600, 34, a.tileBg ?? "#ffffff", ' filter="url(#sh)"');
      s += image(tile, 880, 150, 600, 600);
      return page(t, s);
    },
  });

  pages.push({
    title: "Light and dark",
    svg: async () => {
      let s = head(t, "Logo", "On light and dark", "The same mark, adjusted so every part stays readable on either surface.");
      const pw = (W - 240 - 24) / 2;
      for (const [i, bg, href, aspect, label] of [
        [0, "#ffffff", light, a.light.aspect, "On light · #FFFFFF"],
        [1, "#0b0c0e", dark, a.dark.aspect, "On dark · #0B0C0E"],
      ] as const) {
        const x = 120 + i * (pw + 24);
        s += rect(x, 300, pw, 400, 26, bg, ' filter="url(#sh)"');
        const c = contain(aspect, x + pw * 0.19, 300 + 400 * 0.25, pw * 0.62, 400 * 0.5);
        s += image(href, c.x, c.y, c.w, c.h);
        s += text(label, x + 26, 680, { size: 14, weight: 400, fill: "#8e9599", tracking: 0.04 });
      }
      s += rect(120, 724, 200, 92, 18, "#ffffff", ' filter="url(#sh)"') + image(svgData(a.kit.mono("#0b0c0e", "full", "#ffffff").svg), 150, 743, 140, 54);
      s += rect(344, 724, 200, 92, 18, "#0b0c0e", ' filter="url(#sh)"') + image(svgData(a.kit.mono("#ffffff", "full", "#0b0c0e").svg), 374, 743, 140, 54);
      s += text("One color, for stamps, engraving and single-ink print", 568, 776, { size: 16, weight: 400, fill: t.ink3 });
      return page(t, s);
    },
  });

  pages.push({
    title: "Small sizes",
    svg: async () => {
      let s = head(t, "Legibility", "Clear at every size", "Rendered at true size — the way it shows in a browser tab, a toolbar and an app list.");
      const uses: Record<number, string> = { 16: "Favicon", 24: "Toolbar", 32: "Browser tab", 64: "App list" };
      (["light", "dark"] as const).forEach((tone, ti) => {
        const y = 292 + ti * 256;
        const bg = tone === "light" ? "#ffffff" : "#0b0c0e";
        const fg = tone === "light" ? "#0b0c0e" : "#f4f5f5";
        s += rect(120, y, W - 240, 232, 24, bg, ' filter="url(#sh)"');
        const cw = (W - 240 - 48) / 4;
        SMALL_SIZES.forEach((size, i) => {
          const shot = a.shots[tone].find((x) => x.size === size);
          const cx = 144 + i * cw + cw / 2;
          if (shot) {
            const z = contain(shot.w / shot.h, cx - 111, y + 40, 124, 124);
            s += image(shot.exact, z.x, z.y, z.w, z.h, ' image-rendering="optimizeSpeed" style="image-rendering:pixelated"');
            s += image(shot.screen, cx + 31 + (80 - shot.w) / 2, y + 102 - shot.h / 2, shot.w, shot.h);
          }
          const label = `${size} px`;
          const lw = width(label, { size: 14, weight: 600, fill: fg });
          const uw = width(` ${uses[size]}`, { size: 14, weight: 400, fill: fg });
          s += text(label, cx - (lw + uw) / 2, y + 200, { size: 14, weight: 600, fill: fg });
          s += text(` ${uses[size]}`, cx - (lw + uw) / 2 + lw, y + 200, { size: 14, weight: 400, fill: "#8e9599" });
        });
      });
      return page(t, s);
    },
  });

  if (a.colors.length) {
    pages.push({
      title: "Color",
      svg: async () => {
        let s = head(t, "Color", a.paletteIsBrand ? "Brand palette" : "Colors in the logo");
        const cols = a.colors.slice(0, 8);
        const gap = 18;
        const cw = (W - 240 - gap * (cols.length - 1)) / cols.length;
        cols.forEach((c, i) => {
          const x = 120 + i * (cw + gap);
          s += rect(x, 248, cw, 370, 22, c.hex, ' stroke="rgba(128,128,128,0.25)" stroke-width="1"');
          let name = c.name;
          while (name.length > 3 && width(name, { size: 20, weight: 600, fill: t.ink }) > cw) name = name.slice(0, -2);
          if (name !== c.name) name = name.trimEnd() + "…";
          s += text(name, x, 660, { size: 20, weight: 600, fill: t.ink });
          s += text(c.hex, x, 688, { size: 15, weight: 400, fill: t.ink2, family: "Geist" });
          s += text(c.rgb.replace(/^rgb\(|\)$/g, "").replace(/,\s*/g, " · "), x, 712, { size: 13, weight: 400, fill: t.ink3 });
          if (c.role) s += text(c.role, x, 744, { size: 11.5, weight: 500, fill: t.ink3, tracking: 0.14, upper: true });
        });
        return page(t, s);
      },
    });
  }

  if (a.type) {
    const ty = a.type;
    pages.push({
      title: "Typography",
      svg: async () => {
        let s = head(t, "Typography", ty.fromLogo ? "The wordmark typeface" : "Type system");
        const h = ty.heading;
        const spec = { size: ty.sampleSize, weight: h.weight, fill: t.ink, family: h.css ? h.family : "Geist", tracking: (h.tracking ?? 0) / 1000 };
        s += text(ty.sample, 120, 400, spec);
        s += `<rect x="120" y="448" width="860" height="1" fill="${t.rule}"/>`;
        s += text("Heading", 120, 490, { size: 14, weight: 500, fill: t.ink3, tracking: 0.2, upper: true });
        const hw = width("Heading", { size: 14, weight: 500, fill: t.ink3, tracking: 0.2, upper: true });
        s += text(`${h.family}`, 120 + hw + 16, 492, { size: 22, weight: 600, fill: t.ink });
        s += text(String(h.weight), 120 + hw + 24 + width(h.family, { size: 22, weight: 600, fill: t.ink }), 492, { size: 22, weight: 500, fill: t.ink3 });
        wrap("Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk 0123456789", 860, { size: 34, weight: h.weight, fill: t.ink2, family: spec.family }).forEach(
          (l, i) => (s += text(l, 120, 566 + i * 44, { size: 34, weight: h.weight, fill: t.ink2, family: spec.family })),
        );
        const bx = 1044;
        if (ty.body) {
          const b = ty.body;
          s += text("Body", bx, 300, { size: 14, weight: 500, fill: t.ink3, tracking: 0.2, upper: true });
          s += text(`${b.family}  ${b.weight}`, bx, 336, { size: 22, weight: 600, fill: t.ink });
          const bo = { size: 22, weight: b.weight, fill: t.ink2, family: b.css ? b.family : "Geist" };
          wrap(`${a.brand} is set in ${h.family} for headlines and ${b.family} for everything people read at length — menus, letters, labels and the website. Both are free, open fonts.`, 436, bo).forEach(
            (l, i) => (s += text(l, bx, 390 + i * 34, bo)),
          );
        } else {
          wrap(ty.fromLogo ? "Taken from the wordmark. Pair it with a body font in the Fonts dialog." : ty.note, 436, { size: 17, fill: t.ink3 }).forEach((l, i) => (s += text(l, bx, 300 + i * 26, { size: 17, weight: 400, fill: t.ink3 })));
        }
        return page(t, s);
      },
    });
  }

  if (a.versions.length > 1) {
    pages.push({
      title: "Versions",
      svg: async () => {
        let s = head(t, "Exploration", "Versions side by side", `${a.versions.length} directions explored — this presentation shows ${a.frameName}.`);
        const vs = a.versions.slice(0, 5);
        const cols = vs.length;
        const left = cols === 2 ? 380 : cols === 3 ? 200 : 120;
        const gap = 22;
        const cw = (W - left * 2 - gap * (cols - 1)) / cols;
        vs.forEach((v, i) => {
          const x = left + i * (cw + gap);
          s += rect(x, 300, cw, cw, 22, v.bg ?? "#ffffff", ' filter="url(#sh)"');
          if (v.active) s += `<rect x="${n(x - 7)}" y="293" width="${n(cw + 14)}" height="${n(cw + 14)}" rx="28" fill="none" stroke="#ff4d1f" stroke-width="2"/>`;
          const c = contain(v.aspect, x + cw * 0.07, 300 + cw * 0.07, cw * 0.86, cw * 0.86);
          s += image(svgData(v.svg), c.x, c.y, c.w, c.h);
          s += text(v.name, x, 300 + cw + 36, { size: 17, weight: 500, fill: t.ink });
          if (v.active) s += text("Presented", x + width(v.name, { size: 17, weight: 500, fill: t.ink }) + 12, 300 + cw + 36, { size: 11.5, weight: 500, fill: "#ff4d1f", tracking: 0.14, upper: true });
        });
        return page(t, s);
      },
    });
  }

  for (const m of a.mockupKinds) {
    pages.push({
      title: `In use — ${m.label}`,
      svg: async () => {
        let s = head(t, "In use", m.label);
        try {
          const r = await o.mockup(m.kind);
          const href = await blobData(r.blob);
          s += `<clipPath id="mc"><rect x="400" y="236" width="800" height="600" rx="22"/></clipPath>`;
          s += rect(400, 236, 800, 600, 22, t.surface, ' filter="url(#sh)"');
          s += `<g clip-path="url(#mc)">${image(href, 400, 236, 800, 600)}</g>`;
        } catch {
          s += text("This mockup couldn't be rendered.", 400, 520, { size: 18, weight: 400, fill: t.ink3 });
        }
        return page(t, s);
      },
    });
  }

  if (o.timelapse) {
    const m = o.timelapse;
    pages.push({
      title: "How it was made",
      svg: async () => {
        let s = head(t, "Process", "How it was made");
        const d = m.data;
        const ai = d.steps.filter((x) => x.author === "agent").length;
        const stats: [string, string][] = [
          [String(d.steps.length), "steps"],
          [formatElapsed(d.endedAt - d.startedAt), "of work"],
          [String(ai), "by the AI"],
          [String(d.steps.length - ai), "by hand"],
        ];
        stats.forEach(([v, l], i) => {
          const x = 120 + (i % 2) * 292;
          const y = 300 + Math.floor(i / 2) * 140;
          s += `<rect x="${x}" y="${y}" width="268" height="1" fill="${t.rule}"/>`;
          s += text(v, x, y + 64, { size: 48, weight: 600, fill: t.ink, tracking: -0.03 });
          s += text(l, x, y + 96, { size: 16, weight: 400, fill: t.ink3 });
        });
        // A contact strip of the build: six moments from blank to finished.
        const comp = new TimelapseCompositor(m, { aspect: "square", captions: false, clock: false, sketches: true }, 600, 600, undefined, 2);
        try {
          const shots: string[] = [];
          const N = d.steps.length;
          const picks = [0.12, 0.3, 0.5, 0.7, 0.88, 1].map((f) => Math.max(0, Math.min(N - 1, Math.round(f * (N - 1)))));
          // The sheet alone (state after each picked step), no captions.
          for (const i of picks) shots.push((await comp.raster(i + 1)).toDataURL("image/jpeg", 0.9));
          shots.forEach((u, i) => {
            const x = 760 + (i % 3) * 246;
            const y = 120 + Math.floor(i / 3) * 300;
            s += rect(x, y, 226, 226, 18, t.surface, ' filter="url(#sh)"');
            s += `<clipPath id="tc${i}"><rect x="${x}" y="${y}" width="226" height="226" rx="18"/></clipPath><g clip-path="url(#tc${i})">${image(u, x, y, 226, 226)}</g>`;
            const st = d.steps[picks[i]!]!;
            s += text(`${st.author === "agent" ? "AI" : "You"} · ${st.caption}`.slice(0, 34), x, y + 256, { size: 14, weight: 400, fill: t.ink3 });
          });
        } finally {
          comp.dispose();
        }
        return page(t, s);
      },
    });
  }

  pages.push({
    title: "Thank you",
    svg: async () => {
      const art = o.theme === "dark" ? { href: dark, aspect: a.dark.aspect } : { href: light, aspect: a.light.aspect };
      const c = contain(art.aspect, 350, 170, 900, 380);
      let s = image(art.href, c.x, c.y, c.w, c.h);
      s += text("Thank you", W / 2, 650, { size: 56, weight: 600, fill: t.ink, anchor: "middle", tracking: -0.03 });
      s += text(`${a.brand} — logo, colors and type, ready for every use.`, W / 2, 700, { size: 20, weight: 400, fill: t.ink2, anchor: "middle" });
      return page(t, s);
    },
  });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${a.brand} — Presentation`);
  pdf.setCreator("Brusshy");
  pdf.setProducer("Brusshy");
  pdf.setCreationDate(new Date());
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const svg = (await p.svg()).replace("</svg>", `${foot(t, a, p.title, i + 1, pages.length)}</svg>`);
    const canvas = await svgToCanvas(svg, W * 2, { height: H * 2 });
    const jpg = await canvasToBlob(canvas, "image/jpeg", 0.92);
    canvas.width = canvas.height = 0;
    const img = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const pg = pdf.addPage([W * 0.6, H * 0.6]);
    pg.drawImage(img, { x: 0, y: 0, width: W * 0.6, height: H * 0.6 });
    o.onProgress?.((i + 1) / pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  const bytes = await pdf.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}
