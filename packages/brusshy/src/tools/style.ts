import { z } from "zod";
import { frameDoc, matchPaletteOps, styleBrief, styleProfile } from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/** Style series: read one version's style profile, and recolor a version to another's palette. */
export function registerStyleTools(kit: ToolKit) {
  const { tool, state, frameFor, applyOps, daemon } = kit;

  tool(
    "get_style_profile",
    "The style of one version (frame): palette with area shares, stroke weights, curve/corner character, symmetry, fonts and tracking, detail level and margins — plus a ready style brief. Use it before drawing matching pieces (icon sets, horizontal/stacked/isotype variants) so the series stays consistent.",
    { frame: z.string().optional().describe("Frame (version) id or name (default: active frame)") },
    async ({ frame }) => {
      const s = await state();
      const f = frameFor(s, frame);
      const p = styleProfile(frameDoc(s.doc, f.id), { name: f.name });
      const data = {
        palette: p.palette.map((c) => ({ hex: c.hex, share: Math.round(c.share * 1000) / 1000, roles: c.roles, name: c.name })),
        background: p.frame.background,
        strokeWidths: p.strokes.widths.map((w) => w.width),
        cornerRadius: p.curves.cornerRadius,
        curvedShare: Math.round(p.curves.curvedShare * 100) / 100,
        symmetry: { leftRight: p.symmetry.vertical, topBottom: p.symmetry.horizontal },
        type: p.type,
        bounds: p.layout.bounds && Object.fromEntries(Object.entries(p.layout.bounds).map(([k, v]) => [k, Math.round(v)])),
      };
      return ok(
        text(`${p.summary}\n\n(Text sizes use a box estimate here; outlines in the studio are exact.)\n\nData: ${JSON.stringify(data)}`),
        text(`Style brief (rules for matching pieces):\n${styleBrief(p)}`),
      );
    },
    "Reading the style…",
  );

  tool(
    "match_palette",
    "Recolor a version with another version's palette in one undo step. Colors are paired by lightness order (dark stays dark, light stays light, so contrast survives) with heavier colors preferring heavier ones; gradient stops are mapped too, and pure white/black knockouts stay when the source has nothing similar. Parts locked for the AI are left alone.",
    {
      source_frame: z.string().describe("Version whose palette to copy (id or name)"),
      target_frame: z.string().optional().describe("Version to recolor (default: active frame)"),
    },
    async ({ source_frame, target_frame }) => {
      const s = await state();
      const src = frameFor(s, source_frame);
      const tgt = frameFor(s, target_frame);
      if (src.id === tgt.id) return fail("Source and target are the same version. Pass target_frame (or make another version active).");
      const r = matchPaletteOps(s.doc, src.id, tgt.id, { skip: (n) => n.aiLock });
      if (!r.ops.length) return ok(text(`Nothing to change: "${tgt.name}" already uses "${src.name}"'s colors${r.skipped.length ? ` (skipped ${r.skipped.length} locked part(s))` : ""}.`));
      const res = await applyOps(r.ops, `Match palette from ${src.name}`);
      if (!res.ok) return fail(res.error ?? "Failed");
      await (await daemon()).call("POST", "/api/focus", { ids: [tgt.id] });
      const lines = r.mapping.map((m) => `- ${m.from.toUpperCase()} → ${m.to.toUpperCase()}${m.from === m.to ? " (kept)" : ""}`);
      if (r.background) lines.push(`- background → ${r.background}`);
      if (r.skipped.length) lines.push(`(Skipped ${r.skipped.length} part(s) locked for the AI: ${r.skipped.join(", ")})`);
      return ok(text(`Recolored "${tgt.name}" with "${src.name}"'s palette (${r.ops.length} change(s), one undo step):\n${lines.join("\n")}\n\nCheck it with render_preview frame="${tgt.name}".`));
    },
    "Matching the palette…",
  );
}
