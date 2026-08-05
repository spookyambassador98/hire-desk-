import { NextResponse, after } from "next/server";
import {
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
  readHarvestLive,
  writeHarvestLive,
} from "@/lib/harvest/liveStore";
import { HIRE_RUN_TARGET } from "@/lib/harvest/max";
import { runHireMax } from "@/lib/harvest/runLive";
import { proxyPoolSize } from "@/lib/harvest/proxyPool";
import { enabledSources } from "@/lib/harvest/sources";
import { env } from "@/lib/env";
import { ingestJobsBatch, readJobs } from "@/lib/store";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function executeHarvestRun() {
  const startedAt = new Date().toISOString();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  try {
    await writeHarvestLive({
      running: true,
      startedAt,
      finishedAt: null,
      heartbeatAt: startedAt,
      added: 0,
      skipped: 0,
      trashed: 0,
      segment: null,
      message: `MAX LIVE · target ≥${HIRE_RUN_TARGET}`,
      logs: [
        `[${stamp()}] MAX LIVE start · target ≥${HIRE_RUN_TARGET}`,
        `[${stamp()}] sources ${enabledSources().map((s) => s.id).join(", ") || "none"}`,
        `[${stamp()}] proxy ${proxyPoolSize() ? `ON (${proxyPoolSize()})` : "OFF"}`,
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
        message: "♥ heartbeat · engine alive",
      }).catch(() => undefined);
    }, 12_000);

    const existing = await readJobs();
    const result = await runHireMax({
      existingJobs: existing,
      runTarget: HIRE_RUN_TARGET,
      onJobsBatch: async (chunk) => {
        if (isHarvestStopRequested()) return;
        await ingestJobsBatch(chunk);
      },
      onProgress: async (ev) => {
        const stopped = isHarvestStopRequested();
        if (stopped) stopHeartbeat();
        await pushHarvestLog(ev.message, {
          running: !stopped,
          added: ev.added,
          skipped: ev.skipped,
          trashed: ev.trashed,
          segment: ev.segment,
          message: ev.message,
          ...(stopped
            ? { finishedAt: new Date().toISOString(), running: false }
            : {}),
        });
      },
    });

    stopHeartbeat();
    await pushHarvestLog(result.message, {
      running: false,
      finishedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      added: result.added,
      skipped: result.skipped,
      trashed: result.trashed,
      message: result.message,
    });
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
    try {
      const body = (await request.json().catch(() => null)) as {
        manual?: boolean;
        source?: string;
      } | null;
      manual =
        body?.manual === true ||
        body?.source === "ui" ||
        request.headers.get("x-harvest-manual") === "1";
    } catch {
      manual = false;
    }

    if (!manual && isHarvestPaused()) {
      const mins = Math.ceil(pauseRemainingMs() / 60_000);
      return NextResponse.json({
        started: false,
        paused: true,
        message: `Paused after STOP · ~${mins}m · press MAX LIVE`,
        target: HIRE_RUN_TARGET,
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
        target: HIRE_RUN_TARGET,
      });
    }

    if (manual) beginManualRun();

    const kickoffAt = new Date().toISOString();
    await writeHarvestLive({
      running: true,
      startedAt: kickoffAt,
      finishedAt: null,
      heartbeatAt: kickoffAt,
      added: 0,
      skipped: 0,
      trashed: 0,
      segment: null,
      message: `MAX LIVE kicked · ≥${HIRE_RUN_TARGET}`,
      logs: [
        `[${stamp()}] HTTP kickoff · ${manual ? "manual" : "cron"}`,
      ],
    });

    const run = executeHarvestRun();
    setActiveRun(run);
    void run;
    after(() => getActiveRun() ?? Promise.resolve());

    return NextResponse.json({
      started: true,
      alreadyRunning: false,
      message: `MAX LIVE started · target ≥${HIRE_RUN_TARGET}`,
      target: HIRE_RUN_TARGET,
      proxy: proxyPoolSize(),
      mode: env("HIRE_PARSER_MODE", "live"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        started: false,
        error: msg.slice(0, 200),
        message: `Start failed: ${msg.slice(0, 120)}`,
        target: HIRE_RUN_TARGET,
      },
      { status: 200 },
    );
  }
}
