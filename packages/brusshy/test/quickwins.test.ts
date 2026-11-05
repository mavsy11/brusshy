import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Daemon } from "../src/daemon";
import { layout } from "../src/paths";
import { briefLines, outline } from "../src/mcp";
import { contactSheetSvg } from "../src/tools/quickwins";
import { renderSvgPng } from "../src/raster";

let dir: string;
let daemon: Daemon;
let base: string;

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + p, {
    method,
    headers: { "x-brusshy-token": daemon.token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};
const agentOps = (ops: unknown[]) => call("POST", "/api/ops", { ops, author: "agent", label: "Agent edit" });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-qw-"));
  daemon = new Daemon({ layout: layout(dir), port: 48000 + Math.floor(Math.random() * 1000) });
  await daemon.listen();
  base = `http://127.0.0.1:${daemon.port}`;
});

afterAll(async () => {
  await daemon.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("locks for the AI", () => {
  it("refuses agent edits to ai-locked parts and their children; the user can still edit", async () => {
    const add = await agentOps([
      { op: "add", node: { id: "crest", type: "group", name: "crest" } },
      { op: "add", node: { id: "star", type: "shape", shape: "star", width: 40, height: 40 }, parent: "crest" },
      { op: "add", node: { id: "free", type: "path", d: "M0 0L10 10" } },
    ]);
    expect(add.status).toBe(200);
    // The user locks the crest for the AI (from the studio).
    daemon.store.apply([{ op: "update", id: "crest", set: { aiLock: true } }], "user", "Lock for AI");

    const before = (await call("GET", "/api/state")).json.doc;
    for (const op of [
      { op: "update", id: "crest", set: { transform: { x: 50 } } },
      { op: "update", id: "star", set: { style: { fill: "#ff0000" } } },
      { op: "remove", id: "star" },
      { op: "remove", id: "crest" },
      { op: "move", id: "star", parent: before.nodes.free.parent },
      { op: "add", node: { type: "path", d: "M0 0" }, parent: "crest" },
      { op: "update", id: "crest", set: { aiLock: false } },
      { op: "move", id: "free", parent: "crest" },
    ]) {
      const r = await agentOps([op]);
      expect(r.status, JSON.stringify(op)).toBe(400);
      expect(r.json.error).toMatch(/locked by the user/);
    }
    // A batch that touches a locked part is refused as a whole (atomic).
    const mixed = await agentOps([{ op: "update", id: "free", set: { transform: { x: 9 } } }, { op: "remove", id: "star" }]);
    expect(mixed.status).toBe(400);
    const after = (await call("GET", "/api/state")).json.doc;
    expect(after.nodes.free.transform.x).toBe(0);
    expect(after.nodes.star).toBeDefined();
    expect(after.nodes.crest.transform.x).toBe(0);

    // Unlocked parts stay editable for the agent.
    expect((await agentOps([{ op: "update", id: "free", set: { transform: { x: 9 } } }])).status).toBe(200);
    // The user is never blocked.
    expect(() => daemon.store.apply([{ op: "update", id: "star", set: { style: { fill: "#00ff00" } } }], "user", "Fill")).not.toThrow();
  });

  it("marks ai-locked parts in the agent's outline", async () => {
    const doc = (await call("GET", "/api/state")).json.doc;
    const text = outline(doc);
    expect(text).toMatch(/crest \[group\] "crest".*\(ai-locked\)/);
    expect(text).not.toMatch(/free \[path\].*\(ai-locked\)/);
    expect(text).toContain("don't change, move or delete it");
  });
});

describe("brief and reference roles in the outline", () => {
  it("shows the brief (filled fields only) and each reference's role", async () => {
    let doc = (await call("GET", "/api/state")).json.doc;
    expect(briefLines(doc)[0]).toMatch(/Brief: \(none yet/);
    daemon.store.apply([{ op: "doc", set: { brief: { subject: "Fox coffee", avoid: "beans\ncups" } } }], "user", "Brief");
    daemon.store.apply([{ op: "add", node: { id: "ref1", type: "reference", src: "refs/a.png", width: 10, height: 10, role: "palette" } }], "user", "Ref");
    doc = (await call("GET", "/api/state")).json.doc;
    const text = outline(doc);
    expect(text).toContain("Brief from the user — follow it:");
    expect(text).toContain("• Subject: Fox coffee");
    expect(text).toContain("• Avoid: beans / cups");
    expect(text).not.toContain("Typography:");
    expect(text).toMatch(/ref1 \[reference\].*role=palette/);
    // Undo restores the previous (empty) brief.
    daemon.store.undo();
    daemon.store.undo();
    expect((await call("GET", "/api/state")).json.doc.brief).toBeUndefined();
  });
});

describe("small-size contact sheet", () => {
  it("composes the renders into one PNG", () => {
    const one = renderSvgPng('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>', 16).toString("base64");
    const svg = contactSheetSvg("Test", [16, 24, 32, 64].map((size) => ({ size, png: one, width: size, height: size })));
    expect(svg).toContain("16px · light");
    expect(svg).toContain("64px · dark");
    const png = renderSvgPng(svg, 680);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
