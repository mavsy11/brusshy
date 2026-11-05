// Usage: node test/mcp-smoke.mjs <projectDir>  — spawns `brusshy mcp` and drives a few tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], cwd: process.argv[2] });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  for (const c of r.content) console.log(`[${name}]${r.isError ? " ERROR" : ""}`, c.type === "text" ? c.text.slice(0, 600) : `<${c.type} ${c.data.length}b>`);
  return r;
};
await call("get_document");
await call("set_svg", { svg: '<g id="compass"><circle id="ring" cx="512" cy="512" r="300" fill="none" stroke="#0b0c0e" stroke-width="40"/><path id="needle" d="M512 260 L560 512 L512 764 L464 512Z" fill="#c8102e"/></g>' });
await call("apply_ops", { ops: [{ op: "doc", set: { scene: { material: "gold" } } }] });
await call("render_preview", { view: "2d", width: 256, small: true });
await call("render_preview", { view: "3d" });
await call("apply_style", { style_id: "gilded" });
await call("export", { formats: ["svg", "png", "mono"], png_sizes: [256] });
await call("undo");
await call("get_annotations");
await client.close();
