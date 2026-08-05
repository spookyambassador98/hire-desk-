/**
 * Single egress for MAX LIVE sources.
 * Uses Lead Desk–style proxy pool when PROXY_URLS is set; else direct with backoff.
 */
import { envNum } from "@/lib/env";
import { proxiedFetch, proxyPoolSize } from "./proxyPool";
import { randomUserAgent } from "./userAgents";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gap between outbound requests — wider when no proxy. */
export function harvestGapMs(): number {
  if (proxyPoolSize() > 0) return envNum("HIRE_PROXY_GAP_MS", 120);
  return envNum("HIRE_DIRECT_GAP_MS", 450);
}

export async function harvestFetch(
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("User-Agent")) headers.set("User-Agent", randomUserAgent());
  if (!headers.has("Accept")) headers.set("Accept", "application/json, text/plain, */*");
  if (!headers.has("Accept-Language")) {
    headers.set("Accept-Language", "en-US,en;q=0.9");
  }

  const retries = envNum("HIRE_FETCH_RETRIES", 3);
  let lastErr: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0 || harvestGapMs() > 0) {
        await sleep(i === 0 ? harvestGapMs() : harvestGapMs() * (i + 1));
      }
      const res = await proxiedFetch(url, { ...init, headers });
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error("harvestFetch failed");
}

export function proxyModeLabel(): string {
  const n = proxyPoolSize();
  if (!n) return "OFF · direct (throttle on)";
  return `ON (${n})`;
}

export function safeRunTarget(): number {
  const configured = envNum("HIRE_RUN_TARGET", 80);
  if (proxyPoolSize() > 0) return configured;
  // Without proxy, cap aggressive runs to protect residential / Render IP
  const soft = envNum("HIRE_RUN_TARGET_NO_PROXY", 35);
  return Math.min(configured, soft);
}
