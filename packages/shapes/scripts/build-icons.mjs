// Regenerates src/icons/*.json from @phosphor-icons/core (MIT, devDependency).
// Usage: npm run icons -w @brusshy/shapes
// The generated JSON is checked in, so the runtime needs no icon package.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(path.dirname(require.resolve("@phosphor-icons/core")), "..");
const { icons } = await import(path.join(pkgDir, "dist/index.mjs"));
const out = path.resolve(here, "../src/icons");

// Trademarks are never offered as raw material for a logo.
const isBrand = (i) => i.categories.includes("brands") || i.figma_category === "brands" || /-logo$/.test(i.name);

const CAT = {
  arrows: "arrows",
  commerce: "commerce",
  communication: "communication",
  design: "design",
  "technology & development": "tech",
  education: "education",
  "math & finance": "finance",
  games: "games",
  "health & wellness": "health",
  "maps & travel": "travel",
  media: "media",
  "office & editing": "office",
  people: "people",
  "security & warnings": "security",
  "system & devices": "devices",
  time: "time",
  "weather & nature": "nature",
};

const readD = (weight, name) => {
  const file = path.join(pkgDir, "assets", weight, `${name}${weight === "regular" ? "" : `-${weight}`}.svg`);
  const svg = fs.readFileSync(file, "utf8");
  const ds = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length || /<(circle|rect|line|polyline|polygon|ellipse)\b/.test(svg)) throw new Error(`Unexpected markup in ${file}`);
  return ds.join("");
};

const catalog = [];
const fill = {};
const bold = {};
for (const i of icons) {
  if (isBrand(i)) continue;
  const tags = [...new Set(i.tags.filter((t) => !t.startsWith("*")).map((t) => t.toLowerCase()))];
  catalog.push([i.name, CAT[i.figma_category] ?? "design", tags.join(",")]);
  fill[i.name] = readD("fill", i.name);
  bold[i.name] = readD("bold", i.name);
}
catalog.sort((a, b) => a[0].localeCompare(b[0]));
fs.writeFileSync(path.join(out, "catalog.json"), JSON.stringify(catalog));
fs.writeFileSync(path.join(out, "fill.json"), JSON.stringify(fill));
fs.writeFileSync(path.join(out, "bold.json"), JSON.stringify(bold));
fs.copyFileSync(path.join(pkgDir, "LICENSE"), path.join(out, "LICENSE-phosphor.txt"));
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(out, "source.json"), JSON.stringify({ name: "Phosphor Icons", package: "@phosphor-icons/core", version, license: "MIT", url: "https://phosphoricons.com", count: catalog.length, weights: ["fill", "bold"], viewBox: 256 }, null, 2) + "\n");
console.log(`${catalog.length} icons (brands excluded) → ${out}`);
