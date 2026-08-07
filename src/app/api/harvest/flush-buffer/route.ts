import { NextResponse } from "next/server";
import {
  clearHarvestBuffer,
  countHarvestBuffer,
  readHarvestBuffer,
  readHarvestBufferStats,
  resetHarvestBufferStats,
} from "@/lib/harvest/buffer";
import { getFirebaseQuotaGate } from "@/lib/firebaseQuota";
import { jobDedupeKey } from "@/lib/harvest/dedupe";
import {
  ingestJobsBatch,
  ingestJobsBatchWriteOnly,
  readJobs,
} from "@/lib/store";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function stripBuffered(row: { bufferedAt?: string } & Job): Job {
  const { bufferedAt: _b, ...job } = row;
  void _b;
  return job;
}

export async function POST() {
  try {
    const gate = await getFirebaseQuotaGate().catch(() => null);
    const readsBlocked = Boolean(gate?.readsBlocked || gate?.exhausted);

    const buffered = await readHarvestBuffer();
    const stats = await readHarvestBufferStats().catch(() => ({
      total: 0,
      byRegion: {},
      bySegment: {},
      remote: 0,
      updatedAt: new Date().toISOString(),
    }));

    if (!buffered.length) {
      if ((stats.total || 0) > 0) {
        await resetHarvestBufferStats().catch(() => undefined);
      }
      return NextResponse.json({
        ok: false,
        flushed: 0,
        skipped: 0,
        remaining: 0,
        message:
          stats.total > 0
            ? `⛔ Буфер пуст на сервере (stats было ${stats.total}) · stats сброшены · перезапусти WRITE HARVEST`
            : "Буфер пуст — нечего сливать",
        firebaseQuota: gate,
      });
    }

    const clearIds = buffered.map((r) => r.id);
    let fresh: Job[] = [];
    let skipped = 0;

    if (readsBlocked) {
      // Writes-only path — no full hire_jobs scan while reads are dead.
      fresh = buffered.map(stripBuffered);
      const ing = await ingestJobsBatchWriteOnly(fresh);
      fresh = fresh.slice(0, ing.added);
    } else {
      const existing = await readJobs().catch(() => [] as Job[]);
      const keys = new Set(existing.map((j) => jobDedupeKey(j)));
      const ids = new Set(existing.map((j) => j.id));
      for (const row of buffered) {
        const job = stripBuffered(row);
        if (ids.has(job.id) || keys.has(jobDedupeKey(job))) {
          skipped += 1;
          continue;
        }
        keys.add(jobDedupeKey(job));
        ids.add(job.id);
        fresh.push(job);
      }
      if (fresh.length) {
        await ingestJobsBatch(fresh);
      }
    }

    const cleared = await clearHarvestBuffer(clearIds);
    const remaining = await countHarvestBuffer().catch(() => 0);

    const msg =
      fresh.length > 0
        ? readsBlocked
          ? `ВЛИТЬ · +${fresh.length} → jobs (write-only · reads blocked) · буфер −${cleared}`
          : `ВЛИТЬ · +${fresh.length} → jobs · дублей ${skipped} · буфер очищен`
        : skipped > 0
          ? `ВЛИТЬ · всё уже в desk (дубли ${skipped}) · буфер очищен`
          : `ВЛИТЬ · 0 новых · буфер очищен`;

    return NextResponse.json({
      ok: fresh.length > 0 || cleared > 0,
      flushed: fresh.length,
      skipped,
      cleared,
      remaining,
      writeOnly: readsBlocked,
      message: msg,
      firebaseQuota: gate,
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
        message: `ВЛИТЬ fail · ${msg.slice(0, 120)}`,
      },
      { status: 200 },
    );
  }
}
