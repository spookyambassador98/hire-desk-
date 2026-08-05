import { NextResponse } from "next/server";
import {
  deleteJob,
  deskPayload,
  patchJob,
  type PatchJobInput,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as PatchJobInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const job = await patchJob(id, body);
  if (!job) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, job, ...payload });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteJob(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, ...payload });
}
