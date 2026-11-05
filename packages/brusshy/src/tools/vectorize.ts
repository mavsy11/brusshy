import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Resvg } from "@resvg/resvg-js";
import { frameOf, vectorize, vectorizeOps, vectorizePhoto, vectorizeSvg, type PhotoVectorizeResult, type RasterImage, type ReferenceNodeT, type VectorizeResult } from "@brusshy/core";
import { layout, realInside } from "../paths";
import { fail, ok, text, type ToolKit } from "./kit";

/**
 * vectorize_reference runs right here in the MCP process — no browser needed:
 * the reference file is decoded locally (resvg renders it to RGBA, the same engine
 * the daemon already uses for server previews) and traced by the pure-TS tracer in
 * @brusshy/core, the same code the studio's live preview runs. Nothing goes online.
 */

const MAX_DECODE = 2400;

type Mime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";

/** Pixel size from the file header (PNG, JPEG, GIF, WebP). */
export function imageSize(buf: Buffer): { width: number; height: number; mime: Mime } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), mime: "image/png" };
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), mime: "image/gif" };
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, mime: "image/webp" };
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, mime: "image/webp" };
    }
    if (kind === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1, mime: "image/webp" };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1]!;
      const size = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), mime: "image/jpeg" };
      i += 2 + size;
    }
  }
  return null;
}

/** Decode an image file to RGBA (downscaled to MAX_DECODE on the long side). */
export function decodeImage(buf: Buffer, isSvg = false): RasterImage {
  if (isSvg) {
    const img = new Resvg(buf.toString("utf8"), { fitTo: { mode: "width", value: 1600 } }).render();
    return { width: img.width, height: img.height, data: img.pixels };
  }
  const size = imageSize(buf);
  if (!size || !size.width || !size.height) throw new Error("Unsupported image (use PNG, JPEG, GIF or WebP)");
  const k = Math.min(1, MAX_DECODE / Math.max(size.width, size.height));
  const W = Math.max(1, Math.round(size.width * k));
  const H = Math.max(1, Math.round(size.height * k));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image href="data:${size.mime};base64,${buf.toString("base64")}" width="${W}" height="${H}" preserveAspectRatio="none"/></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "original" } }).render();
  return { width: img.width, height: img.height, data: img.pixels };
}

/** Read a reference node's image bytes (project file under brusshy/ or a data: URL). */
function readReference(src: string): { buf: Buffer; svg: boolean } {
  if (src.startsWith("data:")) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
    if (!m) throw new Error("Unreadable data URL");
    const buf = m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!), "utf8");
    return { buf, svg: m[1] === "image/svg+xml" };
  }
  const root = layout().root;
  const file = path.resolve(root, src.replace(/^\//, ""));
  if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Reference path is outside the project");
  if (!fs.existsSync(file)) throw new Error(`Reference file not found: ${src}`);
  if (!realInside(root, file)) throw new Error("Reference path is outside the project");
  return { buf: fs.readFileSync(file), svg: file.toLowerCase().endsWith(".svg") };
}

const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Photo-mode preview: the photo with the background dimmed and the detected subject outlined
 * (crop dashed), next to the traced result on white.
 */
function photoPreviewSvg(r: PhotoVectorizeResult, src: { buf: Buffer; svg: boolean }): string {
  const W = r.width;
  const H = r.height;
  const gap = Math.round(Math.max(W, H) * 0.04);
  const mime = src.svg ? "image/svg+xml" : (imageSize(src.buf)?.mime ?? "image/png");
  const href = `data:${mime};base64,${src.buf.toString("base64")}`;
  const subject = r.subject.parts.map((p) => p.d).join("");
  const sw = Math.max(W, H) / 300;
  const c = r.crop;
  const cropRect =
    c.x > 0.001 || c.y > 0.001 || c.width < 0.999 || c.height < 0.999
      ? `<rect x="${c.x * W}" y="${c.y * H}" width="${c.width * W}" height="${c.height * H}" fill="none" stroke="#ffffff" stroke-width="${sw}" stroke-dasharray="${sw * 4} ${sw * 3}"/>`
      : "";
  const right = vectorizeSvg(r, { background: "#ffffff" }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * 2 + gap} ${H}" width="${W * 2 + gap}" height="${H}">
<rect width="${W * 2 + gap}" height="${H}" fill="#f4f5f5"/>
<image href="${escAttr(href)}" width="${W}" height="${H}" preserveAspectRatio="none"/>
<path d="M0 0H${W}V${H}H0Z${subject}" fill="#0b0c0e" fill-opacity="0.6" fill-rule="evenodd"/>
<path d="${subject}" fill="none" stroke="#ff4d1f" stroke-width="${sw}" stroke-linejoin="round"/>${cropRect}
<g transform="translate(${W + gap} 0)">${right}</g></svg>`;
}

export function registerVectorizeTools(kit: ToolKit) {
  const { tool, state, applyOps, daemon } = kit;

  tool(
    "vectorize_reference",
    `Trace a reference image layer into clean vector paths, offline (nothing goes online). The result is one named group placed exactly over the image (same transform), as one undo step; the image stays (it is never exported).
- mode "lines": centerline strokes for pencil/pen sketches. mode "shapes": filled regions for logos and flat artwork (colors 1–6 posterizes; threshold 0–1, omit = automatic).
- mode "photo": a photo of a real object (a mug, a pet, a product, a hand-painted sign). The subject is cut out from its background automatically (estimated from the image border; cast shadows ignored), then drawn as style:
  "silhouette" one solid shape (most logo-ready) · "posterized" 2–6 stacked tonal layers (tones, palette color|mono) · "lineart" edges as centerline strokes (weight) · "stencil" 2–3 tones with bridges so it can be cut (bridges).
  Isolation knobs: subject auto|darker|lighter, tolerance 0–1 (omit = automatic; higher eats more of the background), shadows 0–1, keep (N largest subjects), fill_holes, cleanup 0–1, isolate=false (whole crop), crop {x,y,width,height} in 0–1 fractions, mask (project path of a mask image from a local segmentation tool: white/opaque = subject). Photos with a transparent background use their alpha as the mask.
  Preprocessing: exposure −1…1, contrast −1…1, denoise 0–1, corners 0–1 (higher keeps more sharp corners).
- smoothing 0–1, detail 0–1, specks 0–1 (ignore dots and pinholes up to this size) apply to every mode.
- apply=false previews without changing the document (photo mode shows the detected subject next to the result) — preview first, tune, then apply.
Vectorize first, then simplify and correct by hand: the trace is raw material, not the logo.`,
    {
      id: z.string().optional().describe("Reference node id (default: the selected or only reference image in the frame)"),
      mode: z.enum(["shapes", "lines", "photo"]).default("shapes"),
      colors: z.number().int().min(1).max(6).default(1),
      threshold: z.number().min(0).max(1).optional(),
      smoothing: z.number().min(0).max(1).optional().describe("Default 0.5 (photo 0.6)"),
      detail: z.number().min(0).max(1).optional().describe("Default 0.5"),
      specks: z.number().min(0).max(1).optional().describe("Default 0.25 (photo 0.3)"),
      even_lighting: z.boolean().optional().describe("Flatten shadows/vignetting of a photographed page (default: on for lines)"),
      style: z.enum(["silhouette", "posterized", "lineart", "stencil"]).default("silhouette").describe("Photo mode: what to draw from the subject"),
      subject: z.enum(["auto", "darker", "lighter"]).default("auto").describe("Photo mode: the subject is darker / lighter than its background"),
      tolerance: z.number().min(0).max(1).optional().describe("Photo mode: background tolerance (omit = automatic)"),
      shadows: z.number().min(0).max(1).optional().describe("Photo mode: cast-shadow removal (default 0.6, 0 = off)"),
      keep: z.number().int().min(1).max(6).optional().describe("Photo mode: keep the N largest subjects (default 1)"),
      fill_holes: z.boolean().optional().describe("Photo mode: fill holes inside the subject (light patches that got cut out)"),
      isolate: z.boolean().optional().describe("Photo mode: false = no background removal, use the whole crop"),
      cleanup: z.number().min(0).max(1).optional().describe("Photo mode: mask clean-up (default 0.35)"),
      exposure: z.number().min(-1).max(1).optional(),
      contrast: z.number().min(-1).max(1).optional(),
      denoise: z.number().min(0).max(1).optional().describe("Photo mode: blur before tracing (default 0.3)"),
      corners: z.number().min(0).max(1).optional().describe("Photo mode: corner sharpness (default 0.5)"),
      tones: z.number().int().min(2).max(6).optional().describe("Photo posterized 2–6 / stencil 2–3 (default 3)"),
      palette: z.enum(["color", "mono"]).optional().describe("Photo posterized: photo colors or a gray ramp"),
      bridges: z.number().min(0).max(1).optional().describe("Photo stencil: bridge width (default 0.4)"),
      weight: z.number().min(0).max(1).optional().describe("Photo line art: stroke weight (default 0.4)"),
      color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional().describe("Photo silhouette / line art color (default near-black)"),
      crop: z
        .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0.02).max(1), height: z.number().min(0.02).max(1) })
        .optional()
        .describe("Photo mode: only this part of the image, in 0–1 fractions"),
      mask: z.string().optional().describe("Photo mode: project path of a subject mask image (e.g. brusshy/refs/mug-mask.png)"),
      apply: z.boolean().default(true),
      frame: z.string().optional().describe("Frame (version) id or name to look for the reference in (default: active frame)"),
    },
    async (a) => {
      const s = await state();
      let ref: ReferenceNodeT | undefined;
      if (a.id) {
        const n = s.doc.nodes[a.id];
        if (!n || n.type !== "reference") return fail(`${a.id} is not a reference image layer.`);
        ref = n;
      } else {
        const f = kit.frameFor(s, a.frame);
        const refs = Object.values(s.doc.nodes).filter((n): n is ReferenceNodeT => n.type === "reference" && frameOf(s.doc, n.id)?.id === f.id);
        ref = refs.find((n) => s.selection.includes(n.id)) ?? (refs.length === 1 ? refs[0] : undefined);
        if (!ref)
          return fail(
            refs.length
              ? `Several reference images in "${f.name}" — pass id: ${refs.map((n) => `${n.id}${n.name ? ` "${n.name}"` : ""}`).join(", ")}`
              : `No reference image in "${f.name}". The user can drop or paste an image onto the canvas first.`,
          );
      }

      const src = readReference(ref.src);
      const img = decodeImage(src.buf, src.svg);
      const target = { width: ref.width, height: ref.height };
      const photo = a.mode === "photo";
      let result: VectorizeResult;
      let summary: string;
      let previewSvg: string;
      let maskNote = "";
      if (photo) {
        let subjectMask: RasterImage | null = null;
        if (a.mask) {
          try {
            const m = readReference(a.mask);
            subjectMask = decodeImage(m.buf, m.svg);
          } catch (e) {
            return fail(`Could not read the mask ${a.mask}: ${(e as Error).message}`);
          }
        }
        const r = vectorizePhoto(img, {
          style: a.style,
          subject: a.subject,
          tolerance: a.tolerance ?? null,
          shadows: a.shadows,
          keep: a.keep,
          fillHoles: a.fill_holes,
          isolate: a.isolate,
          cleanup: a.cleanup,
          exposure: a.exposure,
          contrast: a.contrast,
          denoise: a.denoise,
          detail: a.detail,
          smoothing: a.smoothing,
          corners: a.corners,
          specks: a.specks,
          tones: a.tones,
          palette: a.palette,
          bridges: a.bridges,
          weight: a.weight,
          color: a.color,
          crop: a.crop ?? null,
          subjectMask,
          target,
        });
        result = r;
        const cov = Math.round(r.subject.coverage * 100);
        const src2 = { border: "the background estimated at the image border", alpha: "the image's transparency", mask: `the mask ${a.mask}`, all: "the whole crop (isolate=false)" }[r.subject.source];
        maskNote =
          `Subject: ${cov}% of the ${r.crop.width < 0.999 || r.crop.height < 0.999 ? "crop" : "image"}, from ${src2}` +
          (r.tolerance !== null ? ` (tolerance ${r.tolerance.toFixed(2)})` : "") +
          (r.subject.source === "border" && cov > 85 ? ". That is most of the image — the background was probably kept: raise tolerance, set subject darker/lighter, or crop tighter." : "") +
          (r.subject.source === "border" && cov < 2 ? ". Very little was found — lower tolerance, or crop around the object." : "") +
          ".";
        summary = `${r.style}: ${r.stats.parts} ${r.style === "lineart" ? "stroke" : "shape"}(s), ${r.stats.nodes} nodes, ${r.layers.length} layer(s): ${r.layers.map((l) => l.color + (l.kind === "stroke" ? ` ${l.strokeWidth}px stroke` : "")).join(", ")}${r.style === "stencil" ? ` · ${r.bridges} bridge(s)` : ""} · traced at ${r.stats.workWidth}×${r.stats.workHeight} in ${r.stats.ms} ms`;
        previewSvg = photoPreviewSvg(r, src);
        if (!r.stats.parts) return ok(text(`Nothing was traced. ${maskNote} Try another tolerance, a crop around the object, isolate=false, or another style.`), previewImage(previewSvg, 1024));
      } else {
        result = vectorize(img, {
          mode: a.mode as "shapes" | "lines",
          colors: a.colors,
          threshold: a.threshold ?? null,
          smoothing: a.smoothing ?? 0.5,
          detail: a.detail ?? 0.5,
          specks: a.specks ?? 0.25,
          evenLighting: a.even_lighting,
          target,
        });
        if (!result.stats.parts)
          return fail(`Nothing was traced (threshold ${result.threshold?.toFixed(2) ?? "auto"}). Try a lower threshold, fewer specks, or the other mode.`);
        summary = `${result.stats.parts} ${a.mode === "lines" ? "stroke" : "shape"}(s), ${result.stats.nodes} nodes, ${result.layers.length} color layer(s): ${result.layers.map((l) => l.color + (l.kind === "stroke" ? ` ${l.strokeWidth}px stroke` : "")).join(", ")}${result.threshold !== null ? ` · threshold ${result.threshold.toFixed(2)}` : ""} · traced at ${result.stats.workWidth}×${result.stats.workHeight} in ${result.stats.ms} ms`;
        previewSvg = vectorizeSvg(result, { background: "#ffffff" });
      }
      const image = previewImage(previewSvg, photo ? 1024 : 768);

      const photoNext =
        "Next: this trace is raw material, not the logo. 1) Simplify: delete stray bits, merge or drop minor tonal layers, cut nodes on wobbly curves (apply_ops), keep only the parts that carry the idea. 2) Design on top: redraw the key shapes as clean geometry (set_svg), exaggerate the recognizable features, fix symmetry and line weights, consider negative space and a single color. 3) render_preview and check_small_sizes. Hide or remove the reference and this raw group when the clean version is done.";
      if (!a.apply) return ok(text(`Preview only (nothing changed): ${summary}${maskNote ? `\n${maskNote}` : ""}\nTune and call again with apply=true.`), image);

      const name = photo ? `${(a.style as string)[0]!.toUpperCase()}${a.style.slice(1).replace("art", " art")} trace — ${ref.name || "photo"}` : undefined;
      const { ops, groupId } = vectorizeOps(s.doc, ref.id, result, name ? { name } : {});
      const r = await applyOps(ops, photo ? "Vectorize photo" : "Vectorize image");
      if (!r.ok) return fail(r.error ?? "Could not add the paths");
      try {
        await (await daemon()).call("POST", "/api/focus", { ids: [groupId] });
      } catch {
        /* cosmetic */
      }
      return ok(
        text(
          photo
            ? `Added group ${groupId} "${name}" over reference ${ref.id}: ${summary}.\n${maskNote}\n${photoNext}`
            : `Added group ${groupId} "Vectorized ${ref.name || "image"}" over reference ${ref.id}: ${summary}.\nNext: clean it up — delete stray bits, merge parts that belong together, straighten and symmetrize, swap wobbly curves for clean geometry (apply_ops / set_svg), then check with render_preview. Hide or remove the reference when done.`,
        ),
        image,
      );
    },
    "Vectorizing the image…",
  );
}

function previewImage(svg: string, width: number) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return { type: "image" as const, data: Buffer.from(png).toString("base64"), mimeType: "image/png" };
}
