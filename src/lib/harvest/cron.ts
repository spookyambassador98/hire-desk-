import { env, envNum } from "@/lib/env";
import {
  getActiveRun,
  isHarvestPaused,
} from "./control";
import { pushHarvestLog } from "./liveStore";
import { HIRE_RUN_TARGET } from "./max";

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * In-process auto MAX LIVE.
 * Kicks via HTTP to avoid bundling run route into instrumentation.
 */
export function startHarvestCron() {
  if (timer) return;
  const ms = envNum("HARVEST_AUTO_CRON_MS", 150 * 60_000);
  console.log(`[harvest-cron] auto every ${Math.round(ms / 60000)}m`);

  timer = setInterval(() => {
    void tick();
  }, ms);

  setTimeout(() => void tick(), 90_000);
}

async function tick() {
  if (isHarvestPaused()) {
    console.log("[harvest-cron] skipped · paused");
    return;
  }
  if (getActiveRun()) {
    console.log("[harvest-cron] skipped · already running");
    return;
  }
  const port = env("PORT", "3011");
  const base = env("HARVEST_INTERNAL_BASE", `http://127.0.0.1:${port}`);
  try {
    const res = await fetch(`${base}/api/harvest/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manual: false, source: "auto-cron" }),
    });
    const data = (await res.json()) as { message?: string };
    console.log("[harvest-cron] kickoff", data);
    await pushHarvestLog(
      `Auto-cron · ${data.message || "ok"} · target ≥${HIRE_RUN_TARGET}`,
    ).catch(() => undefined);
  } catch (err) {
    console.error("[harvest-cron] fail", err);
  }
}
