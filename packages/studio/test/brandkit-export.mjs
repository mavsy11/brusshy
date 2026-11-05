// Usage: npm run test:brandkit -w @brusshy/studio
// Exports a few logos (SVG, PNG, variants, icons, brand kit) in headless Chrome with the studio's
// own export code, writes everything to test/out-brandkit/<logo>/ and checks the kit: every logo
// file says its background, brand.md lists only files that exist, the PDF has its pages.
// Needs a local Chrome (CHROME_PATH, or the default macOS / Linux install).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "test/out-brandkit");
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
const problems = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page:", e.message));
  page.on("console", (m) => m.type() === "error" && process.stdout.write(`  ${m.text()}\n`));
  await page.goto(`${url}test/brandkit-export.html`);
  await page.waitForFunction(() => document.title === "ready", { timeout: 120_000 });
  const results = await page.evaluate(() => window.runBrandKit());

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const r of results) {
    const dir = path.join(outDir, r.fixture.toLowerCase());
    fs.mkdirSync(path.join(dir, "icons"), { recursive: true });
    for (const f of r.files) fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.data, "base64"));
    const bad = (m) => problems.push(`${r.fixture}: ${m}`);
    for (const e of r.failed) bad(`export failed: ${e}`);
    const names = new Set(r.files.map((f) => f.name));
    const logos = r.files.filter((f) => f.logo);
    for (const f of logos.filter((f) => !f.name.startsWith("icons/") && !/-3d-/.test(f.name)))
      if (!/-(color|black|white)-on-(light|dark)(-\d+)?\.(svg|png)$/.test(f.name)) bad(`logo file without its background in the name: ${f.name}`);
    for (const need of ["-color-on-light.svg", "-color-on-dark.svg", "-black-on-light.svg", "-white-on-dark.svg"])
      if (![...names].some((n) => n.endsWith(need) && !n.includes("-symbol-"))) bad(`missing *${need}`);
    const md = r.files.find((f) => f.name === "brand.md");
    if (!md) bad("no brand.md");
    else {
      const text = Buffer.from(md.data, "base64").toString("utf8");
      for (const m of text.matchAll(/`([^`\s]+\.(?:svg|png|ico))`/g)) if (!names.has(m[1])) bad(`brand.md lists a file that is not exported: ${m[1]}`);
      for (const h of ["## Logo files", "## Clear space", "## Minimum size", "## Colors", "## Don't"]) if (!text.includes(h)) bad(`brand.md has no "${h}"`);
      if (!/x = .*(cap height|height of the symbol)/.test(text)) bad("brand.md clear space is not measured on the mark");
    }
    if (r.savedMd.includes("icons/") || (names.has("icons/favicon.ico") && !r.savedMd.includes("`favicon.ico`"))) bad("brand.md saved into the project does not use the flattened file names");
    const pdf = r.files.find((f) => f.name.endsWith("-brand-kit.pdf"));
    const pages = pdf ? (await PDFDocument.load(Buffer.from(pdf.data, "base64"))).getPageCount() : 0;
    if (pages < 5) bad(`brand kit has ${pages} pages`);
    console.log(`${r.fixture}: ${r.files.length} files · ${logos.length} logo files · PDF ${pages} pages`);
  }
  console.log(problems.length ? `\n${problems.length} problems:\n  ${problems.join("\n  ")}` : "\nAll brand-kit checks pass.");
  console.log(`Files: ${path.relative(process.cwd(), outDir)}/`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(problems.length ? 1 : 0);
