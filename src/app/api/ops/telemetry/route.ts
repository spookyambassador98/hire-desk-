import { NextResponse } from "next/server";
import { HIRE_BUILD } from "@/lib/build";
import { env, envSourceOn } from "@/lib/env";
import { probeFirebase } from "@/lib/firebase";
import {
  FIREBASE_QUOTA_BLOCK_PCT,
  FIRESTORE_SOFT,
  snapshotFirebaseQuota,
} from "@/lib/firebaseQuota";
import {
  dayCeiling,
  HIRE_DAILY_QUOTA,
  HIRE_RUN_TARGET,
} from "@/lib/harvest/max";
import { readHarvestLive, readQuotaDay } from "@/lib/harvest/liveStore";
import { proxyModeLabel, safeRunTarget } from "@/lib/harvest/harvestFetch";
import { proxyPoolSize } from "@/lib/harvest/proxyPool";
import { enabledSources } from "@/lib/harvest/sources";
import { readOpsUsage } from "@/lib/opsUsage";
import { peekStoreCounts, storageLabel } from "@/lib/persistence";
import { readJobs, readIndividuals } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const t0 = Date.now();
  const mem = process.memoryUsage();
  const peek = peekStoreCounts();

  const [firebase, live, quota, usage] = await Promise.all([
    probeFirebase(),
    readHarvestLive().catch(() => null),
    readQuotaDay().catch(() => null),
    readOpsUsage().catch(() => null),
  ]);

  // Only hit Firestore for counts when cache is empty (cold process).
  let jobsTotal = peek.jobs;
  let individualsTotal = peek.individuals;
  if (jobsTotal == null || individualsTotal == null) {
    const [jobs, individuals] = await Promise.all([
      jobsTotal == null
        ? readJobs().catch(() => [])
        : Promise.resolve(null),
      individualsTotal == null
        ? readIndividuals().catch(() => [])
        : Promise.resolve(null),
    ]);
    if (jobs) jobsTotal = jobs.length;
    if (individuals) individualsTotal = individuals.length;
  }

  const firebaseMs = Date.now() - t0;
  const totalToday = quota
    ? Object.values(quota.bySegment || {}).reduce((s, n) => s + (n || 0), 0)
    : 0;
  const ceiling = dayCeiling();
  const totalRemaining = Math.max(0, ceiling - totalToday);
  const runTarget = safeRunTarget();

  const beat = live?.heartbeatAt || live?.startedAt || null;
  const heartbeatAgeMs = beat ? Date.now() - Date.parse(beat) : null;
  const heartbeatOk =
    live?.running === true
      ? heartbeatAgeMs !== null && heartbeatAgeMs < 90_000
      : true;

  const softQuota = { ...FIRESTORE_SOFT };
  const gate = usage ? snapshotFirebaseQuota(usage) : null;
  const firebaseOk = firebase.ok && !gate?.exhausted;

  const platformOk =
    (storageLabel() !== "firebase" || firebaseOk) &&
    heartbeatOk &&
    (!live?.message || !/error|fail|завис|stuck/i.test(live.message));

  const platformStatus: "ok" | "degraded" | "down" = platformOk
    ? "ok"
    : firebaseOk || storageLabel() !== "firebase"
      ? "degraded"
      : "down";

  const readsApprox = gate?.readsApprox ?? 0;
  const writesApprox = gate?.writesApprox ?? 0;
  const noteParts = [
    `Tracked ~${readsApprox.toLocaleString("en-US")} reads / ~${writesApprox.toLocaleString("en-US")} writes today (app counters)`,
    `Spark soft cap ${softQuota.readsPerDay.toLocaleString("en-US")}R / ${softQuota.writesPerDay.toLocaleString("en-US")}W`,
    gate?.source ? `source ${gate.source}` : null,
    gate?.exhausted
      ? "RESOURCE_EXHAUSTED — bars use last known + mark empty"
      : "exact billing → Firebase Console Usage",
  ].filter(Boolean);

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    build: HIRE_BUILD,
    platform: {
      status: platformStatus,
      mode: env("HIRE_PARSER_MODE", "live"),
      storage: storageLabel(),
      runTarget,
      configuredTarget: HIRE_RUN_TARGET,
      dailyQuotaPerSegment: HIRE_DAILY_QUOTA,
      dayCeiling: ceiling,
      jobsTotal: jobsTotal ?? 0,
      individualsTotal: individualsTotal ?? 0,
      harvestToday: totalToday,
      harvestRemainingToday: totalRemaining,
    },
    firebase: {
      ...firebase,
      ok: firebaseOk,
      latencyMs: firebaseMs,
      softQuota,
      quotaGate: gate
        ? {
            blocked: gate.blocked,
            blockAtPct: FIREBASE_QUOTA_BLOCK_PCT,
            readsPct: gate.readsPct,
            writesPct: gate.writesPct,
            reason: gate.reason,
            resetsHint: gate.resetsHint,
            exhausted: gate.exhausted,
            source: gate.source,
          }
        : null,
      usage: {
        day: usage?.day ?? null,
        readsApprox,
        writesApprox,
        readsLeftApprox:
          gate?.readsLeftApprox ?? softQuota.readsPerDay,
        writesLeftApprox:
          gate?.writesLeftApprox ?? softQuota.writesPerDay,
        readsPct: gate?.readsPct ?? 0,
        writesPct: gate?.writesPct ?? 0,
        exhausted: gate?.exhausted ?? false,
        source: gate?.source ?? "memory",
        note: noteParts.join(" · "),
      },
    },
    render: {
      runtime: "nodejs",
      serviceHint:
        env("RENDER_SERVICE_NAME") ||
        env("RENDER") ||
        "hire-desk",
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      mem: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
    },
    harvest: {
      running: Boolean(live?.running),
      message: live?.message ?? null,
      segment: live?.segment ?? null,
      added: live?.added ?? 0,
      skipped: live?.skipped ?? 0,
      trashed: live?.trashed ?? 0,
      heartbeatAgeMs,
      heartbeatOk,
    },
    sources: {
      count: enabledSources().length,
      proxy: proxyPoolSize() > 0,
      proxyMode: proxyModeLabel(),
      proxyPool: proxyPoolSize(),
      remotive: envSourceOn("SOURCES_REMOTIVE", true),
      ats: envSourceOn("SOURCES_GREENHOUSE", true),
      html: envSourceOn("SOURCES_HTML", true),
      telegram: envSourceOn("SOURCES_TELEGRAM", false),
    },
  });
}
