#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Daemon } from "./daemon";
import { findBinary } from "./chat";
import { DaemonClient, isOurDaemon } from "./client";
import { connectClients, defaultClients } from "./clients";
import { DEFAULT_PORT, layout, readDaemonInfo, VERSION } from "./paths";
import { openBrowser } from "./open";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "start";

const HELP = `
  brusshy ${VERSION} — AI logo studio

  Usage
    npx brusshy            Open the studio for this folder (starts it if needed)
    npx brusshy init       Connect your AI (Claude Code, Cursor, and Gemini, Antigravity, Codex or Grok if installed)
    npx brusshy mcp        Run the MCP server (your AI client launches this)
    npx brusshy stop       Stop the studio for this folder

  Options
    --port <n>   Port to try first (default ${DEFAULT_PORT})
    --no-open    Don't open the browser
    --client <a,b>  With init: claude, cursor, gemini, antigravity, codex, grok
`;

async function running(): Promise<DaemonClient | null> {
  const l = layout();
  const info = readDaemonInfo(l);
  if (!info) return null;
  const c = new DaemonClient(info);
  try {
    await c.call("GET", "/api/health", undefined, 1200);
    return c;
  } catch {
    return null;
  }
}

async function start() {
  const existing = await running();
  if (existing) {
    if (!flag("quiet")) console.log(`\n  Brusshy is already running → ${existing.studioUrl}\n`);
    if (!flag("no-open")) await openBrowser(existing.studioUrl);
    return;
  }
  const l = layout();
  const daemon = new Daemon({ layout: l, port: Number(opt("port") ?? process.env.BRUSSHY_PORT ?? DEFAULT_PORT), dev: flag("dev") });
  await daemon.listen();
  const url = flag("dev") ? `http://localhost:5173 (Vite) · daemon ${daemon.url}` : daemon.studioUrl;
  if (!flag("quiet")) {
    console.log(`
  ✦ Brusshy ${VERSION}
  Studio   ${url}
  Folder   ${path.relative(process.cwd(), l.root) || "."}/   (logos, refs/, brand/, exports/)

  Connect your AI once:  npx brusshy init
  Then ask it: "Design a logo for …" — it draws here while you watch.
`);
  }
  if (!flag("no-open") && !flag("dev")) await openBrowser(daemon.studioUrl);
  const stop = async () => {
    await daemon.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function stop() {
  const l = layout();
  const info = readDaemonInfo(l);
  if (!info) return console.log("Brusshy is not running here.");
  if (!(await isOurDaemon(info, l))) {
    fs.rmSync(l.daemonFile, { force: true });
    return console.log("Brusshy was not running (cleaned up a stale lock).");
  }
  try {
    process.kill(info.pid, "SIGTERM");
    console.log(`Stopped Brusshy (pid ${info.pid}).`);
  } catch {
    fs.rmSync(l.daemonFile, { force: true });
    console.log("Brusshy was not running (cleaned up a stale lock).");
  }
}

/** The command an MCP client should run: npx when installed from npm, the local build otherwise. */
function mcpCommand(): { command: string; args: string[] } {
  const self = path.resolve(process.argv[1]!);
  if (self.includes(`${path.sep}_npx${path.sep}`) || self.includes(`${path.sep}node_modules${path.sep}`)) {
    return { command: "npx", args: ["-y", "brusshy@latest", "mcp"] };
  }
  // A local build (contributors): absolute paths, fine on this machine only. Don't commit that config.
  console.warn("  Note: running from a local build, so the config points at this checkout. Don't commit it.");
  return { command: process.execPath, args: [self, "mcp"] };
}

function init() {
  const entry = mcpCommand();
  const asked = opt("client")?.split(",").map((c) => c.trim()).filter(Boolean);
  const { wrote, failed } = connectClients(process.cwd(), entry, asked ?? defaultClients((bin) => !!findBinary(bin)));
  const quoted = [entry.command, ...entry.args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  console.log(`
  ✦ Brusshy connected
  Wrote: ${wrote.join(", ") || "nothing"}${failed.map((f) => `\n  Skipped: ${f}`).join("")}

  Claude Code   restart it in this folder and approve the "brusshy" server
                (or globally: claude mcp add brusshy -- ${quoted})
  Cursor        enable "brusshy" in Settings → MCP
  Gemini        Gemini CLI or Antigravity:  npx brusshy init --client gemini,antigravity
  Codex         npx brusshy init --client codex   and trust this folder when Codex asks
                (or globally, add to ~/.codex/config.toml:
                  [mcp_servers.brusshy]
                  command = "${entry.command}"
                  args = [${entry.args.map((a) => `"${a}"`).join(", ")}])
  ChatGPT       the desktop app (Settings → MCP servers) or Codex, signed in with ChatGPT.
                ChatGPT on the web can't reach a server on your computer.
  Grok          Grok Build:  npx brusshy init --client grok
  Other clients any MCP client: ${quoted}

  Then: npx brusshy   and ask your AI to design.
  Keep chatting in your AI's own terminal, or use the chat box on the canvas: your call.
`);
}

async function main() {
  if (flag("version") || cmd === "version") return console.log(VERSION);
  if (flag("help") || argv.includes("-h")) return console.log(HELP);
  switch (cmd) {
    case "start":
      return start();
    case "mcp": {
      const { runMcp } = await import("./mcp");
      return runMcp();
    }
    case "init":
      return init();
    case "stop":
      return stop();
    case "help":
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`brusshy: ${(e as Error).message}`);
  process.exit(1);
});
