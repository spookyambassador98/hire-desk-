import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "src/lib/harvest/sources");
const skip = new Set([
  "types.ts",
  "envBoards.ts",
  "index.ts",
  "htmlBoards.ts",
  "telegram.ts",
]);

for (const f of readdirSync(dir)) {
  if (!f.endsWith(".ts") || skip.has(f)) continue;
  const p = join(dir, f);
  let s = readFileSync(p, "utf8");
  if (!s.includes("await fetch(") && !s.includes("= await fetch(")) {
    console.log("skip-nofetch", f);
    continue;
  }
  if (!s.includes('from "../harvestFetch"')) {
    const lines = s.split("\n");
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ")) lastImport = i;
    }
    lines.splice(
      lastImport + 1,
      0,
      'import { harvestFetch } from "../harvestFetch";',
    );
    s = lines.join("\n");
  }
  s = s.replace(/\bawait fetch\(/g, "await harvestFetch(");
  writeFileSync(p, s);
  console.log("patched", f);
}
