import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Daemon } from "../src/daemon";
import { layout } from "../src/paths";
import { outline } from "../src/mcp";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-type-"));
  daemon = new Daemon({ layout: layout(dir), port: 49000 + Math.floor(Math.random() * 1000) });
  await daemon.listen();
  base = `http://127.0.0.1:${daemon.port}`;
});

afterAll(async () => {
  await daemon.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("type controls through the daemon", () => {
  it("stores type settings and the type system, and shows them to the agent", async () => {
    const r = await agentOps([
      { op: "add", node: { id: "w", type: "text", text: "Northwind", fontFamily: "Fraunces", fontSize: 100, letterSpacing: 4, axes: { wght: 640, SOFT: 100 }, features: ["ss01", "-liga"], alternates: { "2": "salt:1" }, kerning: "optical", kerns: [0, -20] } },
      { op: "doc", set: { typeSystem: { heading: { family: "Fraunces", weight: 640 }, body: { family: "Inter", weight: 400 }, sample: "Northwind", note: "soft serif × neo-grotesque" } } },
    ]);
    expect(r.status).toBe(200);
    const doc = (await call("GET", "/api/state")).json.doc;
    expect(doc.typeSystem.body.family).toBe("Inter");
    const text = outline(doc);
    expect(text).toMatch(/Type system — use these fonts: heading\/wordmark Fraunces 640; body Inter 400 \(soft serif × neo-grotesque\)/);
    expect(text).toMatch(/text="Northwind" Fraunces .*tracking 40; axes wght=640,SOFT=100; features ss01,-liga; alternates 2:salt:1; kerning optical; kerns \[0,-20\]/);
  });

  it("undoes a type change in one step", async () => {
    expect((await agentOps([{ op: "update", id: "w", set: { axes: { wdth: 80 }, features: null } }])).status).toBe(200);
    let doc = (await call("GET", "/api/state")).json.doc;
    expect(doc.nodes.w.axes).toEqual({ wght: 640, SOFT: 100, wdth: 80 });
    expect(doc.nodes.w.features).toBeNull();
    await call("POST", "/api/undo");
    doc = (await call("GET", "/api/state")).json.doc;
    expect(doc.nodes.w.axes).toEqual({ wght: 640, SOFT: 100 });
    expect(doc.nodes.w.features).toEqual(["ss01", "-liga"]);
  });

  it("refuses agent type edits on ai-locked text", async () => {
    daemon.store.apply([{ op: "update", id: "w", set: { aiLock: true } }], "user", "Lock for AI");
    const r = await agentOps([{ op: "update", id: "w", set: { axes: { wght: 300 } } }]);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/locked by the user/);
  });

  it("explains that font facts need the studio", async () => {
    const r = await call("POST", "/api/type", { action: "info", family: "Inter" });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/open_studio/);
  });
});
