import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Daemon } from "../src/daemon";
import { layout } from "../src/paths";
import { outline } from "../src/mcp";

let dir: string;
let daemon: Daemon;
let base: string;

const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + p, {
    method,
    headers: { "x-brusshy-token": daemon.token, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-test-"));
  daemon = new Daemon({ layout: layout(dir), port: 47000 + Math.floor(Math.random() * 1000) });
  await daemon.listen();
  base = `http://127.0.0.1:${daemon.port}`;
});

afterAll(async () => {
  await daemon.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("data folder", () => {
  it("never writes into an existing brusshy/ folder that isn't Brusshy data", () => {
    const p = fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-proj-"));
    fs.mkdirSync(path.join(p, "brusshy"));
    fs.writeFileSync(path.join(p, "brusshy", "package.json"), "{}");
    expect(layout(p).root).toBe(path.join(p, "brusshy-files"));
    fs.rmSync(path.join(p, "brusshy"), { recursive: true });
    expect(layout(p).root).toBe(path.join(p, "brusshy"));
    fs.rmSync(p, { recursive: true, force: true });
  });
});

describe("daemon", () => {
  it("creates the project layout and a first document", () => {
    const l = layout(dir);
    expect(fs.existsSync(l.brand)).toBe(true);
    expect(fs.existsSync(l.refs)).toBe(true);
    expect(fs.readdirSync(l.root).some((f) => f.endsWith(".brusshy.json"))).toBe(true);
    const info = JSON.parse(fs.readFileSync(l.daemonFile, "utf8"));
    expect(info.port).toBe(daemon.port);
    expect(fs.statSync(l.daemonFile).mode & 0o077).toBe(0);
  });

  it("rejects missing tokens, foreign origins and foreign hosts", async () => {
    expect((await call("GET", "/api/state", undefined, { "x-brusshy-token": "nope" })).status).toBe(401);
    expect((await call("GET", "/api/state", undefined, { origin: "https://evil.example" })).status).toBe(403);
    // fetch can't override Host, so use a raw request (DNS-rebinding check).
    const status = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port: daemon.port, path: "/api/health", headers: { host: "evil.example" } }, (res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(403);
  });

  it("applies ops atomically, undoes and redoes", async () => {
    const add = await call("POST", "/api/ops", {
      ops: [{ op: "add", node: { type: "shape", shape: "rect", width: 100, height: 80 } }],
      label: "Add",
    });
    expect(add.status).toBe(200);
    const id = add.json.created[0];
    const bad = await call("POST", "/api/ops", { ops: [{ op: "update", id, set: { transform: { x: 5 } } }, { op: "remove", id: "missing" }] });
    expect(bad.status).toBe(400);
    let s = await call("GET", "/api/state");
    expect(s.json.doc.nodes[id].transform.x).toBe(0);
    await call("POST", "/api/undo");
    s = await call("GET", "/api/state");
    expect(s.json.doc.nodes[id]).toBeUndefined();
    await call("POST", "/api/redo");
    s = await call("GET", "/api/state");
    expect(s.json.doc.nodes[id].type).toBe("shape");
    expect(outline(s.json.doc)).toContain(`${id} [shape:rect]`);
  });

  it("renders 2D on the server when no studio is open, refuses 3D", async () => {
    const r2 = await call("POST", "/api/render", { view: "2d", width: 128 });
    expect(r2.status).toBe(200);
    expect(Buffer.from(r2.json.png, "base64").subarray(1, 4).toString()).toBe("PNG");
    const r3 = await call("POST", "/api/render", { view: "3d" });
    expect(r3.status).toBe(409);
  });

  it("exports SVG/PNG without a studio and keeps files inside exports/", async () => {
    const r = await call("POST", "/api/export", { formats: ["svg", "png", "glb"], pngSizes: [64] });
    expect(r.status).toBe(200);
    expect(r.json.files.map((f: { name: string }) => f.name).sort()).toEqual(["untitled-logo-64.png", "untitled-logo.svg"]);
    expect(r.json.note).toMatch(/glb/);
    const evil = await fetch(`${base}/api/export/file?dir=..&name=x.txt`, { method: "POST", headers: { "x-brusshy-token": daemon.token }, body: "x" });
    expect(evil.status).toBe(400);
  });

  it("stores reference uploads under refs/ and serves them", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const up = await fetch(`${base}/api/refs?name=${encodeURIComponent("../../My Compass.png")}`, { method: "POST", headers: { "x-brusshy-token": daemon.token }, body: png });
    const j = (await up.json()) as { src: string };
    expect(j.src).toBe("refs/my-compass.png");
    const get = await fetch(`${base}/${j.src}`);
    expect(get.status).toBe(200);
    expect((await fetch(`${base}/refs/../.daemon.json`)).status).not.toBe(200);
  });

  it("logs who changed what, so the agent can respect user edits", async () => {
    const before = (await call("GET", "/api/log?since=0")).json.seq as number;
    const add = await call("POST", "/api/ops", { ops: [{ op: "add", node: { type: "path", name: "bean", d: "M0 0L10 10" } }], author: "agent" });
    const id = add.json.created[0];
    // A "user" edit, as the studio would send it.
    daemon.store.apply([{ op: "update", id, set: { d: "M0 0L20 20", transform: { x: 5 } } }], "user", "Edit curve");
    const log = await call("GET", `/api/log?since=${before}`);
    const user = log.json.entries.filter((e: { author: string }) => e.author === "user");
    expect(user).toHaveLength(1);
    expect(user[0].details[0]).toContain('"bean"');
    expect(user[0].details[0]).toContain("shape (path)");
    expect(user[0].details[0]).toContain("position");
  });

  it("jumps back and forward in history", async () => {
    const t0 = (await call("GET", "/api/history")).json;
    const steps = t0.offset + t0.cursor;
    await call("POST", "/api/ops", { ops: [{ op: "add", node: { id: "jump", type: "path", d: "M0 0" } }] });
    expect((await call("GET", "/api/state")).json.doc.nodes.jump).toBeDefined();
    await call("POST", "/api/history/goto", { index: steps });
    expect((await call("GET", "/api/state")).json.doc.nodes.jump).toBeUndefined();
    await call("POST", "/api/history/goto", { index: steps + 1 });
    expect((await call("GET", "/api/state")).json.doc.nodes.jump).toBeDefined();
  });

  it("exports one version (frame) at a time", async () => {
    const s = (await call("GET", "/api/state")).json;
    const v1 = s.activeFrame as string;
    await call("POST", "/api/ops", { ops: [{ op: "add", node: { id: "f_v2", type: "frame", name: "V2", width: 300, height: 200, transform: { x: 2000 } }, parent: null }] });
    const r = await call("POST", "/api/export", { formats: ["svg"], frame: "V2" });
    const svg = fs.readFileSync(path.join(r.json.dir, r.json.files[0].name), "utf8");
    expect(svg).toContain('viewBox="0 0 300 200"');
    expect(r.json.files[0].name).toContain("v2");
    expect(v1).not.toBe("f_v2");
  });

  it("wakes annotation watchers", async () => {
    const wait = call("GET", "/api/annotations/watch?timeout=5000");
    await new Promise((r) => setTimeout(r, 50));
    await call("POST", "/api/ops", { ops: [{ op: "annotate", annotation: { x: 1, y: 1, note: "rounder" } }] });
    expect((await wait).json.found).toBe(true);
  });
});
