import { z } from "zod";
import { newId, type OpT } from "@brusshy/core";
import {
  ICON_CATEGORIES,
  ICON_WEIGHTS,
  SHAPE_CATEGORIES,
  isIconId,
  loadIcons,
  loadIconWeight,
  placeGeometry,
  renderShape,
  searchShapes,
  type ShapeEntry,
  type ShapeParam,
} from "@brusshy/shapes";
import { renderSvgPng } from "../raster";
import { fail, ok, text, type ToolKit } from "./kit";

/**
 * Shapes library for agents: search the catalog (our generated shapes + the open-license
 * symbol set) with a contact sheet, then insert one as editable paths in a version.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const paramSummary = (ps?: ShapeParam[]) =>
  (ps ?? [])
    .map((p) =>
      p.type === "choice"
        ? `${p.key}: ${p.options.map((o, i) => `${i}=${o}`).join("/")} (default ${p.default})`
        : p.type === "seed"
          ? `seed: any integer (default ${p.default})`
          : `${p.key} ${p.min}–${p.max} (default ${p.default})`,
    )
    .join("; ");

const CATS = [...SHAPE_CATEGORIES.map((c) => c.id), "icons", ...ICON_CATEGORIES.map((c) => `icons/${c.id}`)];

function contactSheet(entries: ShapeEntry[], icons: Awaited<ReturnType<typeof loadIcons>> | null): string {
  const cols = Math.min(6, Math.max(1, entries.length));
  const cell = 132;
  const lab = 30;
  const rows = Math.ceil(entries.length / cols);
  const W = cols * cell + 16;
  const H = rows * (cell + lab) + 16;
  const cells = entries.map((e, i) => {
    const x = 8 + (i % cols) * cell;
    const y = 8 + Math.floor(i / cols) * (cell + lab);
    let body = "";
    try {
      const g = renderShape(e.id, undefined, icons);
      body = g.paths.map((p) => `<path d="${p.d}" fill="#0b0c0e"${p.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""}/>`).join("");
    } catch {
      body = "";
    }
    const id = e.id.length > 22 ? `${e.id.slice(0, 21)}…` : e.id;
    return (
      `<rect x="${x + 6}" y="${y + 6}" width="${cell - 12}" height="${cell + lab - 12}" rx="10" fill="#ffffff" stroke="#0b0c0e" stroke-opacity=".08"/>` +
      `<g transform="translate(${x + 22} ${y + 18}) scale(0.88)">${body}</g>` +
      `<text x="${x + cell / 2}" y="${y + cell + 12}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#585f63">${esc(id)}</text>`
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#f4f5f5"/>${cells.join("")}</svg>`;
}

export function registerShapeTools(kit: ToolKit) {
  const { tool, state, applyOps, daemon } = kit;

  tool(
    "search_shapes",
    `Search Brusshy's shapes library: ~240 parametric logo shapes generated in code (basic, stars & bursts, organic, lines & waves, arrows, badges & banners, frames & rings, letterforms, symbols, abstract marks, patterns) plus ~1,400 open-license symbols (Phosphor Icons, MIT; ids "icon:<name>"). Returns ids, names, categories, parameters and a contact sheet of the results. Empty query = browse a category.
Categories: ${CATS.join(", ")}.
Use shapes as raw material and customise them (combine, cut, deform, recolor) — never present an unmodified stock icon as the logo.`,
    {
      query: z.string().default("").describe("Words to match (name, tags, synonyms), e.g. 'leaf', 'rounded star', 'speech bubble'"),
      category: z.string().optional().describe(`One of: ${CATS.join(", ")}`),
      limit: z.number().int().min(1).max(60).default(24),
      icons: z.boolean().default(true).describe("Include the icon set (false = only our generated shapes)"),
    },
    async ({ query, category, limit, icons: withIcons }) => {
      if (category && !CATS.includes(category)) return fail(`Unknown category "${category}". Use one of: ${CATS.join(", ")}`);
      const icons = withIcons || category?.startsWith("icons") ? await loadIcons() : null;
      const all = searchShapes(query, { category, icons });
      const hits = all.slice(0, limit);
      if (!hits.length) return ok(text(`No shapes match "${query}"${category ? ` in ${category}` : ""}. Try a broader word or another category.`));
      const lines = hits.map(({ entry: e }) => {
        const cat = e.kind === "icon" ? `icons/${e.sub}` : e.category;
        const ps = e.kind === "icon" ? "weight: 0=Solid/1=Line" : paramSummary(e.params);
        return `- ${e.id} — ${e.name} [${cat}]${ps ? ` · params: ${ps}` : ""}`;
      });
      const png = renderSvgPng(contactSheet(hits.map((h) => h.entry), icons), 6 * 132 + 16);
      return ok(
        text(`${all.length} match(es)${all.length > hits.length ? `, showing ${hits.length}` : ""}:\n${lines.join("\n")}\n\nInsert one with insert_shape(id, params?, x?, y?, size?). Icons (icon:…) are © Phosphor Icons, MIT.`),
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      );
    },
  );

  tool(
    "insert_shape",
    `Insert a shape from the library (see search_shapes) into a version as editable path(s), as one undo step. x/y = centre in artboard coordinates (default: artboard centre); size = longest side (default 40% of the artboard). Fill defaults to the brand palette's primary color. Multi-part shapes become a named group. Then customise it with apply_ops / deform_path / set_svg and check with render_preview.`,
    {
      id: z.string().describe("Shape id from search_shapes, e.g. 'star', 'laurel', 'icon:coffee'"),
      params: z.record(z.string(), z.number()).optional().describe("Shape parameters (see search_shapes); icons take weight 0=Solid, 1=Line"),
      frame: z.string().optional().describe("Frame (version) id or name (default: the active frame)"),
      x: z.number().optional(),
      y: z.number().optional(),
      size: z.number().positive().optional(),
      fill: z.string().optional().describe("CSS color (default: palette primary, else ink)"),
      name: z.string().optional().describe("Layer name (default: the shape's name)"),
      parent: z.string().optional().describe("Group id to insert into (default: the frame's top level)"),
    },
    async (a) => {
      const s = await state();
      const f = kit.frameFor(s, a.frame);
      if (f.aiLock) return fail(`"${f.name}" is locked by the user — insert the shape into another version (duplicate_frame) instead.`);
      let icons = null;
      if (isIconId(a.id)) {
        const w = ICON_WEIGHTS[Math.round(a.params?.weight ?? 0)] ?? "fill";
        icons = await loadIconWeight(w);
      }
      let g;
      try {
        g = renderShape(a.id, a.params, icons);
      } catch (e) {
        return fail(`${(e as Error).message}. Find ids with search_shapes.`);
      }
      const size = a.size ?? Math.round(Math.min(f.width, f.height) * 0.4);
      const cx = a.x ?? f.width / 2;
      const cy = a.y ?? f.height / 2;
      const primary = s.doc.palette?.colors.find((c) => c.role === "primary")?.hex ?? s.doc.palette?.colors[0]?.hex;
      const fill = a.fill ?? primary ?? "#0b0c0e";
      const name = a.name ?? g.name;
      const placed = placeGeometry(g, size);
      const parent = a.parent ?? f.id;
      if (a.parent) {
        const p = s.doc.nodes[a.parent];
        if (!p || (p.type !== "group" && p.type !== "frame")) return fail(`${a.parent} is not a group.`);
      }
      const style = (fillRule: "nonzero" | "evenodd") => ({ fill, stroke: null, strokeWidth: 0, fillRule });
      const ops: OpT[] = [];
      let top: string;
      if (placed.length === 1) {
        top = newId("n");
        ops.push({ op: "add", node: { id: top, type: "path", name, d: placed[0]!.d, transform: { x: cx, y: cy }, style: style(placed[0]!.fillRule) }, parent });
      } else {
        top = newId("n");
        ops.push({ op: "add", node: { id: top, type: "group", name, transform: { x: cx, y: cy }, style: { fill: null } }, parent });
        placed.forEach((p, i) => ops.push({ op: "add", node: { id: newId("n"), type: "path", name: p.name ?? `${name} ${i + 1}`, d: p.d, style: style(p.fillRule) }, parent: top }));
      }
      const r = await applyOps(ops, `Insert ${name}`);
      if (!r.ok) return fail(r.error ?? "Could not insert the shape");
      try {
        await (await daemon()).call("POST", "/api/focus", { ids: [top] });
      } catch {
        /* focus is cosmetic */
      }
      const icon = isIconId(a.id) ? " (Phosphor Icons, MIT — customise it before using it in a logo)" : "";
      return ok(
        text(
          `Inserted "${name}" (${a.id}${icon}) as ${placed.length === 1 ? `path ${top}` : `group ${top} with ${placed.length} paths`} in "${f.name}": centre (${Math.round(cx)}, ${Math.round(cy)}), ${Math.round((g.bounds.width / Math.max(g.bounds.width, g.bounds.height)) * size)}×${Math.round((g.bounds.height / Math.max(g.bounds.width, g.bounds.height)) * size)}, fill ${fill}.\nThe path's local origin is its centre, so rotation/scale in transform pivot there. Now make it yours (proportions, cuts, combinations) and check with render_preview.`,
        ),
      );
    },
    "Adding a shape…",
  );
}
