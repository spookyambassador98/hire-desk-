import { envSourceOn } from "@/lib/env";
import { envBoardList, sleep } from "./envBoards";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";
import { harvestFetch } from "../harvestFetch";

/**
 * Lever public postings JSON (careers site API).
 * https://api.lever.co/v0/postings/{site}?mode=json
 */
export const leverSource: JobSource = {
  id: "lever",
  label: "Lever boards",
  tier: "secondary",
  enabled: () => envSourceOn("SOURCES_LEVER", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const sites = envBoardList(
      "LEVER_SITES",
      "spotify,shopify,discord,netflix,robinhood,coinbase,rippling,scale",
    );
    await ctx.log(`Lever · ${sites.length} sites · ${ctx.segment.label}`);

    for (const site of sites) {
      if (hits.length >= ctx.limit) break;
      try {
        const res = await harvestFetch(
          `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`,
          {
            signal: ctx.signal ?? AbortSignal.timeout(18_000),
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) {
          await ctx.log(`Lever · ${site} · HTTP ${res.status}`);
          await sleep(80);
          continue;
        }
        const rows = (await res.json()) as Array<{
          id: string;
          text: string;
          hostedUrl: string;
          categories?: { team?: string; location?: string; commitment?: string };
          workplaceType?: string;
          descriptionPlain?: string;
          description?: string;
        }>;
        if (!Array.isArray(rows) || !rows.length) {
          await sleep(60);
          continue;
        }
        for (const j of rows) {
          if (hits.length >= ctx.limit) break;
          const loc =
            j.categories?.location ||
            j.workplaceType ||
            "";
          const desc =
            j.descriptionPlain ||
            (j.description || "").replace(/<[^>]+>/g, " ");
          const blob = `${j.text} ${loc} ${desc}`.slice(0, 2000);
          if (!textMatchesSegment(blob, ctx.segment)) continue;
          const region = inferRegionFromText(
            `${loc} ${j.text} ${desc}`,
            ctx.segment.region,
          );
          if (region !== ctx.segment.region) continue;
          hits.push({
            sourceId: `lever:${site}`,
            company: site,
            role: j.text.trim(),
            region,
            location: loc || null,
            remote: /remote|anywhere|distributed/i.test(`${loc} ${j.workplaceType || ""}`)
              ? true
              : null,
            description: desc.slice(0, 1200),
            url: j.hostedUrl,
            channel: "lever",
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
          });
        }
      } catch (err) {
        await ctx.log(
          `Lever · ${site} · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
      await sleep(100);
    }
    await ctx.log(`Lever · +${hits.length}`);
    return hits;
  },
};
