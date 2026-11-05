// Usage: node test/draw.mjs <projectDir> <tool> '<json args>'  — call one MCP tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
const [dir, name, raw] = process.argv.slice(2);
const client = new Client({ name: "draw", version: "0" });
// BRUSSHY_DEV=1 runs the MCP straight from source (tsx), no build needed.
const dev = process.env.BRUSSHY_DEV === "1";
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
const tsx = new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url).href;
await client.connect(
  new StdioClientTransport(
    dev ? { command: process.execPath, args: ["--import", tsx, src, "mcp"], cwd: dir } : { command: process.execPath, args: [cli, "mcp"], cwd: dir },
  ),
);
const r = await client.callTool({ name, arguments: JSON.parse(raw ?? "{}") });
let i = 0;
for (const c of r.content) {
  if (c.type === "text") console.log(r.isError ? "ERROR:" : "", c.text.slice(0, Number(process.env.MAXTEXT ?? 1500)));
  else {
    const f = path.join(process.env.OUT ?? ".", `out-${name}-${i++}.png`);
    fs.writeFileSync(f, Buffer.from(c.data, "base64"));
    console.log("image ->", f);
  }
}
await client.close();
