import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keep-alive for Render free tier — hit every ~10–14 min. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "hire-desk",
    at: new Date().toISOString(),
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
