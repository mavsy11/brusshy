import { z } from "zod";
import {
  applyOps as applyDocOps,
  BOOLEAN_LABELS,
  BOOLEAN_OPS,
  booleanOps,
  constructionSummary,
  constructionTemplate,
  fillRegionOps,
  mergeConstruction,
  newId,
  primaryColor,
  setConstructionOps,
  subtractRegionOps,
  subtreeIds,
  type DocT,
  type GlyphsResponse,
  type NodeT,
  type OpT,
} from "@brusshy/core";
import { fail, ok, text, type McpState, type ToolKit } from "./kit";

/**
 * Construction grids and the shape builder for agents: booleans that keep curves exact,
 * guide circles/grids on a version, filling the regions between them, and clearing them.
 * The construction is never exported (it lives on the frame, not as layers).
 */
export function registerConstructTools(kit: ToolKit) {
  const { tool, state, frameFor, applyOps, daemon } = kit;

  const lockedOn = (doc: DocT, id: string): string | null => {
    for (let n: NodeT | undefined = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.aiLock) return n.name || n.id;
    for (const sid of subtreeIds(doc, id)) if (doc.nodes[sid]?.aiLock) return doc.nodes[sid]!.name || sid;
    return null;
  };

  /** Text outlines from the studio's fonts (texts are reported when it is closed). */
  async function textOutlines(s: McpState, ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const texts = [...new Set(ids.flatMap((id) => subtreeIds(s.doc, id)))].filter((id) => s.doc.nodes[id]?.type === "text");
    if (!texts.length || !s.studioConnected) return out;
    const c = await daemon();
    for (const id of texts) {
      const n = s.doc.nodes[id];
      if (n?.type !== "text") continue;
      const { id: _i, type: _t, name: _n, parent: _p, visible: _v, locked: _l, transform: _tr, style: _s, extrude: _e, aiLock: _a, warp: _w, effect: _ef, ...params } = n;
      try {
        const r = await c.call<GlyphsResponse>("POST", "/api/glyphs", params, 50_000);
        out[id] = r.glyphs.map((g) => g.d).join("");
      } catch {
        /* reported by the boolean as "needs its outline" */
      }
    }
    return out;
  }

  const focus = async (ids: string[]) => {
    try {
      await (await daemon()).call("POST", "/api/focus", { ids });
    } catch {
      /* cosmetic */
    }
  };

  tool(
    "boolean",
    [
      "Combine shapes with exact geometry, in one undo step: union, subtract (ids[0] minus all the others), intersect, exclude (xor), divide (split into every overlapping piece). ",
      "Curves stay true: arcs remain circular arcs, straight edges stay straight, corners stay sharp. ",
      "The result keeps ids[0]'s name, style and 3D settings and takes its place (divide: each piece keeps the style of the top-most shape covering it). Groups combine their contents; text is outlined (needs the studio open).",
    ].join(""),
    {
      ids: z.array(z.string()).min(1).describe("Layers, in order: subtract cuts ids[1..] out of ids[0]; the result is styled like ids[0]"),
      op: z.enum(BOOLEAN_OPS),
    },
    async ({ ids, op }) => {
      const s = await state();
      for (const id of ids) {
        const lock = s.doc.nodes[id] ? lockedOn(s.doc, id) : null;
        if (lock) return fail(`"${lock}" is locked by the user for the AI — leave it unchanged and work around it.`);
      }
      const plan = booleanOps(s.doc, ids, op, { textOutlines: await textOutlines(s, ids), newId: () => newId("n") });
      if (plan.error) return fail(plan.error);
      const r = await applyOps(plan.ops, BOOLEAN_LABELS[op]);
      if (!r.ok) return fail(r.error ?? "Failed");
      await focus(plan.ids);
      return ok(text(`${BOOLEAN_LABELS[op]}: ${ids.length} layer(s) → ${plan.ids.length} path(s): ${plan.ids.join(", ")} (one undo step). Check it with render_preview.`));
    },
    "Combining shapes…",
  );

  tool(
    "add_construction",
    [
      "Add construction guides to a version — thin guide lines on the canvas, never exported — to *build* a mark the professional way: every curve an arc of a few circles on one ratio, shapes = regions between intersecting circles (then fill_region). ",
      "kind: circle-grid (concentric circles on `ratio` — 1.618 golden, 2, 1.5 — with smaller circles tangent inside the outer one at N/E/S/W, plus square, centre lines, diagonals), ",
      "square-grid (`divisions` cells, `diagonals` for 45° lines), keylines (square, circle and diamond of equal visual size), radial (`sectors` rays with one petal circle each — flowers, suns, apertures; `petal_ratio` = petal radius / outer radius), ",
      "circles (explicit [{cx,cy,r,label?}]), lines ([{x1,y1,x2,y2}]), polygon (points). Artboard coordinates; templates centre on the artboard (cx/cy/size to move or scale them). ",
      "Guides are added to what's there (replace=true starts over).",
    ].join(""),
    {
      kind: z.enum(["circle-grid", "square-grid", "keylines", "radial", "circles", "lines", "polygon"]),
      ratio: z.number().min(1.01).max(10).optional(),
      levels: z.number().int().min(2).max(4).optional().describe("circle-grid: radius levels (default 3)"),
      divisions: z.number().int().min(2).max(32).optional(),
      diagonals: z.boolean().optional(),
      sectors: z.number().int().min(3).max(48).optional(),
      petals: z.boolean().optional().describe("radial: one petal circle per sector (default true)"),
      petal_ratio: z.number().min(0.05).max(1).optional(),
      cx: z.number().optional(),
      cy: z.number().optional(),
      size: z.number().positive().optional().describe("Overall size in artboard units (default ≈ 72% of the artboard)"),
      circles: z.array(z.object({ cx: z.number(), cy: z.number(), r: z.number().positive(), label: z.string().optional() })).optional(),
      lines: z.array(z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), label: z.string().optional() })).optional(),
      points: z.array(z.tuple([z.number(), z.number()])).optional(),
      replace: z.boolean().optional(),
      frame: z.string().optional().describe("Frame (version) id or name (default: active frame)"),
    },
    async (a) => {
      const s = await state();
      const f = frameFor(s, a.frame);
      if (f.aiLock) return fail(`"${f.name}" is locked by the user for the AI — use another version (duplicate_frame).`);
      const add = constructionTemplate(a.kind, f, {
        ratio: a.ratio,
        levels: a.levels,
        divisions: a.divisions,
        diagonals: a.diagonals,
        sectors: a.sectors,
        petals: a.petals,
        petalRatio: a.petal_ratio,
        cx: a.cx,
        cy: a.cy,
        size: a.size,
        circles: a.circles,
        lines: a.lines,
        points: a.points,
      });
      if (!add.guides.length) return fail("Nothing to add (pass circles / lines / points for that kind).");
      const next = mergeConstruction(a.replace ? null : f.construction, add);
      const r = await applyOps(setConstructionOps(f.id, next), `Add construction (${a.kind})`);
      if (!r.ok) return fail(r.error ?? "Failed");
      const circles = add.guides.filter((g) => g.kind === "circle").map((g) => (g.kind === "circle" ? `(${g.cx}, ${g.cy}) r ${g.r}` : ""));
      return ok(
        text(
          `Added ${add.guides.length} guide(s) to "${f.name}": ${add.title ?? a.kind}.\n${circles.length ? `Circles (centre, radius): ${circles.slice(0, 16).join("; ")}${circles.length > 16 ? "; …" : ""}\n` : ""}Now: ${constructionSummary(next)}\n\nFill the regions you want with fill_region (points inside each region), check with render_preview (construction is not in the preview or any export), then clear_construction when the mark is final — or keep it for the construction sheet (export formats ["construction"]).`,
        ),
      );
    },
    "Laying out the grid…",
  );

  tool(
    "fill_region",
    [
      "Fill closed regions formed by a version's construction guides and shapes: each point (artboard coordinates) picks the region around it (like a paint bucket on the grid), and it becomes a new path whose edges are the exact arcs/lines of the guides. ",
      "merge=true makes one path of all the regions (adjacent ones fuse), else one path per region. color defaults to the brand primary. ",
      "subtract=true instead cuts the region under each point out of the filled shape there (target = that layer, or the top-most filled one). Points on a guide line or outside everything are reported.",
    ].join(""),
    {
      points: z.array(z.tuple([z.number(), z.number()])).min(1),
      color: z.string().optional(),
      merge: z.boolean().optional().describe("One path for all regions (default true)"),
      name: z.string().optional(),
      subtract: z.boolean().optional(),
      target: z.string().optional().describe("subtract: layer to cut from"),
      frame: z.string().optional(),
    },
    async (a) => {
      const s = await state();
      const f = frameFor(s, a.frame);
      if (f.aiLock) return fail(`"${f.name}" is locked by the user for the AI — use another version (duplicate_frame).`);
      const outlines = await textOutlines(s, f.children);
      if (a.subtract) {
        let doc = s.doc;
        const notes: string[] = [];
        const allOps: OpT[] = [];
        let last: string | null = a.target ?? null;
        for (const p of a.points) {
          if (last) {
            const lock = doc.nodes[last] ? lockedOn(doc, last) : null;
            if (lock) return fail(`"${lock}" is locked by the user for the AI.`);
          }
          const plan = subtractRegionOps(doc, f.id, p, { targetId: last ?? undefined, textOutlines: outlines, newId: () => newId("n") });
          if (plan.error) {
            notes.push(`(${p.join(", ")}): ${plan.error}`);
            continue;
          }
          const tgt = plan.ops.find((o) => o.op === "remove");
          if (tgt && tgt.op === "remove" && lockedOn(doc, tgt.id)) return fail(`"${doc.nodes[tgt.id]?.name || tgt.id}" is locked by the user for the AI.`);
          doc = applyDocOps(doc, plan.ops).doc;
          allOps.push(...plan.ops);
          last = a.target ? plan.ids[0]! : null;
        }
        if (!allOps.length) return fail(notes.join("\n") || "Nothing to subtract.");
        const r = await applyOps(allOps, "Subtract region");
        if (!r.ok) return fail(r.error ?? "Failed");
        return ok(text(`Cut ${a.points.length - notes.length} region(s) out (one undo step).${notes.length ? `\n${notes.join("\n")}` : ""}`));
      }
      const plan = fillRegionOps(s.doc, f.id, a.points as [number, number][], { color: a.color ?? primaryColor(s.doc), merge: a.merge ?? true, name: a.name, textOutlines: outlines, newId: () => newId("n") });
      if (plan.error) return fail(`${plan.error}${f.construction?.guides.length ? "" : " This version has no construction yet — add_construction first."}`);
      const r = await applyOps(plan.ops, a.points.length > 1 ? `Fill ${a.points.length} regions` : "Fill region");
      if (!r.ok) return fail(r.error ?? "Failed");
      await focus(plan.ids);
      const missed = plan.missed.length ? `\nNo closed region at: ${plan.missed.map((p) => `(${p.join(", ")})`).join(" ")} — move those points off the guide lines, inside a closed region.` : "";
      return ok(text(`Filled the region(s) under ${a.points.length - plan.missed.length} point(s) → ${plan.ids.length} path(s): ${plan.ids.join(", ")} (one undo step).${missed}\nCheck with render_preview; combine pieces with boolean, recolor with apply_ops.`));
    },
    "Filling regions…",
  );

  tool(
    "clear_construction",
    "Remove a version's construction guides (one undo step). Do it when the mark is final — or keep them to export the construction sheet first.",
    { frame: z.string().optional() },
    async ({ frame }) => {
      const s = await state();
      const f = frameFor(s, frame);
      if (f.aiLock) return fail(`"${f.name}" is locked by the user for the AI.`);
      if (!f.construction?.guides.length) return ok(text(`"${f.name}" has no construction.`));
      const r = await applyOps(setConstructionOps(f.id, null), "Clear construction");
      if (!r.ok) return fail(r.error ?? "Failed");
      return ok(text(`Cleared ${f.construction.guides.length} guide(s) from "${f.name}" (undo brings them back).`));
    },
    "Clearing guides…",
  );
}
