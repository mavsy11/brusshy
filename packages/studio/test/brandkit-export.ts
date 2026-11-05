import { applyOps, createDoc, Doc, frameDoc, listFrames, svgToOps, type DocT } from "@brusshy/core";
import { runExport, type ExportFile } from "../src/export/pipeline";
import { flatName } from "../src/export/util";
import brusshyMark from "./fixtures/brusshy-mark.svg?raw";

/*
 * Runs the real export (logo files, variants, icons, brand kit) on a few logos and hands every
 * file back to the runner, which writes them to test/out-brandkit/ and checks them.
 */

const style = (o: Record<string, unknown>) => ({ fill: "#0b0c0e", stroke: null, strokeWidth: 0, strokeLinecap: "round", strokeLinejoin: "round", opacity: 1, fillRule: "nonzero", ...o });

/** Stacked: stroked ring + gradient needle over "NORTH" (a mark and a wordmark, drawn for light). */
const compass = (): DocT =>
  Doc.parse({
    id: "doc_compass",
    name: "Compass",
    artboard: { width: 1024, height: 1024, background: null },
    root: ["ring", "needle", "south", "hub", "word"],
    nodes: {
      ring: { id: "ring", type: "shape", shape: "ellipse", width: 520, height: 520, transform: { x: 252, y: 130 }, style: style({ fill: null, stroke: "#0b0c0e", strokeWidth: 28 }) },
      needle: { id: "needle", type: "path", d: "M0 -210L46 0L-46 0Z", transform: { x: 512, y: 390, rotation: 18 }, style: style({ fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#ff7a45" }, { offset: 1, color: "#c2260c" }] } }) },
      south: { id: "south", type: "path", d: "M0 210L46 0L-46 0Z", transform: { x: 512, y: 390, rotation: 18 }, style: style({ fill: "#0b0c0e" }) },
      hub: { id: "hub", type: "shape", shape: "ellipse", width: 40, height: 40, transform: { x: 492, y: 370 }, style: style({ fill: "#f4f5f5", stroke: "#0b0c0e", strokeWidth: 6 }) },
      word: { id: "word", type: "text", text: "NORTH", fontFamily: "Geist", fontWeight: 600, fontSize: 124, letterSpacing: 18, anchor: "middle", transform: { x: 512, y: 880 }, style: style({ fill: "#0b0c0e" }) },
    },
    typeSystem: { heading: { family: "Geist", weight: 600 }, body: { family: "Geist", weight: 400 } },
    createdAt: 0,
    updatedAt: 0,
  });

function docFrom(name: string, svg: string, background: string | null = null): DocT {
  let doc = createDoc(name);
  const fid = listFrames(doc)[0]!.id;
  const { ops } = svgToOps(svg);
  doc = applyOps(doc, [...ops.map((o) => (o.op === "add" && !(o as { parent?: string }).parent ? { ...o, parent: fid } : o)), { op: "update", id: fid, set: { background } }]).doc;
  return frameDoc(doc, fid);
}

const FIXTURES: (() => DocT)[] = [
  compass,
  // The real Brusshy badge: a dark plate carrying a light mark (the plate must keep its color on dark).
  () => docFrom("Brusshy", brusshyMark),
  // A symbol on its own: one brand hue with a white detail.
  () => docFrom("Ember", `<svg viewBox="0 0 1024 1024"><path d="M512 160 C700 360 780 500 780 640 C780 790 660 880 512 880 C364 880 244 790 244 640 C244 500 324 360 512 160 Z" fill="#e4472a"/><circle cx="512" cy="660" r="110" fill="#ffffff"/></svg>`),
  // A light logo drawn on a dark artboard.
  () => docFrom("Paperlight", `<svg viewBox="0 0 1024 1024"><rect x="160" y="352" width="320" height="320" rx="80" fill="none" stroke="#f6f3ec" stroke-width="48"/><circle cx="320" cy="512" r="72" fill="#f2b33d"/><text x="540" y="560" font-family="Geist" font-weight="500" font-size="120" fill="#f6f3ec">paper</text></svg>`, "#16181c"),
];

const b64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

declare global {
  interface Window {
    runBrandKit: () => Promise<{ fixture: string; files: { name: string; data: string; logo: unknown }[]; failed: string[]; savedMd: string }[]>;
  }
}

window.runBrandKit = async () => {
  const out = [];
  for (const make of FIXTURES) {
    const doc = make();
    let failed: string[] = [];
    const files: ExportFile[] = await runExport(doc, { formats: ["svg", "png", "mono", "icons", "brandkit"], pngSizes: [512] }, (items) => {
      failed = items.filter((i) => i.status === "failed").map((i) => `${i.id}: ${i.error}`);
    });
    // Saving into the project flattens folders: brand.md is rebuilt with the names it gets there.
    const savedMd = (await files.find((f) => f.name === "brand.md")?.relink?.(flatName).text()) ?? "";
    out.push({ fixture: doc.name, failed, savedMd, files: await Promise.all(files.map(async (f) => ({ name: f.name, data: await b64(f.blob), logo: f.logo ?? null }))) });
  }
  return out;
};
document.title = "ready";
