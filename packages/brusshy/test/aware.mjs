// Keeps one MCP session open: first call, waits while a human edits in the studio, second call.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
const c = new Client({ name: "aware", version: "0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], cwd: process.argv[2] }));
const t = async (name, args = {}) => (await c.callTool({ name, arguments: args })).content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
console.log("FIRST:", (await t("get_document")).split("\n").slice(0, 3).join(" | "));
await new Promise((r) => setTimeout(r, Number(process.argv[3] ?? 20000)));
const second = await t("apply_style", { style_id: "neon-sign", frame: "V2" });
console.log("SECOND:\n" + second);
console.log("OUTLINE:\n" + (await t("get_document")).split("\n").filter((l) => l.includes("Frame")).join("\n"));
await c.close();
