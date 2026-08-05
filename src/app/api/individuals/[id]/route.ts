import { NextResponse } from "next/server";
import {
  deleteIndividual,
  deskPayload,
  patchIndividual,
  type PatchIndividualInput,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as PatchIndividualInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const individual = await patchIndividual(id, body);
  if (!individual) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, individual, ...payload });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteIndividual(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, ...payload });
}
