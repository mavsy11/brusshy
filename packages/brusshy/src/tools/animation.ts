import { z } from "zod";
import {
  Animation,
  animationOf,
  deepMerge,
  describeAnimation,
  frameDoc,
  hasAnimation,
  planAnimation,
  previewTimes,
  EASING_NAMES,
  ENTRANCE_KINDS,
  ENTRANCE_PRESETS,
  LOOP_KINDS,
  LOOP_PRESETS,
  NO_ANIMATION,
  PART_ORDERS,
  type AnimPlan,
  type AnimationT,
  type DocT,
  type RenderResponse,
} from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/** Logo animation: set a version's entrance/loop and look at it frame by frame. */

const easing = z.enum(EASING_NAMES as [string, ...string[]]);

function timeline(doc: DocT, plan: AnimPlan): string {
  const parts = plan.parts.filter((p) => p.end > p.start);
  if (!parts.length) return "";
  const rows = parts.slice(0, 24).map((p) => {
    const n = doc.nodes[p.id];
    return `- ${p.id}${n?.name ? ` "${n.name}"` : ""}: ${p.kind} ${Math.round(p.start)}→${Math.round(p.end)} ms`;
  });
  if (parts.length > 24) rows.push(`- … ${parts.length - 24} more`);
  return `Parts in order:\n${rows.join("\n")}`;
}

export function registerAnimationTools(kit: ToolKit) {
  const { tool, state, frameFor, applyOps, daemon } = kit;

  tool(
    "set_animation",
    [
      "Animate a version (frame) of the logo: an entrance (how it appears) and an optional loop (subtle idle motion). One undo step; the user previews it in the Animation panel.",
      `Entrances: ${ENTRANCE_KINDS.map((k) => `${k} (${ENTRANCE_PRESETS[k].hint.toLowerCase()})`).join(", ")}.`,
      `Loops: ${LOOP_KINDS.map((k) => `${k} (${LOOP_PRESETS[k].hint.toLowerCase()})`).join(", ")}.`,
      "Parts are the top-level layers (a lone top-level group is opened up); order them by layer/position, or pass part_ids for an explicit, meaningful order (e.g. symbol first, then each letter). Picking an entrance without timing applies its recommended timing. Pass only what you want to change; everything else is kept. Then check it with preview_animation.",
    ].join(" "),
    {
      frame: z.string().optional().describe("Frame (version) id or name (default: active frame)"),
      entrance: z.enum(ENTRANCE_KINDS).optional(),
      duration_ms: z.number().min(0).max(10000).optional().describe("Per-part entrance duration"),
      delay_ms: z.number().min(0).max(10000).optional(),
      stagger_ms: z.number().min(0).max(3000).optional().describe("Time between consecutive parts"),
      easing: easing.optional().describe(`One of ${EASING_NAMES.join(", ")} (expo = confident ease-out, back = overshoot, smooth = in-out)`),
      order: z.enum(PART_ORDERS).optional(),
      part_ids: z.array(z.string()).optional().describe("Explicit parts in order (sets order=custom). Nested ids allowed, e.g. individual letters."),
      distance: z.number().min(0).max(1).optional().describe("Travel as a fraction of the artboard (fade-up, bounce, assemble, cascade)"),
      direction: z.enum(["left", "right", "up", "down"]).optional().describe("Wipe direction"),
      loop: z.enum(LOOP_KINDS).optional(),
      loop_period_ms: z.number().min(300).max(30000).optional(),
      loop_intensity: z.number().min(0).max(1).optional().describe("0–1; keep it ≤ 0.5 so the loop is barely noticeable"),
      loop_gap_ms: z.number().min(0).max(10000).optional().describe("Pause between the entrance and the first loop cycle"),
      loop_target: z.enum(["logo", "parts"]).optional().describe("Move the whole logo, or each part with a phase offset (wave)"),
      overrides: z
        .record(
          z.string(),
          z
            .object({
              entrance: z.enum(ENTRANCE_KINDS).optional(),
              delay_ms: z.number().min(-10000).max(10000).optional().describe("Extra delay added to this part"),
              duration_ms: z.number().min(0).max(10000).optional(),
              easing: easing.optional(),
              skip: z.boolean().optional().describe("Keep this part still (visible from the start)"),
            })
            .nullable(),
        )
        .optional()
        .describe("Per-part tweaks by part id; null removes a part's override"),
      clear: z.boolean().optional().describe("Remove the animation from this version"),
    },
    async (a) => {
      const s = await state();
      const f = frameFor(s, a.frame);
      if (a.clear) {
        const r = await applyOps([{ op: "update", id: f.id, set: { animation: null }, replace: true }], `Remove animation (${f.name})`);
        return r.ok ? ok(text(`Removed the animation from "${f.name}".`)) : fail(r.error ?? "Failed");
      }
      const cur: AnimationT = f.animation ? animationOf(f.animation) : structuredClone(NO_ANIMATION);
      const entrance: Record<string, unknown> = {};
      if (a.entrance) {
        entrance.kind = a.entrance;
        const p = ENTRANCE_PRESETS[a.entrance];
        if (a.entrance !== "none" && a.entrance !== cur.entrance.kind) {
          entrance.duration = p.duration;
          entrance.easing = p.easing;
          entrance.stagger = p.stagger;
          if (p.distance !== undefined) entrance.distance = p.distance;
          if (p.order && !a.part_ids && cur.entrance.order !== "custom") entrance.order = p.order;
        }
      }
      if (a.duration_ms !== undefined) entrance.duration = a.duration_ms;
      if (a.delay_ms !== undefined) entrance.delay = a.delay_ms;
      if (a.stagger_ms !== undefined) entrance.stagger = a.stagger_ms;
      if (a.easing) entrance.easing = a.easing;
      if (a.order) entrance.order = a.order;
      if (a.part_ids) {
        const missing = a.part_ids.filter((id) => !s.doc.nodes[id]);
        if (missing.length) return fail(`Unknown part id(s): ${missing.join(", ")}. Use get_document for ids.`);
        entrance.ids = a.part_ids;
        entrance.order = "custom";
      }
      if (a.distance !== undefined) entrance.distance = a.distance;
      if (a.direction) entrance.direction = a.direction;
      const loop: Record<string, unknown> = {};
      if (a.loop) {
        loop.kind = a.loop;
        if (a.loop !== "none" && a.loop !== cur.loop.kind) {
          loop.period = LOOP_PRESETS[a.loop].period;
          loop.intensity = LOOP_PRESETS[a.loop].intensity;
        }
      }
      if (a.loop_period_ms !== undefined) loop.period = a.loop_period_ms;
      if (a.loop_intensity !== undefined) loop.intensity = a.loop_intensity;
      if (a.loop_gap_ms !== undefined) loop.gap = a.loop_gap_ms;
      if (a.loop_target) loop.target = a.loop_target;

      let next: AnimationT;
      try {
        const merged = deepMerge(cur as unknown as Record<string, unknown>, { entrance, loop });
        const overrides = { ...cur.overrides } as Record<string, unknown>;
        for (const [id, o] of Object.entries(a.overrides ?? {})) {
          if (o === null) {
            delete overrides[id];
            continue;
          }
          if (!s.doc.nodes[id]) return fail(`Unknown part id ${id}.`);
          overrides[id] = {
            ...(overrides[id] as object),
            ...(o.entrance ? { kind: o.entrance } : {}),
            ...(o.delay_ms !== undefined ? { delay: o.delay_ms } : {}),
            ...(o.duration_ms !== undefined ? { duration: o.duration_ms } : {}),
            ...(o.easing ? { easing: o.easing } : {}),
            ...(o.skip !== undefined ? { skip: o.skip } : {}),
          };
        }
        next = Animation.parse({ ...merged, overrides });
      } catch (e) {
        return fail(`Invalid animation: ${(e as Error).message}`);
      }
      const r = await applyOps([{ op: "update", id: f.id, set: { animation: next }, replace: true }], `Animation (${f.name})`);
      if (!r.ok) return fail(r.error ?? "Failed");
      const after = (await state()).doc;
      const one = frameDoc(after, f.id);
      const plan = planAnimation(one, next);
      const warn: string[] = [];
      if (plan.entranceEnd > 2200) warn.push(`The entrance takes ${(plan.entranceEnd / 1000).toFixed(1)} s — logo entrances usually feel best under 1.5 s (shorten duration or stagger).`);
      if (next.loop.kind !== "none" && next.loop.kind !== "rotate" && next.loop.intensity > 0.7) warn.push("The loop is strong; idle loops read as premium when barely noticeable (intensity ≤ 0.5).");
      return ok(
        text(
          [
            `"${f.name}": ${describeAnimation(next, plan)}.`,
            timeline(one, plan),
            warn.join("\n"),
            "Check it with preview_animation (frames across the timeline). Export with export formats anim-svg, gif or anim-video when asked.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      );
    },
    "Animating…",
  );

  tool(
    "preview_animation",
    "See a version's animation as a contact sheet: numbered frames across the entrance (from the first frame to the settled logo) and into the loop, each labelled with its time. Use it after set_animation to judge timing, order and smoothness. Needs the studio open.",
    {
      frame: z.string().optional().describe("Frame (version) id or name (default: active frame)"),
      frames: z.number().int().min(2).max(16).default(8).describe("How many moments to show"),
      times_ms: z.array(z.number().min(0).max(120000)).max(16).optional().describe("Exact moments to show instead (ms)"),
      width: z.number().int().min(96).max(512).default(220).describe("Width of each frame in px"),
    },
    async ({ frame, frames, times_ms, width }) => {
      const s = await state();
      const f = frameFor(s, frame);
      const spec = animationOf(f.animation);
      if (!hasAnimation(spec)) return fail(`"${f.name}" has no animation yet. Use set_animation first.`);
      const one = frameDoc(s.doc, f.id);
      const plan = planAnimation(one, spec);
      const times = times_ms?.length ? times_ms : previewTimes(plan, frames);
      const r = await (await daemon()).call<RenderResponse & { source: string }>("POST", "/api/render", { frame: f.id, view: "2d", width, transparent: false, animTimes: times });
      if (r.source === "server") return fail("Animation previews need the studio open in a browser. Call open_studio first.");
      return ok(
        { type: "image", data: r.png, mimeType: "image/png" },
        text(
          [
            `"${f.name}": ${describeAnimation(spec, plan)}.`,
            `Frames at ${times.map((t) => `${(t / 1000).toFixed(2)}s`).join(", ")}${plan.loop ? ` (loop starts at ${(plan.loop.start / 1000).toFixed(2)}s)` : ""}.`,
            timeline(one, plan),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    },
    "Watching the animation…",
  );
}
