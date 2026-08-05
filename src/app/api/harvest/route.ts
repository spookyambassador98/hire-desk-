import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { deskPayload, importHarvestJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: string;
    useSample?: boolean;
  } | null;

  let text = body?.text?.trim() || "";
  if (body?.useSample || text === "__sample__") {
    text = await fs.readFile(
      path.join(process.cwd(), "data", "harvest.sample.json"),
      "utf8",
    );
  }

  if (!text) {
    return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  }

  const result = await importHarvestJobs(text);
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, ...result, ...payload });
}
