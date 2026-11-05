import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatService } from "../src/chat";
import { layout } from "../src/paths";

const saved = { HOME: process.env.HOME, PATH: process.env.PATH, FLAG: process.env.BRUSSHY_CHAT_CODEX };
let home: string;

const service = () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-project-"));
  return new ChatService({ layout: layout(project), doc: () => ({ id: "d" }) as never, activeFrame: () => null, broadcast: () => {}, wake: () => {} });
};
const codex = (s: ChatService) => s.state().runners.find((r) => r.kind === "codex")!;

describe("connecting Codex to the canvas chat", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "brusshy-home-"));
    const bin = path.join(home, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\n", { mode: 0o755 });
    process.env.HOME = home;
    process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`;
    delete process.env.BRUSSHY_CHAT_CODEX;
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    process.env.PATH = saved.PATH;
    if (saved.FLAG !== undefined) process.env.BRUSSHY_CHAT_CODEX = saved.FLAG;
  });

  it("asks first: picking it without an answer changes nothing", () => {
    const s = service();
    const before = s.state().runner;
    expect(codex(s).askConnect).toBe(true);
    s.setRunner("codex");
    expect(s.state().runner).toBe(before);
    expect(fs.existsSync(path.join(home, ".brusshy", "chat-connected.json"))).toBe(false);
  });

  it("remembers the answer in the user's home, for every project", () => {
    const s = service();
    s.setRunner("codex", true);
    expect(s.state().runner).toBe("codex");
    expect(codex(s).askConnect).toBe(false);
    expect(codex(service()).askConnect).toBe(false);
  });

  it("a file planted in the project can't connect it", () => {
    const s = service();
    fs.mkdirSync(s["h"].layout.root, { recursive: true });
    fs.writeFileSync(path.join(s["h"].layout.root, "chat-connected.json"), '{"codex":true}');
    expect(codex(s).askConnect).toBe(true);
  });
});
