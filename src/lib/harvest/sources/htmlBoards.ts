import * as cheerio from "cheerio";
import { env, envSourceOn } from "@/lib/env";
import { proxiedFetch, proxyPoolSize } from "../proxyPool";
import type { JobHit, JobSource } from "./types";
import { textMatchesSegment } from "./types";

/**
 * Tertiary HTML sources — only when proxy configured for Indeed;
 * Wellfound attempted direct first.
 */
export const htmlBoardsSource: JobSource = {
  id: "html_boards",
  label: "HTML boards",
  tier: "tertiary",
  enabled: () => envSourceOn("SOURCES_HTML", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    const kw = ctx.segment.keywords[0] || "product engineer";
    await ctx.log(`HTML · «${kw}» · ${ctx.segment.label}`);

    // Wellfound-style public search is fragile; use a simple careers HTML probe list
    const careerUrls = (env("CAREER_HTML_URLS") || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const url of careerUrls) {
      if (hits.length >= ctx.limit) break;
      try {
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
      const res = await fetchWithRetry(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html",
          },
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

    // Indeed only with proxies
    if (proxyPoolSize() > 0 && hits.length < ctx.limit) {
      await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000));
      await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000));
      const loc = ctx.segment.region === "europe" ? "Europe" : "United States";
      const indeed = `https://www.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=${encodeURIComponent(loc)}`;
      try {
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
      const res = await fetchWithRetry(indeed, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html",
          },
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
                description: `Indeed · ${kw}`,
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
          await ctx.log(`Indeed · proxy · partial +${hits.length}`);
        } else {
          await ctx.log(`Indeed · HTTP ${res.status}`);
        }
      } catch (err) {
        await ctx.log(
          `Indeed · ${err instanceof Error ? err.message : "fail"}`,
        );
      }
    } else if (proxyPoolSize() === 0) {
      await ctx.log("Indeed · skipped (no PROXY_URLS)");
    }

    await ctx.log(`HTML · +${hits.length}`);
    return hits;
  },
};
