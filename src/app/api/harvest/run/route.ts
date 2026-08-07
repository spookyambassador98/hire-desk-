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
  buildHarvestBufferBoard,
  countHarvestBuffer,
  readHarvestBuffer,
  readHarvestBufferStats,
  writeHarvestBuffer,
} from "@/lib/harvest/buffer";
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
import { getFirebaseQuotaGate } from "@/lib/firebaseQuota";
import { ingestJobsBatch, readJobs } from "@/lib/store";
import { DEFAULT_HIRE_PROFILE, type Job } from "@/lib/types";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leave headroom before Render kills the request. */
const WAVE_DEADLINE_MS = envNum("HIRE_WAVE_DEADLINE_MS", 250_000);
const WAVE_GAP_MS = envNum("HIRE_WAVE_GAP_MS", 2_000);

type RunMode = "max_live" | "write_harvest";

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

async function liveBufferBoard(stackJobs: Job[]) {
  const stats = await readHarvestBufferStats().catch(() => undefined);
  const board = buildHarvestBufferBoard(stackJobs, stats);
  return {
    stackTotal: board.stackTotal,
    bufferTotal: board.bufferTotal,
    expectedTotal: board.expectedTotal,
    byRegion: board.byRegion,
    remoteBuffered: board.buffer.remote,
    bufferBySegment: board.buffer.bySegment ?? {},
    stackBySegment: board.stack.bySegment ?? {},
  };
}

/** Kick another MAX LIVE wave after this request ends — until day shelves are full. */
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
        body: JSON.stringify({
          source: "auto-continue",
          manual: false,
          mode: "max_live",
        }),
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
      mode: "max_live",
      bufferBoard: null,
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
          await patchHarvestLive({
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

/**
 * WRITE HARVEST — fill harvest_buffer with REMOTE-first jobs while reads are burnt.
 * Continuous passes until Stop or writes soft-quota ≥ block %.
 */
async function executeWriteHarvestRun() {
  const startedAt = new Date().toISOString();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  let bufferTotalLive = 0;
  let sessionSkipped = 0;
  let sessionTrashed = 0;
  let pass = 0;
  let writesBurned = false;
  let emptyStreak = 0;

  try {
    const stackJobs = await readJobs().catch(() => [] as Job[]);
    const buffered0 = await readHarvestBuffer().catch(() => []);
    bufferTotalLive = buffered0.length || (await countHarvestBuffer().catch(() => 0));
    const board0 = await liveBufferBoard(stackJobs);

    await writeHarvestLive({
      running: true,
      mode: "write_harvest",
      startedAt,
      finishedAt: null,
      heartbeatAt: startedAt,
      added: bufferTotalLive,
      skipped: 0,
      trashed: 0,
      segment: null,
      recentAdds: [],
      bufferBoard: board0,
      message: `WRITE HARVEST · REMOTE + AI → buffer · stack ${board0.stackTotal} · buf ${board0.bufferTotal} → ${board0.expectedTotal}`,
      logs: [
        `[${stamp()}] ── WRITE HARVEST · REMOTE + AI Solution/Prompt/No-Code · → harvest_buffer`,
        `[${stamp()}] stack ${board0.stackTotal} · buffer ${board0.bufferTotal} · expected ${board0.expectedTotal}`,
        `[${stamp()}] sources ${enabledSources().map((s) => s.id).join(", ") || "none"}`,
      ],
    });

    heartbeat = setInterval(() => {
      if (isHarvestStopRequested()) {
        stopHeartbeat();
        void patchHarvestLive({
          running: false,
          heartbeatAt: new Date().toISOString(),
          message: "⏹ Stop — exiting WRITE HARVEST",
        }).catch(() => undefined);
        return;
      }
      void patchHarvestLive({
        running: true,
        heartbeatAt: new Date().toISOString(),
        added: bufferTotalLive,
        message: `♥ WRITE HARVEST · buffer ${bufferTotalLive} · stack ${board0.stackTotal} → ${board0.stackTotal + bufferTotalLive}`,
      }).catch(() => undefined);
    }, 12_000);

    // Dedupe against stack + already buffered
    const known: Job[] = [...stackJobs, ...buffered0];

    while (!isHarvestStopRequested()) {
      const gate = await getFirebaseQuotaGate().catch(() => null);
      if (gate?.writesBlocked) {
        writesBurned = true;
        await pushHarvestLog(
          `⛔ Writes burned · ${gate.writesPct}% · WRITE HARVEST stop · buffer ${bufferTotalLive}`,
          {
            running: true,
            added: bufferTotalLive,
            message: `⛔ Writes ≥${gate.writesPct}% · buffer ${bufferTotalLive}`,
          },
        );
        break;
      }

      pass += 1;
      const passTarget = safeRunTarget();
      const expandShelves = emptyStreak >= 1;
      await pushHarvestLog(
        `🔁 WRITE HARVEST pass #${pass} · writes ${gate?.writesPct ?? "?"}% · REMOTE↑ AI↑ · buffer ${bufferTotalLive}${
          expandShelves ? " · expand shelves" : ""
        }`,
        {
          running: true,
          mode: "write_harvest",
          added: bufferTotalLive,
          message: `🔁 pass #${pass} · buffer ${bufferTotalLive} · stack ${board0.stackTotal} → ${board0.stackTotal + bufferTotalLive}`,
        },
      );

      const baseBuf = bufferTotalLive;
      const result = await runHireMax({
        existingJobs: known,
        runTarget: passTarget,
        writeHarvest: true,
        writeExpandShelves: expandShelves,
        onJobsBatch: async (chunk) => {
          if (isHarvestStopRequested()) return;
          const n = await writeHarvestBuffer(chunk);
          bufferTotalLive += n;
          known.push(...chunk);
          const board = await liveBufferBoard(stackJobs);
          board.bufferTotal = Math.max(board.bufferTotal, bufferTotalLive);
          board.expectedTotal = board.stackTotal + board.bufferTotal;
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
          await patchHarvestLive({
            added: bufferTotalLive,
            bufferBoard: board,
            message: `📦 buffer ${bufferTotalLive} · stack ${board.stackTotal} → ${board.stackTotal + bufferTotalLive} · pass #${pass}`,
          });
        },
        onProgress: async (ev) => {
          const stopped = isHarvestStopRequested();
          if (stopped) stopHeartbeat();
          await patchHarvestLive({
            running: !stopped,
            mode: "write_harvest",
            added: bufferTotalLive || baseBuf + ev.added,
            skipped: sessionSkipped + ev.skipped,
            trashed: sessionTrashed + ev.trashed,
            segment: ev.segment,
            message: ev.message,
            ...(stopped
              ? { finishedAt: new Date().toISOString(), running: false }
              : {}),
          });
        },
      });

      sessionSkipped += result.skipped;
      sessionTrashed += result.trashed;

      // Lead-desk style: dry pass ≠ stop — keep spinning until Stop / writes / time
      if (result.added === 0) {
        emptyStreak += 1;
        await pushHarvestLog(
          `○ WRITE HARVEST dry pass #${pass} · streak ${emptyStreak} · buffer ${bufferTotalLive} · продолжаю`,
          {
            running: true,
            added: bufferTotalLive,
            message: `○ Dry #${emptyStreak} · buffer ${bufferTotalLive} · keep going`,
          },
        );
        if (emptyStreak >= 5) {
          await pushHarvestLog(
            `⚪ 5 dry подряд · expand + rotate · buffer ${bufferTotalLive}`,
            {
              running: true,
              added: bufferTotalLive,
              message: `⚪ Dry streak reset · buffer ${bufferTotalLive}`,
            },
          );
          emptyStreak = 1; // stay expanded
        }
      } else {
        emptyStreak = 0;
      }

      if (isHarvestStopRequested()) break;

      await sleep(WAVE_GAP_MS);

      // Soft time guard for Render
      if (Date.now() - Date.parse(startedAt) > WAVE_DEADLINE_MS) {
        await pushHarvestLog(
          `⏱ WRITE HARVEST time budget · buffer ${bufferTotalLive} · passes ${pass}`,
          {
            running: true,
            added: bufferTotalLive,
            message: `⏱ Time · buffer ${bufferTotalLive}`,
          },
        );
        break;
      }
    }

    stopHeartbeat();
    const boardEnd = await liveBufferBoard(stackJobs);
    boardEnd.bufferTotal = Math.max(boardEnd.bufferTotal, bufferTotalLive);
    boardEnd.expectedTotal = boardEnd.stackTotal + boardEnd.bufferTotal;

    const finalMsg = isHarvestStopRequested()
      ? `⏹ WRITE HARVEST stop · +${bufferTotalLive} в буфер · trash ${sessionTrashed} · passes ${pass}`
      : writesBurned
        ? `✅ Writes burned · +${bufferTotalLive} в буфер · после сброса reads — FLUSH`
        : `WRITE HARVEST end · +${bufferTotalLive} в буфер · passes ${pass}`;

    await pushHarvestLog(finalMsg, {
      running: false,
      finishedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      mode: "write_harvest",
      added: bufferTotalLive,
      skipped: sessionSkipped,
      trashed: sessionTrashed,
      bufferBoard: boardEnd,
      message: finalMsg,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pushHarvestLog(`WRITE HARVEST error: ${msg.slice(0, 180)}`, {
      running: false,
      finishedAt: new Date().toISOString(),
      message: "WRITE HARVEST error",
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
    let mode: RunMode = "max_live";
    try {
      const body = (await request.json().catch(() => null)) as {
        manual?: boolean;
        source?: string;
        mode?: string;
      } | null;
      autoContinue =
        body?.source === "auto-continue" ||
        request.headers.get("x-harvest-continue") === "1";
      manual =
        !autoContinue &&
        (body?.manual === true ||
          body?.source === "ui" ||
          request.headers.get("x-harvest-manual") === "1");
      if (body?.mode === "write_harvest") mode = "write_harvest";
    } catch {
      manual = false;
    }

    const writeHarvest = mode === "write_harvest";
    const label = writeHarvest ? "WRITE HARVEST" : "MAX LIVE";

    // WRITE HARVEST is manual-only (like lead-desk).
    if (!manual && writeHarvest) {
      return NextResponse.json({
        started: false,
        message: "WRITE HARVEST только вручную из UI",
        target: safeRunTarget(),
      });
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

    const gate = await getFirebaseQuotaGate().catch(() => null);
    if (writeHarvest) {
      if (gate?.writesBlocked) {
        return NextResponse.json({
          started: false,
          firebaseQuotaBlocked: true,
          message: `⛔ Writes ≥99% · WRITE HARVEST нельзя · ${gate.reason || ""}`,
          firebaseQuota: gate,
          target: safeRunTarget(),
        });
      }
    } else if (gate?.readsBlocked && !autoContinue) {
      return NextResponse.json({
        started: false,
        firebaseQuotaBlocked: true,
        message: `⛔ Reads ≥${gate.readsPct}% · MAX LIVE до сброса${
          !gate.writesBlocked ? " · WRITE HARVEST доступен" : ""
        } · ${gate.reason || ""}`,
        firebaseQuota: gate,
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
        message: live2.message || `${label} already running`,
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

    if (writeHarvest) {
      const stackJobs = await readJobs().catch(() => [] as Job[]);
      const board = await liveBufferBoard(stackJobs);
      await writeHarvestLive({
        running: true,
        mode: "write_harvest",
        startedAt: kickoffAt,
        finishedAt: null,
        heartbeatAt: kickoffAt,
        added: board.bufferTotal,
        skipped: 0,
        trashed: 0,
        segment: null,
        recentAdds: prevKick.recentAdds || [],
        bufferBoard: board,
        message: `WRITE HARVEST · REMOTE · stack ${board.stackTotal} + buf ${board.bufferTotal} → ${board.expectedTotal}`,
        logs: [
          ...(prevKick.logs || []).slice(-80),
          `[${stamp()}] HTTP kickoff · WRITE HARVEST · копилка writes · harvest_buffer`,
        ],
      });

      const run = executeWriteHarvestRun();
      setActiveRun(run);
      void run;
      after(() => getActiveRun() ?? Promise.resolve());

      return NextResponse.json({
        started: true,
        alreadyRunning: false,
        mode: "write_harvest",
        message: `WRITE HARVEST · REMOTE → buffer · stack ${board.stackTotal} · buf ${board.bufferTotal} → ${board.expectedTotal}`,
        bufferBoard: board,
        target: kickTarget,
        configuredTarget: HIRE_RUN_TARGET,
        proxy: proxyPoolSize(),
        proxyMode: proxyModeLabel(),
        firebaseQuota: gate,
      });
    }

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
      mode: "max_live",
      bufferBoard: null,
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
      mode: "max_live",
      dayLeft,
      dayCapacity: dayCeiling(),
      message: `MAX LIVE fill-day · ${dayLeft}/${dayCeiling()} slots open`,
      target: kickTarget,
      configuredTarget: HIRE_RUN_TARGET,
      proxy: proxyPoolSize(),
      proxyMode: proxyModeLabel(),
      modeLabel: env("HIRE_PARSER_MODE", "live"),
      firebaseQuota: gate,
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
