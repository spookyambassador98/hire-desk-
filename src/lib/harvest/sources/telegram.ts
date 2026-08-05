import { harvestFetch } from "../harvestFetch";
import { envBoardList, sleep } from "./envBoards";
import type { JobHit, JobSource } from "./types";
import { inferRegionFromText, textMatchesSegment } from "./types";
import { env, envSourceOn } from "@/lib/env";
import * as cheerio from "cheerio";

/**
 * Public Telegram channel preview (t.me/s/…) — throttle + optional proxy.
 * Whitelist only: TELEGRAM_CHANNELS=channel1,channel2
 */
export const telegramSource: JobSource = {
  id: "telegram",
  label: "Telegram channels",
  tier: "tertiary",
  enabled: () => envSourceOn("SOURCES_TELEGRAM", false),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const channels = envBoardList("TELEGRAM_CHANNELS", "");
    if (!channels.length) {
      await ctx.log("Telegram · skipped (TELEGRAM_CHANNELS empty)");
      return hits;
    }
    await ctx.log(`Telegram · ${channels.length} ch · ${ctx.segment.label}`);

    for (const ch of channels) {
      if (hits.length >= ctx.limit) break;
      const slug = ch.replace(/^@/, "").trim();
      if (!slug) continue;
      try {
        const res = await harvestFetch(
          `https://t.me/s/${encodeURIComponent(slug)}`,
          {
            headers: {
              Accept: "text/html",
            },
            signal: ctx.signal ?? AbortSignal.timeout(16_000),
          },
        );
        if (!res.ok) {
          await ctx.log(`Telegram · @${slug} · HTTP ${res.status}`);
          await sleep(1500);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        $(".tgme_widget_message_text").each((_, el) => {
          if (hits.length >= ctx.limit) return;
          const text = $(el).text().replace(/\s+/g, " ").trim();
          if (text.length < 40) return;
          if (!textMatchesSegment(text, ctx.segment)) return;
          const region = inferRegionFromText(text, ctx.segment.region);
          if (region !== ctx.segment.region) return;
          const urlInPost = text.match(/https?:\/\/[^\s]+/i)?.[0] || null;
          const roleLine =
            text.split(/[.!?\n]/).find((l) => l.length > 10 && l.length < 100) ||
            text.slice(0, 90);
          hits.push({
            sourceId: `telegram:${slug}`,
            company: `@${slug}`,
            role: roleLine.trim(),
            region,
            location: /remote|віддален|удален/i.test(text) ? "Remote" : null,
            remote: /remote|віддален|удален/i.test(text) ? true : null,
            description: text.slice(0, 1200),
            url: urlInPost,
            channel: "other",
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
          });
        });
      } catch (err) {
        await ctx.log(
          `Telegram · @${slug} · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
      await sleep(
        Number(env("TELEGRAM_FETCH_DELAY_MS", "2200")) || 2200,
      );
    }
    await ctx.log(`Telegram · +${hits.length}`);
    return hits;
  },
};
