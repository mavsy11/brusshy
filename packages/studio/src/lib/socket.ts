import type { ClientMsg, ServerMsg } from "@brusshy/core";

type Handler = (msg: ServerMsg) => void;

/**
 * The daemon's token arrives in the address fragment (/#t=…), never in the page itself. Keep it for this tab
 * (reloads included) and take it out of the address bar so it doesn't end up in bookmarks or screenshots.
 */
function readToken(): string {
  // Dev only: Vite injects the dev daemon's token as a meta tag (vite.config.ts).
  const dev = document.querySelector<HTMLMetaElement>('meta[name="brusshy-token"]')?.content;
  if (dev) return dev;
  const m = /(?:^#|&)t=([\w-]+)/.exec(location.hash);
  try {
    if (m) {
      sessionStorage.setItem("brusshy:token", m[1]!);
      history.replaceState(null, "", location.pathname + location.search);
      return m[1]!;
    }
    return sessionStorage.getItem("brusshy:token") ?? "";
  } catch {
    return m?.[1] ?? "";
  }
}

export const token = readToken();

/** Reconnecting WebSocket to the local daemon. */
class Socket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: string[] = [];
  private retry = 0;
  private checking = false;

  /**
   * If the daemon is up but keeps refusing the socket, it was restarted (e.g. after
   * an update) and this page holds an old token: reload to pick up the new one.
   */
  private async checkStaleToken() {
    if (this.checking || this.retry < 2) return;
    this.checking = true;
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      // At most one automatic reload per 20 s, so an unrelated failure can't loop.
      const last = Number(sessionStorage.getItem("brusshy:reloaded") ?? 0);
      if (res.ok && Date.now() - last > 20_000) {
        sessionStorage.setItem("brusshy:reloaded", String(Date.now()));
        location.reload();
      }
    } catch {
      /* daemon down: keep retrying */
    } finally {
      this.checking = false;
    }
  }
  connected = false;
  private statusListeners = new Set<(c: boolean) => void>();

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      this.handlers.forEach((h) => h(msg));
    };
    ws.onclose = () => {
      void this.checkStaleToken();
      this.setConnected(false);
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  private setConnected(c: boolean) {
    this.connected = c;
    this.statusListeners.forEach((f) => f(c));
  }

  onStatus(f: (c: boolean) => void) {
    this.statusListeners.add(f);
    return () => this.statusListeners.delete(f);
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(msg: ClientMsg) {
    const s = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }
}

export const socket = new Socket();

/** Authenticated fetch to the daemon's HTTP API. */
export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), "x-brusshy-token": token } });
  const j = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}
