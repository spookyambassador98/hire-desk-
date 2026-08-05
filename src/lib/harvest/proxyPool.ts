/**
 * Proxy pool (Lead Desk parity):
 * 1) Classic HTTP proxies via Undici ProxyAgent
 * 2) Cloudflare Worker / fetch gateways
 */

import { env } from "@/lib/env";

let classicUrls: string[] = [];
let gatewayUrls: string[] = [];
let agents: unknown[] = [];
let requestCount = 0;
let classicCursor = 0;
let gatewayCursor = 0;
const ROTATE_EVERY = 18;

function loadRawUrls(): string[] {
  const raw =
    env("PROXY_URLS") || env("HTTPS_PROXY") || env("HTTP_PROXY") || "";
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isGatewayUrl(uri: string): boolean {
  if (env("PROXY_GATEWAYS") === "1" && /^https?:\/\//i.test(uri)) {
    return !/^https?:\/\/[^/@]+@/i.test(uri);
  }
  try {
    const u = new URL(uri);
    return (
      u.protocol === "https:" &&
      (u.hostname.endsWith(".workers.dev") ||
        u.hostname.endsWith(".workers.cloudflare.com") ||
        u.searchParams.has("gateway") ||
        /\/proxy\/?$/i.test(u.pathname))
    );
  } catch {
    return false;
  }
}

function isBlockedFreeCfWorker(uri: string): boolean {
  if (env("PROXY_ALLOW_CF_WORKER") === "1") return false;
  try {
    const u = new URL(uri);
    return (
      u.hostname.endsWith(".workers.dev") ||
      u.hostname.endsWith(".workers.cloudflare.com")
    );
  } catch {
    return false;
  }
}

function splitUrls(all: string[]) {
  const classic: string[] = [];
  const gateways: string[] = [];
  for (const u of all) {
    if (isBlockedFreeCfWorker(u)) {
      console.warn(
        "[proxy] skip free CF worker (often blocked by targets) · PROXY_ALLOW_CF_WORKER=1 to force",
        u,
      );
      continue;
    }
    if (isGatewayUrl(u)) gateways.push(u.replace(/\/$/, ""));
    else classic.push(u);
  }
  return { classic, gateways };
}

async function ensurePool() {
  const { classic, gateways } = splitUrls(loadRawUrls());
  const sameClassic =
    classic.length === classicUrls.length &&
    classic.every((u, i) => u === classicUrls[i]);
  const sameGw =
    gateways.length === gatewayUrls.length &&
    gateways.every((u, i) => u === gatewayUrls[i]);

  if (
    sameClassic &&
    sameGw &&
    (agents.length === classic.length || !classic.length)
  ) {
    gatewayUrls = gateways;
    return;
  }

  for (const a of agents) {
    try {
      (a as { close?: () => void }).close?.();
    } catch {
      /* ignore */
    }
  }

  classicUrls = classic;
  gatewayUrls = gateways;
  agents = [];
  if (classicUrls.length) {
    const undici = await import("undici");
    agents = classicUrls.map((uri) => new undici.ProxyAgent(uri));
  }
  classicCursor = 0;
  gatewayCursor = 0;
  requestCount = 0;
}

export function proxyPoolSize() {
  const { classic, gateways } = splitUrls(loadRawUrls());
  return classic.length + gateways.length;
}

export async function getProxyDispatcher(): Promise<unknown | undefined> {
  await ensurePool();
  if (!agents.length) return undefined;
  requestCount += 1;
  if (requestCount % ROTATE_EVERY === 0) {
    classicCursor = (classicCursor + 1) % agents.length;
  }
  return agents[classicCursor % agents.length];
}

function nextGateway(): string | undefined {
  if (!gatewayUrls.length) return undefined;
  requestCount += 1;
  if (requestCount % ROTATE_EVERY === 0 && gatewayUrls.length > 1) {
    gatewayCursor = (gatewayCursor + 1) % gatewayUrls.length;
  }
  return gatewayUrls[gatewayCursor % gatewayUrls.length];
}

async function fetchViaGateway(
  gatewayBase: string,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const target = typeof input === "string" ? input : input.toString();
  const secret = env("PROXY_GATEWAY_SECRET") || env("CF_PROXY_SECRET");
  const headers = new Headers(init.headers || {});
  headers.delete("host");
  if (secret) headers.set("x-proxy-secret", secret);

  const sep = gatewayBase.includes("?") ? "&" : "?";
  const gatewayUrl = `${gatewayBase}${sep}url=${encodeURIComponent(target)}`;

  return fetch(gatewayUrl, {
    method: init.method || "GET",
    headers,
    body: init.body,
    signal: init.signal,
    redirect: init.redirect ?? "follow",
  });
}

export async function proxiedFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  await ensurePool();

  const gateway = nextGateway();
  if (gateway) {
    try {
      return await fetchViaGateway(gateway, input, init);
    } catch (err) {
      console.warn("[proxy] CF gateway failed, trying classic/direct", err);
    }
  }

  const dispatcher = await getProxyDispatcher();
  if (!dispatcher) {
    return fetch(input, init);
  }

  const undici = await import("undici");
  return undici.fetch(input, {
    ...init,
    // @ts-expect-error undici dispatcher
    dispatcher,
  }) as unknown as Response;
}
