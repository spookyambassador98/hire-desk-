/**
 * Cloudflare Worker — fetch gateway for HIRE DESK (Lead Desk pattern).
 *
 * Setup:
 * 1. Cloudflare → Workers & Pages → Create Worker → paste this file → Deploy
 * 2. Settings → Variables → PROXY_SECRET = same as PROXY_GATEWAY_SECRET in Render / .env.local
 * 3. In Render Environment Group `gethired` + .env.local:
 *      PROXY_URLS=https://YOUR-WORKER.YOUR-ACCOUNT.workers.dev
 *      PROXY_GATEWAY_SECRET=your-secret
 *      PROXY_GATEWAYS=1
 *
 * GET / → hire-desk proxy ok
 * GET /?url=https://example.com + header x-proxy-secret → proxied fetch
 *
 * Note: free workers.dev egress is fine for Remotive/Greenhouse/Lever/HN.
 * Indeed HTML still prefers classic residential PROXY_URLS (user:pass@host).
 */

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/" && !incoming.searchParams.has("url")) {
      return new Response("hire-desk proxy ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    const secret = env.PROXY_SECRET || "";
    if (secret) {
      const got = request.headers.get("x-proxy-secret") || "";
      if (got !== secret) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    const target = incoming.searchParams.get("url");
    if (!target) {
      return new Response("missing ?url=", { status: 400 });
    }

    let dest;
    try {
      dest = new URL(target);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (!/^https?:$/i.test(dest.protocol)) {
      return new Response("only http(s)", { status: 400 });
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("x-forwarded-for");
    headers.delete("x-proxy-secret");
    if (!headers.has("user-agent")) {
      headers.set(
        "user-agent",
        "Mozilla/5.0 (compatible; HireDeskProxy/1.0)",
      );
    }

    const method = request.method || "GET";
    try {
      const res = await fetch(dest.toString(), {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : request.body,
        redirect: "follow",
      });
      const outHeaders = new Headers(res.headers);
      outHeaders.delete("content-encoding");
      outHeaders.delete("transfer-encoding");
      outHeaders.set("x-proxied-by", "hire-desk-cf");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
      });
    } catch (err) {
      return new Response(
        `upstream fail: ${err instanceof Error ? err.message : "error"}`,
        { status: 502 },
      );
    }
  },
};
