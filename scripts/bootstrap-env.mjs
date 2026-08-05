/**
 * Build .env.local from .env.example + secrets file + optional lead-desk proxy vars.
 * Run: node scripts/bootstrap-env.mjs
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");
const outPath = join(root, ".env.local");
const secretsPath = join(root, "secrets", "hire-deck-firebase-adminsdk.json");
const leadEnv = join(root, "..", "lead-desk", ".env.local");

function parseEnvFile(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    map.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return map;
}

const example = readFileSync(examplePath, "utf8");
const lines = example.split(/\r?\n/);
const out = [];
let accessSet = false;

for (const line of lines) {
  if (line.startsWith("HIRE_DESK_ACCESS_CODE=")) {
    const code = `HIRE-${randomBytes(4).toString("hex").toUpperCase()}`;
    out.push(`HIRE_DESK_ACCESS_CODE=${code}`);
    accessSet = true;
    continue;
  }
  if (line.startsWith("# HIRE_STORAGE=")) {
    out.push("HIRE_STORAGE=firebase");
    continue;
  }
  if (line.startsWith("# FIREBASE_SERVICE_ACCOUNT_PATH=")) {
    if (existsSync(secretsPath)) {
      out.push("FIREBASE_SERVICE_ACCOUNT_PATH=secrets/hire-deck-firebase-adminsdk.json");
    }
    continue;
  }
  out.push(line);
}

if (!accessSet) {
  out.unshift(
    `HIRE_DESK_ACCESS_CODE=HIRE-${randomBytes(4).toString("hex").toUpperCase()}`,
  );
}

if (existsSync(leadEnv)) {
  const lead = parseEnvFile(readFileSync(leadEnv, "utf8"));
  const proxyKeys = [
    "PROXY_URLS",
    "PROXY_GATEWAYS",
    "PROXY_GATEWAY_SECRET",
    "CF_PROXY_SECRET",
    "PROXY_ALLOW_CF_WORKER",
  ];
  out.push("");
  out.push("# --- copied from lead-desk .env.local (proxy) ---");
  for (const k of proxyKeys) {
    const v = lead.get(k);
    if (v) out.push(`${k}=${v}`);
  }
}

out.push("");
out.push("HARVEST_INTERNAL_BASE=http://127.0.0.1:3011");

writeFileSync(outPath, `${out.join("\n")}\n`, "utf8");
console.log(`Wrote ${outPath}`);

if (existsSync(secretsPath)) {
  const sa = JSON.parse(readFileSync(secretsPath, "utf8"));
  const cronSecret = randomBytes(24).toString("hex");
  const renderPath = join(root, ".env.render.keys");
  const accessLine = out.find((l) => l.startsWith("HIRE_DESK_ACCESS_CODE=")) || "";
  const renderLines = [
    "# Paste into Render → hire-desk Web Service → Environment",
    "# File is gitignored — do not commit",
    "",
    "HIRE_STORAGE=firebase",
    accessLine,
    `HARVEST_CRON_SECRET=${cronSecret}`,
    "HARVEST_INTERNAL_BASE=https://hire-desk.onrender.com",
    "",
    `FIREBASE_PROJECT_ID=${sa.project_id}`,
    `FIREBASE_CLIENT_EMAIL=${sa.client_email}`,
    `FIREBASE_PRIVATE_KEY=${JSON.stringify(sa.private_key)}`,
    "",
    "# Cron job hire-desk-harvest-cron also needs:",
    `RENDER_CRON_URL=https://hire-desk.onrender.com/api/harvest/cron`,
    `HARVEST_CRON_SECRET=${cronSecret}`,
    "",
    "# Optional: copy PROXY_* from .env.local if you use Indeed/Telegram",
  ];
  writeFileSync(renderPath, renderLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${renderPath} (for Render copy-paste)`);

  const localCron = out.findIndex((l) => l.startsWith("HARVEST_CRON_SECRET="));
  if (localCron >= 0) out[localCron] = `HARVEST_CRON_SECRET=${cronSecret}`;
  else {
    out.push(`HARVEST_CRON_SECRET=${cronSecret}`);
  }
  writeFileSync(outPath, `${out.join("\n")}\n`, "utf8");
}
