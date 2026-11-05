// Usage: npm run test:mockups -w @brusshy/studio [-- --fixture Brusshy] [-- --kind tote]
// Renders every mockup for every fixture logo in headless Chrome (the studio's own scene code,
// served by Vite) and fails when a color of a placed logo does not read against what is under it.
// Needs a local Chrome (CHROME_PATH, or the default macOS / Linux install).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "test/out");
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const chrome =
  process.env.CHROME_PATH ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
if (!chrome) {
  console.error("No Chrome found: set CHROME_PATH.");
  process.exit(2);
}

const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { port: 0 }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failed = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page:", e.message));
  page.on("console", (m) => process.stdout.write(`  ${m.text()}\n`));
  await page.goto(`${url}test/mockup-contrast.html`);
  await page.waitForFunction(() => document.title === "ready", { timeout: 120_000 });
  const results = await page.evaluate((only) => window.runContrast(only), { fixture: arg("fixture"), kind: arg("kind") });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const r of results) {
    const name = `${r.fixture}-${r.kind}-${r.theme}`.toLowerCase();
    fs.writeFileSync(path.join(outDir, `${r.ok ? "" : "FAIL-"}${name}.png`), Buffer.from(r.png.split(",")[1], "base64"));
    for (const i of r.inks) rows.push({ scene: name, ...i });
    if (!r.ok) failed++;
  }
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(rows, null, 2));
  const worst = rows.filter((r) => !r.plate).sort((a, b) => a.contrast - b.contrast).slice(0, 5);
  console.log(`\n${results.length - failed}/${results.length} scenes pass · ${rows.length} inks measured · minimum contrast 1.6:1`);
  console.log("Lowest (non-plate) inks:");
  for (const w of worst) console.log(`  ${w.ok ? "ok  " : "FAIL"} ${w.scene} embed ${w.embed} ${w.color}: ${w.contrast}:1 over ${w.area} px`);
  for (const r of rows.filter((x) => !x.ok)) console.log(`  FAIL ${r.scene} embed ${r.embed} ${r.color}: ${r.contrast}:1 over ${r.area} px`);
  console.log(`Renders: ${path.relative(process.cwd(), outDir)}/`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
