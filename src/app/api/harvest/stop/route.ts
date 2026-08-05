import { NextResponse } from "next/server";
import { requestHarvestStop } from "@/lib/harvest/control";
import { pushHarvestLog, writeHarvestLive } from "@/lib/harvest/liveStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  requestHarvestStop();
  await writeHarvestLive({
    running: false,
    finishedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    message: "⏹ Stopped · auto-cron paused 6h",
  });
  await pushHarvestLog("⏹ STOP — abort + cron pause 6h", {
    running: false,
    finishedAt: new Date().toISOString(),
    message: "⏹ Stopped · auto-cron paused 6h",
  });
  return NextResponse.json({ ok: true, stopped: true });
}
