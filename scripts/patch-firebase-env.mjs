import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sa = JSON.parse(
  readFileSync(join(root, "secrets/hire-deck-firebase-adminsdk.json"), "utf8"),
);
const envPath = join(root, ".env.local");
const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
const out = [];
let i = 0;
while (i < lines.length) {
  if (lines[i].startsWith("# FIREBASE_PROJECT_ID=")) {
    out.push(`FIREBASE_PROJECT_ID=${sa.project_id}`);
    out.push(`FIREBASE_CLIENT_EMAIL=${sa.client_email}`);
    out.push(`FIREBASE_PRIVATE_KEY=${JSON.stringify(sa.private_key)}`);
    while (i < lines.length && !lines[i].startsWith("# MAX LIVE")) {
      i += 1;
    }
    continue;
  }
  out.push(lines[i]);
  i += 1;
}
writeFileSync(envPath, `${out.join("\n")}\n`, "utf8");
console.log("Patched .env.local Firebase inline vars");
