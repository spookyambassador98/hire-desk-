import { promises as fs } from "node:fs";
import path from "node:path";
import { env, envSourceOn } from "@/lib/env";
import type { JobHit, JobSource } from "./types";
import { textMatchesSegment } from "./types";

/**
 * LinkedIn — import only (file / URL). No SN scrape.
 * Expects JSON array: { company, role|title, url?, location?, description? }
 */
export const linkedinImportSource: JobSource = {
  id: "linkedin_import",
  label: "LinkedIn import",
  tier: "import",
  enabled: () => envSourceOn("SOURCES_LINKEDIN_IMPORT", true),
  async harvest(ctx) {
    const hits: JobHit[] = [];
    await ctx.log(`LinkedIn import · ${ctx.segment.label}`);

    const url = env("LINKEDIN_EXPORT_URL");
    const file =
      env("LINKEDIN_IMPORT_FILE") ||
      path.join(process.cwd(), "data", "linkedin_imports.json");

    let raw = "";
    try {
      if (url) {
        const res = await fetch(url, {
          signal: ctx.signal ?? AbortSignal.timeout(15_000),
        });
        if (res.ok) raw = await res.text();
      } else {
        raw = await fs.readFile(file, "utf8");
      }
    } catch {
      await ctx.log("LinkedIn import · no file/url (ok)");
      return hits;
    }

    if (!raw.trim()) return hits;

    try {
      const rows = JSON.parse(raw) as Array<{
        company?: string;
        role?: string;
        title?: string;
        url?: string;
        location?: string;
        description?: string;
        region?: string;
      }>;
      for (const r of rows) {
        if (hits.length >= ctx.limit) break;
        const role = (r.role || r.title || "").trim();
        const company = (r.company || "").trim();
        if (!role || !company) continue;
        const blob = `${role} ${r.description || ""}`;
        if (!textMatchesSegment(blob, ctx.segment)) continue;
        hits.push({
          sourceId: "linkedin_import",
          company,
          role,
          region: ctx.segment.region,
          location: r.location || null,
          remote: /remote/i.test(r.location || "") ? true : null,
          description: r.description || `${role} at ${company}`,
          url: r.url || null,
          channel: "linkedin",
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
        });
      }
      await ctx.log(`LinkedIn import · +${hits.length}`);
    } catch (err) {
      await ctx.log(
        `LinkedIn import · parse fail · ${err instanceof Error ? err.message : "err"}`,
      );
    }
    return hits;
  },
};
