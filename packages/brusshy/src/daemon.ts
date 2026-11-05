import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  animatedSvg,
  animationOf,
  CHAT_IMAGES,
  hasAnimation,
  docToSvg,
  findFrame,
  frameDoc,
  frameOf,
  listFrames,
  type AgentStatus,
  type ClientMsg,
  type ExportParams,
  type ExportResponse,
  type RenderParams,
  type RenderResponse,
  type ServerMsg,
} from "@brusshy/core";
import { BUILD, distDir, ensureLayout, slugify, VERSION, writeFileAtomic, type DaemonInfo, type Layout } from "./paths";
import { DocStore } from "./store";
import { renderSvgPng } from "./raster";
import { readBrandContext } from "./brand";
import { ChatService } from "./chat";
import { revealFolder } from "./open";
import { timelapseFor } from "./timelapse";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".hdr": "application/octet-stream",
  ".wasm": "application/wasm",
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface DaemonOptions {
  layout: Layout;
  port: number;
  /** Dev mode: the studio is served by Vite, which proxies /api and /ws here. */
  dev?: boolean;
}

function takeToken(): string {
  const t = process.env.BRUSSHY_TOKEN;
  delete process.env.BRUSSHY_TOKEN; // never passed on to the chat CLI or anything else this process spawns
  return t && /^[\w-]{32,64}$/.test(t) ? t : crypto.randomBytes(24).toString("base64url");
}

export class Daemon {
  readonly store: DocStore;
  /** Per-run secret. A daemon replaced after an update keeps its predecessor's (handed over by ensureDaemon) so open studio tabs keep working. */
  readonly token = takeToken();
  port = 0;
  private server!: http.Server;
  private wss!: WebSocketServer;
  private clients = new Set<WebSocket>();
  private observers = new WeakSet<WebSocket>();
  /** Most recently active studio tab: renders/exports go there. */
  private primary: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private selection: string[] = [];
  /** Frame (version) the user is working in; the agent's default target. */
  private activeFrame: string | null = null;
  private view = "2d";
  private agent: AgentStatus = { state: "idle", message: "", at: Date.now() };
  private agentIdleTimer?: NodeJS.Timeout;
  private watchers = new Set<() => void>();
  readonly chat: ChatService;

  constructor(private o: DaemonOptions) {
    ensureLayout(o.layout);
    this.store = new DocStore(o.layout);
    this.store.load();
    this.chat = new ChatService({
      layout: o.layout,
      doc: () => this.store.active,
      activeFrame: () => this.activeFrame,
      broadcast: (chat) => this.broadcast({ t: "chat", chat }),
      wake: () => this.watchers.forEach((w) => w()),
    });
    this.store.onChange(({ doc, author, label, reqId }) => {
      const h = this.store.history();
      this.broadcast({ t: "doc", doc, canUndo: h.canUndo, canRedo: h.canRedo, author, label, reqId, timeline: h.timeline() });
      this.watchers.forEach((w) => w());
    });
    this.store.onDocs(() => {
      this.broadcast({ t: "docs", docs: this.store.list() });
      this.sendHello();
      this.chat.docChanged();
    });
  }

  // ---------- lifecycle ----------

  async listen(): Promise<number> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        if (!res.headersSent) this.json(res, 500, { error: (e as Error).message });
      });
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
    this.server.on("upgrade", (req, socket, head) => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://x");
        if (url.pathname !== "/ws" || !this.hostOk(req) || !this.originOk(req) || !this.tokenOk(url.searchParams.get("token"))) throw new Error("rejected");
      } catch {
        socket.destroy();
        return;
      }
      // Observers (scripts, tests) talk to the daemon but can't render: never route studio requests to them.
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws, url.searchParams.get("role") === "observer"));
    });

    for (let p = this.o.port; p < this.o.port + 30; p++) {
      const ok = await new Promise<boolean>((resolve) => {
        const onErr = () => resolve(false);
        this.server.once("error", onErr);
        this.server.listen(p, "127.0.0.1", () => {
          this.server.off("error", onErr);
          resolve(true);
        });
      });
      if (ok) {
        this.port = p;
        break;
      }
    }
    if (!this.port) throw new Error(`No free port in ${this.o.port}–${this.o.port + 29}`);

    const info: DaemonInfo = {
      port: this.port,
      pid: process.pid,
      token: this.token,
      version: VERSION,
      project: this.o.layout.project,
      startedAt: Date.now(),
    };
    writeFileAtomic(this.o.layout.daemonFile, JSON.stringify(info, null, 2), 0o600);
    return this.port;
  }

  async close() {
    this.chat.dispose();
    this.store.flush();
    try {
      const cur = JSON.parse(fs.readFileSync(this.o.layout.daemonFile, "utf8")) as DaemonInfo;
      if (cur.pid === process.pid) fs.unlinkSync(this.o.layout.daemonFile);
    } catch {
      /* already gone */
    }
    for (const c of this.clients) c.close();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  get url() {
    return `http://localhost:${this.port}`;
  }

  /** The studio address, carrying the token in the fragment. */
  get studioUrl() {
    return `${this.url}/#t=${this.token}`;
  }

  // ---------- security ----------

  /** Reject DNS-rebinding: only loopback Host headers. */
  private hostOk(req: http.IncomingMessage) {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  /** Browsers must come from our own origin (or Vite in dev); non-browser clients send no Origin. */
  private originOk(req: http.IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const u = new URL(origin);
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      return local && (this.o.dev || u.port === String(this.port));
    } catch {
      return false;
    }
  }

  private tokenOk(t: unknown) {
    if (typeof t !== "string") return false;
    const a = Buffer.from(t);
    const b = Buffer.from(this.token);
    // Byte lengths, not string lengths: a non-ASCII token of the right length would make timingSafeEqual throw.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  private authed(req: http.IncomingMessage) {
    return this.tokenOk(req.headers["x-brusshy-token"]);
  }

  // ---------- websocket ----------

  private onSocket(ws: WebSocket, observer = false) {
    this.clients.add(ws);
    if (!observer) this.primary = ws;
    else this.observers.add(ws);
    this.sendHelloTo(ws);
    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }
      if (!observer) this.primary = ws;
      this.onClientMsg(ws, msg);
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.primary === ws) this.primary = [...this.clients].filter((c) => !this.observers.has(c)).pop() ?? null;
      this.observers.delete(ws);
    });
  }

  private onClientMsg(ws: WebSocket, msg: ClientMsg) {
    switch (msg.t) {
      case "ops":
        try {
          const r = this.store.apply(msg.ops, "user", msg.label ?? "Edit", msg.reqId);
          if (msg.reqId) this.send(ws, { t: "ack", reqId: msg.reqId, ok: true, created: r.created });
        } catch (e) {
          if (msg.reqId) this.send(ws, { t: "ack", reqId: msg.reqId, ok: false, error: (e as Error).message });
          // Resync the client so its optimistic state is corrected.
          this.sendHelloTo(ws);
        }
        return;
      case "undo":
        this.store.undo();
        return;
      case "redo":
        this.store.redo();
        return;
      case "select":
        this.selection = msg.ids;
        if (msg.frame !== undefined && msg.frame !== null) this.activeFrame = msg.frame;
        return;
      case "goto":
        this.store.goto(msg.index);
        return;
      case "view":
        this.view = msg.mode;
        return;
      case "open":
        try {
          this.store.open(msg.id);
        } catch {
          /* ignore unknown doc */
        }
        return;
      case "create":
        this.store.create(msg.name);
        return;
      case "chat":
        this.chat.send({ text: String(msg.text ?? ""), frame: msg.frame, selection: msg.selection, variants: msg.variants, images: Array.isArray(msg.images) ? msg.images.map(String) : undefined, runner: msg.runner });
        return;
      case "chat-stop":
        this.chat.stop();
        return;
      case "chat-clear":
        this.chat.clear();
        return;
      case "chat-runner":
        this.chat.setRunner(msg.runner, msg.connect === true);
        return;
      case "response": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? "Studio request failed"));
        return;
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.readyState === c.OPEN) c.send(s);
  }

  private sendHello() {
    for (const c of this.clients) this.sendHelloTo(c);
  }

  private sendHelloTo(ws: WebSocket) {
    const h = this.store.history();
    this.send(ws, {
      t: "hello",
      doc: this.store.active,
      docs: this.store.list(),
      canUndo: h.canUndo,
      canRedo: h.canRedo,
      agent: this.agent,
      projectDir: this.o.layout.project,
      version: VERSION,
      timeline: h.timeline(),
    });
    this.send(ws, { t: "chat", chat: this.chat.state() });
  }

  /** Resolve a frame reference (id/name) or fall back to the active frame, then the first one. */
  targetFrame(ref?: string | null): string {
    const doc = this.store.active;
    const f = findFrame(doc, ref) ?? findFrame(doc, this.activeFrame) ?? frameOf(doc, this.selection[0]) ?? listFrames(doc)[0];
    if (!f) throw new Error("This document has no frames");
    return f.id;
  }

  get studioConnected() {
    return this.primary !== null && this.primary.readyState === this.primary.OPEN;
  }

  /** Ask the studio (browser) to do something only a browser can (WebGL renders, video…). */
  requestStudio<T>(kind: Extract<ServerMsg, { t: "request" }>["kind"], params: Extract<ServerMsg, { t: "request" }>["params"], timeoutMs = 120_000): Promise<T> {
    const ws = this.primary;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.reject(new Error("STUDIO_OFFLINE"));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Studio did not answer the ${kind} request in ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send(ws, { t: "request", id, kind, params } as ServerMsg);
    });
  }

  setAgent(state: AgentStatus["state"], message = "") {
    const now = Date.now();
    // One "run" spans consecutive tool calls; its steps feed the live progress card.
    const prev = this.agent;
    const run = prev.state === "working" && prev.startedAt ? { startedAt: prev.startedAt, steps: prev.steps ?? [] } : { startedAt: now, steps: [] as { label: string; at: number }[] };
    if (state === "working" && message && run.steps.at(-1)?.label !== message) run.steps = [...run.steps, { label: message, at: now }].slice(-12);
    this.agent = state === "working" ? { state, message, at: now, ...run } : { state, message, at: now };
    if (state === "working" && message) this.chat.queueStep(message);
    this.broadcast({ t: "agent", agent: this.agent });
    clearTimeout(this.agentIdleTimer);
    if (state === "working") this.agentIdleTimer = setTimeout(() => this.setAgent("idle"), 8000);
  }

  focus(ids: string[]) {
    this.broadcast({ t: "focus", ids });
  }

  // ---------- render / export ----------

  async render(params: RenderParams): Promise<RenderResponse & { source: "studio" | "server" }> {
    params = { ...params, frame: this.targetFrame(params.frame) };
    try {
      const r = await this.requestStudio<RenderResponse>("render", params, 60_000);
      return { ...r, source: "studio" };
    } catch (e) {
      if ((e as Error).message !== "STUDIO_OFFLINE" && params.view === "3d") throw e;
      if (params.view === "3d") throw new Error("3D previews need the studio open in a browser. Call open_studio first.");
      const doc = frameDoc(this.store.active, params.frame!);
      const svg = docToSvg(doc, {
        includeWorking: params.includeWorking,
        background: params.transparent === false ? (doc.artboard.background ?? "#ffffff") : undefined,
        resolveRef: (src) => this.refDataUrl(src),
      });
      const width = params.width ?? 768;
      const png = renderSvgPng(svg, width);
      return { png: png.toString("base64"), width, height: Math.round((width * doc.artboard.height) / doc.artboard.width), source: "server" };
    }
  }

  newExportDir(name = this.store.active.name): string {
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const dir = path.join(this.o.layout.exports, `${slugify(name)}-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async export(params: ExportParams): Promise<ExportResponse & { source: "studio" | "server"; note?: string }> {
    params = { ...params, frame: this.targetFrame(params.frame) };
    try {
      const r = await this.requestStudio<ExportResponse>("export", params, 10 * 60_000);
      return { ...r, source: "studio" };
    } catch (e) {
      if ((e as Error).message !== "STUDIO_OFFLINE") throw e;
      // Without a browser we can still produce the vector + raster basics.
      const doc = frameDoc(this.store.active, params.frame!);
      const dir = this.newExportDir(doc.name);
      const files: ExportResponse["files"] = [];
      const write = (name: string, data: string | Buffer) => {
        fs.writeFileSync(path.join(dir, name), data);
        files.push({ name, bytes: Buffer.byteLength(data) });
      };
      const base = slugify(doc.name);
      const svg = docToSvg(doc, { pretty: true });
      if (params.formats.includes("svg")) write(`${base}.svg`, svg);
      if (params.formats.includes("png"))
        for (const w of params.pngSizes ?? [512, 1024, 2048]) write(`${base}-${w}.png`, renderSvgPng(svg, w));
      if (params.formats.includes("mono")) {
        write(`${base}-mono-black.svg`, docToSvg(doc, { monochrome: "#000000", pretty: true }));
        write(`${base}-mono-white.svg`, docToSvg(doc, { monochrome: "#ffffff", pretty: true }));
      }
      if (params.formats.includes("anim-svg")) {
        const spec = animationOf((this.store.active.nodes[params.frame!] as { animation?: unknown } | undefined)?.animation);
        if (hasAnimation(spec)) write(`${base}-animated.svg`, animatedSvg(doc, spec, { scope: "brusshy-anim" }).svg);
      }
      const skipped = params.formats.filter((f) => !["svg", "png", "mono", "anim-svg"].includes(f));
      return {
        dir,
        files,
        source: "server",
        note: skipped.length
          ? `Studio is not open, so these were skipped: ${skipped.join(", ")}. Text is not outlined in server exports. Open the studio and export again for everything.`
          : "Studio is not open: text is kept as <text> (not outlined).",
      };
    }
  }

  private refDataUrl(src: string): string {
    if (src.startsWith("data:")) return src;
    const file = this.safeJoin(this.o.layout.root, src);
    // Outside the project (or missing): render nothing rather than hand resvg a local path to load.
    if (!file || !fs.existsSync(file) || !this.realInside(this.o.layout.root, file)) return "";
    const ext = path.extname(file).toLowerCase();
    return `data:${MIME[ext] ?? "application/octet-stream"};base64,${fs.readFileSync(file).toString("base64")}`;
  }

  /** `file` resolves (symlinks included) to a path inside `base`. */
  private realInside(base: string, file: string) {
    try {
      const root = fs.realpathSync(base);
      const real = fs.realpathSync(file);
      return real === root || real.startsWith(root + path.sep);
    } catch {
      return false;
    }
  }

  private safeJoin(base: string, rel: string): string | null {
    const p = path.resolve(base, rel);
    return p === base || p.startsWith(base + path.sep) ? p : null;
  }

  waitForPendingAnnotation(timeoutMs: number): Promise<boolean> {
    const has = () => this.chat.hasQueued() || Object.values(this.store.active.annotations).some((a) => a.status === "pending");
    if (has()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        this.watchers.delete(check);
        clearTimeout(timer);
        resolve(v);
      };
      const check = () => has() && done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.watchers.add(check);
    });
  }

  // ---------- http ----------

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  private async body(req: http.IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > limit) throw new Error("Body too large");
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.hostOk(req)) return this.json(res, 403, { error: "Bad host" });
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;

    if (p.startsWith("/api/")) {
      if (!this.originOk(req)) return this.json(res, 403, { error: "Bad origin" });
      if (p === "/api/health") return this.json(res, 200, { ok: true, version: VERSION, build: BUILD, project: this.o.layout.project, pid: process.pid });
      if (!this.authed(req)) return this.json(res, 401, { error: "Missing or wrong token" });
      return this.api(req, res, url);
    }

    if (p.startsWith("/refs/") || p.startsWith("/brand/")) {
      // Each folder serves only its own images. They come from outside (downloads, clients): an SVG opened directly
      // must never run script on this origin (it would read the studio's token), so it gets a sandbox with no script.
      // Other sites may not even probe these (an <img> load would tell them a file exists).
      if (req.headers["sec-fetch-site"] === "cross-site") return this.json(res, 403, { error: "Cross-site" });
      const base = p.startsWith("/refs/") ? this.o.layout.refs : this.o.layout.brand;
      let file: string | null = null;
      try {
        file = this.safeJoin(base, decodeURIComponent(p.slice(p.indexOf("/", 1) + 1)));
      } catch {
        /* malformed escape */
      }
      if (!file || !IMAGE_EXT.has(path.extname(file).toLowerCase()) || !fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !this.realInside(base, file)) return this.json(res, 404, { error: "Not found" });
      res.writeHead(200, {
        "cross-origin-resource-policy": "same-origin",
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-cache",
        "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        "x-content-type-options": "nosniff",
      });
      return fs.createReadStream(file).pipe(res);
    }

    if (this.o.dev) return this.json(res, 404, { error: "Studio is served by Vite in dev mode" });
    return this.serveStudio(p, res);
  }

  private serveStudio(p: string, res: http.ServerResponse) {
    const root = path.join(distDir(), "studio");
    let file = this.safeJoin(root, p === "/" ? "index.html" : decodeURIComponent(p.slice(1)));
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    if (!fs.existsSync(file)) return this.json(res, 500, { error: "Studio build missing. Run `npm run build`." });
    const ext = path.extname(file).toLowerCase();
    if (ext === ".html") {
      // The token is NOT in the page: the studio is opened at /#t=<token> (a fragment never reaches a server, a log or a
      // Referer), so nothing else on the machine can fetch it from this unauthenticated page.
      const html = fs.readFileSync(file, "utf8");
      res.writeHead(200, {
        "content-type": MIME[".html"]!,
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' ws://localhost:* ws://127.0.0.1:* https://cdn.jsdelivr.net https://api.fontsource.org https://fonts.gstatic.com data: blob:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
        "x-content-type-options": "nosniff",
      });
      return res.end(html);
    }
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  }

  private async api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const p = url.pathname;
    const method = req.method ?? "GET";
    const readJson = async () => {
      const b = await this.body(req, 16 * 1024 * 1024);
      return b.length ? (JSON.parse(b.toString("utf8")) as Record<string, unknown>) : {};
    };

    if (method === "GET" && p === "/api/state") {
      const h = this.store.history();
      return this.json(res, 200, {
        doc: this.store.active,
        docs: this.store.list(),
        selection: this.selection,
        activeFrame: this.targetFrame(),
        view: this.view,
        studioConnected: this.studioConnected,
        canUndo: h.canUndo,
        canRedo: h.canRedo,
        history: h.summary(15),
        project: this.o.layout.project,
      });
    }
    if (method === "POST" && p === "/api/ops") {
      const b = await readJson();
      try {
        const r = this.store.apply((b.ops as unknown[]) ?? [], "agent", String(b.label ?? "Agent edit"));
        return this.json(res, 200, { ok: true, created: r.created });
      } catch (e) {
        return this.json(res, 400, { ok: false, error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/undo") return this.json(res, 200, { ok: this.store.undo("agent") });
    if (method === "POST" && p === "/api/redo") return this.json(res, 200, { ok: this.store.redo("agent") });
    if (method === "GET" && p === "/api/log") {
      return this.json(res, 200, this.store.logSince(Number(url.searchParams.get("since") ?? 0)));
    }
    if (method === "POST" && p === "/api/history/goto") {
      const b = await readJson();
      return this.json(res, 200, { ok: this.store.goto(Number(b.index), "agent") });
    }
    if (method === "GET" && p === "/api/history") {
      return this.json(res, 200, this.store.history().timeline(200));
    }
    if (method === "GET" && p === "/api/timelapse") {
      try {
        const frame = this.targetFrame(url.searchParams.get("frame"));
        return this.json(res, 200, timelapseFor(this.store.active, this.store.history(), frame, Number(url.searchParams.get("max") ?? 300) || 300));
      } catch (e) {
        return this.json(res, 409, { error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/frame/active") {
      const b = await readJson();
      try {
        this.activeFrame = this.targetFrame(String(b.frame ?? ""));
        return this.json(res, 200, { ok: true, frame: this.activeFrame });
      } catch (e) {
        return this.json(res, 404, { ok: false, error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/docs") {
      const b = await readJson();
      const doc = this.store.create(typeof b.name === "string" ? b.name : undefined);
      return this.json(res, 200, { ok: true, id: doc.id });
    }
    if (method === "POST" && p === "/api/docs/open") {
      const b = await readJson();
      try {
        this.store.open(String(b.id));
        return this.json(res, 200, { ok: true });
      } catch (e) {
        return this.json(res, 404, { ok: false, error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/render") {
      const b = (await readJson()) as unknown as RenderParams;
      try {
        return this.json(res, 200, await this.render(b));
      } catch (e) {
        return this.json(res, 409, { error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/export") {
      const b = (await readJson()) as unknown as ExportParams;
      try {
        return this.json(res, 200, await this.export(b));
      } catch (e) {
        return this.json(res, 409, { error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/glyphs") {
      // Lettering outlines come from the studio: the same font files and layout code the canvas draws with.
      const b = await readJson();
      try {
        return this.json(res, 200, await this.requestStudio("glyphs", b as never, 45_000));
      } catch (e) {
        const offline = (e as Error).message === "STUDIO_OFFLINE";
        return this.json(res, 409, { error: offline ? "Lettering needs the studio open (letters are outlined with the fonts the canvas uses). Call open_studio first." : (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/woff2") {
      // WOFF2 → TTF for the studio's type engine: the decoder (Emscripten) generates code at run time,
      // which the studio's CSP rightly forbids, so it runs here. Bytes in, bytes out: nothing is fetched.
      const b = await this.body(req, 8 * 1024 * 1024);
      if (b.length < 48 || b.toString("latin1", 0, 4) !== "wOF2") return this.json(res, 400, { error: "Not a WOFF2 file" });
      try {
        const { default: decompress } = await import("woff2-encoder/decompress");
        const ttf = await decompress(b);
        res.writeHead(200, { "content-type": "font/ttf", "cache-control": "no-store" });
        return res.end(Buffer.from(ttf.buffer, ttf.byteOffset, ttf.byteLength));
      } catch {
        return this.json(res, 422, { error: "Could not decode the font" });
      }
    }
    if (method === "POST" && p === "/api/type") {
      // Type controls: font features/alternates and alternate outlines are read from the font files in the studio.
      const b = await readJson();
      try {
        return this.json(res, 200, await this.requestStudio("type", b as never, 60_000));
      } catch (e) {
        const offline = (e as Error).message === "STUDIO_OFFLINE";
        return this.json(res, 409, { error: offline ? "Font features and alternates are read in the studio. Call open_studio first." : (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/mockup") {
      // Mockup scenes are drawn in the studio (SVG compositions + the 3D engine).
      const b = await readJson();
      try {
        const params = { ...b, frame: this.targetFrame(typeof b.frame === "string" ? b.frame : undefined) };
        return this.json(res, 200, await this.requestStudio("mockup", params as never, 120_000));
      } catch (e) {
        const offline = (e as Error).message === "STUDIO_OFFLINE";
        return this.json(res, 409, { error: offline ? "Mockups are drawn in the studio. Call open_studio first." : (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/colorways") {
      // Colorway contact sheets are drawn in the studio (outlined text); the MCP falls back to resvg.
      const b = await readJson();
      try {
        const params = { ...b, frame: this.targetFrame(typeof b.frame === "string" ? b.frame : undefined) };
        return this.json(res, 200, await this.requestStudio("colorways", params as never, 90_000));
      } catch (e) {
        return this.json(res, 409, { error: (e as Error).message });
      }
    }
    if (method === "POST" && p === "/api/export/dir") {
      const b = await readJson();
      return this.json(res, 200, { dir: this.newExportDir(typeof b.name === "string" && b.name ? b.name : undefined) });
    }
    if (method === "POST" && p === "/api/export/reveal") {
      // "Reveal folder" after an export: only an existing folder strictly inside brusshy/exports/.
      const b = await readJson();
      const name = path.basename(typeof b.dir === "string" ? b.dir : "");
      // Only names newExportDir makes (no dots): `open` would launch an `X.app` folder instead of revealing it.
      const dir = /^[a-z0-9-]+$/i.test(name) ? this.safeJoin(this.o.layout.exports, name) : null;
      if (!dir || dir === this.o.layout.exports || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return this.json(res, 400, { error: "Not an export folder" });
      const root = fs.realpathSync(this.o.layout.exports);
      const real = fs.realpathSync(dir);
      if (!real.startsWith(root + path.sep)) return this.json(res, 400, { error: "Not an export folder" });
      return this.json(res, 200, { ok: await revealFolder(real) });
    }
    if (method === "POST" && p === "/api/export/file") {
      // Studio streams each generated file here; we write it into the export dir.
      const dir = this.safeJoin(this.o.layout.exports, path.basename(url.searchParams.get("dir") ?? ""));
      const name = path.basename(url.searchParams.get("name") ?? "");
      if (!dir || !name || !fs.existsSync(dir) || !this.realInside(this.o.layout.exports, dir)) return this.json(res, 400, { error: "Bad export target" });
      const target = path.join(dir, name);
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) return this.json(res, 400, { error: "Bad export target" });
      const data = await this.body(req, 512 * 1024 * 1024);
      fs.writeFileSync(target, data);
      return this.json(res, 200, { ok: true, name, bytes: data.length });
    }
    if (method === "POST" && p === "/api/refs") {
      const orig = path.basename(url.searchParams.get("name") ?? "reference.png");
      const ext = path.extname(orig).toLowerCase();
      if (!IMAGE_EXT.has(ext)) return this.json(res, 400, { error: "Unsupported image type" });
      const data = await this.body(req, 40 * 1024 * 1024);
      let name = `${slugify(path.basename(orig, ext))}${ext}`;
      const taken = (n: string) => {
        try {
          fs.lstatSync(path.join(this.o.layout.refs, n)); // a dangling symlink counts as taken
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 2; taken(name); i++) name = `${slugify(path.basename(orig, ext))}-${i}${ext}`;
      fs.writeFileSync(path.join(this.o.layout.refs, name), data, { flag: "wx" });
      return this.json(res, 200, { ok: true, src: `refs/${name}` });
    }
    if (method === "GET" && p === "/api/brand") {
      return this.json(res, 200, readBrandContext(this.o.layout));
    }
    if (method === "GET" && p === "/api/annotations/watch") {
      const timeout = Math.min(Number(url.searchParams.get("timeout") ?? 60_000), 10 * 60_000);
      const found = await this.waitForPendingAnnotation(timeout);
      return this.json(res, 200, { found });
    }
    if (method === "POST" && p === "/api/agent") {
      const b = await readJson();
      this.setAgent(b.state === "idle" ? "idle" : "working", String(b.message ?? ""));
      return this.json(res, 200, { ok: true });
    }
    if (method === "POST" && p === "/api/chat/images") {
      try {
        const image = this.chat.saveImage(await this.body(req, CHAT_IMAGES.bytes + 1));
        return this.json(res, 200, { image });
      } catch (e) {
        return this.json(res, 400, { error: (e as Error).message });
      }
    }
    if (method === "GET" && p === "/api/chat/images") return this.json(res, 200, this.chat.imagesForAgent());
    if (method === "GET" && p.startsWith("/api/chat/images/")) {
      const f = this.chat.imageFile(p.slice("/api/chat/images/".length));
      if (!f) return this.json(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": f.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": "inline" });
      return fs.createReadStream(f.file).pipe(res);
    }
    if (method === "GET" && p === "/api/chat/requests") {
      return this.json(res, 200, { request: this.chat.takeQueued() });
    }
    if (method === "POST" && p === "/api/chat/reply") {
      const b = await readJson();
      return this.json(res, 200, { ok: this.chat.replyQueued(String(b.id ?? ""), String(b.text ?? "")) });
    }
    if (method === "POST" && p === "/api/focus") {
      const b = await readJson();
      this.focus(((b.ids as string[]) ?? []).filter((x) => typeof x === "string"));
      return this.json(res, 200, { ok: true });
    }
    return this.json(res, 404, { error: `No route ${method} ${p}` });
  }
}
