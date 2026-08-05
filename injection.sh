#!/bin/bash
set -e
echo "=== APEX // HIRE DESK HARVEST ENGINE UPGRADE ==="
node -e "$(cat <<'NODE_EOF'
const fs = require('fs');
const path = require('path');

const root = process.cwd();

// ========== 1. Создаём модуль userAgents.ts ==========
const userAgentsPath = path.join(root, 'src/lib/harvest/userAgents.ts');
const userAgentsContent = `export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0'
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
`;
fs.writeFileSync(userAgentsPath, userAgentsContent, 'utf8');
console.log('[+] Created userAgents.ts');

// ========== 2. Обновляем proxyPool.ts ==========
const proxyPoolPath = path.join(root, 'src/lib/harvest/proxyPool.ts');
let proxyPoolContent = fs.readFileSync(proxyPoolPath, 'utf8');

if (!proxyPoolContent.includes('import { randomUserAgent }')) {
  proxyPoolContent = proxyPoolContent.replace(
    /import { env } from .\/..\/env.;/,
    `import { env } from "@/lib/env";\nimport { randomUserAgent } from "./userAgents";`
  );
}

if (!proxyPoolContent.includes('validateProxy')) {
  proxyPoolContent = proxyPoolContent.replace(
    /export function proxyPoolSize\(\) {/,
    `export async function validateProxy(proxyUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('http://httpbin.org/ip', {
      signal: controller.signal,
      headers: { 'User-Agent': randomUserAgent() },
      // @ts-ignore
      dispatcher: new (await import('undici')).ProxyAgent(proxyUrl)
    });
    clearTimeout(timeout);
    return res.ok;
  } catch { return false; }
}

export function proxyPoolSize() {`
  );
}

const newDispatcher = `
async function getProxyDispatcher(): Promise<unknown | undefined> {
  await ensurePool();
  if (!agents.length) return undefined;
  const alive: typeof agents = [];
  for (let i = 0; i < agents.length; i++) {
    const url = classicUrls[i];
    if (await validateProxy(url)) alive.push(agents[i]);
    else console.warn(\`[proxy] removing dead proxy: \${url}\`);
  }
  if (alive.length === 0) return undefined;
  requestCount += 1;
  if (requestCount % ROTATE_EVERY === 0) {
    classicCursor = (classicCursor + 1) % alive.length;
  }
  return alive[classicCursor % alive.length];
}
`;
proxyPoolContent = proxyPoolContent.replace(
  /async function getProxyDispatcher\(\): Promise<unknown \| undefined> \{[\s\S]*?return agents\[classicCursor % agents\.length\];\n\}/,
  newDispatcher
);

fs.writeFileSync(proxyPoolPath, proxyPoolContent, 'utf8');
console.log('[+] Updated proxyPool.ts');

// ========== 3. Создаём модуль retry.ts ==========
const retryPath = path.join(root, 'src/lib/harvest/retry.ts');
const retryContent = `import { randomUserAgent } from './userAgents';
import { proxiedFetch } from './proxyPool';

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 3,
  delay = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const headers = new Headers(init.headers || {});
      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', randomUserAgent());
      }
      if (!headers.has('Accept')) headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'en-US,en;q=0.9');
      if (!headers.has('Referer')) headers.set('Referer', 'https://www.google.com/');
      
      const res = await proxiedFetch(url, { ...init, headers });
      if (res.status >= 500 || res.status === 429 || res.status === 403) {
        throw new Error(\`HTTP \${res.status}\`);
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw lastError || new Error('fetchWithRetry failed');
}
`;
fs.writeFileSync(retryPath, retryContent, 'utf8');
console.log('[+] Created retry.ts');

// ========== 4. Обновляем htmlBoards.ts ==========
const htmlBoardsPath = path.join(root, 'src/lib/harvest/sources/htmlBoards.ts');
let htmlContent = fs.readFileSync(htmlBoardsPath, 'utf8');

if (!htmlContent.includes('import { fetchWithRetry }')) {
  htmlContent = htmlContent.replace(
    /import { proxiedFetch, proxyPoolSize } from ..\/proxyPool.;/,
    `import { proxiedFetch, proxyPoolSize } from "../proxyPool";\nimport { fetchWithRetry } from "../retry";\nimport { randomUserAgent } from "../userAgents";`
  );
}

htmlContent = htmlContent.replace(
  /const res = await proxiedFetch\(url, \{/g,
  'await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));\n      const res = await fetchWithRetry(url, {'
);

htmlContent = htmlContent.replace(
  /const res = await proxiedFetch\(indeed, \{/,
  'await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));\n      const res = await fetchWithRetry(indeed, {'
);

htmlContent = htmlContent.replace(
  /if \(proxyPoolSize\(\) > 0 && hits.length < ctx.limit\) \{/,
  `if (proxyPoolSize() > 0 && hits.length < ctx.limit) {\n      await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000));`
);

fs.writeFileSync(htmlBoardsPath, htmlContent, 'utf8');
console.log('[+] Updated htmlBoards.ts');

// ========== 5. Добавляем задержки в runLive.ts ==========
const runLivePath = path.join(root, 'src/lib/harvest/runLive.ts');
let runLiveContent = fs.readFileSync(runLivePath, 'utf8');

if (!runLiveContent.includes('function sleep')) {
  runLiveContent = runLiveContent.replace(
    /import \{ getStopAbortSignal, isHarvestStopRequested \} from ".\/control";/,
    `import { getStopAbortSignal, isHarvestStopRequested } from "./control";\n\nfunction sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }`
  );
}

runLiveContent = runLiveContent.replace(
  /for \(const segment of segments\) \{/,
  `for (const segment of segments) {\n    if (isHarvestStopRequested()) break;\n    await sleep(2000 + Math.random() * 3000);`
);

fs.writeFileSync(runLivePath, runLiveContent, 'utf8');
console.log('[+] Updated runLive.ts');

// ========== 6. Добавляем кеширование для публичных API (исправленная версия) ==========
const cacheDir = path.join(root, 'data/cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

function addCacheToSource(sourceFile, sourceId) {
  const filePath = path.join(root, 'src/lib/harvest/sources', sourceFile);
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (content.includes('cacheKey')) return;

  // Добавляем импорты fs и path, если их нет
  if (!content.includes('import { promises as fs }')) {
    content = content.replace(
      /import \{ envSourceOn \} from .\/..\/env.;/,
      `import { envSourceOn } from "@/lib/env";\nimport { promises as fs } from "node:fs";\nimport path from "node:path";`
    );
  }

  // Вставляем код кеширования перед основным fetch, используя конкатенацию строк
  const cacheInsert = `
  const cacheFile = path.join(process.cwd(), 'data/cache', '${sourceId}_' + ctx.segment.id + '.json');
  try {
    const cached = await fs.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(cached);
    if (parsed.timestamp && Date.now() - parsed.timestamp < 3600000) {
      await ctx.log(\`${sourceId} · cache hit\`);
      return parsed.hits;
    }
  } catch { /* cache miss */ }
`;
  const logLine = `await ctx.log(\`${sourceId} · ${ctx.segment.label}\`);`;
  content = content.replace(logLine, logLine + cacheInsert);

  // Вставляем запись кеша перед return hits;
  const writeCache = `
  try {
    await fs.mkdir(path.join(process.cwd(), 'data/cache'), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify({ timestamp: Date.now(), hits }), 'utf8');
  } catch { /* ignore */ }
`;
  content = content.replace(/\n  return hits;/, writeCache + '\n  return hits;');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[+] Added cache to ${sourceFile}`);
}

addCacheToSource('remotive.ts', 'remotive');
addCacheToSource('arbeitnow.ts', 'arbeitnow');
addCacheToSource('remoteok.ts', 'remoteok');

// ========== 7. Обновляем .env.example ==========
const envExample = path.join(root, '.env.example');
let envContent = fs.readFileSync(envExample, 'utf8');
if (!envContent.includes('HARVEST_REQUEST_DELAY_MS')) {
  envContent += `

# Harvest tuning
HARVEST_REQUEST_DELAY_MS=2000
HARVEST_RETRY_COUNT=3
HARVEST_RETRY_BACKOFF_MS=1000
HARVEST_SEGMENT_DELAY_MS=2000
`;
  fs.writeFileSync(envExample, envContent, 'utf8');
  console.log('[+] Updated .env.example');
}

console.log('\n✅ All improvements applied.');
console.log('⚠️  Please check your .env and add PROXY_URLS if needed.');
console.log('⚠️  For Indeed we recommend using Puppeteer for production (not included).');
NODE_EOF
)"
echo "=== Upgrade complete ==="
