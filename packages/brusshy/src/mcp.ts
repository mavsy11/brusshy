import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  animationOf,
  describeAnimation,
  hasAnimation,
  deformPathData,
  docToSvg,
  duplicateFrameOps,
  shapeToPath,
  findFrame,
  frameDoc,
  frameOf,
  listFrames,
  nextFramePosition,
  nextVersionName,
  paletteLines,
  boardLines,
  briefTagLines,
  describeRepeat,
  LIGHTING,
  MATERIALS,
  STYLES,
  styleById,
  svgToOps,
  type AnnotationT,
  type DocT,
  type LogEntry,
  type NodeT,
  type OpT,
  type RenderResponse,
} from "@brusshy/core";
import { constructionSummary } from "@brusshy/core";
import { ensureDaemon, type DaemonClient } from "./client";
import { GUIDE, INSTRUCTIONS } from "./guide";
import { VERSION } from "./paths";
import { openBrowser } from "./open";

import { fail, ok, text, type Content, type McpState, type ToolKit } from "./tools/kit";
import { registerExtraTools } from "./tools";

/** What the agent should take from a reference image, by its role. */
const ROLE_HINT: Record<"reference" | "palette" | "silhouette" | "style", string> = {
  reference: "general reference: trace its structure with clean geometry, never copy it",
  palette: "take only its colors (pick 1–3 dominant ones); ignore its shapes",
  silhouette: "match its outer shape/proportions; ignore its colors and inner details",
  style: "match its rendering style (stroke weight, corners, texture, era); not its subject or layout",
};

const paintStr = (p: unknown) => (p === null ? "none" : typeof p === "string" ? p : `${(p as { type: string }).type}-gradient`);

/** Compact, readable outline of the layer tree for the agent, frame by frame. */
export function outline(doc: DocT, activeFrame?: string | null): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id] as NodeT | undefined;
    if (!n) return;
    const t = n.transform;
    if (n.type === "frame") {
      const sc = n.scene;
      lines.push(
        `${n.id === activeFrame ? "▶ " : ""}Frame ${n.id} "${n.name}" — ${n.width}×${n.height}, background ${n.background ?? "transparent"}, on canvas at (${Math.round(t.x)},${Math.round(t.y)}); 3D: ${sc.material}/${sc.lighting}, depth ${sc.depth}, bevel ${sc.bevel}${sc.bloom ? `, bloom ${sc.bloom}` : ""}${n.aiLock ? " (ai-locked: the whole version is off-limits)" : ""}${n.construction?.guides.length ? `; construction: ${constructionSummary(n.construction)}` : ""}`,
      );
      if (n.animation && hasAnimation(animationOf(n.animation))) lines.push(`  animation: ${describeAnimation(animationOf(n.animation))}`);
      if (!n.children.length) lines.push("  (empty)");
      n.children.forEach((c) => walk(c, 1));
      return;
    }
    const bits = [`${"  ".repeat(depth)}- ${n.id} [${n.type}${n.type === "shape" ? `:${n.shape}` : ""}]`];
    if (n.name) bits.push(`"${n.name}"`);
    if (n.type === "text") bits.push(`text="${n.text}" ${n.fontFamily} ${n.fontWeight} ${n.fontSize}px${typeLine(n)}`);
    if (n.type === "shape") bits.push(`${Math.round(n.width)}×${Math.round(n.height)}${n.radius ? ` r${n.radius}` : ""}`);
    if (n.type === "sketch") bits.push(`${n.strokes.length} strokes`);
    if (n.type === "reference") bits.push(`image ${n.src} ${n.width}×${n.height}, role=${n.role}`);
    if (["path", "shape", "text"].includes(n.type)) {
      bits.push(`fill=${paintStr(n.style.fill)}`);
      if (n.style.stroke && n.style.strokeWidth) bits.push(`stroke=${paintStr(n.style.stroke)}/${n.style.strokeWidth}`);
    }
    if (t.x || t.y) bits.push(`@(${Math.round(t.x)},${Math.round(t.y)})`);
    if (t.rotation) bits.push(`rot ${Math.round(t.rotation)}°`);
    if (t.scaleX !== 1 || t.scaleY !== 1) bits.push(`scale ${t.scaleX}×${t.scaleY}`);
    if (n.extrude) bits.push(`3D(depth ${n.extrude.depth}, bevel ${n.extrude.bevel}, ${n.extrude.material}, z ${n.extrude.z})`);
    if (!n.visible) bits.push("(hidden)");
    if (n.locked) bits.push("(locked)");
    if (n.aiLock) bits.push("(ai-locked)");
    if (n.type === "group" && n.repeat) bits.push(`(repeat: ${describeRepeat(n.repeat)}; source ${n.repeat.source} — edit it, then repeat ids=["${n.id}"] to rebuild)`);
    lines.push(bits.join(" "));
    if (n.type === "group") n.children.forEach((c) => walk(c, depth + 1));
  };
  doc.root.forEach((id) => walk(id, 0));
  const frames = listFrames(doc).length;
  const anyLock = Object.values(doc.nodes).some((n) => n.aiLock);
  return [
    `Document "${doc.name}" (${doc.id}) — ${frames} version${frames === 1 ? "" : "s"} (frames). Coordinates inside a frame are frame-local (0,0 = its top-left). ▶ = active frame (your default target).`,
    ...briefLines(doc),
    ...boardLines(doc),
    ...typeSystemLines(doc),
    ...paletteLines(doc),
    ...lines,
    ...(anyLock ? ["(ai-locked) = the user locked this part (and everything inside it) for you: don't change, move or delete it; edits to it are refused."] : []),
  ].join("\n");
}

const BRIEF_LABELS: [Exclude<keyof NonNullable<DocT["brief"]>, "tags">, string][] = [
  ["subject", "Subject"],
  ["use", "Where it's used"],
  ["style", "Style"],
  ["palette", "Palette"],
  ["typography", "Typography"],
  ["keep", "Must keep"],
  ["avoid", "Avoid"],
  ["notes", "Notes"],
];

/** Type controls on a text node, compactly (axes, features, alternates, kerning, tracking). */
function typeLine(n: Extract<DocT["nodes"][string], { type: "text" }>): string {
  const b: string[] = [];
  if (n.letterSpacing) b.push(`tracking ${Math.round((n.letterSpacing / n.fontSize) * 1000)}`);
  if (n.axes && Object.keys(n.axes).length) b.push(`axes ${Object.entries(n.axes).map(([k, v]) => `${k}=${v}`).join(",")}`);
  if (n.features?.length) b.push(`features ${n.features.join(",")}`);
  const alts = Object.entries(n.alternates ?? {}).filter(([, v]) => v);
  if (alts.length) b.push(`alternates ${alts.map(([i, v]) => `${i}:${v}`).join(",")}`);
  if (n.kerning) b.push(`kerning ${n.kerning}`);
  if (n.kerns?.some((k) => k)) b.push(`kerns [${n.kerns.join(",")}]`);
  return b.length ? ` (${b.join("; ")})` : "";
}

/** The brand type system (heading + body fonts), when the user or agent saved one. */
function typeSystemLines(doc: DocT): string[] {
  const t = doc.typeSystem;
  if (!t) return [];
  const role = (r: NonNullable<DocT["typeSystem"]>["heading"]) => `${r.family} ${r.weight}${r.axes ? ` axes ${JSON.stringify(r.axes)}` : ""}${r.features?.length ? ` features ${r.features.join(",")}` : ""}${r.tracking !== undefined ? ` tracking ${r.tracking}` : ""}`;
  return [`Type system — use these fonts: heading/wordmark ${role(t.heading)}${t.body ? `; body ${role(t.body)}` : ""}${t.note ? ` (${t.note})` : ""}`];
}

/** The user's structured brief, as the agent should read it (empty fields are skipped). */
export function briefLines(doc: DocT): string[] {
  const b = doc.brief;
  const filled = b ? BRIEF_LABELS.filter(([k]) => b[k]?.trim()) : [];
  const tags = briefTagLines(b?.tags);
  if (!b || (!filled.length && !tags.length)) return ["Brief: (none yet — the user can fill one in the studio's Brief panel)"];
  return ["Brief from the user — follow it:", ...filled.map(([k, l]) => `  • ${l}: ${b[k].trim().replace(/\s*\n\s*/g, " / ")}`), ...tags];
}

function annotationLine(doc: DocT, a: AnnotationT): string {
  const n = a.nodeId ? doc.nodes[a.nodeId] : undefined;
  const f = a.frameId ? doc.nodes[a.frameId] : undefined;
  const where = f ? ` in frame "${f.name}" (${f.id})` : "";
  const target = (n && n.type !== "frame" ? `on ${n.id} [${n.type}]${n.name ? ` "${n.name}"` : ""}` : "on the artboard") + where;
  return `- ${a.id} (${a.status}) ${target} at (${Math.round(a.x)},${Math.round(a.y)}): "${a.note}"${a.reply ? ` → reply: "${a.reply}"` : ""}`;
}

type State = McpState;

export async function runMcp() {
  let client: DaemonClient | null = null;
  const daemon = async (open = false) => {
    if (client) {
      try {
        await client.call("GET", "/api/health", undefined, 1500);
        return client;
      } catch {
        client = null;
      }
    }
    const r = await ensureDaemon({ open });
    client = r.client;
    return client;
  };
  const state = async () => (await daemon()).call<State>("GET", "/api/state");
  const busy = async (message: string) => {
    try {
      await (await daemon()).call("POST", "/api/agent", { state: "working", message }, 2000);
    } catch {
      /* status is cosmetic */
    }
  };
  const applyOps = async (ops: OpT[], label: string) =>
    (await daemon()).call<{ ok: boolean; created: string[]; error?: string }>("POST", "/api/ops", { ops, label, author: "agent" });

  /** Resolve the frame a tool should act on: explicit id/name, else the user's active frame. */
  const frameFor = (s: State, ref?: string) => {
    if (ref) {
      const f = findFrame(s.doc, ref);
      if (!f) throw new Error(`No frame "${ref}". Frames: ${listFrames(s.doc).map((x) => `${x.name} (${x.id})`).join(", ")}`);
      return f;
    }
    return findFrame(s.doc, s.activeFrame) ?? listFrames(s.doc)[0]!;
  };

  // Activity-log cursor: every tool result reports what the *user* changed since the agent last looked.
  let lastSeq: number | null = null;
  const userChanges = async (): Promise<string> => {
    try {
      const r = await (await daemon()).call<{ seq: number; entries: LogEntry[] }>("GET", `/api/log?since=${lastSeq ?? 0}`, undefined, 3000);
      const first = lastSeq === null;
      lastSeq = r.seq;
      if (first) return "";
      const mine = r.entries.filter((e) => e.author === "user");
      if (!mine.length) return "";
      const lines = mine.slice(-25).flatMap((e) => (e.details.length ? e.details.map((d) => `- ${e.label}: ${d}`) : [`- ${e.label}`]));
      return `\n\n⚠ The user changed the design by hand since your last action. Treat these as deliberate decisions: keep them, build on them, and don't revert or redraw those parts unless the user asks.\n${lines.join("\n")}`;
    } catch {
      return "";
    }
  };

  const server = new McpServer({ name: "brusshy", version: VERSION }, { instructions: INSTRUCTIONS });

  // Retry safety: a repeated call with the same idempotency_key returns the first result
  // instead of applying the change twice (e.g. a client retry after a network glitch).
  const replay = new Map<string, { at: number; result: { content: Content[]; isError?: boolean } }>();
  const tool: ToolKit["tool"] = (name, description, shape, run, status) => {
    const withKey = {
      ...shape,
      idempotency_key: z.string().max(200).optional().describe("Optional. Repeat a call with the same key and it won't be applied twice."),
    };
    server.registerTool(name, { description, inputSchema: withKey }, (async (args: Record<string, unknown>) => {
      const key = typeof args.idempotency_key === "string" ? `${name}:${args.idempotency_key}` : null;
      const cached = key ? replay.get(key) : undefined;
      if (cached) return { ...cached.result, content: [...cached.result.content, text("(Same idempotency_key as an earlier call — returned that result; nothing was applied again.)")] };
      const changes = name === "watch_annotations" ? "" : await userChanges();
      try {
        if (status) await busy(status);
        const r = await run(args as never);
        if (changes) r.content.push(text(changes.trim()));
        if (key && !r.isError) {
          replay.set(key, { at: Date.now(), result: r });
          for (const [k, v] of replay) if (Date.now() - v.at > 30 * 60_000) replay.delete(k);
        }
        return r;
      } catch (e) {
        return fail((e as Error).message + changes);
      }
    }) as never);
  };

  tool("open_studio", "Start Brusshy (if needed) and open the canvas in the user's browser so they can watch and annotate. Call this first.", {}, async () => {
    const c = await daemon(false);
    const s = await state();
    if (!s.studioConnected) await openBrowser(c.studioUrl);
    // The link without its token: tool results end up in the AI's transcript.
    return ok(text(`Studio: ${c.base.replace("127.0.0.1", "localhost")}${s.studioConnected ? " (already open)" : " (opened in the browser)"}\n\n${outline(s.doc, s.activeFrame)}`));
  });

  tool(
    "get_design_guide",
    "Logo design principles, workflow with the user, and style recipes (modern, luxury, 1800s, rustic, art deco, neon…). Read before designing.",
    { topic: z.enum(["all", ...Object.keys(GUIDE)]).default("all") },
    async ({ topic }) => ok(text(topic === "all" ? Object.values(GUIDE).join("\n\n") : GUIDE[topic]!)),
  );

  tool(
    "get_document",
    "Read the logo: every version (frame) with its layers (ids, types, names, colors, positions, 3D look), or one frame as JSON/SVG.",
    {
      format: z.enum(["outline", "json", "svg"]).default("outline").describe("outline = compact tree of all frames; json/svg = one frame"),
      frame: z.string().optional().describe("Frame id or name for json/svg (default: active frame)"),
    },
    async ({ format, frame }) => {
      const s = await state();
      if (format !== "outline") {
        const f = frameFor(s, frame);
        const one = frameDoc(s.doc, f.id);
        return ok(text(format === "json" ? JSON.stringify(one) : docToSvg(one, { dataIds: true, pretty: true })));
      }
      const pending = Object.values(s.doc.annotations).filter((a) => a.status === "pending").length;
      return ok(text(`${outline(s.doc, s.activeFrame)}\n\nSelection: ${s.selection.join(", ") || "none"} · Pending notes: ${pending} · Studio open: ${s.studioConnected}`));
    },
  );

  tool("get_selection", "What the user has selected on the canvas right now (ids and their SVG).", {}, async () => {
    const s = await state();
    if (!s.selection.length) return ok(text("Nothing selected."));
    const nodes = s.selection.map((id) => s.doc.nodes[id]).filter(Boolean);
    return ok(text(JSON.stringify(nodes, null, 1)));
  });

  tool(
    "set_svg",
    "Main drawing tool. Write SVG (full <svg> or fragment) in the frame's coordinates (0,0 = top-left of the artboard); it becomes editable nodes in that frame. Use replace_ids to swap existing nodes for the new drawing (it takes the place of the first one). Supports path, rect, circle, ellipse, polygon, polyline, line, text, g, linear/radial gradients.",
    {
      frame: z.string().optional().describe("Frame (version) id or name to draw in (default: the active frame)"),
      svg: z.string().describe("SVG markup. Give parts meaningful ids; they become layer names."),
      replace_ids: z.array(z.string()).optional().describe("Existing node ids to remove; the new nodes go where the first one was."),
      parent: z.string().optional().describe("Group id to insert into (default: the frame's top level)."),
      group_name: z.string().optional().describe("Wrap everything in one named group."),
      label: z.string().default("Agent drawing"),
    },
    async ({ svg, replace_ids, parent, group_name, label, frame }) => {
      const s = await state();
      let index: number | undefined;
      let par: string | null = parent ?? frameFor(s, frame).id;
      const ops: OpT[] = [];
      if (replace_ids?.length) {
        const first = s.doc.nodes[replace_ids[0]!];
        if (!first) return fail(`Node ${replace_ids[0]} not found`);
        par = parent ?? first.parent ?? frameFor(s, frame).id;
        const siblings = par ? ((s.doc.nodes[par] as { children?: string[] }).children ?? []) : s.doc.root;
        index = siblings.indexOf(first.id);
        const removed = new Set(replace_ids);
        // Index shifts left for every replaced sibling that sits before the insertion point.
        index -= siblings.slice(0, index).filter((id) => removed.has(id)).length;
        for (const id of replace_ids) ops.push({ op: "remove", id });
      }
      const imported = svgToOps(svg, { parent: par, index, groupName: group_name });
      if (!imported.ops.length) return fail("The SVG produced no drawable nodes.");
      const r = await applyOps([...ops, ...imported.ops], label);
      if (!r.ok) return fail(r.error ?? "Failed");
      await (await daemon()).call("POST", "/api/focus", { ids: imported.ids });
      const after = await state();
      return ok(text(`Added ${imported.ops.length} node(s) to frame "${frameOf(after.doc, imported.ids[0])?.name ?? "?"}". Top-level: ${imported.ids.join(", ")}\n\n${outline(after.doc, after.activeFrame)}\n\nNow check it with render_preview.`));
    },
    "Drawing…",
  );

  tool(
    "apply_ops",
    `Precise, atomic edits (all-or-nothing, one undo step). Ops:
- {op:"update", id, set:{...}} deep-merges into a node. Common keys: d (path data), transform:{x,y,rotation,scaleX,scaleY}, style:{fill,stroke,strokeWidth,opacity,fillRule,strokeLinecap,strokeLinejoin}, name, visible, locked, text/fontFamily/fontSize/fontWeight/letterSpacing/anchor (text), width/height/radius/sides/innerRatio (shape), extrude:{depth,bevel,bevelSegments,material,z} (3D; null removes).
  Paint = CSS color | null | {type:"linear"|"radial", angle, stops:[{offset,color}]}.
- {op:"add", node:{type, ...}, parent?, index?} types: path{d}, shape{shape:rect|ellipse|polygon|star,width,height,radius,sides,innerRatio}, text{text,...}, group{}. Without parent it goes into the target frame.
- {op:"remove", id} · {op:"move", id, parent:frameId|groupId, index?}
- Frame (version) settings: {op:"update", id:frameId, set:{name?, width?, height?, background?, scene:{material,lighting,depth,bevel,bloom,background,shadow,camera:{azimuth,elevation,fov}}}}
  ({op:"doc", set:{artboard|scene}} is accepted too and applies to the target frame.)
Shapes' origin is their top-left; transforms rotate around the node origin.`,
    {
      ops: z.array(z.record(z.string(), z.unknown())),
      label: z.string().default("Agent edit"),
      frame: z.string().optional().describe("Target frame for adds without a parent and for doc-level settings (default: active frame)"),
    },
    async ({ ops, label, frame }) => {
      const s = await state();
      const fid = frameFor(s, frame).id;
      const mapped = (ops as OpT[]).flatMap((o): OpT[] => {
        if (o.op === "add" && o.parent === undefined && o.node.type !== "frame") return [{ ...o, parent: fid }];
        if (o.op === "doc") {
          const out: OpT[] = [];
          const set: Record<string, unknown> = {};
          if (o.set.artboard) Object.assign(set, o.set.artboard);
          if (o.set.scene) set.scene = o.set.scene;
          if (Object.keys(set).length) out.push({ op: "update", id: fid, set });
          if (o.set.name !== undefined) out.push({ op: "doc", set: { name: o.set.name } });
          return out;
        }
        return [o];
      });
      const r = await applyOps(mapped, label);
      if (!r.ok) return fail(r.error ?? "Failed");
      const ids = (ops as { id?: string }[]).map((o) => o.id).filter(Boolean) as string[];
      if (ids.length || r.created.length) await (await daemon()).call("POST", "/api/focus", { ids: [...ids, ...r.created] });
      return ok(text(`Applied ${ops.length} op(s).${r.created.length ? ` Created: ${r.created.join(", ")}` : ""}`));
    },
    "Editing…",
  );

  tool(
    "render_preview",
    "See the logo as an image. Use it after every meaningful change. view=2d for the vector, 3d for the extruded render (needs the studio open). small=true also returns a 64px render to judge legibility at icon size.",
    {
      view: z.enum(["2d", "3d"]).default("2d"),
      width: z.number().int().min(64).max(2048).default(768),
      show_working: z.boolean().default(false).describe("Include sketch/reference layers and annotation pins"),
      small: z.boolean().default(false),
      azimuth: z.number().optional().describe("3D camera azimuth in degrees"),
      elevation: z.number().optional().describe("3D camera elevation in degrees"),
      frame: z.string().optional().describe("Frame (version) id or name (default: active frame)"),
    },
    async ({ view, width, show_working, small, azimuth, elevation, frame }) => {
      const c = await daemon();
      const target = frameFor(await state(), frame).id;
      const r = await c.call<RenderResponse & { source: string }>("POST", "/api/render", {
        frame: target,
        view,
        width,
        transparent: false,
        includeWorking: show_working,
        showAnnotations: show_working,
        azimuth,
        elevation,
      });
      const out: Content[] = [{ type: "image", data: r.png, mimeType: "image/png" }];
      if (small && view === "2d") {
        const s = await c.call<RenderResponse>("POST", "/api/render", { frame: target, view, width: 64, transparent: false });
        out.push(text("64px (favicon-size) check:"), { type: "image", data: s.png, mimeType: "image/png" });
      }
      if (r.source === "server") out.push(text("(Rendered on the server because the studio is not open: fonts may differ. Call open_studio for exact previews and 3D.)"));
      return ok(...out);
    },
    "Looking at the design…",
  );

  tool(
    "get_sketch",
    "Read the user's hand-drawn sketch layers (and reference images) in a frame: a render of the working layers plus simplified stroke data. Treat sketches as intent to clean up into vector. Each reference image has a role (reference / palette / silhouette / style) that says what to take from it.",
    { frame: z.string().optional().describe("Frame id or name (default: active frame)") },
    async ({ frame }) => {
      const c = await daemon();
      const s = await state();
      const f = frameFor(s, frame);
      const one = frameDoc(s.doc, f.id);
      const sketches = Object.values(one.nodes).filter((n) => n.type === "sketch" || n.type === "reference");
      if (!sketches.length) return ok(text(`There are no sketch or reference layers in frame "${f.name}".`));
      const r = await c.call<RenderResponse>("POST", "/api/render", { frame: f.id, view: "2d", width: 768, transparent: false, includeWorking: true });
      const data = sketches.map((n) =>
        n.type === "sketch"
          ? {
              id: n.id,
              type: "sketch",
              transform: n.transform,
              strokes: n.strokes.map((st) => {
                const step = Math.max(1, Math.floor(st.points.length / 40));
                return { size: st.size, points: st.points.filter((_, i) => i % step === 0 || i === st.points.length - 1).map((p) => [Math.round(p[0]), Math.round(p[1])]) };
              }),
            }
          : { id: n.id, type: "reference", role: n.role, use: ROLE_HINT[n.role], src: n.src, transform: n.transform, width: n.width, height: n.height, opacity: n.style.opacity },
      );
      const roles = sketches.flatMap((n) => (n.type === "reference" ? [`- ${n.id}${n.name ? ` "${n.name}"` : ""}: role ${n.role} — ${ROLE_HINT[n.role]}`] : []));
      return ok({ type: "image", data: r.png, mimeType: "image/png" }, text(JSON.stringify(data)), ...(roles.length ? [text(`Reference images and how to use them:\n${roles.join("\n")}`)] : []));
    },
    "Reading the sketch…",
  );

  tool(
    "get_annotations",
    "Notes the user pinned on parts of the logo (what to change and where).",
    { status: z.enum(["pending", "in_progress", "resolved", "dismissed", "all"]).default("pending") },
    async ({ status }) => {
      const s = await state();
      const list = Object.values(s.doc.annotations).filter((a) => status === "all" || a.status === status);
      if (!list.length) return ok(text(`No ${status === "all" ? "" : status + " "}annotations.`));
      return ok(text(list.map((a) => annotationLine(s.doc, a)).join("\n")));
    },
  );

  tool(
    "watch_annotations",
    "Wait until the user leaves a new note on the canvas or types a request in the canvas chat, then return it. Use it to stay in a feedback loop with the user.",
    { timeout_seconds: z.number().int().min(5).max(600).default(300) },
    async ({ timeout_seconds }) => {
      await busy("Waiting for your notes…");
      const c = await daemon();
      const r = await c.call<{ found: boolean }>("GET", `/api/annotations/watch?timeout=${timeout_seconds * 1000}`, undefined, (timeout_seconds + 10) * 1000);
      await c.call("POST", "/api/agent", { state: "idle" });
      if (!r.found) return ok(text(`No new notes in ${timeout_seconds}s.`));
      const s = await state();
      const notes = Object.values(s.doc.annotations).filter((a) => a.status === "pending").map((a) => annotationLine(s.doc, a));
      // A request typed in the canvas chat (no CLI to run it) also wakes the loop.
      const chat = await c.call<{ request: { id: string; prompt: string } | null }>("GET", "/api/chat/requests").catch(() => ({ request: null }));
      if (chat.request) notes.push(`Canvas chat request ${chat.request.id}:\n${chat.request.prompt}\n→ Do it, then call reply_chat with id "${chat.request.id}" and a 1–3 sentence answer.`);
      return ok(text(notes.join("\n") || "Nothing pending."));
    },
  );

  tool(
    "resolve_annotation",
    "Update a note after acting on it: status resolved (default), in_progress or dismissed, plus a short reply the user sees.",
    { id: z.string(), reply: z.string().default(""), status: z.enum(["in_progress", "resolved", "dismissed"]).default("resolved") },
    async ({ id, reply, status }) => {
      const r = await applyOps([{ op: "annotation", id, set: { status, reply } }], "Annotation");
      return r.ok ? ok(text(`Annotation ${id} → ${status}`)) : fail(r.error ?? "Failed");
    },
  );

  tool("list_presets", "3D style presets (one-click looks), materials and lighting available for apply_style / apply_ops.", {}, async () =>
    ok(
      text(
        [
          "Styles (apply_style):",
          ...STYLES.map((s) => `- ${s.id}: ${s.label} (material ${s.material}, lighting ${s.lighting})`),
          "",
          "Materials (scene.material or node extrude.material):",
          ...MATERIALS.map((m) => `- ${m.id}: ${m.description}`),
          "",
          "Lighting (scene.lighting):",
          ...LIGHTING.map((l) => `- ${l.id}: ${l.description}`),
        ].join("\n"),
      ),
    ),
  );

  tool(
    "apply_style",
    "Apply a one-click 3D look to a frame (sets its material, lighting, depth, bevel, bloom, background). Each version (frame) has its own look. Pass node_ids to give only those parts a different material.",
    { style_id: z.string(), node_ids: z.array(z.string()).optional(), frame: z.string().optional().describe("Frame id or name (default: active frame)") },
    async ({ style_id, node_ids, frame }) => {
      const st = styleById(style_id);
      if (!st) return fail(`Unknown style ${style_id}. Use list_presets.`);
      const fid = frameFor(await state(), frame).id;
      const ops: OpT[] = node_ids?.length
        ? node_ids.map((id) => ({ op: "update", id, set: { extrude: { material: st.material } } }) as OpT)
        : [{ op: "update", id: fid, set: { scene: { material: st.material, lighting: st.lighting, depth: st.depth, bevel: st.bevel, bloom: st.bloom, background: st.background } } }];
      const r = await applyOps(ops, `Style: ${st.label}`);
      return r.ok ? ok(text(`Applied ${st.label}. Check it with render_preview view=3d.`)) : fail(r.error ?? "Failed");
    },
    "Styling…",
  );

  tool("get_brand_context", "Brand material the user dropped into brusshy/brand/ (guidelines, palettes, previous logos). Text and SVG are inlined.", {}, async () => {
    const r = await (await daemon()).call<{ dir: string; files: { path: string; kind: string; bytes: number; content?: string }[] }>("GET", "/api/brand");
    const real = r.files.filter((f) => !f.path.endsWith("brand/README.md"));
    if (!real.length) return ok(text(`No brand files yet. The user can drop guidelines (.md), palettes and previous logos into ${r.dir}/.`));
    return ok(text(real.map((f) => `## ${f.path} (${f.kind}, ${f.bytes} bytes)\n${f.content ?? "(binary — ask the user to describe it or add it as a reference layer)"}`).join("\n\n")));
  });

  tool(
    "export",
    "Export the logo into brusshy/exports/. Formats: svg, png (pngSizes), mono (variants: full color on the other ground, black, white — for the logo and its symbol), icons (favicon kit), png3d (hi-res 3D render), glb (3D model), video (turntable), brandkit (PDF + brand.md: the brand rules as Markdown for agents — logo files by background, clear space, minimum size, colors, fonts, don'ts), anim-svg / gif / anim-video (the version's logo animation — see set_animation), mockups (the logo on 9 applications, PNG each), timelapse / timelapse-gif (a replay of how the version was built, step by step from its history, with a branded end card — square 1080×1080 and/or vertical 1080×1920), construction (presentation sheet: the mark on its construction grid with hatched regions and ratio labels beside the clean mark, PNG 2048 + SVG; derived from the curves when the version has no construction).",
    {
      formats: z.array(z.enum(["svg", "png", "mono", "icons", "png3d", "glb", "video", "brandkit", "anim-svg", "gif", "anim-video", "mockups", "timelapse", "timelapse-gif", "construction"])).min(1),
      brandkit_mockups: z.boolean().optional().describe("Add an \"In use\" page of mockups to the brand kit (default true)"),
      png_sizes: z.array(z.number().int().min(16).max(8192)).optional(),
      size_3d: z.number().int().min(256).max(4096).optional(),
      video_seconds: z.number().min(1).max(20).optional(),
      anim_size: z.number().int().min(256).max(2160).optional().describe("anim-video width (default 1080)"),
      gif_size: z.number().int().min(64).max(1200).optional().describe("gif width (default 480)"),
      anim_transparent: z.boolean().optional().describe("Transparent gif (1-bit) / anim-video as WebM with alpha"),
      timelapse_aspects: z.array(z.enum(["square", "vertical"])).optional().describe("timelapse formats: square 1080×1080 and/or vertical 1080×1920 (default square)"),
      timelapse_seconds: z.number().min(2).max(120).optional().describe("Length of the timelapse build part (default: auto, ~0.6 s a step up to 18 s)"),
      construction_dark: z.boolean().optional().describe("construction: also a dark-paper sheet"),
      frame: z.string().optional().describe("Frame (version) id or name to export (default: active frame)"),
    },
    async ({ formats, png_sizes, size_3d, video_seconds, anim_size, gif_size, anim_transparent, frame, brandkit_mockups, timelapse_aspects, timelapse_seconds, construction_dark }) => {
      const fid = frameFor(await state(), frame).id;
      const r = await (await daemon()).call<{ dir: string; files: { name: string; bytes: number }[]; note?: string }>(
        "POST",
        "/api/export",
        { frame: fid, formats, pngSizes: png_sizes, size3d: size_3d, video: video_seconds ? { seconds: video_seconds } : undefined, anim: { size: anim_size, gifSize: gif_size, transparent: anim_transparent }, mockups: { inBrandKit: brandkit_mockups ?? true }, timelapse: { aspects: timelapse_aspects, seconds: timelapse_seconds }, construction: { dark: construction_dark } },
        11 * 60_000,
      );
      return ok(text(`Exported to ${r.dir}:\n${r.files.map((f) => `- ${f.name} (${Math.round(f.bytes / 1024)} KB)`).join("\n")}${r.note ? `\n\n${r.note}` : ""}`));
    },
    "Exporting…",
  );

  tool("undo", "Undo the last change (the user's or yours).", {}, async () => {
    const r = await (await daemon()).call<{ ok: boolean }>("POST", "/api/undo");
    return ok(text(r.ok ? "Undone." : "Nothing to undo."));
  });
  tool("redo", "Redo the last undone change.", {}, async () => {
    const r = await (await daemon()).call<{ ok: boolean }>("POST", "/api/redo");
    return ok(text(r.ok ? "Redone." : "Nothing to redo."));
  });

  tool(
    "deform_path",
    "Bend or twist a whole shape smoothly in one step (e.g. curl a petal/leaf tip clockwise). bend = the far end curls most; twist = even rotation from the pivot. Shapes and text are converted to paths. Positive degrees = clockwise on screen.",
    {
      id: z.string().describe("Node id (path, shape or text)"),
      kind: z.enum(["bend", "twist"]).default("bend"),
      degrees: z.number().min(-360).max(360),
      pivot: z.enum(["bottom", "top", "left", "right", "center"]).default("bottom").describe("Where the shape stays anchored (e.g. a petal's base)"),
    },
    async ({ id, kind, degrees, pivot }) => {
      const s = await state();
      const n = s.doc.nodes[id];
      if (!n) return fail(`Node ${id} not found`);
      let d: string | null = null;
      if (n.type === "path") d = n.d;
      else if (n.type === "shape") d = shapeToPath(n);
      else return fail("Only paths and shapes can be deformed here (convert text to a path first, e.g. by redrawing it with set_svg).");
      const next = deformPathData(d, kind, degrees, pivot);
      const ops: OpT[] =
        n.type === "path"
          ? [{ op: "update", id, set: { d: next } }]
          : [
              { op: "remove", id },
              { op: "add", node: { id, type: "path", name: n.name, d: next, transform: n.transform, style: n.style, extrude: n.extrude, visible: n.visible }, parent: n.parent, index: (n.parent ? ((s.doc.nodes[n.parent] as { children: string[] }).children) : s.doc.root).indexOf(id) },
            ];
      const r = await applyOps(ops, `${kind === "bend" ? "Bend" : "Twist"} ${Math.round(degrees)}°`);
      if (!r.ok) return fail(r.error ?? "Failed");
      await (await daemon()).call("POST", "/api/focus", { ids: [id] });
      return ok(text(`${kind === "bend" ? "Bent" : "Twisted"} ${id} by ${degrees}° around its ${pivot}. Check it with render_preview.`));
    },
    "Bending…",
  );

  tool(
    "duplicate_frame",
    "Duplicate a whole version (frame: background, logo, 3D look) as a new version next to it — use it to explore variants without touching the original. Returns the new frame id; then edit it with frame=<new id>.",
    { frame: z.string().optional().describe("Frame id or name to copy (default: active frame)"), name: z.string().optional().describe("Name for the copy (default: next V#)") },
    async ({ frame, name }) => {
      const s = await state();
      const f = frameFor(s, frame);
      const { ops, rootId } = duplicateFrameOps(s.doc, f.id, name);
      const r = await applyOps(ops, `Duplicate ${f.name}`);
      if (!r.ok) return fail(r.error ?? "Failed");
      await (await daemon()).call("POST", "/api/frame/active", { frame: rootId });
      await (await daemon()).call("POST", "/api/focus", { ids: [rootId] });
      return ok(text(`Created version "${(await state()).doc.nodes[rootId]?.name}" (${rootId}) from "${f.name}". It is now the active frame.`));
    },
    "Duplicating…",
  );

  tool(
    "new_frame",
    "Start a blank version (frame) next to the others, e.g. for a different direction.",
    { name: z.string().optional(), width: z.number().int().min(16).max(8192).default(1024), height: z.number().int().min(16).max(8192).default(1024), background: z.string().nullable().default(null) },
    async ({ name, width, height, background }) => {
      const s = await state();
      const pos = nextFramePosition(s.doc);
      const r = await applyOps([{ op: "add", node: { type: "frame", name: name ?? nextVersionName(s.doc), width, height, background, transform: pos, style: { fill: null } }, parent: null }], "New version");
      if (!r.ok) return fail(r.error ?? "Failed");
      await (await daemon()).call("POST", "/api/frame/active", { frame: r.created[0] });
      return ok(text(`Created blank frame ${r.created[0]}. It is now the active frame.`));
    },
  );

  tool("history", "The undo timeline (yours and the user's edits) — use goto_history to jump back to an earlier state.", {}, async () => {
    const t = await (await daemon()).call<{ items: { label: string; author: string; at: number }[]; cursor: number; offset: number }>("GET", "/api/history");
    if (!t.items.length) return ok(text("No history yet."));
    return ok(
      text(
        t.items
          .map((it, i) => `${t.offset + i + 1}. ${it.author === "agent" ? "AI" : "User"} — ${it.label} (${new Date(it.at).toLocaleTimeString()})${t.offset + i + 1 > t.offset + t.cursor ? " [undone]" : ""}`)
          .join("\n") + `\n\nCurrent step: ${t.offset + t.cursor}`,
      ),
    );
  });
  tool("goto_history", "Jump to a step of the timeline (0 = before any edit). Steps after it become undone (redo-able).", { step: z.number().int().min(0) }, async ({ step }) => {
    const r = await (await daemon()).call<{ ok: boolean }>("POST", "/api/history/goto", { index: step });
    return ok(text(r.ok ? `Now at step ${step}.` : "Already there."));
  });

  tool("list_documents", "All logo documents in this project.", {}, async () => {
    const s = await state();
    return ok(text(s.docs.map((d) => `- ${d.id} "${d.name}" (${d.file})${d.id === s.doc.id ? " ← active" : ""}`).join("\n")));
  });
  tool("new_document", "Create a new logo document and make it active.", { name: z.string() }, async ({ name }) => {
    const r = await (await daemon()).call<{ id: string }>("POST", "/api/docs", { name });
    return ok(text(`Created ${r.id} "${name}" (now active).`));
  });
  tool("open_document", "Switch the active logo document.", { id: z.string() }, async ({ id }: { id: string }) => {
    await (await daemon()).call("POST", "/api/docs/open", { id });
    const st = await state();
    return ok(text(outline(st.doc, st.activeFrame)));
  });

  registerExtraTools({ tool, daemon, state, applyOps, frameFor, busy });

  // Prompts show up as slash commands in clients like Claude Code (/mcp__brusshy__design_logo).
  server.registerPrompt(
    "design_logo",
    {
      description: "Design a logo in Brusshy from a short brief",
      argsSchema: {
        brand: z.string().describe("Brand name"),
        about: z.string().optional().describe("What the brand does / who it is for"),
        style: z.string().optional().describe("Style direction, e.g. modern, 1800s, rustic, metallic"),
      },
    },
    ({ brand, about, style }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Design a logo for "${brand}"${about ? ` — ${about}` : ""}${style ? `. Style: ${style}` : ""}.
Use the Brusshy tools: open_studio, get_design_guide, get_brand_context and get_sketch first; then draw with set_svg, check every step with render_preview (2D and the 64px check), refine until it is genuinely strong, and finish with a fitting 3D look (apply_style + render_preview view=3d). Tell me briefly what you made and why.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "apply_notes",
    { description: "Apply every note pinned on the Brusshy canvas" },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Read my pending notes on the Brusshy canvas (get_annotations), apply each one, check the result with render_preview, and resolve each note with a one-line reply. Then wait for new notes with watch_annotations and keep going until I stop leaving notes.",
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "sketch_to_logo",
    { description: "Turn the sketch on the canvas into a clean vector logo", argsSchema: { style: z.string().optional() } },
    ({ style }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Turn my sketch on the Brusshy canvas into a clean, professional vector logo${style ? ` in a ${style} style` : ""}. Read it with get_sketch, keep its composition and proportions, clean the curves and symmetry, draw it with set_svg (leave the sketch layer, hide it when done), and check with render_preview.`,
          },
        },
      ],
    }),
  );

  await server.connect(new StdioServerTransport());
}
