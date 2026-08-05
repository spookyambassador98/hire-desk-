import { randomUUID } from "node:crypto";
import { envNum } from "@/lib/env";
import { resolveSalary } from "@/lib/regions";
import { computeFit, enrichJobProofs } from "@/lib/scoring";
import { stripHtml } from "@/lib/text";
import type { Job } from "@/lib/types";
import {
  getStopAbortSignal,
  isHarvestStopRequested,
} from "./control";
import {
  bumpSegmentQuota,
  pushHarvestLog,
  readQuotaDay,
} from "./liveStore";
import {
  HIRE_RUN_TARGET,
  countJobsByRegion,
  prioritizedSegments,
  segmentRemaining,
  type HireSegment,
  type HireSegmentId,
} from "./max";
import { safeRunTarget, proxyModeLabel } from "./harvestFetch";
import { enabledSources, sourcesByTier } from "./sources";
import type { JobHit } from "./sources/types";
import { proxyPoolSize } from "./proxyPool";

export type RunHireMaxResult = {
  added: number;
  skipped: number;
  trashed: number;
  message: string;
};

function hitKey(h: JobHit) {
  return `${h.company.toLowerCase()}|${h.role.toLowerCase()}|${(h.url || "").toLowerCase()}`;
}

function jobKey(j: Job) {
  return `${j.company.toLowerCase()}|${j.role.toLowerCase()}|${(j.url || "").toLowerCase()}`;
}

function hitToJob(hit: JobHit, segment: HireSegment): Job {
  const now = new Date().toISOString();
  const description = hit.description
    ? stripHtml(hit.description)
    : `${hit.role} at ${hit.company}`;
  const salary = resolveSalary({
    min: hit.salaryMin,
    max: hit.salaryMax,
    currency: hit.salaryCurrency,
    description,
    salaryText: hit.salaryText,
    region: hit.region,
  });
  return enrichJobProofs({
    id: `job_${randomUUID().slice(0, 8)}`,
    company: hit.company.trim(),
    role: hit.role.trim(),
    region: hit.region,
    location: hit.location,
    remote: hit.remote,
    description,
    salary,
    url: hit.url,
    channel: hit.channel,
    contact: null,
    status: "new",
    notes: null,
    source: `max:${segment.id}:${hit.sourceId}`,
    appliedAt: null,
    followUpAt: null,
    postedAt: hit.postedAt || null,
    createdAt: now,
    updatedAt: now,
  });
}

async function harvestTier(
  segment: HireSegment,
  limit: number,
  log: (m: string) => Promise<void>,
): Promise<JobHit[]> {
  const signal = getStopAbortSignal();
  const tiers = ["primary", "secondary", "tertiary", "import"] as const;
  const out: JobHit[] = [];
  const seen = new Set<string>();

  for (const tier of tiers) {
    if (isHarvestStopRequested()) break;
    if (out.length >= limit) break;
    const sources = sourcesByTier(tier);
    for (const src of sources) {
      if (isHarvestStopRequested()) break;
      if (out.length >= limit) break;
      const need = limit - out.length;
      try {
        const hits = await src.harvest({
          segment,
          limit: need,
          log,
          signal,
        });
        for (const h of hits) {
          const k = hitKey(h);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(h);
          if (out.length >= limit) break;
        }
      } catch (err) {
        await log(
          `${src.id} · crash · ${err instanceof Error ? err.message : "err"}`,
        );
      }
    }
  }
  return out;
}

export type RunHireMaxOpts = {
  existingJobs: Job[];
  runTarget?: number;
  onJobsBatch?: (jobs: Job[]) => Promise<void>;
  onProgress?: (ev: {
    added: number;
    skipped: number;
    trashed: number;
    segment: string | null;
    message: string;
  }) => Promise<void>;
};

/**
 * MAX LIVE engine — cascade sources until RUN_TARGET or quotas/stop.
 */
export async function runHireMax(
  opts: RunHireMaxOpts,
): Promise<RunHireMaxResult> {
  const runTarget = opts.runTarget ?? safeRunTarget();
  const quota = await readQuotaDay();
  const inventory = countJobsByRegion(opts.existingJobs);
  const segments = prioritizedSegments(quota.bySegment, inventory);
  const existingKeys = new Set(opts.existingJobs.map(jobKey));

  let added = 0;
  let skipped = 0;
  let trashed = 0;

  const log = async (msg: string) => {
    await pushHarvestLog(msg, {
      running: !isHarvestStopRequested(),
      added,
      skipped,
      trashed,
      message: msg,
    });
    await opts.onProgress?.({
      added,
      skipped,
      trashed,
      segment: null,
      message: msg,
    });
  };

  await log(
    `MAX LIVE · target ≥${runTarget} (cfg ${HIRE_RUN_TARGET}) · proxy ${proxyModeLabel()} · sources ${enabledSources().length} · segments ${segments.length}`,
  );
  await log(
    `⚖ region inventory EU ${inventory.europe ?? 0} · US ${inventory.america ?? 0} · AS ${inventory.asia ?? 0} → scarcest first`,
  );
  if (proxyPoolSize() === 0) {
    await log(
      `⚠ No PROXY_URLS — soft cap ${runTarget} + gaps · set CF gateway or residential (see cloudflare/hire-proxy-worker.js)`,
    );
  }

  for (const segment of segments) {
    if (isHarvestStopRequested()) break;
    if (added >= runTarget) break;

    const remaining = segmentRemaining(
      segment.id as HireSegmentId,
      quota.bySegment,
    );
    if (remaining <= 0) {
      await log(`${segment.label} · quota full · skip`);
      continue;
    }

    const need = Math.min(remaining, runTarget - added, envNum("HIRE_SEGMENT_BATCH", 25));
    await log(`▶ ${segment.label} · need ${need}`);
    await opts.onProgress?.({
      added,
      skipped,
      trashed,
      segment: segment.label,
      message: `▶ ${segment.label}`,
    });

    const hits = await harvestTier(segment, need * 2, log);
    const batch: Job[] = [];

    for (const hit of hits) {
      if (isHarvestStopRequested()) break;
      if (added + batch.length >= runTarget) break;
      if (batch.length >= remaining) break;

      const job = hitToJob(hit, segment);
      const k = jobKey(job);
      if (existingKeys.has(k)) {
        skipped += 1;
        continue;
      }

      const fit = computeFit(job);
      if (fit.antiFiltered || fit.score < 20) {
        trashed += 1;
        continue;
      }

      existingKeys.add(k);
      batch.push(job);
    }

    if (batch.length) {
      await opts.onJobsBatch?.(batch);
      added += batch.length;
      await bumpSegmentQuota(segment.id, batch.length);
      quota.bySegment[segment.id] =
        (quota.bySegment[segment.id] ?? 0) + batch.length;
      await log(`💾 ${segment.label} · +${batch.length} (total +${added})`);
    } else {
      await log(`${segment.label} · 0 kept`);
    }
  }

  const message = isHarvestStopRequested()
    ? `⏹ Stopped · +${added} · skip ${skipped} · trash ${trashed}`
    : added >= runTarget
      ? `✓ Target ≥${runTarget} · +${added} · skip ${skipped} · trash ${trashed}`
      : `Done · +${added} · skip ${skipped} · trash ${trashed} (under target — sources thin / quotas)`;

  await log(message);
  return { added, skipped, trashed, message };
}
