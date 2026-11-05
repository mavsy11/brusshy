/**
 * Regenerates the before/after images of docs/guides/vectorize.md from synthetic photos
 * rendered in code (no real photos, nothing to license):
 *
 *   npx tsx docs/guides/img/make-images.ts
 *
 * Every result is the real output of the photo tracer (packages/core/src/vectorize-photo.ts)
 * with default settings unless noted.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { vectorizePhoto, vectorizeSvg, type PhotoStyle, type PhotoVectorizeOptions, type RasterImage } from "../../../packages/core/src/index";
import { syntheticBottle, syntheticCat, syntheticMug } from "../../../packages/core/test/fixtures/photos";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---- a tiny PNG encoder (RGBA, deflate) ---- */
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b: Buffer) => {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(img: RasterImage): Buffer {
  const { width: w, height: h } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) raw[y * (w * 4 + 1) + 1 + i] = img.data[y * w * 4 + i]!;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;

/** One strip: the photo (subject outlined) followed by each style. */
function strip(file: string, photo: RasterImage, styles: { style: PhotoStyle; label: string; o?: PhotoVectorizeOptions }[], base: PhotoVectorizeOptions = {}) {
  const W = photo.width;
  const H = photo.height;
  const panelW = 300;
  const k = panelW / W;
  const panelH = Math.round(H * k);
  const gap = 18;
  const labelH = 34;
  const cols = styles.length + 1;
  const total = cols * panelW + (cols - 1) * gap + 2 * gap;
  const href = `data:image/png;base64,${png(photo).toString("base64")}`;
  const first = vectorizePhoto(photo, { ...base, style: "silhouette" });
  const outline = first.subject.parts.map((p) => p.d).join("");
  let body = `<g transform="translate(${gap} ${gap})"><image href="${href}" width="${panelW}" height="${panelH}" preserveAspectRatio="none"/>
<g transform="scale(${k})"><path d="${outline}" fill="none" stroke="#ff4d1f" stroke-width="${2.2 / k}" stroke-linejoin="round"/></g>
<text x="0" y="${panelH + 23}" ${FONT} font-size="14" fill="#0b0c0e" font-weight="600">Photo</text>
<text x="${panelW}" y="${panelH + 23}" ${FONT} font-size="12" fill="#8e9599" text-anchor="end">subject found: ${Math.round(first.subject.coverage * 100)}%</text></g>`;
  styles.forEach((s, i) => {
    const r = vectorizePhoto(photo, { ...base, ...s.o, style: s.style });
    const x = gap + (i + 1) * (panelW + gap);
    body += `<g transform="translate(${x} ${gap})"><rect width="${panelW}" height="${panelH}" fill="#ffffff" stroke="#dfe2e3"/>
<g transform="scale(${k})">${inner(vectorizeSvg(r))}</g>
<text x="0" y="${panelH + 23}" ${FONT} font-size="14" fill="#0b0c0e" font-weight="600">${s.label}</text>
<text x="${panelW}" y="${panelH + 23}" ${FONT} font-size="12" fill="#8e9599" text-anchor="end">${r.stats.parts} ${s.style === "lineart" ? "strokes" : "shapes"} · ${r.stats.nodes} nodes</text></g>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${panelH + labelH + 2 * gap}"><rect width="100%" height="100%" fill="#f4f5f5"/>${body}</svg>`;
  fs.writeFileSync(path.join(here, file), new Resvg(svg, { fitTo: { mode: "width", value: total * 2 } }).render().asPng());
  console.log("wrote", file);
}

const ALL: { style: PhotoStyle; label: string; o?: PhotoVectorizeOptions }[] = [
  { style: "silhouette", label: "Silhouette" },
  { style: "posterized", label: "Posterized · 3 tones" },
  { style: "lineart", label: "Line art" },
  { style: "stencil", label: "Stencil · 2 tones", o: { tones: 2 } },
];

strip("vectorize-photo-mug.png", syntheticMug().image, ALL);
strip("vectorize-photo-cat.png", syntheticCat().image, [
  { style: "silhouette", label: "Silhouette" },
  { style: "silhouette", label: "Silhouette · fill holes", o: { fillHoles: true } },
  { style: "posterized", label: "Posterized · grays", o: { palette: "mono", tones: 4 } },
  { style: "stencil", label: "Stencil · 3 tones", o: { tones: 3 } },
]);
strip("vectorize-photo-bottle.png", syntheticBottle().image, [
  { style: "silhouette", label: "Silhouette" },
  { style: "posterized", label: "Posterized · 4 tones", o: { tones: 4 } },
  { style: "lineart", label: "Line art · bold", o: { weight: 0.8 } },
]);
// A background that shares the subject's colors: what goes wrong, and what the optional mask
// hook fixes (here the mask comes from the synthetic scene; in practice from a local tool).
const busyPhoto = syntheticMug(900, 700, true);
const maskData = new Uint8ClampedArray(900 * 700 * 4);
for (let p = 0; p < 900 * 700; p++) maskData.set(busyPhoto.truth[p] ? [255, 255, 255, 255] : [0, 0, 0, 255], p * 4);
strip("vectorize-photo-busy.png", busyPhoto.image, [
  { style: "silhouette", label: "Automatic" },
  { style: "silhouette", label: "With a mask image", o: { subjectMask: { width: 900, height: 700, data: maskData } } },
]);
