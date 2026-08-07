import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isFirebaseExhausted } from "@/lib/opsUsage";
import { peekStoreCounts, storageLabel } from "@/lib/persistence";
import { readJobs } from "@/lib/store";
import bundledSeedJobs from "@/data/recovery/seed-jobs.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const seedPath = path.join(
    process.cwd(),
    "data",
    "recovery",
    "seed-jobs.json",
  );
  let seedOnDisk = false;
  let seedDiskCount = 0;
  try {
    const raw = await fs.readFile(seedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown[];
    seedOnDisk = Array.isArray(parsed);
    seedDiskCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    seedOnDisk = false;
  }

  const jobs = await readJobs().catch(() => []);
  const peek = peekStoreCounts();

  return NextResponse.json({
    ok: true,
    storage: storageLabel(),
    firebaseExhausted: isFirebaseExhausted(),
    jobsLoaded: jobs.length,
    cacheJobs: peek.jobs,
    seedBundled: Array.isArray(bundledSeedJobs)
      ? bundledSeedJobs.length
      : 0,
    seedOnDisk,
    seedDiskCount,
    cwd: process.cwd(),
  });
}
