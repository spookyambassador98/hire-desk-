import { NextResponse } from "next/server";
import { deskPayload, importHarvestJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: string;
  } | null;

  const text = body?.text?.trim() || "";

  if (!text) {
    return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  }

  const result = await importHarvestJobs(text);
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, ...result, ...payload });
}
