import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  getActiveRun,
  isHarvestPaused,
  pauseRemainingMs,
} from "@/lib/harvest/control";
import { HIRE_RUN_TARGET } from "@/lib/harvest/max";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * External cron → kicks MAX LIVE.
 * Authorization: Bearer $HARVEST_CRON_SECRET
 */
export async function POST(request: Request) {
  const secret = env("HARVEST_CRON_SECRET");
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "HARVEST_CRON_SECRET unset" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (isHarvestPaused()) {
    return NextResponse.json({
      ok: true,
      started: false,
      paused: true,
      message: `Paused · ${Math.ceil(pauseRemainingMs() / 60000)}m`,
    });
  }

  if (getActiveRun()) {
    return NextResponse.json({
      ok: true,
      started: false,
      alreadyRunning: true,
      target: HIRE_RUN_TARGET,
    });
  }

  const port = env("PORT", "3011");
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    `127.0.0.1:${port}`;
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const origin = env("HARVEST_INTERNAL_BASE") || `${proto}://${host}`;

  const res = await fetch(`${origin}/api/harvest/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manual: false, source: "cron" }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ ok: true, kickoff: data });
}
