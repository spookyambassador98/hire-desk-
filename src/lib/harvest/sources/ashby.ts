import { env, envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { regionForSegmentHit, textMatchesSegment } from "./types";
import { harvestFetch } from "../harvestFetch";

function ashbyBoards(): string[] {
  return (env("ASHBY_BOARDS") || "openai,anthropic,vercel")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ashby public job board JSON.
 * https://api.ashbyhq.com/posting-api/job-board/{board}
 */
export const ashbySource: JobSource = {
  id: "ashby",
  label: "Ashby boards",
  tier: "secondary",
  enabled: () => envSourceOn("SOURCES_ASHBY", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const boards = ashbyBoards();
    await ctx.log(`Ashby · ${boards.length} boards · ${ctx.segment.label}`);

    for (const board of boards) {
      if (hits.length >= ctx.limit) break;
      try {
        const res = await harvestFetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`,
          {
            signal: ctx.signal ?? AbortSignal.timeout(15_000),
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) {
          await ctx.log(`Ashby · ${board} · HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as {
          jobs?: Array<{
            id: string;
            title: string;
            jobUrl: string;
            location?: string;
            department?: string;
            descriptionPlain?: string;
            descriptionHtml?: string;
          }>;
        };
        for (const j of data.jobs || []) {
          if (hits.length >= ctx.limit) break;
          const loc = j.location || "";
          const desc = j.descriptionPlain || j.descriptionHtml || "";
          const blob = `${j.title} ${j.department || ""} ${desc}`.slice(0, 2000);
          if (!textMatchesSegment(blob, ctx.segment)) continue;
          const region = regionForSegmentHit(loc, ctx.segment);
          if (!region) continue;
          hits.push({
            sourceId: `ashby:${board}`,
            company: board,
            role: j.title,
            region,
            location: loc || null,
            remote: /remote/i.test(loc) ? true : null,
            description: desc.replace(/<[^>]+>/g, " ").slice(0, 1200),
            url: j.jobUrl,
            channel: "ashby",
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
          });
        }
      } catch (err) {
        await ctx.log(
          `Ashby · ${board} · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
    }
    await ctx.log(`Ashby · +${hits.length}`);
    return hits;
  },
};
