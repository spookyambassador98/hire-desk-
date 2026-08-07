import { NextResponse } from "next/server";
import {
  getActiveRun,
  isHarvestPaused,
  isHarvestStopRequested,
  pauseRemainingMs,
} from "@/lib/harvest/control";
import {
  buildHarvestBufferBoard,
  countHarvestBuffer,
  readHarvestBufferStats,
} from "@/lib/harvest/buffer";
import { readHarvestLive, readQuotaDay } from "@/lib/harvest/liveStore";
import {
  HIRE_DAILY_QUOTA,
  HIRE_RUN_TARGET,
  HIRE_SEGMENTS,
  dayCeiling,
} from "@/lib/harvest/max";
import { enabledSources } from "@/lib/harvest/sources";
import { proxyPoolSize } from "@/lib/harvest/proxyPool";
import { proxyModeLabel, safeRunTarget } from "@/lib/harvest/harvestFetch";
import { env } from "@/lib/env";
import { getFirebaseQuotaGate } from "@/lib/firebaseQuota";
import { probeFirebase } from "@/lib/firebase";
import { storageLabel } from "@/lib/persistence";
import { readJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const live = await readHarvestLive();
  // Prefer in-memory / meta quota — do not full-scan jobs on every poll.
  let quota = await readQuotaDay();
  if (Object.keys(quota.bySegment || {}).length === 0) {
    const jobs = await readJobs().catch(() => []);
    quota = await readQuotaDay(jobs);
  }
  const quotas = HIRE_SEGMENTS.map((s) => {
    const today = quota.bySegment[s.id] ?? 0;
    return {
      segmentId: s.id,
      label: s.label,
      today,
      quota: HIRE_DAILY_QUOTA,
      remaining: Math.max(0, HIRE_DAILY_QUOTA - today),
      pct: Math.min(100, Math.round((today / HIRE_DAILY_QUOTA) * 100)),
    };
  });
  const totalToday = quotas.reduce((n, q) => n + q.today, 0);
  const firebase =
    storageLabel() === "firebase" ? await probeFirebase() : null;
  const effectiveTarget = safeRunTarget();

  const jobs = await readJobs().catch(() => []);
  const bufferStats = await readHarvestBufferStats().catch(() => ({
    total: 0,
    byRegion: { europe: 0, america: 0, asia: 0 } as Partial<
      Record<"europe" | "america" | "asia", number>
    >,
    bySegment: {},
    remote: 0,
    updatedAt: new Date().toISOString(),
  }));
  const harvestBufferCount =
    Number(bufferStats.total) ||
    (await countHarvestBuffer().catch(() => 0));
  const bufferBoard = buildHarvestBufferBoard(jobs, {
    ...bufferStats,
    total: harvestBufferCount,
  });
  const firebaseQuota = await getFirebaseQuotaGate().catch(() => null);

  return NextResponse.json({
    runTarget: effectiveTarget,
    configuredTarget: HIRE_RUN_TARGET,
    dailyQuotaPerSegment: HIRE_DAILY_QUOTA,
    segments: HIRE_SEGMENTS.length,
    totalCapacity: dayCeiling(),
    totalToday,
    totalRemaining: Math.max(0, dayCeiling() - totalToday),
    quotas,
    sources: enabledSources().map((s) => ({
      id: s.id,
      label: s.label,
      tier: s.tier,
    })),
    proxyPool: proxyPoolSize(),
    proxyMode: proxyModeLabel(),
    storage: storageLabel(),
    firebase,
    firebaseQuota,
    harvestBufferCount,
    bufferBoard,
    jobsTotal: jobs.length,
    paused: isHarvestPaused(),
    pauseRemainingMs: pauseRemainingMs(),
    stopRequested: isHarvestStopRequested(),
    activeRun: Boolean(getActiveRun()),
    mode: env("HIRE_PARSER_MODE", "live"),
    live,
  });
}
