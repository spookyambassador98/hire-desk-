import { envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";

/**
 * Arbeitnow public API — EU-heavy remote jobs.
 * https://www.arbeitnow.com/api/job-board-api
 */
export const arbeitnowSource: JobSource = {
  id: "arbeitnow",
  label: "Arbeitnow",
  tier: "primary",
  enabled: () => envSourceOn("SOURCES_ARBEITNOW", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    await ctx.log(`Arbeitnow · ${ctx.segment.label}`);
    try {
      const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
        signal: ctx.signal ?? AbortSignal.timeout(20_000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        await ctx.log(`Arbeitnow · HTTP ${res.status}`);
        return hits;
      }
      const data = (await res.json()) as {
        data?: Array<{
          slug: string;
          company_name: string;
          title: string;
          description: string;
          remote: boolean;
          url: string;
          location: string;
          tags: string[];
        }>;
      };
      for (const j of data.data || []) {
        if (hits.length >= ctx.limit) break;
        const blob = `${j.title} ${(j.tags || []).join(" ")} ${j.description}`.slice(
          0,
          2000,
        );
        if (!textMatchesSegment(blob, ctx.segment)) continue;
        const region = inferRegionFromText(
          `${j.location} ${j.title}`,
          ctx.segment.region,
        );
        if (region !== ctx.segment.region) continue;
        hits.push({
          sourceId: "arbeitnow",
          company: j.company_name,
          role: j.title,
          region,
          location: j.location || (j.remote ? "Remote" : null),
          remote: j.remote,
          description: (j.description || "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 1200),
          url: j.url,
          channel: "other",
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
        });
      }
      await ctx.log(`Arbeitnow · +${hits.length}`);
    } catch (err) {
      await ctx.log(
        `Arbeitnow · fail · ${err instanceof Error ? err.message : "err"}`,
      );
    }
    return hits;
  },
};
