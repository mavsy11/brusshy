import { spawn } from "node:child_process";
import path from "node:path";

/** Open a URL in the default browser without extra dependencies. */
export function openBrowser(url: string): Promise<void> {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
      p.on("error", () => resolve());
      p.unref();
      resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Show a folder in the OS file manager. The caller must pass an absolute path it has
 * already confirmed is safe; it goes to the launcher as a single argument (no shell).
 */
export function revealFolder(dir: string): Promise<boolean> {
  if (!path.isAbsolute(dir)) return Promise.resolve(false);
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [dir]] : process.platform === "win32" ? ["explorer.exe", [dir]] : ["xdg-open", [dir]];
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args as string[], { stdio: "ignore", detached: true, shell: false });
      p.on("error", () => resolve(false));
      p.on("spawn", () => resolve(true));
      p.unref();
    } catch {
      resolve(false);
    }
  });
}
