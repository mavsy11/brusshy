import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.1";

declare const __BRUSSHY_BUILD__: string | undefined;
/** Build stamp: a running daemon from another build is restarted by the MCP so code never mixes. */
export const BUILD = typeof __BRUSSHY_BUILD__ === "string" ? __BRUSSHY_BUILD__ : "dev";
export const DEFAULT_PORT = 4848;

/** The project folder Brusshy works in (where the user ran it, or BRUSSHY_DIR). */
export function projectDir(): string {
  return path.resolve(process.env.BRUSSHY_DIR || process.cwd());
}

export interface Layout {
  project: string;
  root: string;
  refs: string;
  brand: string;
  exports: string;
  daemonFile: string;
}

const MARKER = ".brusshy";

/**
 * Where Brusshy keeps its files: `brusshy/` — unless the project already has a
 * `brusshy/` folder that is something else (e.g. a code repo), then `brusshy-files/`.
 */
export function dataDir(project: string): string {
  const preferred = path.join(project, "brusshy");
  if (!fs.existsSync(preferred)) return preferred;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(preferred);
  } catch {
    return path.join(project, "brusshy-files");
  }
  const ours = entries.length === 0 || entries.includes(MARKER) || entries.some((f) => f.endsWith(".brusshy.json"));
  return ours ? preferred : path.join(project, "brusshy-files");
}

export function layout(project = projectDir()): Layout {
  const root = dataDir(project);
  return {
    project,
    root,
    refs: path.join(root, "refs"),
    brand: path.join(root, "brand"),
    exports: path.join(root, "exports"),
    daemonFile: path.join(root, ".daemon.json"),
  };
}

export function ensureLayout(l: Layout) {
  for (const d of [l.root, l.refs, l.brand, l.exports]) fs.mkdirSync(d, { recursive: true });
  // Runtime files (the session token, chat history with local paths) stay out of git if someone commits brusshy/.
  const ignore = path.join(l.root, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, ".daemon.json\n.chat/\n*.tmp\n");
  const marker = path.join(l.root, MARKER);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, "This folder holds Brusshy logos, references, brand files and exports.\n");
  const readme = path.join(l.brand, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      "# Brand context\n\nDrop anything that describes your brand here: guidelines (.md), palettes, previous logos (.svg/.png), mood references.\nYour AI reads this folder (MCP tool `get_brand_context`) before designing.\n",
    );
  }
}

export interface DaemonInfo {
  port: number;
  pid: number;
  token: string;
  version: string;
  project: string;
  startedAt: number;
}

export function readDaemonInfo(l: Layout): DaemonInfo | null {
  try {
    return JSON.parse(fs.readFileSync(l.daemonFile, "utf8")) as DaemonInfo;
  } catch {
    return null;
  }
}

/** Directory of the built bundle (dist/), used to locate the studio assets. */
export function distDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "logo"
  );
}

/** `file` exists and resolves, symlinks included, to a path inside `root`. */
export function realInside(root: string, file: string): boolean {
  try {
    const r = fs.realpathSync(root);
    const f = fs.realpathSync(file);
    return f === r || f.startsWith(r + path.sep);
  } catch {
    return false;
  }
}

/** Write a file atomically (temp + rename) so a crash never leaves half a document. */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
