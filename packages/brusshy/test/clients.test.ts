import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectClients, defaultClients } from "../src/clients";

const entry = { command: "npx", args: ["-y", "brusshy@latest", "mcp"] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-clients-"));
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

describe("connecting AI clients", () => {
  it("writes each client's own file and format", () => {
    const dir = tmp();
    const r = connectClients(dir, entry, ["claude", "cursor", "gemini", "antigravity", "codex", "grok"]);
    expect(r.failed).toEqual([]);
    for (const f of [".mcp.json", ".cursor/mcp.json", ".gemini/settings.json", ".agents/mcp_config.json"]) {
      expect(JSON.parse(read(dir, f)).mcpServers.brusshy).toEqual(entry);
    }
    for (const f of [".codex/config.toml", ".grok/config.toml"]) {
      expect(read(dir, f)).toBe('[mcp_servers.brusshy]\ncommand = "npx"\nargs = ["-y","brusshy@latest","mcp"]\n');
    }
  });

  it("keeps the rest of the user's config", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".gemini"));
    fs.writeFileSync(path.join(dir, ".gemini/settings.json"), JSON.stringify({ theme: "dark", mcpServers: { mine: { command: "x" } } }));
    fs.mkdirSync(path.join(dir, ".codex"));
    fs.writeFileSync(path.join(dir, ".codex/config.toml"), 'model = "o"\n\n[mcp_servers.brusshy]\ncommand = "old"\n\n[mcp_servers.mine]\ncommand = "x"\n');
    connectClients(dir, entry, ["gemini", "codex"]);
    const gemini = JSON.parse(read(dir, ".gemini/settings.json"));
    expect(gemini.theme).toBe("dark");
    expect(Object.keys(gemini.mcpServers)).toEqual(["mine", "brusshy"]);
    const toml = read(dir, ".codex/config.toml");
    expect(toml).toContain('model = "o"');
    expect(toml).toContain("[mcp_servers.mine]");
    expect(toml).not.toContain('"old"');
    expect(toml.match(/\[mcp_servers\.brusshy\]/g)).toHaveLength(1);
  });

  it("a broken file or unknown name doesn't stop the others", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".gemini"));
    fs.writeFileSync(path.join(dir, ".gemini/settings.json"), "{ // comment\n}");
    const r = connectClients(dir, entry, ["gemini", "nope", "claude"]);
    expect(r.wrote).toEqual([".mcp.json"]);
    expect(r.failed).toHaveLength(2);
    expect(read(dir, ".gemini/settings.json")).toContain("comment");
  });

  it("connects by default what's installed", () => {
    expect(defaultClients(() => false)).toEqual(["claude", "cursor"]);
    expect(defaultClients((b) => b === "agy")).toEqual(["claude", "cursor", "antigravity"]);
  });
});
