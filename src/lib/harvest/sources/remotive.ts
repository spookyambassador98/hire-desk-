import { envSourceOn } from "@/lib/env";
import { harvestFetch } from "../harvestFetch";
import type { JobHit, JobSource } from "./types";
import { regionForRemoteSegmentHit, textMatchesSegment } from "./types";

/**
 * Remotive public API — stable primary source.
 * https://remotive.com/api/remote-jobs
 */
export const remotiveSource: JobSource = {
  id: "remotive",
  label: "Remotive",
  tier: "primary",
  enabled: () => envSourceOn("SOURCES_REMOTIVE", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    await ctx.log(`Remotive · ${ctx.segment.label}`);
    try {
      const res = await harvestFetch("https://remotive.com/api/remote-jobs", {
        signal: ctx.signal ?? AbortSignal.timeout(20_000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        await ctx.log(`Remotive · HTTP ${res.status}`);
        return hits;
      }
      const data = (await res.json()) as {
        jobs?: Array<{
          id: number;
          url: string;
          title: string;
          company_name: string;
          category: string;
          job_type: string;
          candidate_required_location: string;
          description: string;
          salary: string;
          publication_date?: string;
        }>;
      };
      for (const j of data.jobs || []) {
        if (hits.length >= ctx.limit) break;
        const blob = `${j.title} ${j.category} ${j.description}`.slice(0, 2000);
        if (!textMatchesSegment(blob, ctx.segment)) continue;
        const region = regionForRemoteSegmentHit(
          j.candidate_required_location || "Remote",
          ctx.segment,
        );
        if (!region) continue;
        hits.push({
          sourceId: "remotive",
          company: j.company_name,
          role: j.title,
          region,
          location: j.candidate_required_location || "Remote",
          remote: true,
          description: (j.description || "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 1200),
          url: j.url,
          channel: "other",
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryText: j.salary || null,
          postedAt: j.publication_date || null,
        });
      }
      await ctx.log(`Remotive · +${hits.length}`);
    } catch (err) {
      await ctx.log(
        `Remotive · fail · ${err instanceof Error ? err.message : "err"}`,
      );
    }
    return hits;
  },
};
