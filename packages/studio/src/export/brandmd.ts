import type { DocT } from "@brusshy/core";
import { donts, kitRules, unitLabel } from "./rules";
import { svgViewBox } from "./raster";
import { buildSvg } from "./svg";
import { exportableIds, extractPalette, toCmyk } from "./util";
import { designedFor, symbolDoc } from "./variants";

/**
 * brand.md: the brand rules as Markdown, next to the brand-kit PDF, for any AI agent (or person)
 * that has to use the logo: which file goes on which background, clear space, minimum size,
 * colors, fonts and what not to do. Everything in it is measured on the logo.
 */

/** What an exported file is, for brand.md's table of logo files. */
export interface LogoFileMeta {
  /** Logo, Symbol, Favicon, App icon, 3D render… */
  variant: string;
  /** Full color, Black, White. */
  color: string;
  /** The background it is meant for. */
  background: string;
  /** Pixel size ("1024 × 1024"); vector files give their size at 1×. */
  size: string;
}

export const sizeOf = (w: number, h: number, vector = false) => `${Math.round(w)} × ${Math.round(h)}${vector ? " (vector)" : ""}`;
export const svgSize = (svg: string) => {
  const vb = svgViewBox(svg);
  return sizeOf(vb.width, vb.height, true);
};
/** Size of a PNG rendered `width` px wide from `svg`. */
export const pngSize = (svg: string, width: number) => {
  const vb = svgViewBox(svg);
  return sizeOf(width, Math.round((width * vb.height) / Math.max(1e-6, vb.width)));
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)];

/** Fonts set in the logo's own text layers (family + weight, with the words that use them). */
export function logoFonts(doc: DocT): { family: string; weight: number; samples: string[] }[] {
  const groups = new Map<string, { family: string; weight: number; samples: string[] }>();
  for (const id of exportableIds(doc)) {
    const n = doc.nodes[id]!;
    if (n.type !== "text" || !n.text.trim()) continue;
    const k = `${n.fontFamily}|${n.fontWeight}`;
    const g = groups.get(k) ?? { family: n.fontFamily, weight: n.fontWeight, samples: [] };
    if (g.samples.length < 3 && !g.samples.includes(n.text)) g.samples.push(n.text.length > 40 ? n.text.slice(0, 39) + "…" : n.text);
    groups.set(k, g);
  }
  return [...groups.values()];
}

/**
 * Build brand.md for this export. `files` are the export's files with their logo metadata;
 * `path` maps an export file name to where it ended up (saving into the project flattens folders).
 */
export function brandMarkdown(doc: DocT, files: { name: string; logo?: LogoFileMeta }[], pdfName: string, path: (name: string) => string = (n) => n): string {
  const name = doc.name.trim() || "Logo";
  const rules = kitRules(doc);
  const master = svgViewBox(buildSvg(doc, { trim: { pad: 0 }, background: null }));
  const home = designedFor(doc);
  const logos = files.filter((f): f is { name: string; logo: LogoFileMeta } => !!f.logo);
  const find = (re: RegExp) => logos.find((f) => re.test(f.name) && f.name.endsWith(".svg"));
  const L: string[] = [];
  const p = (...lines: string[]) => L.push(...lines);

  p(`# ${name} — brand guidelines`, "");
  p(
    "Rules for using this logo, written for people and for AI agents. Use the files listed here exactly as they are: never redraw, retype, recolor or restyle the logo.",
    `The full guidelines are in [${path(pdfName)}](${encodeURI(path(pdfName))}).`,
    "",
  );

  // ---- files
  p("## Logo files", "");
  if (logos.length) {
    p(...table(["Variant", "Color", "Background", "File", "Size (px)"], logos.map((f) => [f.logo.variant, f.logo.color, f.logo.background, `\`${path(f.name)}\``, f.logo.size])), "");
    const onLight = find(/-color-on-light\.svg$/);
    const onDark = find(/-color-on-dark\.svg$/);
    const picks = [
      onLight && `- On white or light backgrounds: \`${path(onLight.name)}\`.`,
      onDark && `- On dark backgrounds or dark photos: \`${path(onDark.name)}\` (full color made readable on dark).`,
      find(/-black-on-light\.svg$/) && `- One-color print (stamps, engraving, fax, embroidery): the \`black-on-light\` or \`white-on-dark\` files.`,
      symbolDoc(doc) && find(/-symbol-/) && `- Square or small spaces (avatars, app icons, favicons): the \`symbol\` files, or the icons.`,
      "- Use SVG wherever vectors are accepted; use PNG only where they are not, never scaled up.",
    ].filter((s): s is string => !!s);
    p("Which file to use:", "", ...picks, "");
    p(`The logo's own colors are drawn for ${home} backgrounds.`, "");
  } else p("No logo files were exported with this kit.", "");

  // ---- clear space + minimum size
  p("## Clear space", "");
  if (rules.clear) {
    const c = rules.clear;
    p(
      `Keep at least **x** of empty space on every side of the logo, where **${c.definition}**.`,
      "No text, graphics, other logos or the edge of the page or screen may come inside it. x scales with the logo: it is measured on the mark, not a fixed size.",
      "",
      `- At the master size (${Math.round(master.width)} × ${Math.round(master.height)} px), x = ${Math.round(c.value)} px.`,
      `- In other words, x = ${(c.value / master.width).toFixed(3)} × the logo's width${c.amount !== 1 ? `, and ${c.what} = ${unitLabel(c.amount)}` : ""}.`,
      "",
    );
  } else p(`Keep empty space of a quarter of the logo's shorter side on every side.`, "");
  p("## Minimum size", "");
  if (rules.minSize) {
    const m = rules.minSize;
    p(
      `- On screen: at least **${m.px} px wide**.`,
      ...(m.mm ? [`- In print: at least **${m.mm} mm wide**.`] : []),
      `- Limited by the ${m.limitedBy === "cap height" ? "wordmark's cap height (it must stay readable)" : m.limitedBy === "stroke" ? "mark's thinnest strokes (they must not break up)" : "icon size"}.`,
      ...(symbolDoc(doc) ? ["- Below it, use the symbol on its own (or the favicon)."] : []),
      "",
    );
  } else p("Never so small that any part of the logo blurs or breaks up.", "");

  // ---- colors
  const { colors, gradients } = extractPalette(doc);
  p("## Colors", "");
  if (colors.length) {
    p(
      ...table(
        ["", "HEX", "RGB", "CMYK"],
        colors.slice(0, 12).map((c, i) => [i === 0 ? "Primary" : "", c.hex.toUpperCase(), `${c.r} ${c.g} ${c.b}`, toCmyk(c.r, c.g, c.b).join(" ")]),
      ),
      "",
    );
  }
  for (const g of gradients.slice(0, 3)) p(`- ${g.type === "linear" ? `Linear gradient, ${Math.round(g.angle)}°` : "Radial gradient"}: ${g.stops.map((s) => `${s.hex.toUpperCase()} ${Math.round(s.offset * 100)}%`).join(" → ")}`);
  if (gradients.length) p("");
  const pal = doc.palette?.colors ?? [];
  if (pal.length) {
    p("Brand palette (for everything around the logo):", "", ...table(["Role", "Name", "HEX"], pal.map((c) => [c.role, c.name || "—", c.hex.toUpperCase()])), "");
  }
  if (!colors.length && !pal.length) p("The logo has no colors yet.", "");

  // ---- type
  const fonts = logoFonts(doc);
  const ts = doc.typeSystem;
  if (fonts.length || ts) {
    p("## Typography", "");
    const rows: string[][] = [];
    for (const f of fonts) rows.push(["In the logo", f.family, String(f.weight), f.samples.map((s) => `“${s}”`).join(", ")]);
    if (ts) rows.push(["Headings", ts.heading.family, String(ts.heading.weight), ts.heading.tracking ? `tracking ${ts.heading.tracking}/1000 em` : ""]);
    if (ts?.body) rows.push(["Body text", ts.body.family, String(ts.body.weight), ""]);
    p(...table(["Use", "Font", "Weight", "Notes"], rows), "");
    if (fonts.length) p("The wordmark is outlined in the logo files: never retype it in a font.", "");
  }

  // ---- misuse
  p("## Don't", "");
  for (const d of donts(rules)) p(`- **${d.title}.** ${d.note}`);
  p("- **Don't rebuild the logo.** No new lockups, taglines, crops or partial logos beyond the files above.", "");
  return L.join("\n");
}
