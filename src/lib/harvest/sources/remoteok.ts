import { envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";

/**
 * RemoteOK public API.
 * https://remoteok.com/api
 */
export const remoteokSource: JobSource = {
  id: "remoteok",
  label: "RemoteOK",
  tier: "primary",
  enabled: () => envSourceOn("SOURCES_REMOTEOK", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    await ctx.log(`RemoteOK · ${ctx.segment.label}`);
    try {
      const res = await fetch("https://remoteok.com/api", {
        signal: ctx.signal ?? AbortSignal.timeout(20_000),
        headers: {
          Accept: "application/json",
          "User-Agent": "HireDesk/1.0 (career ops)",
        },
      });
      if (!res.ok) {
        await ctx.log(`RemoteOK · HTTP ${res.status}`);
        return hits;
      }
      const data = (await res.json()) as Array<{
        id?: string | number;
        company?: string;
        position?: string;
        description?: string;
        url?: string;
        location?: string;
        tags?: string[];
        salary_min?: number;
        salary_max?: number;
      }>;
      for (const j of data) {
        if (!j || !j.position || !j.company) continue;
        if (hits.length >= ctx.limit) break;
        const blob = `${j.position} ${(j.tags || []).join(" ")} ${j.description || ""}`.slice(
          0,
          2000,
        );
        if (!textMatchesSegment(blob, ctx.segment)) continue;
        const region = inferRegionFromText(
          `${j.location || ""} ${j.position}`,
          ctx.segment.region,
        );
        if (region !== ctx.segment.region) continue;
        hits.push({
          sourceId: "remoteok",
          company: j.company,
          role: j.position,
          region,
          location: j.location || "Remote",
          remote: true,
          description: (j.description || "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 1200),
          url: j.url || null,
          channel: "other",
          salaryMin: j.salary_min ?? null,
          salaryMax: j.salary_max ?? null,
          salaryCurrency: "USD",
        });
      }
      await ctx.log(`RemoteOK · +${hits.length}`);
    } catch (err) {
      await ctx.log(
        `RemoteOK · fail · ${err instanceof Error ? err.message : "err"}`,
      );
    }
    return hits;
  },
};
