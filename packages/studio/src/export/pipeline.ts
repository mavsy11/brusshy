import { zipSync, type Zippable } from "fflate";
import type { DocT, ExportFormat, ExportParams, ExportResponse } from "@brusshy/core";
import { api } from "../lib/socket";
import { exportGLB, render3D, renderVideo } from "../three/api";
import { buildBrandKit } from "./brandkit";
import { brandMarkdown, pngSize, sizeOf, svgSize, type LogoFileMeta } from "./brandmd";
import { buildIco } from "./ico";
import { svgToPng } from "./raster";
import { buildSvg, prepareFonts, svgFile, unoutlinedText } from "./svg";
import { extractPalette, flatName, slug, textBlob } from "./util";
import { designedFor, iconMark, INK_LABEL, logoVariants, tone, variantName, type Ground, type LogoVariant } from "./variants";
import { ANIM_LABELS, animDetail, exportAnimation, isAnimFormat } from "../animation/exports";
import { exportMockups, forPdf, KIT_MOCKUPS, MOCKUP_LABEL, mockupDetail, renderMockupSet, type MockupShot } from "../mockups/exports";
import { exportTimelapse, isTimelapseFormat, TIMELAPSE_LABELS, timelapseDetail } from "../timelapse/export";
import { constructionDetail, exportConstruction } from "../construct/sheet";

/** Everything the dialog can ask for (a superset of the agent's ExportParams). */
export interface ExportOptions extends ExportParams {
  /** Crop 2D exports to the artwork bounds + a small margin instead of the artboard. */
  trim?: boolean;
  /** Transparent background for 2D PNGs (default true). */
  pngTransparent?: boolean;
  /** Transparent background for the 3D render (default true). */
  transparent3d?: boolean;
}

export interface ExportFile {
  /** Relative path inside the export (may contain "icons/"). */
  name: string;
  blob: Blob;
  /** A logo file: listed (with its background and size) in brand.md. */
  logo?: LogoFileMeta;
  /** Rebuild the file once every file's final name is known (brand.md links to the others). */
  relink?: (path: (name: string) => string) => Blob;
}

export type ItemStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface ExportItem {
  id: ExportFormat;
  label: string;
  detail: string;
  status: ItemStatus;
  /** 0–1 while running, when the step can report it. */
  progress?: number;
  note?: string;
  error?: string;
  files: string[];
}

export const DEFAULT_PNG_SIZES = [512, 1024, 2048];
export const ICON_PNGS = [16, 32, 180, 192, 512];
const ORDER: ExportFormat[] = ["svg", "png", "mono", "icons", "png3d", "glb", "mockups", "brandkit", "video", "anim-svg", "gif", "anim-video", "timelapse", "timelapse-gif", "construction"];

const LABELS: Record<ExportFormat, string> = {
  svg: "SVG",
  png: "PNG",
  mono: "Variants",
  icons: "App & web icons",
  png3d: "3D render",
  glb: "3D model",
  video: "Turntable video",
  brandkit: "Brand kit",
  mockups: MOCKUP_LABEL,
  ...ANIM_LABELS,
  ...TIMELAPSE_LABELS,
  construction: "Construction sheet",
};

function detail(f: ExportFormat, o: ExportOptions): string {
  if (isAnimFormat(f)) return animDetail(f, o);
  if (isTimelapseFormat(f)) return timelapseDetail(f, o);
  if (f === "construction") return constructionDetail(o);
  switch (f) {
    case "svg":
      return o.trim ? "Outlined text · trimmed" : "Outlined text · artboard";
    case "png":
      return `${(o.pngSizes?.length ? o.pngSizes : DEFAULT_PNG_SIZES).join(", ")} px${o.pngTransparent === false ? "" : " · transparent"}`;
    case "mono":
      return "Color on light & dark, black, white · logo + symbol · SVG + PNG";
    case "icons":
      return "favicon.ico, 16–512 px, manifest";
    case "png3d":
      return `${o.size3d ?? 2048} px${o.transparent3d === false ? "" : " · transparent"}`;
    case "glb":
      return "GLB (glTF binary)";
    case "video":
      return `${o.video?.seconds ?? 5} s · ${o.video?.size ?? 1080} px`;
    case "brandkit":
      return o.mockups?.inBrandKit ? "PDF + brand.md · A4 landscape · with mockups" : "PDF + brand.md · A4 landscape";
    case "mockups":
      return mockupDetail(o);
  }
}

/** The items an export will produce, in run order. */
export function planExport(o: ExportOptions): ExportItem[] {
  const want = new Set(o.formats);
  return ORDER.filter((f) => want.has(f)).map((id) => ({ id, label: LABELS[id], detail: detail(id, o), status: "queued", files: [] }));
}

const pngBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

const GROUND_NAME: Record<Ground, string> = { light: "Light", dark: "Dark" };
const variantMeta = (v: LogoVariant, size: string): LogoFileMeta => ({
  variant: v.part === "symbol" ? "Symbol" : "Logo",
  color: INK_LABEL[v.ink],
  background: GROUND_NAME[v.ground],
  size,
});

/**
 * Run an export. Each item fails on its own (e.g. 3D before WebGL is ready) without
 * stopping the rest; `onProgress` receives a fresh item list on every change.
 */
export async function runExport(
  doc: DocT,
  o: ExportOptions,
  onProgress?: (items: ExportItem[]) => void,
  signal?: AbortSignal,
): Promise<ExportFile[]> {
  let items = planExport(o);
  const emit = () => onProgress?.(items.map((i) => ({ ...i, files: [...i.files] })));
  const patch = (id: ExportFormat, p: Partial<ExportItem>) => {
    items = items.map((i) => (i.id === id ? { ...i, ...p } : i));
    emit();
  };
  emit();

  const base = slug(doc.name);
  const files: ExportFile[] = [];
  const trim = o.trim ? ({ pad: 0.04 } as const) : false;
  let shot3d: Blob | null = null;
  let mockShots: MockupShot[] = [];
  let mockNote: string | undefined;
  let constructionNote: string | undefined;

  await prepareFonts(doc);
  const missingFonts = [...new Set(unoutlinedText(doc).map((t) => t.fontFamily))];
  const fontNote = missingFonts.length ? `Kept as live text (font unavailable): ${missingFonts.join(", ")}` : undefined;

  for (const item of planExport(o)) {
    const id = item.id;
    if (signal?.aborted) {
      patch(id, { status: "skipped", note: "Cancelled" });
      continue;
    }
    patch(id, { status: "running", progress: 0 });
    const out: ExportFile[] = [];
    const add = (name: string, blob: Blob, logo?: LogoFileMeta) => out.push({ name, blob, ...(logo ? { logo } : {}) });
    // Let the dialog paint the "running" state before heavy synchronous work.
    await new Promise((r) => setTimeout(r, 0));
    try {
      switch (id) {
        case "svg": {
          // The logo as drawn, on its artboard's background when it has one.
          const svg = buildSvg(doc, { trim, pretty: true });
          const bg = doc.artboard.background;
          const ground = bg ? tone(bg) : designedFor(doc);
          add(`${variantName(base, { part: "logo", ink: "color", ground })}.svg`, textBlob(svgFile(svg, doc.name), "image/svg+xml"), {
            variant: "Logo",
            color: INK_LABEL.color,
            background: bg ? `${GROUND_NAME[ground]} (its own ${bg.toUpperCase()} background is included)` : GROUND_NAME[ground],
            size: svgSize(svg),
          });
          break;
        }
        case "png": {
          const sizes = [...new Set(o.pngSizes?.length ? o.pngSizes : DEFAULT_PNG_SIZES)].sort((a, b) => a - b);
          const bg = o.pngTransparent === false ? (doc.artboard.background ?? "#ffffff") : null;
          const svg = buildSvg(doc, { trim, background: bg });
          const ground = bg ? tone(bg) : designedFor(doc);
          const name = variantName(base, { part: "logo", ink: "color", ground });
          for (let i = 0; i < sizes.length; i++) {
            add(`${name}-${sizes[i]}.png`, await svgToPng(svg, sizes[i]!), {
              variant: "Logo",
              color: INK_LABEL.color,
              background: bg ? `${GROUND_NAME[ground]} (opaque ${bg.toUpperCase()} background)` : GROUND_NAME[ground],
              size: pngSize(svg, sizes[i]!),
            });
            patch(id, { progress: (i + 1) / sizes.length });
          }
          break;
        }
        case "mono": {
          // Every variant but the logo as drawn (that one is the SVG/PNG export).
          const home = designedFor(doc);
          const list = logoVariants(doc, { trim, pretty: true }).filter((v) => !(v.part === "logo" && v.ink === "color" && v.ground === home));
          for (let i = 0; i < list.length; i++) {
            const v = list[i]!;
            const name = variantName(base, v);
            add(`${name}.svg`, textBlob(svgFile(v.svg, `${doc.name} (${v.part === "symbol" ? "symbol, " : ""}${INK_LABEL[v.ink].toLowerCase()} on ${v.ground})`), "image/svg+xml"), variantMeta(v, svgSize(v.svg)));
            add(`${name}-1024.png`, await svgToPng(v.svg, 1024), variantMeta(v, pngSize(v.svg, 1024)));
            patch(id, { progress: (i + 1) / list.length });
          }
          break;
        }
        case "icons": {
          const iconFiles = await buildIcons(doc, (p) => patch(id, { progress: p }));
          for (const f of iconFiles) add(f.name, f.blob, f.logo);
          break;
        }
        case "png3d": {
          const size = o.size3d ?? 2048;
          const transparent = o.transparent3d !== false;
          const blob = await render3D(doc, { width: size, transparent });
          shot3d = blob;
          const bmp = await createImageBitmap(blob);
          add(`${base}-3d-${size}.png`, blob, { variant: "3D render", color: INK_LABEL.color, background: transparent ? GROUND_NAME[designedFor(doc)] : "Its own (opaque scene)", size: sizeOf(bmp.width, bmp.height) });
          bmp.close();
          break;
        }
        case "glb": {
          add(`${base}.glb`, await exportGLB(doc));
          break;
        }
        case "brandkit": {
          let mockups: MockupShot[] | undefined;
          if (o.mockups?.inBrandKit) {
            const pick = KIT_MOCKUPS.map((k) => mockShots.find((s) => s.kind === k)).filter((s): s is MockupShot => !!s);
            mockups = pick.length === KIT_MOCKUPS.length ? pick : (await renderMockupSet(doc, KIT_MOCKUPS, 1400, (p) => patch(id, { progress: p * 0.4 }))).shots;
          }
          const pdf = await buildBrandKit(doc, {
            mockups: mockups ? await Promise.all(mockups.map(async (m) => ({ label: m.label, png: await forPdf(m.png) }))) : undefined,
            render3d: shot3d ?? undefined,
            onProgress: (p) => patch(id, { progress: p }),
          });
          const pdfName = `${base}-brand-kit.pdf`;
          add(pdfName, pdf);
          // brand.md points at real files: the variants not exported in this run come with the kit (SVG).
          const have = new Set(files.map((f) => f.name));
          for (const v of logoVariants(doc, { trim, pretty: true })) {
            const name = `${variantName(base, v)}.svg`;
            if (!have.has(name)) add(name, textBlob(svgFile(v.svg, doc.name), "image/svg+xml"), variantMeta(v, svgSize(v.svg)));
          }
          const all = [...files, ...out];
          const md = (path?: (name: string) => string) => textBlob(brandMarkdown(doc, all, pdfName, path), "text/markdown");
          out.push({ name: "brand.md", blob: md(), relink: md });
          break;
        }
        case "mockups": {
          const r = await exportMockups(doc, o, base, (p) => patch(id, { progress: p }));
          for (const f of r.files) add(f.name, f.blob);
          mockShots = r.shots;
          if (r.note) mockNote = r.note;
          break;
        }
        case "anim-svg":
        case "anim-video":
        case "gif": {
          for (const f of await exportAnimation(doc, id, o, (p) => patch(id, { progress: Math.max(0, Math.min(1, p)) }))) add(f.name, f.blob);
          break;
        }
        case "construction": {
          const r = await exportConstruction(doc, o, base, (p) => patch(id, { progress: p }));
          for (const f of r.files) add(f.name, f.blob);
          constructionNote = r.note;
          break;
        }
        case "timelapse":
        case "timelapse-gif": {
          for (const f of await exportTimelapse(id, o, doc.name, (p) => patch(id, { progress: Math.max(0, Math.min(1, p)) }), signal)) add(f.name, f.blob);
          break;
        }
        case "video": {
          const r = await renderVideo(doc, {
            seconds: o.video?.seconds ?? 5,
            fps: o.video?.fps,
            size: o.video?.size ?? 1080,
            motion: o.video?.motion ?? "turntable",
            onProgress: (p) => patch(id, { progress: Math.max(0, Math.min(1, p)) }),
          });
          add(`${base}-${o.video?.motion === "float" ? "float" : "turntable"}.${r.ext}`, r.blob);
          break;
        }
      }
      files.push(...out);
      const note = id === "construction" ? constructionNote : id === "mockups" ? mockNote : (id === "svg" || id === "png" || id === "mono" || id === "icons" || id === "brandkit") ? fontNote : undefined;
      patch(id, { status: "done", progress: 1, files: out.map((f) => f.name), note });
    } catch (e) {
      console.error(`[export] ${id} failed`, e);
      patch(id, { status: "failed", error: humanError(e) });
    }
  }
  return files;
}

function humanError(e: unknown): string {
  const m = (e as Error)?.message || String(e);
  return m.length > 140 ? m.slice(0, 137) + "…" : m;
}

/** favicon.ico (16/32/48) + PNGs + apple-touch-icon + favicon.svg + site.webmanifest + a snippet. */
async function buildIcons(full: DocT, onProgress: (p: number) => void): Promise<ExportFile[]> {
  const out: ExportFile[] = [];
  const doc = iconMark(full);
  // Icons are square and cropped to the mark so it reads at 16 px.
  const square = buildSvg(doc, { trim: { pad: 0.04, square: true }, background: null });
  const tight = buildSvg(doc, { trim: { pad: 0.02, square: true }, background: null });
  const opaque = doc.artboard.background ?? "#ffffff";
  const touch = buildSvg(doc, { trim: { pad: 0.14, square: true }, background: opaque });

  const clear = `${GROUND_NAME[designedFor(doc)]} (transparent)`;
  const icon = (variant: string, size: string, background: string): LogoFileMeta => ({ variant, color: INK_LABEL.color, background, size });

  const steps = 8;
  let step = 0;
  const tick = () => onProgress(++step / steps);

  const ico: { size: number; png: Uint8Array }[] = [];
  for (const s of [16, 32, 48]) {
    const blob = await svgToPng(s <= 32 ? tight : square, s, { height: s });
    ico.push({ size: s, png: await pngBytes(blob) });
    if (s !== 48) out.push({ name: `icons/favicon-${s}.png`, blob, logo: icon("Favicon", sizeOf(s, s), clear) });
    tick();
  }
  out.unshift({ name: "icons/favicon.ico", blob: buildIco(ico), logo: icon("Favicon", "16, 32, 48", clear) });
  out.push({ name: "icons/apple-touch-icon.png", blob: await svgToPng(touch, 180, { height: 180 }), logo: icon("App icon (Apple touch)", sizeOf(180, 180), `Its own (opaque ${opaque.toUpperCase()})`) });
  tick();
  for (const s of [192, 512]) {
    out.push({ name: `icons/icon-${s}.png`, blob: await svgToPng(square, s, { height: s }), logo: icon("App icon (web manifest)", sizeOf(s, s), clear) });
    tick();
  }
  out.push({ name: "icons/favicon.svg", blob: textBlob(square, "image/svg+xml"), logo: icon("Favicon", svgSize(square), clear) });

  const theme = extractPalette(doc).colors[0]?.hex ?? "#0B0C0E";
  const manifest = {
    name: doc.name,
    short_name: doc.name.length > 12 ? doc.name.slice(0, 12).trim() : doc.name,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    theme_color: theme,
    background_color: opaque,
    display: "standalone",
  };
  out.push({ name: "icons/site.webmanifest", blob: textBlob(JSON.stringify(manifest, null, 2) + "\n", "application/manifest+json") });
  out.push({
    name: "icons/favicon-README.md",
    blob: textBlob(
      [
        `# ${doc.name} — web icons`,
        "",
        "Copy these files to the root of your site (next to index.html) and add this to `<head>`:",
        "",
        "```html",
        '<link rel="icon" href="/favicon.ico" sizes="32x32">',
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
        '<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">',
        '<link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">',
        `<meta name="theme-color" content="${theme}">`,
        "```",
        "",
        "Next.js (app router): put favicon.ico, icon.svg (rename favicon.svg) and apple-icon.png (rename apple-touch-icon.png) in `app/`.",
        "",
      ].join("\n"),
      "text/markdown",
    ),
  });
  tick();
  return out;
}

const STORED = /\.(png|jpe?g|mp4|webm|glb|pdf|ico|gif)$/i;

/** Zip the export client-side (already-compressed formats are stored, text is deflated). */
export async function zipFiles(files: ExportFile[]): Promise<Blob> {
  const entries: Zippable = {};
  const mtime = new Date();
  for (const f of files) {
    entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: STORED.test(f.name) ? 0 : 9, mtime }];
  }
  return new Blob([zipSync(entries)], { type: "application/zip" });
}

/** Write files into a fresh brusshy/exports/<dir> through the daemon. */
export async function saveToProject(
  files: ExportFile[],
  onFile?: (done: number, total: number) => void,
  name?: string,
): Promise<ExportResponse> {
  const { dir } = await api<{ dir: string }>("/api/export/dir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const folder = dir.split(/[\\/]/).pop() ?? "";
  const written: ExportResponse["files"] = [];
  const used = new Set<string>();
  const names: string[] = [];
  for (const f of files) {
    let name = flatName(f.name);
    // Flattening could collide (e.g. two README files): prefix with the folder.
    if (used.has(name)) name = f.name.replace(/\//g, "-");
    used.add(name);
    names.push(name);
  }
  const final = new Map(files.map((f, i) => [f.name, names[i]!]));
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const name = names[i]!;
    const blob = f.relink ? f.relink((n) => final.get(n) ?? n) : f.blob;
    const r = await api<{ bytes: number }>(
      `/api/export/file?dir=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`,
      { method: "POST", body: blob, headers: { "content-type": "application/octet-stream" } },
    );
    written.push({ name, bytes: r.bytes ?? blob.size });
    onFile?.(i + 1, files.length);
  }
  return { dir, files: written };
}

/** The agent's export request (MCP): run everything and write it into the project. */
export async function exportForAgent(doc: DocT, params: ExportParams): Promise<ExportResponse & { failed?: { format: string; error: string }[] }> {
  let last: ExportItem[] = [];
  const files = await runExport(doc, { ...params, formats: params.formats?.length ? params.formats : ["svg", "png"] }, (i) => (last = i));
  const failed = last.filter((i) => i.status === "failed").map((i) => ({ format: i.id, error: i.error ?? "failed" }));
  if (!files.length) throw new Error(failed.length ? failed.map((f) => `${f.format}: ${f.error}`).join("; ") : "Nothing to export");
  const res = await saveToProject(files, undefined, doc.name);
  return failed.length ? { ...res, failed } : res;
}
