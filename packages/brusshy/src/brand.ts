import fs from "node:fs";
import path from "node:path";
import type { Layout } from "./paths";

export interface BrandFile {
  path: string;
  kind: "text" | "svg" | "image" | "other";
  bytes: number;
  /** Inline content for text and SVG files (truncated to keep context small). */
  content?: string;
}

const TEXT = new Set([".md", ".txt", ".json", ".css", ".yaml", ".yml"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_INLINE = 40_000;
/** Bounds on what one call reads: files are listed only (not read) past these. */
const MAX_FILES = 200;
const MAX_READ = 2 * 1024 * 1024;

/** Everything in brusshy/brand/, with text inlined so the agent can read it in one call. Symlinks are skipped (nothing outside the folder is read). */
export function readBrandContext(l: Layout): { dir: string; files: BrandFile[] } {
  const files: BrandFile[] = [];
  // The folder itself may not be a symlink either (a cloned repo could point brand/ at the home folder).
  if (fs.existsSync(l.brand) && fs.lstatSync(l.brand).isSymbolicLink()) return { dir: path.relative(l.project, l.brand), files };
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.name.startsWith(".") || f.isSymbolicLink() || files.length >= MAX_FILES) continue;
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        walk(full);
        continue;
      }
      if (!f.isFile()) continue;
      const ext = path.extname(f.name).toLowerCase();
      const rel = path.relative(l.root, full);
      const bytes = fs.statSync(full).size;
      if ((TEXT.has(ext) || ext === ".svg") && bytes <= MAX_READ) {
        const content = fs.readFileSync(full, "utf8");
        files.push({
          path: rel,
          kind: ext === ".svg" ? "svg" : "text",
          bytes,
          content: content.length > MAX_INLINE ? content.slice(0, MAX_INLINE) + "\n…(truncated)" : content,
        });
      } else {
        files.push({ path: rel, kind: IMAGE.has(ext) ? "image" : "other", bytes });
      }
    }
  };
  walk(l.brand);
  return { dir: path.relative(l.project, l.brand), files };
}
