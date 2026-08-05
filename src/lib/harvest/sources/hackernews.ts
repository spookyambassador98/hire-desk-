import { envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";

const HN_SEARCH =
  "https://hn.algolia.com/api/v1/search?query=Ask%20HN%3A%20Who%20is%20hiring&tags=story&hitsPerPage=3";

let cachedStoryId: number | null = null;
let cachedStoryAt = 0;

async function latestWhoIsHiringId(): Promise<number | null> {
  const now = Date.now();
  if (cachedStoryId && now - cachedStoryAt < 6 * 60 * 60 * 1000) {
    return cachedStoryId;
  }
  const res = await fetch(HN_SEARCH, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    hits?: Array<{ objectID: string; title?: string }>;
  };
  const hit = (data.hits || []).find((h) =>
    /who is hiring/i.test(h.title || ""),
  );
  if (!hit) return null;
  const id = Number(hit.objectID);
  if (!Number.isFinite(id)) return null;
  cachedStoryId = id;
  cachedStoryAt = now;
  return id;
}

function parseHnComment(text: string): {
  company: string;
  role: string;
  url: string | null;
} | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const head = lines[0];
  const urlMatch = text.match(/https?:\/\/[^\s)]+/i);
  const url = urlMatch ? urlMatch[0].replace(/[.,;]+$/, "") : null;

  const pipe = head.split("|").map((s) => s.trim());
  if (pipe.length >= 2) {
    return {
      company: pipe[0].slice(0, 80),
      role: pipe[1].slice(0, 120),
      url,
    };
  }
  const dash = head.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    return { company: dash[1].trim(), role: dash[2].trim(), url };
  }
  if (head.length > 12) {
    return { company: "HN comment", role: head.slice(0, 120), url };
  }
  return null;
}

/**
 * Monthly «Who is hiring?» thread via official HN Algolia API.
 */
export const hackernewsSource: JobSource = {
  id: "hackernews",
  label: "HN Who is hiring",
  tier: "primary",
  enabled: () => envSourceOn("SOURCES_HACKERNEWS", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    if (ctx.segment.region !== "america") {
      await ctx.log("HN · skipped (America segment only)");
      return hits;
    }
    await ctx.log(`HN · Who is hiring · ${ctx.segment.label}`);

    try {
      const storyId = await latestWhoIsHiringId();
      if (!storyId) {
        await ctx.log("HN · no recent Who is hiring thread");
        return hits;
      }
      const res = await fetch(
        `https://hn.algolia.com/api/v1/items/${storyId}`,
        {
          signal: ctx.signal ?? AbortSignal.timeout(20_000),
          headers: { Accept: "application/json" },
        },
      );
      if (!res.ok) {
        await ctx.log(`HN · items · HTTP ${res.status}`);
        return hits;
      }
      const thread = (await res.json()) as {
        children?: Array<{
          author?: string;
          text?: string;
          is_deleted?: boolean;
        }>;
      };
      for (const c of thread.children || []) {
        if (hits.length >= ctx.limit) break;
        if (c.is_deleted || !c.text) continue;
        const plain = c.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (!textMatchesSegment(plain, ctx.segment)) continue;
        const parsed = parseHnComment(plain);
        if (!parsed) continue;
        const region = inferRegionFromText(plain, "america");
        if (region !== "america") continue;
        hits.push({
          sourceId: `hn:${storyId}`,
          company: parsed.company,
          role: parsed.role,
          region: "america",
          location: /remote/i.test(plain) ? "Remote" : null,
          remote: /remote/i.test(plain) ? true : null,
          description: plain.slice(0, 1200),
          url: parsed.url,
          channel: "other",
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
        });
      }
    } catch (err) {
      await ctx.log(`HN · ${err instanceof Error ? err.message : "fail"}`);
    }
    await ctx.log(`HN · +${hits.length}`);
    return hits;
  },
};
