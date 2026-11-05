import { z } from "zod";
import { MOCKUP_KINDS, MOCKUPS, type MockupResponse } from "@brusshy/core";
import { fail, ok, text, type ToolKit } from "./kit";

/** render_mockup: the studio draws the scene (SVG compositions / 3D engine) and returns a PNG. */
export function registerMockupTools(kit: ToolKit) {
  const { tool, daemon, state, frameFor } = kit;
  tool(
    "render_mockup",
    `See (and show the user) the logo in context, on a real application. Kinds:\n${MOCKUPS.map((m) => `- ${m.id}: ${m.description}`).join("\n")}\nUse it to judge the logo at real sizes and on real surfaces (e.g. app-icon and browser-tab reveal weak small-size legibility). Needs the studio open. The user can export every mockup as PNG from the Mockups view or the export dialog.`,
    {
      kind: z.enum(MOCKUP_KINDS),
      frame: z.string().optional().describe("Frame (version) id or name (default: active frame)"),
      theme: z.enum(["auto", "light", "dark"]).default("auto").describe("Light or dark surroundings; auto picks what makes the logo read best"),
      width: z.number().int().min(400).max(2400).default(1200),
    },
    async ({ kind, frame, theme, width }) => {
      const f = frameFor(await state(), frame);
      const c = await daemon();
      try {
        const r = await c.call<MockupResponse>("POST", "/api/mockup", { kind, frame: f.id, theme, width }, 130_000);
        return ok({ type: "image", data: r.png, mimeType: "image/png" }, text(`${MOCKUPS.find((m) => m.id === kind)?.label} · ${f.name} · ${r.theme} · ${r.width}×${r.height}`));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
    "Placing the logo on a mockup…",
  );
}
