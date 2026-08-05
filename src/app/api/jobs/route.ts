import { NextResponse } from "next/server";
import { createJob, deskPayload, type CreateJobInput } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await deskPayload();
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CreateJobInput | null;
  if (!body?.company?.trim() || !body?.role?.trim() || !body?.description?.trim()) {
    return NextResponse.json(
      { ok: false, error: "company_role_description_required" },
      { status: 400 },
    );
  }
  if (body.region !== "europe" && body.region !== "america") {
    return NextResponse.json({ ok: false, error: "bad_region" }, { status: 400 });
  }
  const job = await createJob(body);
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, job, ...payload });
}
