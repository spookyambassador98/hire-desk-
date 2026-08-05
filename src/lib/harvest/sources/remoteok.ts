import { envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";
import { harvestFetch } from "../harvestFetch";

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
      const res = await harvestFetch("https://remoteok.com/api", {
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
        date?: number | string;
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
        let postedAt: string | null = null;
        if (typeof j.date === "number" && j.date > 0) {
          postedAt = new Date(j.date * 1000).toISOString();
        } else if (typeof j.date === "string" && j.date) {
          const t = Date.parse(j.date);
          if (!Number.isNaN(t)) postedAt = new Date(t).toISOString();
        }
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
          postedAt,
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
