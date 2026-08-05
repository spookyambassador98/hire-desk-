import { env, envSourceOn } from "@/lib/env";
import { sleep } from "./envBoards";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";

function githubHeaders(): HeadersInit {
  const token = env("GITHUB_TOKEN");
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "HireDesk-MaxLive/1.0",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * GitHub Search API — open issues labeled hiring (optional GITHUB_TOKEN).
 */
export const githubSource: JobSource = {
  id: "github",
  label: "GitHub hiring issues",
  tier: "primary",
  enabled: () => envSourceOn("SOURCES_GITHUB", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const kw = ctx.segment.keywords[0] || "product engineer";
    const q = encodeURIComponent(
      `is:issue is:open label:hiring ${kw} remote in:title,body`,
    );
    await ctx.log(`GitHub · hiring issues · ${ctx.segment.label}`);

    try {
      const res = await fetch(
        `https://api.github.com/search/issues?q=${q}&sort=updated&per_page=30`,
        {
          signal: ctx.signal ?? AbortSignal.timeout(18_000),
          headers: githubHeaders(),
        },
      );
      if (res.status === 403 || res.status === 401) {
        await ctx.log(
          `GitHub · HTTP ${res.status} · set GITHUB_TOKEN for higher limits`,
        );
        return hits;
      }
      if (!res.ok) {
        await ctx.log(`GitHub · HTTP ${res.status}`);
        return hits;
      }
      const data = (await res.json()) as {
        items?: Array<{
          title: string;
          html_url: string;
          body?: string | null;
          repository_url?: string;
        }>;
      };
      for (const item of data.items || []) {
        if (hits.length >= ctx.limit) break;
        const body = (item.body || "").replace(/<[^>]+>/g, " ");
        const blob = `${item.title} ${body}`.slice(0, 2000);
        if (!textMatchesSegment(blob, ctx.segment)) continue;
        const region = inferRegionFromText(blob, ctx.segment.region);
        if (region !== ctx.segment.region) continue;
        const repoSlug =
          item.repository_url?.split("/repos/")[1]?.replace("/", " / ") ||
          "GitHub";
        hits.push({
          sourceId: "github:issues",
          company: repoSlug.split(" / ")[0] || "GitHub",
          role: item.title.replace(/^\[.*?\]\s*/i, "").slice(0, 120),
          region,
          location: /remote/i.test(blob) ? "Remote" : null,
          remote: /remote/i.test(blob) ? true : null,
          description: body.slice(0, 1200) || item.title,
          url: item.html_url,
          channel: "other",
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
        });
      }
    } catch (err) {
      await ctx.log(`GitHub · ${err instanceof Error ? err.message : "fail"}`);
    }
    await sleep(200);
    await ctx.log(`GitHub · +${hits.length}`);
    return hits;
  },
};
