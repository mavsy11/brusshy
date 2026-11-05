// Drive the canvas chat like the studio does: node test/chat.mjs <project dir> "<request>" [variants]
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const [dir, text, variants] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(path.join(path.resolve(dir), "brusshy", ".daemon.json"), "utf8"));
const ws = new WebSocket(`ws://localhost:${info.port}/ws?token=${info.token}&role=observer`);
let sent = false;
let lastSteps = 0;
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.t !== "chat") return;
  if (!sent) {
    sent = true;
    ws.send(JSON.stringify({ t: "chat", text, variants: variants ? Number(variants) : undefined }));
    return;
  }
  const m = msg.chat.messages.at(-1);
  if (!m || m.role !== "assistant") return;
  for (const s of (m.steps ?? []).slice(lastSteps)) console.log(`  · ${s.label}`);
  lastSteps = m.steps?.length ?? 0;
  if (m.status !== "running" && m.status !== "queued") {
    console.log(`[${m.status} in ${Math.round(m.ms / 1000)}s] ${m.text}`);
    ws.close();
  }
});
ws.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
