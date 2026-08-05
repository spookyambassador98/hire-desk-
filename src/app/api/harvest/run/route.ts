import { NextResponse, after } from "next/server";
import {
  beginContinueRun,
  beginManualRun,
  getActiveRun,
  isHarvestPaused,
  isHarvestStopRequested,
  pauseRemainingMs,
  setActiveRun,
} from "@/lib/harvest/control";
import {
  patchHarvestLive,
  pushHarvestLog,
  pushIntakeHits,
  readHarvestLive,
  readQuotaDay,
  writeHarvestLive,
} from "@/lib/harvest/liveStore";
import {
  HIRE_RUN_TARGET,
  anySegmentOpen,
  dayCeiling,
  dayQuotaRemaining,
  dayQuotaUsed,
} from "@/lib/harvest/max";
import { runHireMax } from "@/lib/harvest/runLive";
import { proxyPoolSize } from "@/lib/harvest/proxyPool";
import { proxyModeLabel, safeRunTarget } from "@/lib/harvest/harvestFetch";
import { enabledSources } from "@/lib/harvest/sources";
import { scoreJob } from "@/lib/scoring";
import { env, envNum } from "@/lib/env";
import { ingestJobsBatch, readJobs } from "@/lib/store";
import { DEFAULT_HIRE_PROFILE } from "@/lib/types";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leave headroom before Render kills the request. */
const WAVE_DEADLINE_MS = envNum("HIRE_WAVE_DEADLINE_MS", 250_000);
const WAVE_GAP_MS = envNum("HIRE_WAVE_GAP_MS", 2_000);

function stamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isStuck(live: Awaited<ReturnType<typeof readHarvestLive>>) {
  if (!live.running) return false;
  const beat = live.heartbeatAt || live.startedAt;
  if (!beat) return true;
  const age = Date.now() - Date.parse(beat);
  return !Number.isFinite(age) || age > 90_000;
}

function resolveOrigin(request: Request) {
  const port = env("PORT", "3011");
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    `127.0.0.1:${port}`;
  const proto = request.headers.get("x-forwarded-proto") || "http";
  return env("HARVEST_INTERNAL_BASE") || `${proto}://${host}`;
}

/** Kick another run after this request ends — until day shelves are full. */
function scheduleAutoContinue(origin: string) {
  after(async () => {
    try {
      await sleep(4_000);
      if (isHarvestStopRequested() || isHarvestPaused()) return;
      if (getActiveRun()) return;
      const jobs = await readJobs();
      const quota = await readQuotaDay(jobs);
      if (!anySegmentOpen(quota.bySegment) || dayQuotaRemaining(quota.bySegment) <= 0) {
        return;
      }
      await fetch(`${origin}/api/harvest/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-harvest-continue": "1",
        },
        body: JSON.stringify({ source: "auto-continue", manual: false }),
      });
    } catch (err) {
      console.error("[harvest] auto-continue failed", err);
    }
  });
}

async function executeHarvestRun(
  origin: string,
  opts: { continueSession?: boolean } = {},
) {
  const startedAt = new Date().toISOString();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  let sessionAdded = 0;
  let sessionSkipped = 0;
  let sessionTrashed = 0;
  let dayUsedSnap = 0;
  let needsContinue = false;

  try {
    const waveCap = safeRunTarget();
    const prev = await readHarvestLive();
    const jobs0 = await readJobs();
    const q0 = await readQuotaDay(jobs0);
    const dayLeft0 = dayQuotaRemaining(q0.bySegment);
    dayUsedSnap = dayQuotaUsed(q0.bySegment);

    if (opts.continueSession) {
      sessionAdded = prev.added || 0;
      sessionSkipped = prev.skipped || 0;
      sessionTrashed = prev.trashed || 0;
    }

    await writeHarvestLive({
      running: true,
      startedAt: opts.continueSession && prev.startedAt ? prev.startedAt : startedAt,
      finishedAt: null,
      heartbeatAt: startedAt,
      added: sessionAdded,
      skipped: sessionSkipped,
      trashed: sessionTrashed,
      segment: null,
      recentAdds: prev.recentAdds || [],
      message: `MAX LIVE · fill day · ${dayLeft0} slots left`,
      logs: [
        ...(prev.logs || []).slice(-50),
        `[${stamp()}] ── MAX LIVE fill-day${opts.continueSession ? " · continue" : ""} · wave cap ${waveCap} · day ${dayUsedSnap}/${dayCeiling()}`,
        `[${stamp()}] sources ${enabledSources().map((s) => s.id).join(", ") || "none"}`,
        `[${stamp()}] proxy ${proxyModeLabel()} · pool ${proxyPoolSize()}`,
      ],
    });

    heartbeat = setInterval(() => {
      if (isHarvestStopRequested()) {
        stopHeartbeat();
        void patchHarvestLive({
          running: false,
          heartbeatAt: new Date().toISOString(),
          message: "⏹ Stop — exiting",
        }).catch(() => undefined);
        return;
      }
      void patchHarvestLive({
        running: true,
        heartbeatAt: new Date().toISOString(),
        message: `♥ fill-day · +${sessionAdded} · ${dayUsedSnap}/${dayCeiling()}`,
      }).catch(() => undefined);
    }, 12_000);

    const deadline = Date.now() + WAVE_DEADLINE_MS;
    let wave = 0;
    let dryWaves = 0;

    while (!isHarvestStopRequested()) {
      const jobs = await readJobs();
      const quota = await readQuotaDay(jobs);
      dayUsedSnap = dayQuotaUsed(quota.bySegment);
      const dayLeft = dayQuotaRemaining(quota.bySegment);

      if (dayLeft <= 0 || !anySegmentOpen(quota.bySegment)) {
        await pushHarvestLog(
          `✓ Day shelves full · ${dayQuotaUsed(quota.bySegment)}/${dayCeiling()} · +${sessionAdded} session`,
          {
            running: true,
            added: sessionAdded,
            skipped: sessionSkipped,
            trashed: sessionTrashed,
            message: `✓ Day quota filled · +${sessionAdded}`,
          },
        );
        break;
      }

      if (Date.now() >= deadline) {
        needsContinue = true;
        await pushHarvestLog(
          `⏱ Time budget · auto-continue · day left ${dayLeft} · +${sessionAdded}`,
          {
            running: true,
            added: sessionAdded,
            skipped: sessionSkipped,
            trashed: sessionTrashed,
            message: `⏱ Continuing… day left ${dayLeft}`,
          },
        );
        break;
      }

      wave += 1;
      const waveTarget = Math.min(waveCap, dayLeft);
      await pushHarvestLog(
        `🌊 Wave ${wave} · need ≤${waveTarget} · day left ${dayLeft}`,
        {
          running: true,
          added: sessionAdded,
          skipped: sessionSkipped,
          trashed: sessionTrashed,
          segment: null,
          message: `🌊 Wave ${wave} · day left ${dayLeft}`,
        },
      );

      const baseAdded = sessionAdded;
      const baseSkipped = sessionSkipped;
      const baseTrashed = sessionTrashed;

      const result = await runHireMax({
        existingJobs: jobs,
        runTarget: waveTarget,
        onJobsBatch: async (chunk) => {
          if (isHarvestStopRequested()) return;
          await ingestJobsBatch(chunk);
          await pushIntakeHits(
            chunk.map((j) => {
              const scores = scoreJob(j, {
                europeQuotaRemaining: DEFAULT_HIRE_PROFILE.europeDailyQuota,
                americaQuotaRemaining: DEFAULT_HIRE_PROFILE.americaDailyQuota,
                asiaQuotaRemaining: DEFAULT_HIRE_PROFILE.asiaDailyQuota,
              });
              return {
                id: j.id,
                company: j.company,
                role: j.role,
                region: j.region,
                source: j.source,
                fit: scores.fit.score,
                pri: scores.priority.score,
              };
            }),
          );
        },
        onProgress: async (ev) => {
          const stopped = isHarvestStopRequested();
          if (stopped) stopHeartbeat();
          await pushHarvestLog(ev.message, {
            running: !stopped,
            added: baseAdded + ev.added,
            skipped: baseSkipped + ev.skipped,
            trashed: baseTrashed + ev.trashed,
            segment: ev.segment,
            message: ev.message,
            ...(stopped
              ? { finishedAt: new Date().toISOString(), running: false }
              : {}),
          });
        },
      });

      sessionAdded += result.added;
      sessionSkipped += result.skipped;
      sessionTrashed += result.trashed;

      if (result.added === 0) {
        dryWaves += 1;
        await pushHarvestLog(
          `○ Wave ${wave} dry · +0 · dry ${dryWaves}/2`,
          {
            running: true,
            added: sessionAdded,
            skipped: sessionSkipped,
            trashed: sessionTrashed,
            message: `○ Wave ${wave} dry`,
          },
        );
        if (dryWaves >= 2) {
          await pushHarvestLog(
            `∅ Sources dry for open shelves · stop · +${sessionAdded} session`,
            {
              running: true,
              added: sessionAdded,
              skipped: sessionSkipped,
              trashed: sessionTrashed,
              message: `∅ Sources exhausted · +${sessionAdded}`,
            },
          );
          break;
        }
      } else {
        dryWaves = 0;
      }

      if (isHarvestStopRequested()) break;
      await sleep(WAVE_GAP_MS);
    }

    stopHeartbeat();

    if (needsContinue && !isHarvestStopRequested() && !isHarvestPaused()) {
      scheduleAutoContinue(origin);
      await pushHarvestLog(
        `↻ Scheduled auto-continue · session +${sessionAdded}`,
        {
          running: true,
          finishedAt: null,
          heartbeatAt: new Date().toISOString(),
          added: sessionAdded,
          skipped: sessionSkipped,
          trashed: sessionTrashed,
          message: `↻ Auto-continue armed · +${sessionAdded}`,
        },
      );
    } else {
      const jobsEnd = await readJobs();
      const qEnd = await readQuotaDay(jobsEnd);
      const filled = dayQuotaRemaining(qEnd.bySegment) <= 0;
      const msg = isHarvestStopRequested()
        ? `⏹ Stopped · +${sessionAdded} · skip ${sessionSkipped} · trash ${sessionTrashed}`
        : filled
          ? `✓ Day full ${dayQuotaUsed(qEnd.bySegment)}/${dayCeiling()} · +${sessionAdded}`
          : `Done · +${sessionAdded} · skip ${sessionSkipped} · trash ${sessionTrashed} · day ${dayQuotaUsed(qEnd.bySegment)}/${dayCeiling()}`;
      await pushHarvestLog(msg, {
        running: false,
        finishedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        added: sessionAdded,
        skipped: sessionSkipped,
        trashed: sessionTrashed,
        message: msg,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pushHarvestLog(`Error: ${msg.slice(0, 180)}`, {
      running: false,
      finishedAt: new Date().toISOString(),
      message: "Harvest error",
    });
  } finally {
    stopHeartbeat();
    setActiveRun(null);
  }
}

export async function POST(request: Request) {
  try {
    let manual = false;
    let autoContinue = false;
    try {
      const body = (await request.json().catch(() => null)) as {
        manual?: boolean;
        source?: string;
      } | null;
      autoContinue =
        body?.source === "auto-continue" ||
        request.headers.get("x-harvest-continue") === "1";
      manual =
        !autoContinue &&
        (body?.manual === true ||
          body?.source === "ui" ||
          request.headers.get("x-harvest-manual") === "1");
    } catch {
      manual = false;
    }

    if ((!manual || autoContinue) && isHarvestPaused()) {
      const mins = Math.ceil(pauseRemainingMs() / 60_000);
      return NextResponse.json({
        started: false,
        paused: true,
        message: `Paused after STOP · ~${mins}m · press MAX LIVE`,
        target: safeRunTarget(),
      });
    }

    const live = await readHarvestLive();
    if (isStuck(live)) {
      await writeHarvestLive({
        running: false,
        finishedAt: new Date().toISOString(),
        message: "Reset stuck run",
        logs: [
          ...(live.logs || []).slice(-70),
          `[${stamp()}] Reset stuck running`,
        ],
      });
    }

    const live2 = await readHarvestLive();
    const active = getActiveRun();

    if (manual && active && (isHarvestStopRequested() || isHarvestPaused())) {
      await Promise.race([active.catch(() => undefined), sleep(25_000)]);
      setActiveRun(null);
    } else if ((live2.running && !isStuck(live2)) || getActiveRun()) {
      return NextResponse.json({
        started: true,
        alreadyRunning: true,
        message: live2.message || "MAX LIVE already running",
        target: safeRunTarget(),
      });
    }

    if (manual) beginManualRun();
    else if (autoContinue) {
      if (!beginContinueRun()) {
        return NextResponse.json({
          started: false,
          paused: true,
          message: "Continue blocked · STOP pause active",
          target: safeRunTarget(),
        });
      }
    }

    const origin = resolveOrigin(request);
    const kickoffAt = new Date().toISOString();
    const kickTarget = safeRunTarget();
    const prevKick = await readHarvestLive();
    const jobsKick = await readJobs();
    const qKick = await readQuotaDay(jobsKick);
    const dayLeft = dayQuotaRemaining(qKick.bySegment);

    if (dayLeft <= 0 && !manual) {
      return NextResponse.json({
        started: false,
        dayFull: true,
        dayLeft: 0,
        dayCapacity: dayCeiling(),
        message: `Day shelves full · ${dayQuotaUsed(qKick.bySegment)}/${dayCeiling()}`,
        target: kickTarget,
      });
    }

    await writeHarvestLive({
      running: true,
      startedAt:
        autoContinue && prevKick.startedAt ? prevKick.startedAt : kickoffAt,
      finishedAt: null,
      heartbeatAt: kickoffAt,
      added: autoContinue ? prevKick.added || 0 : 0,
      skipped: autoContinue ? prevKick.skipped || 0 : 0,
      trashed: autoContinue ? prevKick.trashed || 0 : 0,
      segment: null,
      recentAdds: prevKick.recentAdds || [],
      message: `MAX LIVE fill-day · ${dayLeft} left`,
      logs: [
        ...(prevKick.logs || []).slice(-80),
        `[${stamp()}] HTTP kickoff · ${autoContinue ? "auto-continue" : manual ? "manual" : "cron"} · day left ${dayLeft}`,
      ],
    });

    const run = executeHarvestRun(origin, { continueSession: autoContinue });
    setActiveRun(run);
    void run;
    after(() => getActiveRun() ?? Promise.resolve());

    return NextResponse.json({
      started: true,
      alreadyRunning: false,
      fillDay: true,
      dayLeft,
      dayCapacity: dayCeiling(),
      message: `MAX LIVE fill-day · ${dayLeft}/${dayCeiling()} slots open`,
      target: kickTarget,
      configuredTarget: HIRE_RUN_TARGET,
      proxy: proxyPoolSize(),
      proxyMode: proxyModeLabel(),
      mode: env("HIRE_PARSER_MODE", "live"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        started: false,
        error: msg.slice(0, 200),
        message: `Start failed: ${msg.slice(0, 120)}`,
        target: safeRunTarget(),
      },
      { status: 200 },
    );
  }
}
