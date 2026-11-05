import { z } from "zod";
import { REFINE_ACTIONS, REFINE_LABELS, refineOps, subtreeIds, type DocT, type GlyphsResponse, type NodeT } from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/**
 * Deterministic refinements for the agent — the same math as the studio's quick bar
 * (@brusshy/core refine.ts), so cleanup passes cost no drawing tokens and are exact.
 */
export function registerRefineTools(kit: ToolKit) {
  const { tool, state, applyOps, daemon } = kit;

  /** Locked for the AI on, above or inside a layer. */
  function lockedAmong(doc: DocT, ids: string[]): string | null {
    for (const id of ids) {
      for (let n: NodeT | undefined = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.aiLock) return n.name || n.id;
      for (const sid of subtreeIds(doc, id)) if (doc.nodes[sid]?.aiLock) return doc.nodes[sid]!.name || sid;
    }
    return null;
  }

  tool(
    "refine",
    [
      "Refine layers with exact geometry, in one undo step (no redrawing): ",
      "simplify (fewer nodes, corners kept; amount = tolerance 0–100, default 40), ",
      "smooth (even out wobbly curves, corners kept; amount = strength 0–100, default 50), ",
      "bolder / thinner (offset the filled outline out/in by amount artboard units; stroke-only lines change stroke width; default ≈ 10% of the stroke weight), ",
      "round (round sharp corners, amount = radius; rect/polygon/star shapes just set their radius), ",
      "optical-center (move the layers so their visual centre — ink mass — sits at the centre of the version), ",
      "snap-grid (round anchors to a grid step = amount, default 8), ",
      "symmetric (mirror one half onto the other about the best vertical axis; side = which half to keep; refuses when the layers aren't nearly symmetric). ",
      "Groups refine their contents; text is converted to outlines (needs the studio open). Check the result with render_preview.",
    ].join(""),
    {
      ids: z.array(z.string()).min(1).describe("Layer ids (groups refine everything inside)"),
      action: z.enum(REFINE_ACTIONS),
      amount: z.number().min(0).max(10000).optional().describe("Tolerance/strength 0–100 (simplify, smooth), offset (bolder, thinner), radius (round), grid step (snap-grid)"),
      side: z.enum(["left", "right"]).optional().describe("symmetric: the half to keep (default left)"),
    },
    async (a) => {
      const s = await state();
      const missing = a.ids.filter((id) => !s.doc.nodes[id]);
      if (missing.length) return fail(`Not found: ${missing.join(", ")}`);
      // Moving or re-centring a group would carry its locked parts along: refuse those outright.
      if (a.action === "optical-center") {
        const locked = lockedAmong(s.doc, a.ids);
        if (locked) return fail(`"${locked}" is locked by the user for the AI — leave it unchanged and work around it.`);
      } else
        for (const id of a.ids)
          for (let n: NodeT | undefined = s.doc.nodes[id]; n; n = n.parent ? s.doc.nodes[n.parent] : undefined)
            if (n.aiLock) return fail(`"${n.name || n.id}" is locked by the user for the AI — leave it unchanged and work around it.`);

      // Text outlines from the studio's fonts (texts are skipped with a note when it is closed).
      const textOutlines: Record<string, string> = {};
      const texts = [...new Set(a.ids.flatMap((id) => subtreeIds(s.doc, id)))].filter((id) => s.doc.nodes[id]?.type === "text");
      if (texts.length && s.studioConnected) {
        const c = await daemon();
        for (const id of texts) {
          const n = s.doc.nodes[id];
          if (n?.type !== "text") continue;
          const { id: _i, type: _t, name: _n, parent: _p, visible: _v, locked: _l, transform: _tr, style: _s, extrude: _e, aiLock: _a, warp: _w, effect: _ef, ...params } = n;
          try {
            const r = await c.call<GlyphsResponse>("POST", "/api/glyphs", params, 50_000);
            textOutlines[id] = r.glyphs.map((g) => g.d).join("");
          } catch {
            /* skipped with a note below */
          }
        }
      }

      const r = refineOps(s.doc, a.ids, a.action, { amount: a.amount, side: a.side, textOutlines, skip: (n) => n.aiLock });
      const notes = r.notes.length ? `\n${r.notes.join("\n")}` : "";
      if (!r.ops.length) return ok(text(`${r.summary} — nothing changed.${notes}`));
      const res = await applyOps(r.ops, r.label);
      if (!res.ok) return fail(res.error ?? "Failed");
      try {
        await (await daemon()).call("POST", "/api/focus", { ids: r.changed });
      } catch {
        /* the highlight is cosmetic */
      }
      const amt = r.amount !== null && a.action !== "optical-center" && a.action !== "symmetric" ? ` (amount ${r.amount})` : "";
      return ok(text(`${r.summary}${amt} — ${r.changed.length} layer${r.changed.length === 1 ? "" : "s"} changed: ${r.changed.join(", ")}. One undo step ("${REFINE_LABELS[a.action].verb}").${notes}`));
    },
    "Refining…",
  );
}
