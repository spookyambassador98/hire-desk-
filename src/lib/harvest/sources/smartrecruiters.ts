import { envSourceOn } from "@/lib/env";
import { envBoardList, sleep } from "./envBoards";
import type { JobHit, JobSource } from "./types";
import { regionForRemoteSegmentHit, textMatchesSegment } from "./types";
import { harvestFetch } from "../harvestFetch";

/**
 * SmartRecruiters public postings API.
 * https://api.smartrecruiters.com/v1/companies/{slug}/postings
 */
export const smartrecruitersSource: JobSource = {
  id: "smartrecruiters",
  label: "SmartRecruiters",
  tier: "secondary",
  enabled: () => envSourceOn("SOURCES_SMARTRECRUITERS", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const companies = envBoardList(
      "SMARTRECRUITERS_COMPANIES",
      "Visa,Wise,Revolut,Spotify,Square",
    );
    await ctx.log(
      `SmartRecruiters · ${companies.length} cos · ${ctx.segment.label}`,
    );

    for (const company of companies) {
      if (hits.length >= ctx.limit) break;
      try {
        let offset = 0;
        const pageSize = 40;
        while (hits.length < ctx.limit && offset < 120) {
          const res = await harvestFetch(
            `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?offset=${offset}&limit=${pageSize}`,
            {
              signal: ctx.signal ?? AbortSignal.timeout(18_000),
              headers: { Accept: "application/json" },
            },
          );
          if (!res.ok) {
            await ctx.log(`SmartRecruiters · ${company} · HTTP ${res.status}`);
            break;
          }
          const data = (await res.json()) as {
            content?: Array<{
              id: string;
              name: string;
              location?: {
                city?: string;
                region?: string;
                country?: string;
                remote?: boolean;
                hybrid?: boolean;
              };
              company?: { name?: string };
            }>;
            totalFound?: number;
          };
          const batch = data.content || [];
          if (!batch.length) break;

          for (const j of batch) {
            if (hits.length >= ctx.limit) break;
            const loc = [
              j.location?.city,
              j.location?.region,
              j.location?.country,
            ]
              .filter(Boolean)
              .join(", ");
            const blob = `${j.name} ${loc}`.slice(0, 2000);
            if (!textMatchesSegment(blob, ctx.segment)) continue;
            const region = regionForRemoteSegmentHit(
              loc || (j.location?.remote ? "Remote" : ""),
              ctx.segment,
            );
            if (!region) continue;
            hits.push({
              sourceId: `smartrecruiters:${company}`,
              company: j.company?.name || company,
              role: j.name.trim(),
              region,
              location: loc || null,
              remote: j.location?.remote
                ? true
                : /remote/i.test(loc)
                  ? true
                  : null,
              description: `SmartRecruiters · ${company} · ${loc || "see posting"}`,
              url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${j.id}`,
              channel: "careers",
              salaryMin: null,
              salaryMax: null,
              salaryCurrency: null,
            });
          }
          offset += batch.length;
          if (offset >= (data.totalFound ?? batch.length)) break;
          await sleep(80);
        }
      } catch (err) {
        await ctx.log(
          `SmartRecruiters · ${company} · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
      await sleep(100);
    }
    await ctx.log(`SmartRecruiters · +${hits.length}`);
    return hits;
  },
};
