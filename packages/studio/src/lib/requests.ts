import type { ExportParams, ExportResponse, RenderParams, RenderResponse, ServerMsg } from "@brusshy/core";
import { socket } from "./socket";

/**
 * The daemon asks the studio for things only a browser can do (WebGL renders,
 * outlined text, video…). Modules register handlers here.
 */
type RenderHandler = (p: RenderParams) => Promise<RenderResponse>;
type ExportHandler = (p: ExportParams) => Promise<ExportResponse>;

const handlers: { render2d?: RenderHandler; render3d?: RenderHandler; export?: ExportHandler } = {};

export function registerRender2D(h: RenderHandler) {
  handlers.render2d = h;
}
export function registerRender3D(h: RenderHandler) {
  handlers.render3d = h;
}
export function registerExport(h: ExportHandler) {
  handlers.export = h;
}

/** Feature modules answer their own request kinds (e.g. "glyphs" from lib/lettering). */
const extra = new Map<string, (params: never) => Promise<unknown>>();
export function registerRequest<K extends Extract<ServerMsg, { t: "request" }>["kind"]>(
  kind: K,
  h: (params: Extract<ServerMsg, { t: "request"; kind: K }>["params"]) => Promise<unknown>,
) {
  extra.set(kind, h as (params: never) => Promise<unknown>);
}

socket.on(async (msg: ServerMsg) => {
  if (msg.t !== "request") return;
  try {
    let data: unknown;
    const own = extra.get(msg.kind);
    if (own) data = await own(msg.params as never);
    else if (msg.kind === "glyphs") throw new Error("Lettering is not available in this studio");
    else if (msg.kind === "mockup") throw new Error("Mockups are not available in this studio");
    else if (msg.kind === "type") throw new Error("Type controls are not available in this studio");
    else if (msg.kind === "colorways") throw new Error("Colorways are not available in this studio");
    else if (msg.kind === "render") {
      const h = msg.params.view === "3d" ? handlers.render3d : handlers.render2d;
      if (!h) throw new Error(`No ${msg.params.view} renderer available`);
      data = await h(msg.params);
    } else {
      if (!handlers.export) throw new Error("Export is not available");
      data = await handlers.export(msg.params);
    }
    socket.send({ t: "response", id: msg.id, ok: true, data });
  } catch (e) {
    socket.send({ t: "response", id: msg.id, ok: false, error: (e as Error).message });
  }
});

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
