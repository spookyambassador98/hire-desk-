import { env, envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { textMatchesSegment } from "./types";
import { harvestFetch } from "../harvestFetch";

function boardTokens(): string[] {
  return (env("GREENHOUSE_BOARDS") || "stripe,notion,figma,vercel,linear")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Greenhouse public boards API.
 * https://boards-api.greenhouse.io/v1/boards/{token}/jobs
 */
export const greenhouseSource: JobSource = {
  id: "greenhouse",
  label: "Greenhouse boards",
  tier: "secondary",
  enabled: () => envSourceOn("SOURCES_GREENHOUSE", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const boards = boardTokens();
    await ctx.log(`Greenhouse · ${boards.length} boards · ${ctx.segment.label}`);

    for (const token of boards) {
      if (hits.length >= ctx.limit) break;
      try {
        const res = await harvestFetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
          {
            signal: ctx.signal ?? AbortSignal.timeout(15_000),
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) {
          await ctx.log(`Greenhouse · ${token} · HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as {
          jobs?: Array<{
            id: number;
            title: string;
            absolute_url: string;
            location?: { name?: string };
            content?: string;
            updated_at?: string;
            first_published?: string;
          }>;
        };
        for (const j of data.jobs || []) {
          if (hits.length >= ctx.limit) break;
          const blob = `${j.title} ${j.content || ""}`.slice(0, 2000);
          if (!textMatchesSegment(blob, ctx.segment)) continue;
          hits.push({
            sourceId: `greenhouse:${token}`,
            company: token,
            role: j.title,
            region: ctx.segment.region,
            location: j.location?.name || null,
            remote: /remote/i.test(j.location?.name || "") ? true : null,
            description: (j.content || "")
              .replace(/<[^>]+>/g, " ")
              .slice(0, 1200),
            url: j.absolute_url,
            channel: "greenhouse",
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
            postedAt: j.first_published || j.updated_at || null,
          });
        }
      } catch (err) {
        await ctx.log(
          `Greenhouse · ${token} · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
    }
    await ctx.log(`Greenhouse · +${hits.length}`);
    return hits;
  },
};
