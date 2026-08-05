import { NextResponse } from "next/server";
import { logActivity, readActivities, type HireActivityType } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const activities = await readActivities(7);
  return NextResponse.json({ activities });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    type?: HireActivityType;
    entityId?: string | null;
    entityLabel?: string | null;
    detail?: string | null;
  } | null;
  if (!body?.type) {
    return NextResponse.json({ ok: false, error: "type_required" }, { status: 400 });
  }
  const activity = await logActivity({
    type: body.type,
    entityId: body.entityId,
    entityLabel: body.entityLabel,
    detail: body.detail,
  });
  return NextResponse.json({ ok: true, activity });
}
