import fs from "node:fs";
import path from "node:path";

// Legal notices travel with the bundle: the code they cover is inlined into dist.
fs.mkdirSync("dist", { recursive: true });
fs.copyFileSync("../../THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
fs.copyFileSync("../shapes/src/icons/LICENSE-phosphor.txt", "dist/LICENSE-phosphor.txt");

const from = path.resolve("../studio/dist");
const to = path.resolve("dist/studio");
if (!fs.existsSync(from)) {
  console.warn("[brusshy] studio build not found; run the studio build first");
  process.exit(0);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`[brusshy] copied studio → ${path.relative(process.cwd(), to)}`);
