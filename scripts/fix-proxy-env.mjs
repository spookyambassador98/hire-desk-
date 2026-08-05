import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const NL = "\n";
const secret = existsSync("secrets/proxy-secret.txt")
  ? readFileSync("secrets/proxy-secret.txt", "utf8").replace(/\\n/g, "").trim()
  : randomBytes(24).toString("hex");

writeFileSync("secrets/proxy-secret.txt", secret + NL);

let local = readFileSync(".env.local", "utf8").replace(/\\n/g, NL);

const block = [
  "",
  "# --- proxy (Lead Desk pattern) ---",
  "PROXY_URLS=",
  `PROXY_GATEWAY_SECRET=${secret}`,
  `CF_PROXY_SECRET=${secret}`,
  "PROXY_GATEWAYS=1",
  "PROXY_ALLOW_CF_WORKER=1",
  "PROXY_BLOCK_CF_WORKER=0",
  "HIRE_RUN_TARGET_NO_PROXY=35",
  "HIRE_DIRECT_GAP_MS=450",
  "HIRE_PROXY_GAP_MS=120",
  "HIRE_FETCH_RETRIES=3",
  "",
].join(NL);

// strip previous mangled / duplicate proxy keys
local = local
  .split(NL)
  .filter((line) => {
    const k = line.replace(/^#\s*/, "").split("=")[0];
    return ![
      "PROXY_URLS",
      "PROXY_GATEWAY_SECRET",
      "CF_PROXY_SECRET",
      "PROXY_GATEWAYS",
      "PROXY_ALLOW_CF_WORKER",
      "PROXY_BLOCK_CF_WORKER",
      "HIRE_RUN_TARGET_NO_PROXY",
      "HIRE_DIRECT_GAP_MS",
      "HIRE_PROXY_GAP_MS",
      "HIRE_FETCH_RETRIES",
    ].includes(k);
  })
  .join(NL)
  .replace(/\n{3,}/g, "\n\n")
  .trimEnd();

writeFileSync(".env.local", local + NL + block);

const pastePath = "secrets/render-paste.env";
let paste = existsSync(pastePath)
  ? readFileSync(pastePath, "utf8").replace(/\\n/g, NL)
  : "";
paste = paste
  .split(NL)
  .filter((line) => {
    const k = line.split("=")[0];
    return ![
      "PROXY_URLS",
      "PROXY_GATEWAY_SECRET",
      "CF_PROXY_SECRET",
      "PROXY_GATEWAYS",
      "PROXY_ALLOW_CF_WORKER",
      "PROXY_BLOCK_CF_WORKER",
      "HIRE_RUN_TARGET_NO_PROXY",
      "HIRE_DIRECT_GAP_MS",
      "HIRE_PROXY_GAP_MS",
      "HIRE_FETCH_RETRIES",
    ].includes(k);
  })
  .join(NL)
  .trimEnd();

const pasteExtra = [
  "PROXY_URLS=",
  `PROXY_GATEWAY_SECRET=${secret}`,
  `CF_PROXY_SECRET=${secret}`,
  "PROXY_GATEWAYS=1",
  "PROXY_ALLOW_CF_WORKER=1",
  "PROXY_BLOCK_CF_WORKER=0",
  "HIRE_RUN_TARGET_NO_PROXY=35",
  "HIRE_DIRECT_GAP_MS=450",
  "HIRE_PROXY_GAP_MS=120",
].join(NL);

writeFileSync(pastePath, paste + NL + pasteExtra + NL);
console.log("fixed env proxy block, secret len", secret.length);
