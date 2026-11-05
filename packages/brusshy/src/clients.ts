import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./paths";

export type McpEntry = { command: string; args: string[] };

/** Where each AI client reads a project's MCP servers. `bin`: only connected by default when that CLI is installed. */
export const CLIENTS: Record<string, { file: string; bin?: string }> = {
  claude: { file: ".mcp.json" },
  cursor: { file: ".cursor/mcp.json" },
  gemini: { file: ".gemini/settings.json", bin: "gemini" },
  antigravity: { file: ".agents/mcp_config.json", bin: "agy" },
  codex: { file: ".codex/config.toml", bin: "codex" },
  grok: { file: ".grok/config.toml", bin: "grok" },
};

function mergeJson(file: string, entry: McpEntry) {
  let j: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      j = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it or add Brusshy manually.`);
    }
  }
  j.mcpServers = { ...(j.mcpServers as Record<string, unknown>), brusshy: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(j, null, 2) + "\n");
}

function mergeToml(file: string, entry: McpEntry) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // The table's own lines go, the rest of the user's config stays.
  const rest = old.replace(/^\[mcp_servers\.brusshy\]\n(?:(?!\[).*\n?)*/m, "").trimEnd();
  const table = `[mcp_servers.brusshy]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, rest ? `${rest}\n\n${table}` : table);
}

/** Writes each client's config. A file that can't be merged is reported, not fatal: the other clients still connect. */
export function connectClients(cwd: string, entry: McpEntry, names: string[]) {
  const wrote: string[] = [];
  const failed: string[] = [];
  for (const name of names) {
    const client = CLIENTS[name];
    if (!client) {
      failed.push(`${name}: unknown client (use ${Object.keys(CLIENTS).join(", ")})`);
      continue;
    }
    const file = path.join(cwd, client.file);
    try {
      (file.endsWith(".toml") ? mergeToml : mergeJson)(file, entry);
      wrote.push(client.file);
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  return { wrote, failed };
}

/** Claude Code and Cursor have always been connected; the others only when their CLI is on this machine. */
export const defaultClients = (installed: (bin: string) => boolean) =>
  Object.entries(CLIENTS)
    .filter(([, c]) => !c.bin || installed(c.bin))
    .map(([name]) => name);
