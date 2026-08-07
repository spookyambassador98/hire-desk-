import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import {
  bumpOpsUsage,
  isFirebaseExhausted,
  noteFirestoreError,
} from "@/lib/opsUsage";
import type { Individual, Job } from "@/lib/types";
import bundledSeedJobs from "@/data/recovery/seed-jobs.json";
import bundledSeedIndividuals from "@/data/recovery/seed-individuals.json";

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const INDIVIDUALS_FILE = path.join(DATA_DIR, "individuals.json");
const SEED_JOBS_FILE = path.join(DATA_DIR, "recovery", "seed-jobs.json");
const SEED_INDIVIDUALS_FILE = path.join(
  DATA_DIR,
  "recovery",
  "seed-individuals.json",
);

const FS_JOBS = "hire_jobs";
const FS_INDIVIDUALS = "hire_individuals";

/** Soft TTL while healthy — avoid full collection scans on every poll. */
const CACHE_TTL_MS = 5 * 60_000;
/** When quota is dead, keep serving memory forever until process restart / UTC reset. */
const CACHE_TTL_EXHAUSTED_MS = 24 * 60 * 60_000;

type StoreCache = {
  jobs: Job[] | null;
  jobsAt: number;
  individuals: Individual[] | null;
  individualsAt: number;
};

const g = globalThis as typeof globalThis & {
  __hirePersistCache?: StoreCache;
};

function cache(): StoreCache {
  if (!g.__hirePersistCache) {
    g.__hirePersistCache = {
      jobs: null,
      jobsAt: 0,
      individuals: null,
      individualsAt: 0,
    };
  }
  return g.__hirePersistCache;
}

function ttlMs() {
  return isFirebaseExhausted() ? CACHE_TTL_EXHAUSTED_MS : CACHE_TTL_MS;
}

function jobsFresh(c: StoreCache) {
  // Never treat an empty array as a fresh cache — that stuck the desk at 0 jobs.
  return (
    c.jobs != null &&
    c.jobs.length > 0 &&
    Date.now() - c.jobsAt < ttlMs()
  );
}

function individualsFresh(c: StoreCache) {
  return (
    c.individuals != null &&
    c.individuals.length > 0 &&
    Date.now() - c.individualsAt < ttlMs()
  );
}

function canTouchFirebase() {
  return firebaseConfigured() && !isFirebaseExhausted();
}

async function readJobsWithFallback(memory: Job[] | null): Promise<Job[]> {
  const primary = await readJsonFile<Job[]>(JOBS_FILE, []);
  if (primary.length) return primary;
  if (memory && memory.length) return memory;
  const diskSeed = await readJsonFile<Job[]>(SEED_JOBS_FILE, []);
  if (diskSeed.length) return diskSeed;
  const bundled = bundledSeedJobs as Job[];
  return Array.isArray(bundled) && bundled.length ? bundled : [];
}

async function readIndividualsWithFallback(
  memory: Individual[] | null,
): Promise<Individual[]> {
  const primary = await readJsonFile<Individual[]>(INDIVIDUALS_FILE, []);
  if (primary.length) return primary;
  if (memory && memory.length) return memory;
  const diskSeed = await readJsonFile<Individual[]>(SEED_INDIVIDUALS_FILE, []);
  if (diskSeed.length) return diskSeed;
  const bundled = bundledSeedIndividuals as Individual[];
  return Array.isArray(bundled) && bundled.length ? bundled : [];
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, "recovery"), { recursive: true });
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonFile<T>(file: string, data: T) {
  await ensureDataDir();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function readJobsFirestore(): Promise<Job[]> {
  try {
    const snap = await firestore().collection(FS_JOBS).get();
    await bumpOpsUsage({ reads: Math.max(1, snap.size) });
    return snap.docs.map((d) => d.data() as Job);
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

async function writeJobsFirestore(jobs: Job[]) {
  // Never wipe the cloud collection with an empty/near-empty replace.
  if (jobs.length === 0) {
    console.error(
      "[persistence] REFUSED writeJobsFirestore([]) — would delete all hire_jobs",
    );
    throw new Error("Refused empty Firebase jobs write (wipe guard)");
  }
  const db = firestore();
  const keep = new Set(jobs.map((j) => j.id));
  try {
    const existing = await db.collection(FS_JOBS).get();
    // If we're replacing with a tiny set vs a large cloud DB, refuse mass-delete
    if (existing.size >= 20 && jobs.length < Math.floor(existing.size * 0.25)) {
      console.error(
        `[persistence] REFUSED writeJobsFirestore shrink ${existing.size}→${jobs.length}`,
      );
      throw new Error(
        `Refused Firebase jobs shrink ${existing.size}→${jobs.length} (wipe guard)`,
      );
    }
    let writes = 0;
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops > 0) {
        await batch.commit();
        writes += ops;
        batch = db.batch();
        ops = 0;
      }
    };
    for (const doc of existing.docs) {
      if (!keep.has(doc.id)) {
        batch.delete(doc.ref);
        ops += 1;
        if (ops >= 400) await flush();
      }
    }
    await flush();
    for (let i = 0; i < jobs.length; i += 400) {
      batch = db.batch();
      const chunk = jobs.slice(i, i + 400);
      for (const job of chunk) {
        batch.set(db.collection(FS_JOBS).doc(job.id), job, { merge: true });
      }
      await batch.commit();
      writes += chunk.length;
    }
    await bumpOpsUsage({
      reads: Math.max(1, existing.size),
      writes,
    });
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

/** Write only the given jobs — no full-collection rewrite. */
async function upsertJobsFirestore(jobs: Job[]) {
  if (!jobs.length) return;
  const db = firestore();
  let writes = 0;
  try {
    for (let i = 0; i < jobs.length; i += 400) {
      const batch = db.batch();
      const chunk = jobs.slice(i, i + 400);
      for (const job of chunk) {
        batch.set(db.collection(FS_JOBS).doc(job.id), job, { merge: true });
      }
      await batch.commit();
      writes += chunk.length;
    }
    await bumpOpsUsage({ writes });
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

async function deleteJobFirestore(id: string) {
  try {
    await firestore().collection(FS_JOBS).doc(id).delete();
    await bumpOpsUsage({ writes: 1 });
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

async function readIndividualsFirestore(): Promise<Individual[]> {
  try {
    const snap = await firestore().collection(FS_INDIVIDUALS).get();
    await bumpOpsUsage({ reads: Math.max(1, snap.size) });
    return snap.docs.map((d) => d.data() as Individual);
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

async function writeIndividualsFirestore(rows: Individual[]) {
  const db = firestore();
  const keep = new Set(rows.map((r) => r.id));
  try {
    const existing = await db.collection(FS_INDIVIDUALS).get();
    let writes = 0;
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops > 0) {
        await batch.commit();
        writes += ops;
        batch = db.batch();
        ops = 0;
      }
    };
    for (const doc of existing.docs) {
      if (!keep.has(doc.id)) {
        batch.delete(doc.ref);
        ops += 1;
        if (ops >= 400) await flush();
      }
    }
    await flush();
    for (let i = 0; i < rows.length; i += 400) {
      batch = db.batch();
      const chunk = rows.slice(i, i + 400);
      for (const row of chunk) {
        batch.set(db.collection(FS_INDIVIDUALS).doc(row.id), row, {
          merge: true,
        });
      }
      await batch.commit();
      writes += chunk.length;
    }
    await bumpOpsUsage({
      reads: Math.max(1, existing.size),
      writes,
    });
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

async function upsertIndividualsFirestore(rows: Individual[]) {
  if (!rows.length) return;
  const db = firestore();
  let writes = 0;
  try {
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      const chunk = rows.slice(i, i + 400);
      for (const row of chunk) {
        batch.set(db.collection(FS_INDIVIDUALS).doc(row.id), row, {
          merge: true,
        });
      }
      await batch.commit();
      writes += chunk.length;
    }
    await bumpOpsUsage({ writes });
  } catch (err) {
    noteFirestoreError(err);
    throw err;
  }
}

export type ReadOpts = { fresh?: boolean };

/**
 * Prefer memory → Firestore → local JSON → bundled recovery seed.
 * Never throw RESOURCE_EXHAUSTED up to the homepage — serve stale / empty.
 */
export async function readRawJobs(opts: ReadOpts = {}): Promise<Job[]> {
  const c = cache();
  if (!opts.fresh && jobsFresh(c)) return c.jobs!;
  // Stale cache beats crashing the desk while quota is dead
  if (isFirebaseExhausted() && c.jobs && c.jobs.length) return c.jobs;
  if (isFirebaseExhausted()) {
    const rescued = await readJobsWithFallback(c.jobs);
    c.jobs = rescued;
    c.jobsAt = Date.now();
    return rescued;
  }

  try {
    let jobs: Job[];
    if (canTouchFirebase()) {
      try {
        jobs = await readJobsFirestore();
      } catch (err) {
        noteFirestoreError(err);
        jobs = await readJobsWithFallback(c.jobs);
        console.error(
          `[persistence] Firestore jobs fail → fallback ${jobs.length}`,
        );
        c.jobs = jobs;
        c.jobsAt = Date.now();
        return jobs;
      }
    } else {
      jobs = await readJobsWithFallback(c.jobs);
    }
    // Never clobber a fat local mirror with an empty cloud read
    if (
      Array.isArray(jobs) &&
      jobs.length === 0 &&
      c.jobs &&
      c.jobs.length > 0
    ) {
      console.error(
        "[persistence] ignoring empty Firestore jobs — keeping memory cache",
      );
      return c.jobs;
    }
    const local = await readJobsWithFallback(c.jobs);
    if (Array.isArray(jobs) && jobs.length === 0 && local.length > 0) {
      console.error(
        `[persistence] empty Firestore vs local/seed ${local.length} — serving recovery`,
      );
      c.jobs = local;
      c.jobsAt = Date.now();
      if (canTouchFirebase()) {
        try {
          await upsertJobsFirestore(local);
        } catch (err) {
          noteFirestoreError(err);
        }
      }
      return local;
    }
    c.jobs = jobs;
    c.jobsAt = Date.now();
    // Mirror to local so Render disk can serve if Firebase dies mid-day
    if (canTouchFirebase() && jobs.length > 0) {
      void writeJsonFile(JOBS_FILE, jobs).catch(() => undefined);
    }
    return jobs;
  } catch (err) {
    noteFirestoreError(err);
    if (c.jobs && c.jobs.length) return c.jobs;
    return readJobsWithFallback(null);
  }
}

export async function writeRawJobs(jobs: Job[]) {
  if (jobs.length === 0) {
    console.error("[persistence] REFUSED writeRawJobs([])");
    throw new Error("Refused empty jobs write");
  }
  // Always keep a local mirror for outage mode
  await writeJsonFile(JOBS_FILE, jobs).catch(() => undefined);
  if (canTouchFirebase()) {
    try {
      await writeJobsFirestore(jobs);
    } catch (err) {
      noteFirestoreError(err);
      // local already written — desk stays usable
    }
  }
  const c = cache();
  c.jobs = jobs;
  c.jobsAt = Date.now();
}

/** Append/merge jobs without rewriting the whole collection. */
export async function upsertRawJobs(jobs: Job[]) {
  if (!jobs.length) return;
  if (canTouchFirebase()) {
    try {
      await upsertJobsFirestore(jobs);
    } catch (err) {
      noteFirestoreError(err);
    }
  }
  // Local merge always
  try {
    const existing = await readJsonFile<Job[]>(JOBS_FILE, []);
    const byId = new Map(existing.map((j) => [j.id, j]));
    for (const j of jobs) byId.set(j.id, j);
    await writeJsonFile(JOBS_FILE, [...byId.values()]);
  } catch {
    /* ignore */
  }
  const c = cache();
  if (c.jobs) {
    const byId = new Map(c.jobs.map((j) => [j.id, j]));
    for (const j of jobs) byId.set(j.id, j);
    c.jobs = [...byId.values()];
    c.jobsAt = Date.now();
  } else {
    c.jobsAt = 0;
  }
}

export async function deleteRawJob(id: string): Promise<boolean> {
  if (canTouchFirebase()) {
    try {
      await deleteJobFirestore(id);
    } catch (err) {
      noteFirestoreError(err);
    }
  }
  const existing = await readJsonFile<Job[]>(JOBS_FILE, []);
  const next = existing.filter((j) => j.id !== id);
  const changed = next.length !== existing.length;
  if (changed) await writeJsonFile(JOBS_FILE, next).catch(() => undefined);
  const c = cache();
  if (c.jobs) {
    const filtered = c.jobs.filter((j) => j.id !== id);
    const hit = filtered.length !== c.jobs.length;
    c.jobs = filtered;
    c.jobsAt = Date.now();
    return hit || changed;
  }
  return changed;
}

export async function readRawIndividuals(
  opts: ReadOpts = {},
): Promise<Individual[]> {
  const c = cache();
  if (!opts.fresh && individualsFresh(c)) return c.individuals!;
  if (isFirebaseExhausted() && c.individuals && c.individuals.length) {
    return c.individuals;
  }
  if (isFirebaseExhausted()) {
    const rescued = await readIndividualsWithFallback(c.individuals);
    c.individuals = rescued;
    c.individualsAt = Date.now();
    return rescued;
  }

  try {
    const rows = canTouchFirebase()
      ? await readIndividualsFirestore()
      : await readIndividualsWithFallback(c.individuals);
    if (
      Array.isArray(rows) &&
      rows.length === 0
    ) {
      const local = await readIndividualsWithFallback(c.individuals);
      if (local.length > 0) {
        c.individuals = local;
        c.individualsAt = Date.now();
        return local;
      }
    }
    c.individuals = rows;
    c.individualsAt = Date.now();
    if (canTouchFirebase() && rows.length > 0) {
      void writeJsonFile(INDIVIDUALS_FILE, rows).catch(() => undefined);
    }
    return rows;
  } catch (err) {
    noteFirestoreError(err);
    if (c.individuals && c.individuals.length) return c.individuals;
    return readIndividualsWithFallback(null);
  }
}

export async function writeRawIndividuals(rows: Individual[]) {
  await writeJsonFile(INDIVIDUALS_FILE, rows).catch(() => undefined);
  if (canTouchFirebase()) {
    try {
      await writeIndividualsFirestore(rows);
    } catch (err) {
      noteFirestoreError(err);
    }
  }
  const c = cache();
  c.individuals = rows;
  c.individualsAt = Date.now();
}

export async function upsertRawIndividuals(rows: Individual[]) {
  if (!rows.length) return;
  if (canTouchFirebase()) {
    try {
      await upsertIndividualsFirestore(rows);
    } catch (err) {
      noteFirestoreError(err);
    }
  }
  try {
    const existing = await readJsonFile<Individual[]>(INDIVIDUALS_FILE, []);
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const r of rows) byId.set(r.id, r);
    await writeJsonFile(INDIVIDUALS_FILE, [...byId.values()]);
  } catch {
    /* ignore */
  }
  const c = cache();
  if (c.individuals) {
    const byId = new Map(c.individuals.map((r) => [r.id, r]));
    for (const r of rows) byId.set(r.id, r);
    c.individuals = [...byId.values()];
    c.individualsAt = Date.now();
  } else {
    c.individualsAt = 0;
  }
}

/** Cheap counts for ops telemetry — never forces a full scan. */
export function peekStoreCounts(): {
  jobs: number | null;
  individuals: number | null;
  jobsCachedAt: number | null;
  individualsCachedAt: number | null;
} {
  const c = cache();
  return {
    jobs: c.jobs?.length ?? null,
    individuals: c.individuals?.length ?? null,
    jobsCachedAt: c.jobs ? c.jobsAt : null,
    individualsCachedAt: c.individuals ? c.individualsAt : null,
  };
}

export function storageLabel(): "firebase" | "local" {
  return firebaseConfigured() ? "firebase" : "local";
}
