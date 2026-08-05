import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const expected = process.env.HIRE_DESK_ACCESS_CODE || "APEX-HIRE";
  const code = (body.code || "").trim();
  if (!code || code !== expected) {
    return NextResponse.json({ ok: false, error: "bad_code" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
