import { z } from "zod";
import {
  BOARD_ROLE_HINT,
  BOARD_ROLE_LABEL,
  describeRepeat,
  listTechniques,
  releaseRepeatOps,
  repeatGroupOf,
  repeatOps,
  RepeatError,
  type BoardItemT,
  type GroupNodeT,
  type Technique,
} from "@brusshy/core";
import { renderSvgPng } from "../raster";
import { fail, ok, text, type Content, type ToolKit } from "./kit";

/** Exploration tools: the technique catalog, exact repeats (radial / mirror / grid) and the reference board. */

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
const ext = (src: string) => (src.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
/** Formats the server rasterizer can embed in the contact sheet (others are sent as their own images). */
const SHEET_OK = new Set(["image/png", "image/jpeg", "image/gif", "image/svg+xml"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function techniqueBlock(t: Technique): string {
  return [`- ${t.id} — ${t.name}: ${t.summary}`, t.subjects ? `    subjects: ${t.subjects}` : "", `    watch out: ${t.watchOut}`, `    build: ${t.howTo}`].filter(Boolean).join("\n");
}

/** Contact sheet of the board: a grid of cells, each image fitted, with its number, role and note. */
function contactSheet(items: { item: BoardItemT; data: Buffer; mime: string }[]): Buffer {
  const n = items.length;
  const cols = n <= 3 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const cell = 300;
  const band = 54;
  const gap = 14;
  const W = cols * cell + (cols + 1) * gap;
  const H = rows * (cell + band) + (rows + 1) * gap;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#f4f5f5"/>`];
  items.forEach(({ item, data, mime }, i) => {
    const x = gap + (i % cols) * (cell + gap);
    const y = gap + Math.floor(i / cols) * (cell + band + gap);
    const note = item.note.trim();
    const short = note.length > 46 ? `${note.slice(0, 45)}…` : note;
    parts.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell + band}" rx="10" fill="#ffffff" stroke="#dfe2e3"/>`,
      SHEET_OK.has(mime)
        ? `<image x="${x + 8}" y="${y + 8}" width="${cell - 16}" height="${cell - 16}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${data.toString("base64")}"/>`
        : `<text x="${x + cell / 2}" y="${y + cell / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#8e9599">image #${i + 1} follows the sheet</text>`,
      `<text x="${x + 12}" y="${y + cell + 18}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#0b0c0e">#${i + 1} · ${esc(BOARD_ROLE_LABEL[item.role])}</text>`,
      short ? `<text x="${x + 12}" y="${y + cell + 40}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#585f63">${esc(short)}</text>` : "",
    );
  });
  return renderSvgPng(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`, W);
}

export function registerExploreTools({ tool, daemon, state, applyOps }: ToolKit) {
  tool(
    "list_techniques",
    "The construction-technique catalog for exploring marks: letter treatments (stencil, modular, monoline, inline, negative space, interlock, fold, rotation, container, perspective, fragmented, object-letter) and symbol constructions (radial repeat, mirror symmetry, circle construction, modular grid, line-based, positive/negative swap, silhouette + cutout, geometric reduction). Each comes with what it does, what goes wrong and how to build it here. Use it to run one letter or subject through several techniques (make_variants, one technique per variant, named after it). Copy the technique, never a specific mark.",
    { kind: z.enum(["letter", "symbol"]).optional().describe("letter = monograms/initials/wordmark details; symbol = pictorial and abstract marks. Default: both.") },
    async ({ kind }) => {
      const groups = kind ? [kind] : (["letter", "symbol"] as const);
      const out = groups.map((k) => `${k === "letter" ? "Letter-based techniques (one letter, many treatments)" : "Symbol constructions (one subject, many constructions)"}:\n${listTechniques(k).map(techniqueBlock).join("\n")}`);
      return ok(
        text(
          `${out.join("\n\n")}\n\nExploring: pick a letter or subject, run it through 4–6 techniques with make_variants (blank, one technique per variant, rename each variant "<name> · <technique>"), keep the 2–3 that carry the idea. Radial, mirror and grid constructions: draw one unit, then the repeat tool.`,
        ),
      );
    },
  );

  tool(
    "repeat",
    `Exact repeats of a unit — never eyeball copies. One undo step; the result is a group (e.g. "Petal ×8") with the source first and generated copies after; the group remembers the recipe.
- radial: count instances (source included) rotated by angle/count about the pivot (angle < 360 = a fan with both ends). Options: alternate_scale (every other copy scaled toward the centre), alternate_mirror (every other copy mirrored across its radius), orient=false keeps copies upright.
- mirror: axis vertical (left↔right across a vertical line), horizontal (top↕bottom) or both (4-way). Draw half against the axis first.
- grid: count columns × rows with gap between the copies' bounds.
merge=true unions everything into one exact shape (best for mirrored halves that touch the axis).
Pivot: "artboard" (centre of the version, default for radial/mirror), "selection" (the unit's centre) or {x,y} in artboard coordinates.
To rebuild after editing the source (or change count/angle/pivot…), call repeat again with ids=[the group or its source] and only the options to change. release=true turns it into a plain group.`,
    {
      ids: z.array(z.string()).min(1).describe("Layers to repeat (siblings; several become one unit), or an existing repeat group / its source to rebuild"),
      mode: z.enum(["radial", "mirror", "grid"]).optional().describe("Required for a new repeat"),
      count: z.number().int().min(1).max(72).optional().describe("radial: instances incl. the source (default 8); grid: columns (default 3)"),
      rows: z.number().int().min(1).max(72).optional().describe("grid: rows (default 1)"),
      angle: z.number().min(-360).max(360).optional().describe("radial sweep in degrees (default 360)"),
      pivot: z.union([z.enum(["artboard", "selection"]), z.object({ x: z.number(), y: z.number() })]).optional(),
      axis: z.enum(["vertical", "horizontal", "both"]).optional().describe("mirror axis (default vertical)"),
      gap: z.number().optional().describe("grid: gap between copies (default 24)"),
      gap_y: z.number().optional().describe("grid: vertical gap (default = gap)"),
      alternate_scale: z.number().min(0.05).max(4).optional(),
      alternate_mirror: z.boolean().optional(),
      orient: z.boolean().optional(),
      merge: z.boolean().optional().describe("Union the source and copies into one exact shape (e.g. a mirrored half → one symmetric shape); the source stays hidden so rebuilds still work. merge=false splits it back into copies."),
      name: z.string().max(80).optional().describe("Group name (default like \"Petal ×8\")"),
      release: z.boolean().optional().describe("Stop treating the group as a repeat (copies stay as plain layers)"),
    },
    async (a) => {
      const s = await state();
      const missing = a.ids.filter((id) => !s.doc.nodes[id]);
      if (missing.length) return fail(`Not found: ${missing.join(", ")}`);
      if (a.release) {
        const g = repeatGroupOf(s.doc, a.ids[0]);
        if (!g) return fail(`${a.ids[0]} is not a repeat group.`);
        const r = await applyOps(releaseRepeatOps(s.doc, g.id), "Release repeat");
        return r.ok ? ok(text(`"${g.name}" (${g.id}) is now a plain group; its copies are ordinary layers.`)) : fail(r.error ?? "Failed");
      }
      const existing = a.ids.length === 1 ? repeatGroupOf(s.doc, a.ids[0]) : null;
      const rebuild = !!existing && (existing.id === a.ids[0] || existing.repeat!.source === a.ids[0]);
      if (!rebuild && !a.mode) return fail("Pass mode (radial, mirror or grid) for a new repeat.");
      let result;
      try {
        result = repeatOps(
          s.doc,
          a.ids,
          {
            mode: a.mode ?? existing?.repeat?.mode ?? "radial",
            count: a.count,
            rows: a.rows,
            angle: a.angle,
            pivot: a.pivot,
            axis: a.axis,
            gap: a.gap,
            gapY: a.gap_y,
            altScale: a.alternate_scale,
            altMirror: a.alternate_mirror,
            orient: a.orient,
            merge: a.merge,
            name: a.name,
          },
        );
      } catch (e) {
        if (e instanceof RepeatError) return fail(e.message);
        throw e;
      }
      const r = await applyOps(result.ops, result.label);
      if (!r.ok) return fail(r.error ?? "Failed");
      await (await daemon()).call("POST", "/api/focus", { ids: [result.groupId] });
      const after = await state();
      const g = after.doc.nodes[result.groupId] as GroupNodeT | undefined;
      return ok(
        text(
          `${result.updated ? "Rebuilt" : "Made"} "${g?.name ?? ""}" (group ${result.groupId}): ${describeRepeat(result.recipe)} — source ${result.sourceId} + ${result.copies} cop${result.copies === 1 ? "y" : "ies"}.\nEdit the source (${result.sourceId}), then call repeat with ids=["${result.groupId}"] to rebuild (copies are regenerated; hand edits to copies are replaced). Check it with render_preview.`,
        ),
      );
    },
    "Repeating…",
  );

  tool(
    "get_board",
    "The user's reference board: inspiration images they collected for this logo, each with a role (reference / palette / silhouette / style) that says what to take from it, and an optional note. Returns a numbered contact sheet plus the roles and notes. Take the technique and feel, never copy a mark.",
    {},
    async () => {
      const s = await state();
      const items = s.doc.board?.items ?? [];
      if (!items.length) return ok(text("The reference board is empty. (The user adds images in the studio: Reference board.)"));
      const c = await daemon();
      const loaded: { item: BoardItemT; data: Buffer; mime: string }[] = [];
      const missing: string[] = [];
      for (const item of items) {
        const mime = MIME[ext(item.src)];
        try {
          if (!mime || /^(https?:|data:)/.test(item.src)) throw new Error("unsupported");
          const res = await fetch(`${c.base}/${item.src.replace(/^\.?\//, "").split("/").map(encodeURIComponent).join("/")}`, { headers: { "x-brusshy-token": c.info.token } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          loaded.push({ item, data: Buffer.from(await res.arrayBuffer()), mime });
        } catch {
          missing.push(item.src);
        }
      }
      const content: Content[] = [];
      if (loaded.length) {
        try {
          content.push({ type: "image", data: contactSheet(loaded).toString("base64"), mimeType: "image/png" });
          loaded.forEach((l) => {
            if (SHEET_OK.has(l.mime)) return;
            content.push(text(`#${items.indexOf(l.item) + 1} (${l.item.name || l.item.src}):`), { type: "image", data: l.data.toString("base64"), mimeType: l.mime });
          });
        } catch {
          // Fall back to the images one by one (raster formats only).
          for (const l of loaded) if (l.mime !== "image/svg+xml") content.push({ type: "image", data: l.data.toString("base64"), mimeType: l.mime });
        }
      }
      const lines = items.map((it, i) => `#${i + 1} ${it.name || it.src} — ${BOARD_ROLE_LABEL[it.role]}: ${BOARD_ROLE_HINT[it.role]}${it.note.trim() ? `\n    note: "${it.note.trim()}"` : ""}`);
      content.push(
        text(
          `Reference board — ${items.length} image${items.length === 1 ? "" : "s"}:\n${lines.join("\n")}${missing.length ? `\n(Couldn't load: ${missing.join(", ")})` : ""}\n\nUse it as direction, not as source material: take techniques, proportions, colour relationships and era — never trace or copy a mark from it. If images disagree, the brief wins; mention the conflict in one line.`,
        ),
      );
      return ok(...content);
    },
    "Looking at the reference board…",
  );
}
