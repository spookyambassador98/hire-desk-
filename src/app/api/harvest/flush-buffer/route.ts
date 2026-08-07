import { NextResponse } from "next/server";
import {
  clearHarvestBuffer,
  countHarvestBuffer,
  readHarvestBuffer,
} from "@/lib/harvest/buffer";
import { getFirebaseQuotaGate } from "@/lib/firebaseQuota";
import { jobDedupeKey } from "@/lib/harvest/dedupe";
import { ingestJobsBatch, readJobs } from "@/lib/store";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  try {
    const gate = await getFirebaseQuotaGate().catch(() => null);
    if (gate?.readsBlocked) {
      return NextResponse.json({
        ok: false,
        flushed: 0,
        skipped: 0,
        message: `⛔ Reads still blocked · wait reset · ${gate.reason || ""}`,
        firebaseQuota: gate,
      });
    }

    const buffered = await readHarvestBuffer();
    if (!buffered.length) {
      return NextResponse.json({
        ok: true,
        flushed: 0,
        skipped: 0,
        remaining: 0,
        message: "Buffer empty — nothing to flush",
      });
    }

    const existing = await readJobs().catch(() => [] as Job[]);
    const keys = new Set(existing.map((j) => jobDedupeKey(j)));
    const ids = new Set(existing.map((j) => j.id));

    const fresh: Job[] = [];
    const clearIds: string[] = [];
    for (const row of buffered) {
      clearIds.push(row.id);
      const { bufferedAt: _b, ...job } = row;
      void _b;
      if (ids.has(job.id) || keys.has(jobDedupeKey(job))) continue;
      keys.add(jobDedupeKey(job));
      ids.add(job.id);
      fresh.push(job);
    }

    if (fresh.length) {
      await ingestJobsBatch(fresh);
    }

    const cleared = await clearHarvestBuffer(clearIds);
    const remaining = await countHarvestBuffer().catch(() => 0);

    return NextResponse.json({
      ok: true,
      flushed: fresh.length,
      skipped: buffered.length - fresh.length,
      cleared,
      remaining,
      message:
        fresh.length > 0
          ? `FLUSH · +${fresh.length} → jobs · dupes ${buffered.length - fresh.length} · buffer cleared`
          : `FLUSH · all already in desk (dupes ${buffered.length}) · buffer cleared`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[flush-buffer]", err);
    return NextResponse.json(
      {
        ok: false,
        flushed: 0,
        skipped: 0,
        error: msg.slice(0, 200),
        message: `FLUSH fail · ${msg.slice(0, 120)}`,
      },
      { status: 200 },
    );
  }
}
