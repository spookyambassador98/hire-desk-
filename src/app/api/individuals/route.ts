import { NextResponse } from "next/server";
import {
  createIndividual,
  deskPayload,
  seedIndividualsFromSamples,
  type CreateIndividualInput,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("seed") === "1") {
    await seedIndividualsFromSamples();
  }
  const payload = await deskPayload();
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CreateIndividualInput | null;
  if (!body?.name?.trim() || !body?.company?.trim() || !body?.kind) {
    return NextResponse.json(
      { ok: false, error: "name_company_kind_required" },
      { status: 400 },
    );
  }
  if (body.region !== "europe" && body.region !== "america") {
    return NextResponse.json({ ok: false, error: "bad_region" }, { status: 400 });
  }
  const individual = await createIndividual(body);
  const payload = await deskPayload();
  return NextResponse.json({ ok: true, individual, ...payload });
}
