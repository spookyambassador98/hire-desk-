import { envSourceOn } from "@/lib/env";
import { envBoardList, sleep } from "./envBoards";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";
import { harvestFetch } from "../harvestFetch";

type WorkableWidget = {
  name?: string;
  jobs?: Array<{
    title: string;
    shortlink: string;
    location?: { country?: string; city?: string; telecommuting?: boolean };
    description?: string;
  }>;
};

/**
 * Workable public widget API (account slug from apply.workable.com/{slug}).
 */
export const workableSource: JobSource = {
  id: "workable",
  label: "Workable",
  tier: "secondary",
  enabled: () => envSourceOn("SOURCES_WORKABLE", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const accounts = envBoardList("WORKABLE_ACCOUNTS", "");
    if (!accounts.length) {
      await ctx.log("Workable · skipped (set WORKABLE_ACCOUNTS)");
      return hits;
    }
    await ctx.log(`Workable · ${accounts.length} accounts · ${ctx.segment.label}`);

    for (const account of accounts) {
      if (hits.length >= ctx.limit) break;
      try {
        const res = await harvestFetch(
          `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
          {
            signal: ctx.signal ?? AbortSignal.timeout(18_000),
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) {
          await ctx.log(`Workable · ${account} · HTTP ${res.status}`);
          await sleep(100);
          continue;
        }
        const data = (await res.json()) as WorkableWidget;
        const company = data.name || account;
        for (const j of data.jobs || []) {
          if (hits.length >= ctx.limit) break;
          const loc = [j.location?.city, j.location?.country]
            .filter(Boolean)
            .join(", ");
          const desc = (j.description || "").replace(/<[^>]+>/g, " ");
          const blob = `${j.title} ${loc} ${desc}`.slice(0, 2000);
          if (!textMatchesSegment(blob, ctx.segment)) continue;
          const region = inferRegionFromText(
            `${loc} ${j.title} ${desc}`,
            ctx.segment.region,
          );
          if (region !== ctx.segment.region) continue;
          const url = j.shortlink.startsWith("http")
            ? j.shortlink
            : `https://apply.workable.com/j/${j.shortlink}`;
          hits.push({
            sourceId: `workable:${account}`,
            company,
            role: j.title.trim(),
            region,
            location: loc || null,
            remote: j.location?.telecommuting ? true : /remote/i.test(loc) ? true : null,
            description: desc.slice(0, 1200),
            url,
            channel: "careers",
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
          });
        }
      } catch (err) {
        await ctx.log(
          `Workable · ${account} · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
      await sleep(120);
    }
    await ctx.log(`Workable · +${hits.length}`);
    return hits;
  },
};
