import { z } from "zod";
import {
  CLEAR_SPACE_UNITS,
  detectLockupParts,
  LOCKUP_ALIGNS,
  LOCKUP_ARRANGEMENTS,
  LOCKUP_CENTRES,
  LOCKUP_LABELS,
  LOCKUP_RANGES,
  lockupAdvice,
  lockupMetrics,
  lockupSummary,
  lockupVersionsOps,
  pathDataBounds,
  planLockup,
  subtreeIds,
  type ClearSpaceUnit,
  type DocT,
  type GlyphsResponse,
  type LockupArrangement,
  type LockupMetrics,
  type LockupParts,
  type TextNodeT,
  type TypeMetrics,
  type TypeMetricsFn,
} from "@brusshy/core";
import { fail, ok, text, type McpState, type ToolKit } from "./kit";

/**
 * Lockups for the agent: balance mark + wordmark by numbers (ratio in cap heights, gap,
 * alignment, optical centring, clear space, minimum size). Type metrics come from the
 * studio's fonts when it is open (the "H" and "x" of the real font, plus exact outlines);
 * otherwise they are estimated from the font size and the result says so.
 */
export function registerLockupTools(kit: ToolKit) {
  const { tool, state, frameFor, applyOps, daemon } = kit;

  /** Outlines scale linearly with the font size (letter-spacing included), so the key is size-free. */
  const textKey = (n: Pick<TextNodeT, "text" | "fontFamily" | "fontWeight" | "fontSize" | "letterSpacing" | "anchor">) =>
    JSON.stringify([n.text, n.fontFamily, n.fontWeight, Math.round((n.letterSpacing / n.fontSize) * 1e4), n.anchor]);
  /** Scale absolute path data (the studio's outlines only use M/L/Q/C/Z). */
  const scaleD = (d: string, k: number) => (k === 1 ? d : d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (v) => String(Math.round(Number(v) * k * 1000) / 1000)));

  /** Fetch glyph metrics for every text layer in the given subtrees (studio fonts). */
  async function glyphMetrics(s: McpState, ids: string[]): Promise<{ fn: TypeMetricsFn; exact: boolean }> {
    const texts = new Map<string, TextNodeT>();
    for (const id of ids) for (const sid of subtreeIds(s.doc, id)) {
      const n = s.doc.nodes[sid];
      if (n?.type === "text" && n.text.trim()) texts.set(textKey(n), n);
    }
    const cache = new Map<string, { capHeight: number; xHeight: number; d: string; size: number }>();
    const ratios = new Map<string, { cap: number; x: number }>();
    let exact = s.studioConnected;
    if (s.studioConnected && texts.size) {
      const c = await daemon();
      try {
        for (const [key, n] of texts) {
          const fontKey = `${n.fontFamily}|${n.fontWeight}`;
          const [outline, hx] = await Promise.all([
            c.call<GlyphsResponse>("POST", "/api/glyphs", { text: n.text, fontFamily: n.fontFamily, fontWeight: n.fontWeight, fontSize: n.fontSize, letterSpacing: n.letterSpacing, anchor: n.anchor }, 50_000),
            ratios.has(fontKey)
              ? Promise.resolve(null)
              : c.call<GlyphsResponse>("POST", "/api/glyphs", { text: "Hx", fontFamily: n.fontFamily, fontWeight: n.fontWeight, fontSize: 1000, letterSpacing: 0, anchor: "start" }, 50_000),
          ]);
          if (hx) {
            const H = hx.glyphs[0] ? pathDataBounds(hx.glyphs[0].d) : null;
            const X = hx.glyphs[1] ? pathDataBounds(hx.glyphs[1].d) : null;
            if (H && X) ratios.set(fontKey, { cap: -H.y0 / 1000, x: -X.y0 / 1000 });
          }
          const r = ratios.get(fontKey);
          if (!r) {
            exact = false;
            continue;
          }
          cache.set(key, { capHeight: r.cap, xHeight: r.x, d: outline.glyphs.map((g) => g.d).join(""), size: n.fontSize });
        }
      } catch {
        exact = false;
      }
    } else exact = false;
    const fn: TypeMetricsFn = (n): TypeMetrics | null => {
      const c = cache.get(textKey(n));
      return c ? { capHeight: c.capHeight * n.fontSize, xHeight: c.xHeight * n.fontSize, d: scaleD(c.d, n.fontSize / c.size) } : null;
    };
    return { fn, exact: exact && cache.size === texts.size };
  }

  /** AI locks: a node or any ancestor (the version included). */
  const lockedName = (doc: DocT, id: string): string | null => {
    for (let n: DocT["nodes"][string] | undefined = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.aiLock) return n.name || n.id;
    return null;
  };

  function partsFor(s: McpState, frameId: string, markIds?: string[], wordIds?: string[]): LockupParts {
    const auto = detectLockupParts(s.doc, frameId, s.selection);
    const inFrame = (ids: string[]) => {
      for (const id of ids) if (!s.doc.nodes[id]) throw new Error(`Node ${id} not found`);
      return ids;
    };
    return {
      mark: markIds?.length ? inFrame(markIds) : auto.mark,
      wordmark: wordIds?.length ? inFrame(wordIds) : auto.wordmark,
      source: markIds?.length || wordIds?.length ? "selection" : auto.source,
    };
  }

  const describeParts = (doc: DocT, p: LockupParts) => {
    const nm = (id: string) => `"${doc.nodes[id]?.name || doc.nodes[id]?.type || id}" (${id})`;
    return `mark ${p.mark.map(nm).join(" + ") || "—"} · wordmark ${p.wordmark.map(nm).join(" + ") || "—"}`;
  };

  const data = (m: LockupMetrics) => ({
    arrangement: m.arrangement,
    ratio: m.ratio,
    gapCap: m.gapCap,
    gap: m.gap,
    gapStroke: m.gapStroke,
    align: m.align,
    stackOffset: m.stackOffset,
    capHeight: m.type && Math.round(m.type.capHeight * 100) / 100,
    xHeight: m.type && Math.round(m.type.xHeight * 100) / 100,
    markBox: m.mark && Object.fromEntries(Object.entries(m.mark.box).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    bounds: m.bounds && Object.fromEntries(Object.entries(m.bounds).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    centreOffset: m.centreOffset,
    clearSpace: m.clearSpace,
    minSize: m.minSize,
    exact: m.exact,
  });

  const clearArg = (unit?: ClearSpaceUnit, amount?: number) => (unit || amount !== undefined ? { unit: unit ?? "cap", amount } : undefined);

  tool(
    "get_lockup_metrics",
    "Measure how the mark and the wordmark of a version sit together, so you can balance a lockup by numbers instead of eyeballing: arrangement, mark height in cap heights (ratio), ink gap in cap heights and mark strokes, vertical alignment offsets (optical / cap-centre / baseline), optical vs bbox centring on the artboard, clear space (in cap height, x-height or mark units) with the actual margins, and a minimum size (screen px, print mm). Exact type metrics need the studio open; otherwise they are estimated.",
    {
      frame: z.string().optional().describe("Version id or name (default: active)"),
      clear_space_unit: z.enum(CLEAR_SPACE_UNITS).optional().describe("cap (default), x (x-height) or mark (mark height)"),
      clear_space: z.number().min(0).max(10).optional().describe("Clear space in units (default 1 cap, 1 x-height or 0.25 mark)"),
      mark_ids: z.array(z.string()).optional().describe("Override: the mark's layer ids"),
      wordmark_ids: z.array(z.string()).optional().describe("Override: the wordmark's layer ids"),
    },
    async ({ frame, clear_space_unit, clear_space, mark_ids, wordmark_ids }) => {
      const s = await state();
      const f = frameFor(s, frame);
      let parts: LockupParts;
      try {
        parts = partsFor(s, f.id, mark_ids, wordmark_ids);
      } catch (e) {
        return fail((e as Error).message);
      }
      const g = await glyphMetrics(s, [...parts.mark, ...parts.wordmark]);
      const m = lockupMetrics(s.doc, f.id, { parts, typeMetrics: g.fn, clearSpace: clearArg(clear_space_unit, clear_space) });
      const advice = lockupAdvice(m);
      return ok(
        text(
          `Lockup of "${f.name}" (${f.width}×${f.height}) — ${describeParts(s.doc, m.parts)}.\n${lockupSummary(m)}` +
            (m.notes.length ? `\nNotes: ${m.notes.join(" ")}` : "") +
            (advice.length ? `\n\nOut of the usual range:\n- ${advice.join("\n- ")}\nFix with make_lockup (it keeps what you don't pass).` : "\n\nEverything is within the usual ranges.") +
            `\n\nData: ${JSON.stringify(data(m))}`,
        ),
      );
    },
    "Measuring the lockup…",
  );

  const ArrangementArg = z.enum(LOCKUP_ARRANGEMENTS);

  tool(
    "make_lockup",
    "Arrange a version's mark and wordmark as a lockup in one undo step: horizontal (mark left), mark-right, stacked (mark above, optically centred), wordmark-only or icon-only. The mark is scaled to `ratio` × cap height, placed `gap` cap heights (or mark strokes) from the wordmark's ink, aligned (optical = visual centres; cap = cap-height centre; baseline = sits on the baseline), and the lockup is optically centred on the artboard (shrunk if it would break the clear space). With as_versions, each arrangement becomes a new version next to the others (\"V3 Horizontal\", \"V3 Stacked\"…), its artboard fitted to the clear space — pass several arrangements to build a full lockup set. Parts locked for the AI keep their size and place (the other part is laid out around them).",
    {
      frame: z.string().optional().describe("Version id or name (default: active)"),
      arrangement: z.union([ArrangementArg, z.array(ArrangementArg).min(1)]).describe("One arrangement, or several (with as_versions)"),
      ratio: z.number().min(0.2).max(12).optional().describe(`Mark height ÷ cap height (default: current, kept within ${LOCKUP_RANGES.horizontal.ratio.min}–${LOCKUP_RANGES.horizontal.ratio.max} horizontal, ${LOCKUP_RANGES.stacked.ratio.min}–${LOCKUP_RANGES.stacked.ratio.max} stacked)`),
      gap: z.number().min(0).max(20).optional().describe(`Gap between the mark's and the wordmark's ink, in gap_unit (default: current, or ${LOCKUP_RANGES.horizontal.gap.default} cap horizontal / ${LOCKUP_RANGES.stacked.gap.default} cap stacked)`),
      gap_unit: z.enum(["cap", "stroke"]).optional().describe("cap = cap heights (default), stroke = the mark's stroke weight"),
      align: z.enum(LOCKUP_ALIGNS).optional().describe("Horizontal lockups: optical (default), cap (cap-height centre) or baseline"),
      center: z.enum(LOCKUP_CENTRES).optional().describe("optical (default: contrast-weighted visual centre), bbox, or none (keep the wordmark where it is)"),
      fit: z.enum(["shrink", "artboard", "none"]).optional().describe("shrink (default in place): scale down if it would break the clear space; artboard (default for versions): resize the artboard to the clear space; none"),
      clear_space_unit: z.enum(CLEAR_SPACE_UNITS).optional(),
      clear_space: z.number().min(0).max(10).optional().describe("Clear space amount in units (default 1 cap / 1 x-height / 0.25 mark)"),
      as_versions: z.boolean().optional().describe("Create new versions instead of changing this one"),
      mark_ids: z.array(z.string()).optional().describe("Override: the mark's layer ids"),
      wordmark_ids: z.array(z.string()).optional().describe("Override: the wordmark's layer ids"),
    },
    async (a) => {
      const s = await state();
      const f = frameFor(s, a.frame);
      const list: LockupArrangement[] = Array.isArray(a.arrangement) ? [...new Set(a.arrangement)] : [a.arrangement];
      let parts: LockupParts;
      try {
        parts = partsFor(s, f.id, a.mark_ids, a.wordmark_ids);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (!parts.mark.length && !parts.wordmark.length) return fail(`No mark or wordmark found in "${f.name}". Name the symbol group id="icon" and use a text layer for the name, or pass mark_ids / wordmark_ids.`);
      const markLocked = parts.mark.map((id) => lockedName(s.doc, id)).find(Boolean) ?? null;
      const typeLocked = parts.wordmark.map((id) => lockedName(s.doc, id)).find(Boolean) ?? null;
      const g = await glyphMetrics(s, [...parts.mark, ...parts.wordmark]);
      const clearSpace = clearArg(a.clear_space_unit, a.clear_space);
      const base = { ratio: a.ratio, gap: a.gap, gapUnit: a.gap_unit, align: a.align, centre: a.center, clearSpace };
      const m0 = lockupMetrics(s.doc, f.id, { parts, typeMetrics: g.fn });
      const estimateNote = m0.type?.source === "font-size" ? "\n(Type metrics estimated from the font size — open the studio for exact glyph metrics.)" : "";

      if (a.as_versions || list.length > 1) {
        const keepSize = markLocked ? ("mark" as const) : typeLocked ? ("wordmark" as const) : undefined;
        let r;
        try {
          r = lockupVersionsOps(s.doc, f.id, parts, list, { ...base, fit: a.fit ?? "artboard", keepSize }, g.fn);
        } catch (e) {
          return fail((e as Error).message);
        }
        const res = await applyOps(r.ops, `Lockups: ${list.map((x) => LOCKUP_LABELS[x]).join(", ")}`);
        if (!res.ok) return fail(res.error ?? "Failed");
        const after = (await state()).doc;
        await (await daemon()).call("POST", "/api/focus", { ids: r.frames.map((x) => x.id) });
        const lines = r.frames.map((fr) => {
          const m = lockupMetrics(after, fr.id, { typeMetrics: g.fn, clearSpace });
          const fn = after.nodes[fr.id];
          const size = fn?.type === "frame" ? `${fn.width}×${fn.height}` : "";
          return `- "${fr.name}" (${fr.id}) ${size}: ${m.ratio !== null ? `ratio ${m.ratio} × cap, ` : ""}${m.gapCap !== null ? `gap ${m.gapCap} × cap, ` : ""}clear space ${m.clearSpace ? Math.round(m.clearSpace.value * 10) / 10 : "—"}${m.minSize ? `, min ${m.minSize.px} px` : ""}`;
        });
        const lockNote = markLocked || typeLocked ? `\n(The ${markLocked ? "mark" : "wordmark"} is locked for the AI: its copies keep their size.)` : "";
        return ok(text(`Made ${r.frames.length} lockup version${r.frames.length === 1 ? "" : "s"} from "${f.name}" (one undo step), each artboard fitted to its clear space:\n${lines.join("\n")}${r.notes.length ? `\n${r.notes.join("\n")}` : ""}${lockNote}${estimateNote}\n\nCheck them with render_preview frame="<name>".`));
      }

      const arr = list[0]!;
      if (lockedName(s.doc, f.id)) return fail(`"${f.name}" is locked by the user for the AI. Use as_versions: true to build the lockup in a new version instead.`);
      if (markLocked && typeLocked) return fail(`Both the mark ("${markLocked}") and the wordmark ("${typeLocked}") are locked by the user — leave them as they are, or use as_versions: true.`);
      let plan;
      try {
        plan = planLockup(s.doc, f.id, parts, { ...base, arrangement: arr, fit: a.fit ?? "shrink", fixed: markLocked ? "mark" : typeLocked ? "wordmark" : null }, g.fn);
      } catch (e) {
        return fail((e as Error).message);
      }
      if (!plan.ops.length) {
        const m = lockupMetrics(s.doc, f.id, { parts, typeMetrics: g.fn, clearSpace });
        return ok(text(`"${f.name}" is already that lockup — nothing to change.\n${lockupSummary(m)}`));
      }
      const res = await applyOps(plan.ops, `Lockup: ${LOCKUP_LABELS[arr]}`);
      if (!res.ok) return fail(res.error ?? "Failed");
      const after = (await state()).doc;
      await (await daemon()).call("POST", "/api/focus", { ids: [...parts.mark, ...parts.wordmark].filter((id) => after.nodes[id]) });
      const m = lockupMetrics(after, f.id, { parts, typeMetrics: g.fn, clearSpace });
      const how = [
        plan.ratio !== null ? `mark = ${plan.ratio} × cap height` : null,
        plan.gap !== null ? `gap ${plan.gap} × cap` : null,
        arr === "horizontal" || arr === "mark-right" ? `${plan.align} alignment` : null,
        markLocked || typeLocked ? null : `${a.center ?? "optical"} centring`,
      ].filter(Boolean);
      return ok(
        text(
          `${LOCKUP_LABELS[arr]} lockup applied to "${f.name}" (one undo step)${how.length ? `: ${how.join(", ")}` : ""}.\n${plan.notes.length ? plan.notes.join("\n") + "\n" : ""}\n${lockupSummary(m)}${estimateNote}\n\nCheck it with render_preview; fine-tune with make_lockup (ratio / gap / align) or get_lockup_metrics.`,
        ),
      );
    },
    "Arranging the lockup…",
  );
}
