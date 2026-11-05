import { z } from "zod";
import {
  applyOps as applyLocal,
  arrangeLettersOps,
  LAYOUT_RANGE,
  LETTER_LAYOUTS,
  letteringOps,
  letterBoxes,
  type DocT,
  type GlyphsResponse,
  type LetterLayout,
  type OpT,
  type TextNodeT,
} from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/**
 * Custom lettering for the agent. Glyph outlines come from the studio (POST /api/glyphs →
 * studio "glyphs" request): the browser already holds the exact font files the canvas draws
 * with and the hardened glyph layout, so letters land exactly where the text was. The op
 * building and layout math are shared with the studio through @brusshy/core.
 */
export function registerLetteringTools(kit: ToolKit) {
  const { tool, state, applyOps, daemon } = kit;

  const clampAmount = (layout: LetterLayout, amount: number | undefined) => {
    const r = LAYOUT_RANGE[layout];
    return Math.max(r.min, Math.min(r.max, amount ?? r.default));
  };

  async function letterOps(doc: DocT, n: TextNodeT): Promise<{ ops: OpT[]; letterIds: string[] }> {
    const c = await daemon();
    const r = await c.call<GlyphsResponse>("POST", "/api/glyphs", {
      text: n.text,
      fontFamily: n.fontFamily,
      fontWeight: n.fontWeight,
      fontSize: n.fontSize,
      letterSpacing: n.letterSpacing,
      anchor: n.anchor,
      // Type controls (variable axes, features, alternates, kerning) so letters match the text exactly.
      ...Object.fromEntries(Object.entries({ axes: n.axes, features: n.features, alternates: n.alternates, kerning: n.kerning, kerns: n.kerns }).filter(([, v]) => v != null)),
    }, 50_000);
    const { ops, letterIds } = letteringOps(doc, n.id, r.glyphs);
    return { ops, letterIds };
  }

  const describe = (doc: DocT, groupId: string) =>
    letterBoxes(doc, groupId)
      .map((l) => `${doc.nodes[l.id]?.name || "?"} (${l.id})`)
      .join(", ");

  async function run(id: string, layout: LetterLayout | undefined, amount: number | undefined, verb: string) {
    const s = await state();
    const n = s.doc.nodes[id];
    if (!n) return fail(`Node ${id} not found`);
    if (n.aiLock) return fail(`${id} is locked for the AI — ask the user before changing it.`);
    let ops: OpT[] = [];
    let doc = s.doc;
    if (n.type === "text") {
      const made = await letterOps(s.doc, n);
      ops = made.ops;
      doc = applyLocal(s.doc, ops).doc;
    } else if (n.type !== "group" || letterBoxes(s.doc, id).length < 2) {
      return fail(`${id} is a ${n.type}. Pass a text layer, or a group of letter shapes made by make_lettering.`);
    }
    const amt = layout ? clampAmount(layout, amount) : 0;
    if (layout && (layout !== "straight" || n.type === "group")) ops = [...ops, ...arrangeLettersOps(doc, id, layout, amt)];
    const label = n.type === "text" ? (layout && layout !== "straight" ? `Lettering: ${layout}` : "Make lettering") : `Arrange letters: ${layout}`;
    const r = await applyOps(ops, label);
    if (!r.ok) return fail(r.error ?? "Failed");
    await (await daemon()).call("POST", "/api/focus", { ids: [id] });
    const after = (await state()).doc;
    const how = layout && layout !== "straight" ? ` — layout ${layout} ${amt}${LAYOUT_RANGE[layout].unit}` : "";
    return ok(
      text(
        `${verb} "${after.nodes[id]?.name}" (group ${id})${how}, one undo step. Letters: ${describe(after, id)}.\n` +
          `Each letter is an editable path: reshape one with apply_ops {op:"update", id, set:{d}}, curl it with deform_path, recolor or move it individually; arrange_letters again to change the layout (it replaces the previous one). Check with render_preview.`,
      ),
    );
  }

  tool(
    "make_lettering",
    "Turn a text layer into custom lettering: one editable path per letter (named by its character) inside a group named after the word, at the exact same positions, kerning and letter-spacing. The group keeps the text's id and place. Optionally lay the letters out at once (arc for badges, wave, rise, stagger). Needs the studio open (letters are outlined with the fonts the canvas uses).",
    {
      id: z.string().describe("Text node id"),
      layout: z.enum(LETTER_LAYOUTS).optional().describe("Optional layout to apply in the same step"),
      amount: z.number().optional().describe("arc: sweep in degrees (+ arches up, − curves down, ±330 max); wave: % of letter height (±60); stagger: % of letter height (±100); rise: total climb in % of letter height (±200)"),
    },
    async ({ id, layout, amount }) => {
      const s = await state();
      if (s.doc.nodes[id]?.type !== "text") return fail(`${id} is not a text layer${s.doc.nodes[id] ? ` (it is a ${s.doc.nodes[id]!.type})` : ""}.`);
      return run(id, layout, amount, "Lettered");
    },
    "Lettering…",
  );

  tool(
    "arrange_letters",
    "Lay out the letters of a lettering group (or a text layer, which is turned into lettering first) along a layout: arc (badge/emblem — positive sweep arches up for a top line, negative curves down for a bottom line), wave, rise (climbs left→right), stagger (letters bounce up/down), straight (reset). Layouts replace each other; letters stay editable.",
    {
      group_id: z.string().describe("Lettering group id (or a text node id)"),
      layout: z.enum(LETTER_LAYOUTS),
      amount: z.number().optional().describe("arc: degrees of sweep (default 120); wave/stagger: % of letter height; rise: % of letter height over the word"),
    },
    async ({ group_id, layout, amount }) => run(group_id, layout, amount, "Arranged"),
    "Arranging letters…",
  );
}
