import * as cheerio from "cheerio";
import { env, envSourceOn } from "@/lib/env";
import { harvestFetch } from "../harvestFetch";
import { proxyPoolSize } from "../proxyPool";
import type { JobHit, JobSource } from "./types";
import { textMatchesSegment } from "./types";

/**
 * Tertiary HTML sources — careers pages + Indeed (Indeed needs proxy).
 */
export const htmlBoardsSource: JobSource = {
  id: "html_boards",
  label: "HTML boards",
  tier: "tertiary",
  enabled: () => envSourceOn("SOURCES_HTML", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const kws = ctx.segment.keywords.slice(0, 4);
    const kw = kws[0] || "ai engineer";
    await ctx.log(
      `HTML · «${kws.join(" · ") || kw}» · ${ctx.segment.label}`,
    );

    const careerUrls = (env("CAREER_HTML_URLS") || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const url of careerUrls) {
      if (hits.length >= ctx.limit) break;
      try {
        const res = await harvestFetch(url, {
          headers: { Accept: "text/html" },
          signal: ctx.signal ?? AbortSignal.timeout(14_000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const $ = cheerio.load(html);
        $("a").each((_, el) => {
          if (hits.length >= ctx.limit) return;
          const href = $(el).attr("href") || "";
          const title = $(el).text().trim();
          if (title.length < 8 || title.length > 90) return;
          if (!textMatchesSegment(title, ctx.segment)) return;
          const abs = href.startsWith("http")
            ? href
            : new URL(href, url).toString();
          hits.push({
            sourceId: "html_careers",
            company: new URL(url).hostname.replace(/^www\./, ""),
            role: title,
            region: ctx.segment.region,
            location: null,
            remote: null,
            description: `From careers page · ${url}`,
            url: abs,
            channel: "careers",
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
          });
        });
      } catch {
        /* continue */
      }
    }

    if (proxyPoolSize() > 0 && hits.length < ctx.limit) {
      const loc =
        ctx.segment.region === "europe"
          ? "Europe"
          : ctx.segment.region === "asia"
            ? "Asia"
            : "United States";
      for (const q of kws.length ? kws : [kw]) {
        if (hits.length >= ctx.limit) break;
        const indeed = `https://www.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}`;
        try {
          const res = await harvestFetch(indeed, {
            headers: { Accept: "text/html" },
            signal: ctx.signal ?? AbortSignal.timeout(14_000),
          });
          if (res.ok) {
            const html = await res.text();
            const $ = cheerio.load(html);
            $("h2.jobTitle a, a.jcs-JobTitle, .jobTitle-color-purple").each(
              (_, el) => {
                if (hits.length >= ctx.limit) return;
                const title = $(el).text().trim();
                const href = $(el).attr("href") || "";
                if (!title || !textMatchesSegment(title, ctx.segment)) return;
                const company =
                  $(el)
                    .closest("[data-jk], .job_seen_beacon, .cardOutline")
                    .find("[data-testid='company-name'], .companyName")
                    .first()
                    .text()
                    .trim() || "Indeed company";
                hits.push({
                  sourceId: "indeed",
                  company,
                  role: title,
                  region: ctx.segment.region,
                  location: loc,
                  remote: /remote/i.test(title) ? true : null,
                  description: `Indeed · ${q}`,
                  url: href.startsWith("http")
                    ? href
                    : `https://www.indeed.com${href}`,
                  channel: "other",
                  salaryMin: null,
                  salaryMax: null,
                  salaryCurrency: null,
                });
              },
            );
            await ctx.log(`Indeed · «${q}» · proxy · +${hits.length}`);
          } else {
            await ctx.log(`Indeed · «${q}» · HTTP ${res.status}`);
          }
        } catch (err) {
          await ctx.log(
            `Indeed · ${err instanceof Error ? err.message : "fail"}`,
          );
        }
      }
    } else if (proxyPoolSize() === 0) {
      await ctx.log("Indeed · skipped (no PROXY_URLS)");
    }

    await ctx.log(`HTML · +${hits.length}`);
    return hits;
  },
};
