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
  matchesPriorityAiRole,
  prioritizedSegments,
  segmentRemaining,
  type HireSegment,
  type HireSegmentId,
} from "./max";
import { jobDedupeKey } from "./dedupe";
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
  return jobDedupeKey(h);
}

function jobKey(j: Job) {
  return jobDedupeKey(j);
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
  opts: { remoteFirst?: boolean } = {},
): Promise<JobHit[]> {
  const signal = getStopAbortSignal();
  const tiers = ["primary", "secondary", "tertiary", "import"] as const;
  const out: JobHit[] = [];
  const seen = new Set<string>();
  const remoteIds = new Set(["remotive", "remoteok", "arbeitnow"]);

  for (const tier of tiers) {
    if (isHarvestStopRequested()) break;
    if (out.length >= limit) break;
    let sources = sourcesByTier(tier);
    if (opts.remoteFirst) {
      sources = [
        ...sources.filter((s) => remoteIds.has(s.id)),
        ...sources.filter((s) => !remoteIds.has(s.id)),
      ];
    }
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

  if (opts.remoteFirst) {
    out.sort((a, b) => Number(Boolean(b.remote)) - Number(Boolean(a.remote)));
  }
  return out;
}

function hitLooksRemote(hit: JobHit) {
  if (hit.remote === true) return true;
  const blob = `${hit.location || ""} ${hit.description || ""} ${hit.role || ""}`;
  return /\bremote\b|\bdistributed\b|\bwork\s+from\s+home\b|\bwfh\b|\banywhere\b/i.test(
    blob,
  );
}

function hitPriorityScore(hit: JobHit): number {
  const blob = `${hit.role}\n${hit.description || ""}`;
  let s = 0;
  if (hitLooksRemote(hit)) s += 100;
  if (matchesPriorityAiRole(hit.role) || matchesPriorityAiRole(blob)) s += 80;
  if (hit.remote === true) s += 10;
  return s;
}

function sortHitsPriority(hits: JobHit[]): JobHit[] {
  return [...hits].sort((a, b) => hitPriorityScore(b) - hitPriorityScore(a));
}

export type RunHireMaxOpts = {
  existingJobs: Job[];
  runTarget?: number;
  /** WRITE HARVEST: prefer remote boards + remote hits; caller buffers writes. */
  writeHarvest?: boolean;
  /**
   * WRITE only: if AI shelves were dry, also pull founding/fullstack
   * so the buffer still fills (SORT can filter later).
   */
  writeExpandShelves?: boolean;
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
 * MAX LIVE / WRITE HARVEST engine — cascade sources until RUN_TARGET or stop.
 */
export async function runHireMax(
  opts: RunHireMaxOpts,
): Promise<RunHireMaxResult> {
  const writeHarvest = Boolean(opts.writeHarvest);
  const writeExpand = Boolean(opts.writeExpandShelves);
  const runTarget = opts.runTarget ?? safeRunTarget();
  const inventory = countJobsByRegion(opts.existingJobs);
  const quota = await readQuotaDay(opts.existingJobs);
  const allSegments = prioritizedSegments(quota.bySegment, inventory);
  const segments = writeHarvest
    ? allSegments.filter((s) =>
        writeExpand
          ? s.family === "ai" ||
            s.family === "founding" ||
            s.family === "fullstack"
          : s.family === "ai",
      )
    : allSegments;
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

  const filledShelves = segments.filter(
    (s) => segmentRemaining(s.id as HireSegmentId, quota.bySegment) <= 0,
  ).length;

  await log(
    writeHarvest
      ? `WRITE HARVEST · REMOTE + AI roles first · target ≥${runTarget} · → buffer · sources ${enabledSources().length}${
          writeExpand ? " · expand founding/fullstack" : ""
        }`
      : `MAX LIVE · REMOTE + AI Product track · target ≥${runTarget} (cfg ${HIRE_RUN_TARGET}) · proxy ${proxyModeLabel()} · sources ${enabledSources().length} · segments ${segments.length}`,
  );
  await log(
    `🎯 priority · AI-Native Full-Stack Product Builder · AI Solution Architect · Full-Stack AI · Prompt / AI Product · No-Code Lead · AI Engineer · Solution Maker`,
  );
  await log(
    `⚖ region inventory EU ${inventory.europe ?? 0} · US ${inventory.america ?? 0} · AS ${inventory.asia ?? 0} → scarcest first`,
  );
  if (!writeHarvest) {
    await log(
      `📦 day shelves ${filledShelves}/${segments.length} full · continue (no reset)`,
    );
  } else {
    await log(
      `📦 buffer mode · только полки AI Product (${segments.map((s) => s.id).join(", ")}) · в jobs только ВЛИТЬ`,
    );
  }
  if (proxyPoolSize() === 0) {
    await log(
      `⚠ No PROXY_URLS — soft cap ${runTarget} + gaps · set CF gateway or residential (see cloudflare/hire-proxy-worker.js)`,
    );
  }

  for (const segment of segments) {
    if (isHarvestStopRequested()) break;
    if (added >= runTarget) break;

    const remaining = writeHarvest
      ? runTarget - added
      : segmentRemaining(segment.id as HireSegmentId, quota.bySegment);
    if (remaining <= 0) {
      if (!writeHarvest) await log(`${segment.label} · quota full · skip`);
      continue;
    }

    const need = Math.min(
      remaining,
      runTarget - added,
      envNum("HIRE_SEGMENT_BATCH", writeHarvest ? 18 : 25),
    );
    await log(
      `▶ ${segment.label} · need ${need} · REMOTE↑ AI↑`,
    );
    await opts.onProgress?.({
      added,
      skipped,
      trashed,
      segment: segment.label,
      message: `▶ ${segment.label}`,
    });

    const preferAiRemote = true; // REMOTE + AI product roles are always search priority
    const hits = await harvestTier(segment, need * 2, log, {
      remoteFirst: true,
    });
    // Prefer remote + priority AI roles into the keep batch first
    const ordered = sortHitsPriority(hits);
    const batch: Job[] = [];

    for (const hit of ordered) {
      if (isHarvestStopRequested()) break;
      if (added + batch.length >= runTarget) break;
      if (batch.length >= remaining) break;

      const isPri =
        matchesPriorityAiRole(hit.role) ||
        matchesPriorityAiRole(`${hit.role} ${hit.description || ""}`);
      const isRemote = hitLooksRemote(hit);

      // Prefer remote + priority AI roles; soft-skip fillers once quota half-filled
      if (
        !isPri &&
        !isRemote &&
        ordered.some(
          (h) =>
            hitLooksRemote(h) ||
            matchesPriorityAiRole(h.role),
        ) &&
        batch.filter(
          (j) =>
            j.remote === true ||
            matchesPriorityAiRole(j.role),
        ).length >= Math.ceil(need * 0.55)
      ) {
        skipped += 1;
        continue;
      }

      const job = hitToJob(hit, segment);
      if (isRemote) job.remote = true;
      const k = jobKey(job);
      if (existingKeys.has(k)) {
        skipped += 1;
        continue;
      }

      const fit = computeFit(job);
      // WRITE: keep thin AI/product hits; MAX LIVE stays stricter
      const minFit = writeHarvest ? 8 : 20;
      if (fit.antiFiltered || fit.score < minFit) {
        trashed += 1;
        continue;
      }

      existingKeys.add(k);
      batch.push(job);
    }

    if (batch.length) {
      await opts.onJobsBatch?.(batch);
      added += batch.length;
      if (!writeHarvest) {
        await bumpSegmentQuota(segment.id, batch.length);
        quota.bySegment[segment.id] =
          (quota.bySegment[segment.id] ?? 0) + batch.length;
      }
      const remotes = batch.filter((j) => j.remote === true).length;
      const aiHits = batch.filter((j) => matchesPriorityAiRole(j.role)).length;
      await log(
        `💾 ${segment.label} · +${batch.length} (${remotes} remote · ${aiHits} AI-priority${writeHarvest ? " → buffer" : ""}) (total +${added})`,
      );
    } else {
      await log(`${segment.label} · 0 kept`);
    }
  }

  const message = isHarvestStopRequested()
    ? `⏹ Stopped · +${added} · skip ${skipped} · trash ${trashed}`
    : writeHarvest
      ? added >= runTarget
        ? `WRITE HARVEST pass · +${added} → buffer · trash ${trashed}`
        : `WRITE HARVEST pass · +${added} → buffer · trash ${trashed} (thin)`
      : added >= runTarget
        ? `✓ Target ≥${runTarget} · +${added} · skip ${skipped} · trash ${trashed}`
        : `Done · +${added} · skip ${skipped} · trash ${trashed} (under target — sources thin / quotas)`;

  await log(message);
  return { added, skipped, trashed, message };
}
