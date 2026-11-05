import { z } from "zod";
import {
  addEffectOps,
  apply,
  applyOps as applyLocal,
  describeWarp,
  effectLayers,
  effectsGroupOf,
  effectsGroupsAround,
  effectTexts,
  envelopeFromWarp,
  frameOf,
  identityEnvelope,
  invert,
  newId,
  prepareWarp,
  regenerateEffectsOps,
  removeEffectOps,
  warpCommitOps,
  warpConversions,
  warpFor,
  worldMatrix,
  EFFECT_KINDS,
  EFFECT_LABELS,
  EFFECT_PARAMS,
  WARP_LABELS,
  WARP_PRESETS,
  type DocT,
  type EffectParams,
  type EnvelopeT,
  type GlyphOutline,
  type GlyphsResponse,
  type NodeT,
  type OpT,
  type P,
  type WarpSpec,
  type WarpTarget,
} from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/**
 * Type Lab for the agent: envelope warps (presets + free envelope) and effect layers (outline,
 * inline, shadow, double). Same math as the studio (@brusshy/core). Texts are outlined with the
 * studio's fonts through the existing glyphs request (POST /api/glyphs), so the studio must be open
 * for text; paths, shapes and lettering groups work without it.
 */
export function registerTypeLabWarpTools(kit: ToolKit) {
  const { tool, state, applyOps, daemon } = kit;

  /** A node's glyph-request params: every text/font field it has (forward compatible with new type controls). */
  const glyphParams = (n: Extract<NodeT, { type: "text" }>) => {
    const { id: _i, type: _t, name: _n, parent: _p, visible: _v, locked: _l, transform: _tr, style: _s, extrude: _e, aiLock: _a, warp: _w, effect: _ef, ...rest } = n;
    return rest;
  };

  async function glyphsOf(doc: DocT, textIds: string[]): Promise<Record<string, GlyphOutline[]>> {
    const out: Record<string, GlyphOutline[]> = {};
    if (!textIds.length) return out;
    const c = await daemon();
    for (const id of textIds) {
      const n = doc.nodes[id];
      if (n?.type !== "text") continue;
      const r = await c.call<GlyphsResponse>("POST", "/api/glyphs", glyphParams(n), 50_000);
      out[id] = r.glyphs;
    }
    return out;
  }

  const outlinesOf = async (doc: DocT, textIds: string[]): Promise<Record<string, string>> =>
    Object.fromEntries(Object.entries(await glyphsOf(doc, textIds)).map(([id, g]) => [id, g.map((x) => x.d).join("")]));

  /** Name of an ai-locked node on, above or inside any of the ids (the daemon would refuse the edit). */
  function lockedAmong(doc: DocT, ids: string[]): string | null {
    for (const id of ids) {
      for (let n: NodeT | undefined = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : undefined) if (n.aiLock) return n.name || n.id;
      const down = (nid: string): string | null => {
        const n = doc.nodes[nid];
        if (!n) return null;
        if (n.aiLock) return n.name || n.id;
        if (n.type === "group" || n.type === "frame") for (const c of n.children) {
          const hit = down(c);
          if (hit) return hit;
        }
        return null;
      };
      const hit = down(id);
      if (hit) return hit;
    }
    return null;
  }

  function check(doc: DocT, ids: string[]): string | null {
    if (!ids.length) return "Pass the ids of the layers to change.";
    const missing = ids.filter((id) => !doc.nodes[id]);
    if (missing.length) return `Not found: ${missing.join(", ")}`;
    if (ids.some((id) => doc.nodes[id]!.type === "frame")) return "Pass layers inside a version (not the frame itself).";
    const locked = lockedAmong(doc, ids);
    if (locked) return `"${locked}" is locked by the user for the AI — leave it unchanged and work around it.`;
    return null;
  }

  /** Effects groups touched by a warp get their effect layers rebuilt in the same step. */
  async function effectFollowOps(before: DocT, ops: OpT[], members: string[]): Promise<OpT[]> {
    const after = applyLocal(before, ops).doc;
    const groups = effectsGroupsAround(after, members);
    const out: OpT[] = [];
    for (const g of groups) {
      const outlines = await outlinesOf(after, effectTexts(after, [g]));
      out.push(...regenerateEffectsOps(after, g, outlines));
    }
    return out;
  }

  /** The warp box in the version's coordinates (what the agent draws in). */
  function boxCorners(doc: DocT, t: WarpTarget): { tl: P; tr: P; br: P; bl: P } {
    const f = frameOf(doc, t.members[0]!);
    const toFrame = invert(f ? worldMatrix(doc, f.id) : [1, 0, 0, 1, 0, 0]);
    const at = (u: number, v: number): P => {
      const w = apply(t.space, t.box.x + u * t.box.w, t.box.y + v * t.box.h);
      const q = apply(toFrame, w[0], w[1]);
      return [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10];
    };
    return { tl: at(0, 0), tr: at(1, 0), br: at(1, 1), bl: at(0, 1) };
  }

  const fmtP = (p: P) => `(${p[0]}, ${p[1]})`;

  async function runWarp(ids: string[], spec: WarpSpec | ((t: WarpTarget) => WarpSpec), what: string) {
    const s = await state();
    const err = check(s.doc, ids);
    if (err) return fail(err);
    const glyphs = await glyphsOf(s.doc, warpConversions(s.doc, ids).texts);
    const t = prepareWarp(s.doc, ids, { glyphs });
    const sp = typeof spec === "function" ? spec(t) : spec;
    const ops = warpCommitOps(t, sp);
    ops.push(...(await effectFollowOps(s.doc, ops, t.members)));
    const reset = sp.preset !== "envelope" && Math.abs(sp.amount) < 1e-9;
    const r = await applyOps(ops, reset ? "Reset warp" : `Warp: ${describeWarp(sp)}`);
    if (!r.ok) return fail(r.error ?? "Failed");
    await (await daemon()).call("POST", "/api/focus", { ids: t.members });
    const c = boxCorners(s.doc, t);
    const lettered = Object.keys(t.pending).filter((id) => s.doc.nodes[id]?.type === "text");
    return ok(
      text(
        `${reset ? "Reset the warp on" : `${what} on`} ${t.members.join(", ")} (one undo step; ${t.leaves.length} shape${t.leaves.length === 1 ? "" : "s"}).` +
          (lettered.length ? ` Text ${lettered.join(", ")} became lettering groups (one path per letter, same ids).` : "") +
          `\nOriginal bounds in artboard coordinates: tl ${fmtP(c.tl)}, tr ${fmtP(c.tr)}, br ${fmtP(c.br)}, bl ${fmtP(c.bl)} — use them for warp_envelope.` +
          `\nThe warp is stored on the layers: calling warp/warp_envelope again re-applies from the original geometry (it replaces this warp); amount 0 restores the original. ` +
          `Check it with render_preview and check_small_sizes.`,
      ),
    );
  }

  tool(
    "warp",
    `Warp layers as one piece (text, lettering groups, paths, shapes, groups) with an envelope preset: ${WARP_PRESETS.map((p) => `${p} (${WARP_LABELS[p].hint.toLowerCase()})`).join("; ")}. Text is turned into lettering (one path per letter) and shapes into paths in the same undo step; curves stay smooth. The warp is re-editable: calling it again replaces the previous warp (it starts from the original geometry), amount 0 resets. Effect layers next to the shapes are rebuilt. Subtle amounts (15–40) read best on logos.`,
    {
      ids: z.array(z.string()).min(1).describe("Layers to warp together (their union is the envelope)"),
      preset: z.enum(WARP_PRESETS),
      amount: z.number().min(-100).max(100).describe("−100…100; sign flips the direction (arc: + arches up, − smiles; perspective: + right side recedes)"),
      orientation: z.enum(["horizontal", "vertical"]).default("horizontal").describe("vertical runs the warp along the height (e.g. a vertical arc)"),
    },
    async ({ ids, preset, amount, orientation }) => runWarp(ids, { preset, amount, orientation }, `Warped ${WARP_LABELS[preset].label} ${amount}${orientation === "vertical" ? " (vertical)" : ""}`),
    "Warping…",
  );

  const Pt = z.tuple([z.number(), z.number()]);
  tool(
    "warp_envelope",
    "Free envelope warp: pull the corners of the layers' bounding box anywhere and bow its edges (a Coons patch, like dragging an envelope mesh by hand). Coordinates are artboard coordinates of the version (the warp tool reports the original bounds). Give corners and/or bow (simplest) or exact edge handles. Starts from the current warp when no corners are given. Re-editable and one undo step; reset=true restores the original shapes.",
    {
      ids: z.array(z.string()).min(1),
      corners: z.object({ tl: Pt.optional(), tr: Pt.optional(), br: Pt.optional(), bl: Pt.optional() }).optional().describe("New positions of the box corners (artboard coordinates); omitted corners stay"),
      bow: z
        .object({ top: z.number().optional(), bottom: z.number().optional(), left: z.number().optional(), right: z.number().optional() })
        .optional()
        .describe("Bow each edge outward (+) or inward (−) at its middle, in % of the box height (top/bottom) or width (left/right). e.g. {top: 20} arches the top edge up by 20% of the height"),
      handles: z
        .object({ top: z.tuple([Pt, Pt]).optional(), right: z.tuple([Pt, Pt]).optional(), bottom: z.tuple([Pt, Pt]).optional(), left: z.tuple([Pt, Pt]).optional() })
        .optional()
        .describe("Exact cubic handles per edge, in artboard coordinates: top [near tl, near tr], right [near tr, near br], bottom [near bl, near br], left [near tl, near bl]"),
      reset: z.boolean().optional(),
    },
    async ({ ids, corners, bow, handles, reset }) => {
      if (reset) return runWarp(ids, { preset: "arch", amount: 0, orientation: "horizontal" }, "Reset");
      const s = await state();
      const frame = ids.length && s.doc.nodes[ids[0]!] ? frameOf(s.doc, ids[0]!) : null;
      const fromFrame = frame ? worldMatrix(s.doc, frame.id) : ([1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number]);
      return runWarp(
        ids,
        (t) => {
          // Artboard coordinates → normalised envelope coordinates of the target's box.
          const inv = invert(t.space);
          const N = (p: P): P => {
            const w = apply(fromFrame, p[0], p[1]);
            const c = apply(inv, w[0], w[1]);
            return [(c[0] - t.box.x) / t.box.w, (c[1] - t.box.y) / t.box.h];
          };
          let env: EnvelopeT =
            !corners && !handles && t.current
              ? t.current.preset === "envelope" && t.current.envelope && t.current.envelope.rows === 1
                ? structuredClone(t.current.envelope)
                : envelopeFromWarp(warpFor(t.current, t.box), t.box, 1, 1)
              : identityEnvelope(1, 1);
          const [tl, tr, bl, br] = [env.nodes[0]!, env.nodes[1]!, env.nodes[2]!, env.nodes[3]!];
          if (corners) {
            if (corners.tl) tl.p = N(corners.tl);
            if (corners.tr) tr.p = N(corners.tr);
            if (corners.br) br.p = N(corners.br);
            if (corners.bl) bl.p = N(corners.bl);
            // Straight edges between the new corners (handles at thirds).
            const third = (a: P, b: P): [P, P] => [
              [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
              [b[0] + (a[0] - b[0]) / 3, b[1] + (a[1] - b[1]) / 3],
            ];
            [tl.r, tr.l] = third(tl.p, tr.p);
            [bl.r, br.l] = third(bl.p, br.p);
            [tl.d, bl.u] = third(tl.p, bl.p);
            [tr.d, br.u] = third(tr.p, br.p);
          }
          if (bow) {
            // A cubic's midpoint moves ¾ of its handles' offset: handles move by bow / 0.75.
            const k = 1 / 0.75 / 100;
            if (bow.top) (tl.r = [tl.r[0], tl.r[1] - bow.top * k]), (tr.l = [tr.l[0], tr.l[1] - bow.top * k]);
            if (bow.bottom) (bl.r = [bl.r[0], bl.r[1] + bow.bottom * k]), (br.l = [br.l[0], br.l[1] + bow.bottom * k]);
            if (bow.left) (tl.d = [tl.d[0] - bow.left * k, tl.d[1]]), (bl.u = [bl.u[0] - bow.left * k, bl.u[1]]);
            if (bow.right) (tr.d = [tr.d[0] + bow.right * k, tr.d[1]]), (br.u = [br.u[0] + bow.right * k, br.u[1]]);
          }
          if (handles) {
            if (handles.top) [tl.r, tr.l] = [N(handles.top[0]), N(handles.top[1])];
            if (handles.bottom) [bl.r, br.l] = [N(handles.bottom[0]), N(handles.bottom[1])];
            if (handles.left) [tl.d, bl.u] = [N(handles.left[0]), N(handles.left[1])];
            if (handles.right) [tr.d, br.u] = [N(handles.right[0]), N(handles.right[1])];
          }
          env = { ...env, nodes: [tl, tr, bl, br] };
          return { preset: "envelope", amount: 0, orientation: "horizontal", envelope: env };
        },
        "Applied a free envelope",
      );
    },
    "Warping…",
  );

  tool(
    "add_effect",
    `Add (or update) a vector effect on layers: ${EFFECT_KINDS.map((k) => `${k} (${EFFECT_LABELS[k].hint.toLowerCase()})`).join("; ")}. The effect is a real path layer named "<name> ${"<effect>"}" placed next to the sources inside an effects group (created if needed, same place in the tree) — editable, exportable, 3D-ready; no SVG filters. Calling it again for the same kind updates that layer (unspecified params keep their values). Defaults are sized to the letters. remove=true deletes that effect.`,
    {
      ids: z.array(z.string()).min(1).describe("Source layers (same parent), or an effects group / one of its layers"),
      kind: z.enum(EFFECT_KINDS),
      color: z.string().optional().describe("Fill colour of the effect layer"),
      gap: z.number().min(0).optional().describe("outline/double: space between letters and line (artboard units)"),
      width: z.number().min(0).optional().describe("outline/inline/double: line thickness"),
      inset: z.number().min(0).optional().describe("inline: distance from the edge inwards"),
      angle: z.number().optional().describe("shadow: direction in degrees (0 right, 90 down; default 45)"),
      distance: z.number().min(0).optional().describe("shadow: offset (drop) or extrusion length (long)"),
      style: z.enum(["drop", "long"]).optional().describe("shadow: drop = offset copy, long = solid extrusion"),
      corners: z.enum(["round", "miter"]).optional(),
      gap2: z.number().min(0).optional().describe("double: space between the two lines"),
      width2: z.number().min(0).optional().describe("double: second line thickness"),
      remove: z.boolean().optional(),
    },
    async ({ ids, kind, remove, ...raw }) => {
      const s = await state();
      const err = check(s.doc, ids);
      if (err) return fail(err);
      const doc = s.doc;
      if (remove) {
        const g = ids.length === 1 ? effectsGroupOf(doc, ids[0]!) : null;
        const layer = g ? effectLayers(doc, g)[kind] : undefined;
        if (!layer) return fail(`No ${kind} effect on ${ids.join(", ")}.`);
        const r = await applyOps(removeEffectOps(doc, layer), `Remove ${kind}`);
        return r.ok ? ok(text(`Removed the ${kind} (${layer}).`)) : fail(r.error ?? "Failed");
      }
      const group = ids.length === 1 ? effectsGroupOf(doc, ids[0]!) : null;
      const target = group ? [group] : ids;
      const textOutlines = await outlinesOf(doc, effectTexts(doc, target));
      const f = frameOf(doc, ids[0]!);
      const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Partial<EffectParams>;
      let plan;
      try {
        plan = addEffectOps(doc, target, kind, params, { textOutlines, newId, background: f?.background ?? null });
      } catch (e) {
        return fail((e as Error).message);
      }
      const r = await applyOps(plan.ops, `${EFFECT_LABELS[kind].label} effect`);
      if (!r.ok) return fail(r.error ?? "Failed");
      await (await daemon()).call("POST", "/api/focus", { ids: [plan.layerId] });
      const used = EFFECT_PARAMS[kind].map((k) => `${k} ${plan.params[k]}`).join(", ");
      return ok(
        text(
          `${kind} layer ${plan.layerId} in effects group ${plan.groupId} (${used}). One undo step. ` +
            `Warping the group later rebuilds its effects; call add_effect again to tune it. Check with render_preview (and check_small_sizes: thin outlines vanish at 16 px).`,
        ),
      );
    },
    "Adding effect…",
  );
}
