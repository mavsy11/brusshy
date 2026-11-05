import { z } from "zod";
import {
  CRITIQUE_LABELS,
  critique,
  critiqueNote,
  critiqueText,
  frameDoc,
  spreadMarkers,
  subtreeIds,
  type CritiqueFinding,
  type GlyphOutline,
  type GlyphsResponse,
  type RenderResponse,
  type TextNodeT,
} from "@brusshy/core";
import { renderSvgPng } from "../raster";
import { ok, text, type McpState, type ToolKit } from "./kit";

/**
 * Design critique for the agent: the deterministic checks (core/critique.ts) plus a render
 * with numbered markers, then the agent adds its own judgement and pins actionable findings
 * as canvas notes the user applies one by one.
 */
export function registerCritiqueTools(kit: ToolKit) {
  const { tool, state, frameFor, daemon } = kit;

  /** Real glyph outlines for every text layer of the version (studio fonts), when the studio is open. */
  async function glyphsFor(s: McpState, frameId: string): Promise<Map<string, GlyphOutline[]>> {
    const out = new Map<string, GlyphOutline[]>();
    if (!s.studioConnected) return out;
    const c = await daemon();
    for (const id of subtreeIds(s.doc, frameId)) {
      const n = s.doc.nodes[id];
      if (n?.type !== "text" || !n.text.trim()) continue;
      const { text: t, fontFamily, fontWeight, fontSize, letterSpacing, anchor, axes, features, alternates, kerning, kerns } = n;
      try {
        const r = await c.call<GlyphsResponse>("POST", "/api/glyphs", { text: t, fontFamily, fontWeight, fontSize, letterSpacing, anchor, axes, features, alternates, kerning, kerns }, 50_000);
        if (r.glyphs?.length) out.set(id, r.glyphs);
      } catch {
        /* font not available: the text is estimated and the report says so */
      }
    }
    return out;
  }

  /** The version's render with a numbered marker on every finding, so the agent sees where each one is. */
  function markedRender(png: string, w: number, h: number, fw: number, fh: number, findings: CritiqueFinding[]): string {
    const k = w / fw;
    const r = Math.max(9, Math.round(w / 64));
    const at = spreadMarkers(findings.map((f) => [f.x * k, f.y * k]), r * 2.3);
    const marks = findings
      .map((f, i) => {
        const [x, y] = at[i];
        const box = f.box ? `<rect x="${f.box.x * k}" y="${f.box.y * k}" width="${f.box.w * k}" height="${f.box.h * k}" fill="none" stroke="#ff4d1f" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.7"/>` : "";
        return `${box}<circle cx="${x}" cy="${y}" r="${r}" fill="#ff4d1f" stroke="#ffffff" stroke-width="2"/><text x="${x}" y="${y + r * 0.38}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${r * 1.05}" font-weight="700" fill="#ffffff">${i + 1}</text>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f4f5f5"/><image width="${w}" height="${h}" href="data:image/png;base64,${png}"/>${marks}</svg>`;
    return renderSvgPng(svg, w).toString("base64");
  }

  tool(
    "critique",
    "A senior-designer review of a version: deterministic checks first — legibility at 16/24 px (hairlines, gaps and counters that close), balance (visual vs artboard centre), contrast (WCAG, hue-only neighbours), complexity (nodes, colours, tiny details), consistency (stroke weights, corner radii), alignment near-misses and wordmark spacing — each with a 0–100 score, a verdict and findings anchored to layers and points, plus a render with numbered markers. Then YOU add design judgement (concept fit with the brief, originality) and pin the actionable findings as canvas notes. Use it when the user asks for feedback, a review or a critique, or before calling a logo finished.",
    { frame: z.string().optional().describe("Frame (version) id or name (default: active frame)") },
    async ({ frame }) => {
      const s = await state();
      const f = frameFor(s, frame);
      const glyphs = await glyphsFor(s, f.id);
      const report = critique(frameDoc(s.doc, f.id), { name: f.name, textGlyphs: (n: TextNodeT) => glyphs.get(n.id) ?? null });
      if (report.empty) return ok(text(`Version "${f.name}" is empty — nothing to critique yet.`));

      const content = [];
      try {
        const width = 768;
        const r = await (await daemon()).call<RenderResponse>("POST", "/api/render", { frame: f.id, view: "2d", width, transparent: false });
        content.push({ type: "image" as const, data: markedRender(r.png, r.width, r.height, f.width, f.height, report.findings), mimeType: "image/png" });
      } catch {
        /* the text report stands on its own */
      }

      const b = s.doc.brief;
      const brief = b
        ? Object.entries(b)
            .filter(([, v]) => typeof v === "string" && v.trim())
            .map(([k, v]) => `- ${k}: ${v}`)
        : [];
      const notes = report.findings.map((x) => ({ op: "annotate", annotation: { frameId: f.id, nodeId: x.nodeId, x: Math.round(x.x), y: Math.round(x.y), note: critiqueNote(x) } }));
      const instructions = [
        "Your turn — review it as a senior brand designer, on top of the checks. The checks only measure craft; the idea is yours to judge, and it matters more.",
        "1. Look at the render (numbers = findings below). Drop any finding that is intentional or wrong for this design; keep the ones you agree with.",
        `2. Score the CONCEPT yourself, 0–100, honestly${brief.length ? " against the brief" : " (there is no brief — infer the intent from the work)"}. Calibrate: 90+ = a senior designer would sign it and people would remember it; 75 = solid and on-brief but could belong to another company; 60 = the first idea anyone would have; under 50 = clip art or a stock icon with a name next to it.`,
        "   Generic test: name the category cliché first (an animal head in a round badge, a letter in a box or an arch, a compass or a map pin for navigation, a bolt for energy, concentric rings for water, a document or a chart for finance, a leaf for eco, a speech bubble for chat). If the mark is that cliché with nothing only this brand could own, the concept is 60 at most.",
        "   Stranger test: name the render in three plain words, as someone who never heard the idea would (\"a fox sleeping\", not \"warmth and craft\"). If the words don't name the idea, it isn't reading: the concept score drops, however clever the idea is.",
        "   Then judge silhouette, memorability, curve quality and optical corrections, and how it works across uses.",
        "3. If you are designing (not only reviewing) and the concept is under 80, don't polish: go back to the idea — a twist the cliché can't have, or a different concept — and critique again. Compare with the earlier versions too: keep the strongest one, not the latest.",
        `4. Pin each actionable finding — the checks' you agree with plus your own — as a note on the canvas with ONE apply_ops call (one undo step): {op:"annotate", annotation:{frameId:"${f.id}", nodeId, x, y, note}} in artboard coordinates, note starting with "Critique · <topic>:" and ending with a concrete fix. Skip notes already pinned (get_annotations).`,
        "5. Don't change the design unless the user asked you to fix things — the user applies the notes one by one. Answer with both scores (craft from the checks, concept from you), a 2–3 sentence verdict (lead with your strongest point) and the top 3 fixes.",
      ];
      content.push(
        text(critiqueText(report)),
        text(
          [
            brief.length ? `Brief:\n${brief.join("\n")}` : "Brief: (none)",
            "",
            ...instructions,
            "",
            `Ready-made notes for the checks (edit or drop before pinning): ${JSON.stringify(notes)}`,
            "",
            `Categories: ${report.categories.map((c) => `${CRITIQUE_LABELS[c.id]} ${c.score ?? "n/a"}`).join(" · ")}`,
          ].join("\n"),
        ),
      );
      return ok(...content);
    },
    "Critiquing…",
  );
}
