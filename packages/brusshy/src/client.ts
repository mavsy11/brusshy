import { spawn } from "node:child_process";
import { BUILD, layout, readDaemonInfo, type DaemonInfo, type Layout } from "./paths";

/** HTTP client for the local daemon, used by the MCP server and CLI. */
export class DaemonClient {
  constructor(public info: DaemonInfo) {}

  get base() {
    return `http://127.0.0.1:${this.info.port}`;
  }
  /** The studio address. The token rides in the fragment, which the browser never sends anywhere. */
  get studioUrl() {
    return `http://localhost:${this.info.port}/#t=${this.info.token}`;
  }

  async call<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: { "x-brusshy-token": this.info.token, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function health(info: DaemonInfo, l: Layout): Promise<"ok" | "stale" | "down"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = (await res.json()) as { project?: string; build?: string };
    if (!res.ok || j.project !== l.project) return "down";
    // A daemon from an older build (e.g. before an update) is replaced; a newer one is fine.
    if (BUILD === "dev" || j.build === "dev" || j.build === BUILD) return "ok";
    return !j.build || Number(j.build) < Number(BUILD) ? "stale" : "ok";
  } catch {
    return "down";
  }
}

const healthy = async (info: DaemonInfo, l: Layout) => (await health(info, l)) === "ok";

/** True when .daemon.json's pid really is this folder's Brusshy daemon (a cloned repo could ship any pid). */
export async function isOurDaemon(info: DaemonInfo, l: Layout): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1200) });
    const j = (await res.json()) as { project?: string; pid?: number };
    return res.ok && j.project === l.project && j.pid === info.pid;
  } catch {
    return false;
  }
}

/** Find the project's running daemon, or start one in the background. */
export async function ensureDaemon(opts: { open?: boolean } = {}): Promise<{ client: DaemonClient; started: boolean }> {
  const l = layout();
  const existing = readDaemonInfo(l);
  if (existing) {
    const h = await health(existing, l);
    if (h === "ok") return { client: new DaemonClient(existing), started: false };
    if (h === "stale") {
      try {
        process.kill(existing.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      for (let i = 0; i < 25 && (await health(existing, l)) !== "down"; i++) await new Promise((r) => setTimeout(r, 120));
    }
  }

  const args = [...process.execArgv, process.argv[1]!, "start", "--quiet"];
  if (!opts.open) args.push("--no-open");
  // A replaced daemon comes back on the same port, so open studio tabs reconnect instead of going dead.
  if (existing?.port) args.push("--port", String(existing.port));
  const child = spawn(process.execPath, args, {
    cwd: l.project,
    detached: true,
    stdio: "ignore",
    // Hand the token over to the replacement so open studio tabs reconnect without a new link.
    env: { ...process.env, BRUSSHY_DIR: l.project, ...(existing?.token ? { BRUSSHY_TOKEN: existing.token } : {}) },
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const info = readDaemonInfo(l);
    if (info && info.pid !== existing?.pid && (await healthy(info, l))) return { client: new DaemonClient(info), started: true };
  }
  throw new Error("Could not start the Brusshy daemon (timed out). Try running `npx brusshy` in the project folder.");
}
