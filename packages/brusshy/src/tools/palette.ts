import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Resvg } from "@resvg/resvg-js";
import {
  applyPaletteOps,
  colorFormats,
  colorwayDoc,
  colorwayList,
  colorwaySheetSvg,
  contrastPairs,
  contrastRatio,
  docToSvg,
  generatePalette,
  imageColors,
  keepColorwaysOps,
  logoColors,
  normalizeColor,
  paletteBriefText,
  planColorways,
  toPaletteEntries,
  PALETTE_HARMONIES,
  PALETTE_ROLES,
  type ColorwaysResponse,
  type DocT,
  type PaletteEntryT,
} from "@brusshy/core";
import { renderSvgPng } from "../raster";
import { layout, realInside } from "../paths";
import { fail, ok, text, type Content, type ToolKit } from "./kit";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const inkOn = (bg: string) => (contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0b0c0e") ? "#ffffff" : "#0b0c0e");

/** A swatch strip the agent (and the user, in the chat) can look at. */
function swatchPng(colors: PaletteEntryT[]): Content {
  const w = 132;
  const h = 150;
  const parts = colors.map((c, i) => {
    const x = 16 + i * (w + 8);
    const ink = inkOn(c.hex);
    return (
      `<rect x="${x}" y="16" width="${w}" height="${h}" rx="12" fill="${c.hex}" stroke="#0b0c0e" stroke-opacity=".1"/>` +
      `<text x="${x + 12}" y="38" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1" fill="${ink}" fill-opacity=".75">${c.role.toUpperCase()}${c.locked ? " · LOCKED" : ""}</text>` +
      `<text x="${x + 12}" y="${h - 8}" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="${ink}">${esc(c.name)}</text>` +
      `<text x="${x + 12}" y="${h + 8}" font-family="Menlo, monospace" font-size="11" fill="${ink}" fill-opacity=".75">${c.hex.toUpperCase()}</text>`
    );
  });
  const W = 32 + colors.length * (w + 8) - 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h + 32}" viewBox="0 0 ${W} ${h + 32}"><rect width="100%" height="100%" fill="#f4f5f5"/>${parts.join("")}</svg>`;
  return { type: "image", data: renderSvgPng(svg, W).toString("base64"), mimeType: "image/png" };
}

function describe(colors: PaletteEntryT[]): string {
  const lines = colors.map((c) => `- ${c.role}: ${c.hex} "${c.name}" — ${colorFormats(c.hex).oklch}${c.locked ? " (locked)" : ""}`);
  const pairs = contrastPairs(colors.map((c) => c.hex)).filter((p) => p.level !== "fail");
  const pairLines = pairs.slice(0, 6).map((p) => `  ${colors[p.a]!.name} / ${colors[p.b]!.name}: ${p.ratio.toFixed(2)}:1 (${p.level})`);
  return [...lines, "", pairs.length ? "Contrast pairs that work (WCAG):" : "No pair reaches 3:1 — add a darker ink or a lighter ground.", ...pairLines].join("\n");
}

/** RGBA pixels of a reference image (a reference layer id, a path in the Brusshy folder, or a data: URL). */
function referencePixels(doc: DocT, ref: string): Uint8Array {
  const node = doc.nodes[ref];
  let src = node?.type === "reference" ? node.src : ref;
  if (!src.startsWith("data:")) {
    const root = layout().root;
    const file = path.resolve(root, src.replace(/^\/+/, ""));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !realInside(root, file)) throw new Error(`Image not found: ${ref} (pass a reference layer id or a path like refs/photo.jpg)`);
    const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
    src = `data:image/${ext === "svg" ? "svg+xml" : ext};base64,${fs.readFileSync(file).toString("base64")}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="160" height="160"><image href="${src}" width="160" height="160" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return new Uint8Array(new Resvg(svg).render().pixels);
}

const ColorInput = z.object({
  hex: z.string().describe("Any CSS color (#rrggbb, rgb(), hsl(), a name)"),
  name: z.string().optional().describe("Display name (default: nearest simple name)"),
  role: z.enum(PALETTE_ROLES).optional().describe("primary | secondary | accent | neutral (dark ink) | background (light ground)"),
  locked: z.boolean().optional().describe("Locked colors survive regenerate"),
});

/** Brand palette: generate, save, and see the logo in every palette combination. */
export function registerPaletteTools(kit: ToolKit) {
  const { tool, state, frameFor, applyOps, daemon } = kit;

  tool(
    "generate_palette",
    `Generate a brand palette (3–6 colors) in OKLCH so steps look even: a lead color, support colors, a dark ink and a light ground. Harmonies: ${PALETTE_HARMONIES.join(", ")} ("logo" = the version's own colors, "image" = colors sampled from a reference image). Locked colors in the document's palette (or the ones you pass in keep) stay; the rest regenerate. Deterministic for a seed. Returns a swatch image + names, HEX/OKLCH and contrast pairs. Not saved unless save=true (or call set_palette).`,
    {
      harmony: z.enum(PALETTE_HARMONIES).default("analogous"),
      count: z.number().int().min(3).max(6).default(5),
      seed: z.number().int().min(1).optional().describe("Same seed = same palette (default: random)"),
      keep: z.array(z.string()).optional().describe("Colors to keep as-is (CSS colors, or names/hex of colors already in the palette)"),
      frame: z.string().optional().describe('Version for harmony "logo" (default: active frame)'),
      image: z.string().optional().describe('For harmony "image": a reference layer id or a path in the Brusshy folder (e.g. refs/moodboard.jpg)'),
      save: z.boolean().default(false).describe("Save it as the document's brand palette (one undo step)"),
    },
    async ({ harmony, count, seed, keep, frame, image, save }) => {
      const s = await state();
      const doc = s.doc;
      const sd = seed ?? 1 + Math.floor(Math.random() * 2 ** 30);
      let current: PaletteEntryT[] = (doc.palette?.colors ?? []).map((c) => ({ ...c }));
      if (keep?.length) {
        current = current.map((c) => ({ ...c, locked: false }));
        for (const k of keep) {
          const hex = normalizeColor(k);
          const hit = current.find((c) => c.hex === hex || c.name.toLowerCase() === k.trim().toLowerCase());
          if (hit) hit.locked = true;
          else if (hex) {
            const role = current.some((c) => c.role === "primary") ? "accent" : "primary";
            current.push(toPaletteEntries([{ hex, role, locked: true }])[0]!);
          } else return fail(`Not a color or palette entry: "${k}"`);
        }
      }
      let logo: { hex: string; weight: number }[] | undefined;
      let samples: { hex: string; weight: number }[] | undefined;
      if (harmony === "logo") logo = logoColors(doc, frameFor(s, frame).id);
      if (harmony === "image") {
        const ref = image ?? Object.values(doc.nodes).find((n) => n.type === "reference" && n.role === "palette")?.id ?? Object.values(doc.nodes).find((n) => n.type === "reference")?.id;
        if (!ref) return fail('Harmony "image" needs an image: pass image=<reference layer id or refs/… path>, or ask the user to drop one on the canvas.');
        try {
          samples = imageColors(referencePixels(doc, ref), { seed: sd });
        } catch (e) {
          return fail((e as Error).message);
        }
        if (!samples.length) return fail("Couldn't read any colors from that image.");
      }
      const colors = generatePalette({ harmony, count, seed: sd, current, logo, image: samples });
      if (save) {
        const r = await applyOps([{ op: "doc", set: { palette: { colors, harmony, seed: sd } } }], `Generate palette (${harmony})`);
        if (!r.ok) return fail(r.error ?? "Failed");
      }
      return ok(
        swatchPng(colors),
        text(
          `${harmony} palette, seed ${sd}${save ? " — saved as the brand palette (the user sees it in the Palette panel)" : ""}:\n${describe(colors)}\n\n` +
            (save ? "Next: make_colorways to see the logo in every combination." : "To keep it: set_palette with these colors (or call again with save=true). To iterate: same call with keep=[colors you like] and another seed."),
        ),
      );
    },
    "Mixing a palette…",
  );

  tool(
    "set_palette",
    "Save the document's brand palette (one undo step): ordered colors with a role each (primary, secondary, accent, neutral = dark ink, background = light ground). The user edits it in the Palette panel; you read it in get_document. Optionally also write it into the Brief and recolor a version with it.",
    {
      colors: z.array(ColorInput).min(1).max(12),
      brief: z.boolean().default(false).describe("Also write it into the Brief's palette field"),
      apply_to: z.string().optional().describe("Also recolor this version (id or name) with the palette, lightness-ordered, in the same undo step"),
    },
    async ({ colors: input, brief, apply_to }) => {
      const s = await state();
      let colors: PaletteEntryT[];
      try {
        colors = toPaletteEntries(input);
      } catch (e) {
        return fail((e as Error).message);
      }
      const set: Record<string, unknown> = { palette: { colors } };
      if (brief) set.brief = { palette: paletteBriefText(colors) };
      const ops: Parameters<typeof applyOps>[0] = [{ op: "doc", set }];
      let note = "";
      if (apply_to) {
        const f = frameFor(s, apply_to);
        const r = applyPaletteOps(s.doc, f.id, colors, { skip: (n) => n.aiLock });
        ops.push(...r.ops);
        note = `\nRecolored "${f.name}": ${r.mapping.map((m) => `${m.from} → ${m.to}`).join(", ") || "nothing to change"}${r.background ? `, background → ${r.background}` : ""}${r.skipped.length ? ` (skipped ${r.skipped.length} ai-locked part(s))` : ""}.`;
      }
      const r = await applyOps(ops, apply_to ? "Set palette and recolor" : "Set palette");
      if (!r.ok) return fail(r.error ?? "Failed");
      return ok(swatchPng(colors), text(`Brand palette saved${brief ? " (and written into the Brief)" : ""}:\n${describe(colors)}${note}`));
    },
    "Saving the palette…",
  );

  tool(
    "make_colorways",
    "See a version in every combination of the brand palette as one contact sheet: rows = background colors, column 0 = full color, column n = palette color n as the only ink (details sitting on the mark knock out to the background so they keep reading; fake holes painted in the ground color follow the background). Each tile shows the WCAG contrast of the main ink (⚠ under 3:1). Pass keep=[tile ids like \"A3\", \"D0\"] to turn chosen tiles into new versions side by side (one undo step) — only when the user asked for versions.",
    {
      frame: z.string().optional().describe("Version id or name (default: active frame)"),
      keep: z.array(z.string()).optional().describe("Tile ids to keep as new versions"),
    },
    async ({ frame, keep }) => {
      const s = await state();
      const f = frameFor(s, frame);
      const colors = s.doc.palette?.colors ?? [];
      if (colors.length < 2) return fail("No brand palette yet (or only one color). Call generate_palette with save=true, or set_palette, first.");
      const plan = planColorways(s.doc, f.id, colors);
      if (!plan.all.length) return fail(`"${f.name}" has nothing to recolor.`);
      const want = (keep ?? []).map((k) => k.trim().toUpperCase());
      const picks = want.map((id) => plan.all.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
      if (picks.length < want.length) {
        const missing = want.filter((id) => !plan.all.some((c) => c.id === id));
        return fail(`Unknown tile id(s): ${missing.join(", ")}. Valid: ${plan.all.map((c) => c.id).join(", ")}. Call make_colorways without keep to see the sheet.`);
      }
      const out: Content[] = [];
      let list = colorwayList(plan);
      let source = "studio";
      try {
        const r = await (await daemon()).call<ColorwaysResponse>("POST", "/api/colorways", { frame: f.id, palette: colors }, 95_000);
        out.push({ type: "image", data: r.png, mimeType: "image/png" });
        list = r.list;
      } catch {
        source = "server";
        const svg = colorwaySheetSvg(plan, (cw) => docToSvg(colorwayDoc(s.doc, f.id, cw), { background: null }), { title: `${s.doc.name} · ${f.name} — colorways` });
        out.push({ type: "image", data: renderSvgPng(svg, Number(/width="(\d+)"/.exec(svg)?.[1] ?? 1200)).toString("base64"), mimeType: "image/png" });
      }
      const lines = [`${list.length} colorways of "${f.name}":`, ...list];
      if (picks.length) {
        const r = keepColorwaysOps(s.doc, f.id, picks);
        const res = await applyOps(r.ops, `Keep colorways ${picks.map((c) => c.id).join(", ")}`);
        if (!res.ok) return fail(res.error ?? "Failed");
        lines.push("", `Kept as new versions (one undo step): ${r.frames.map((x) => `${x.name} = ${x.colorway.id} ${x.colorway.label}`).join("; ")}.`);
      } else lines.push("", "Nothing was created. To keep tiles as versions: make_colorways keep=[\"A3\", …].");
      if (source === "server") lines.push("(Rendered on the server because the studio is not open: fonts may differ.)");
      return ok(...out, text(lines.join("\n")));
    },
    "Laying out colorways…",
  );
}
