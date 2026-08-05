import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import {
  bumpOpsUsage,
  noteFirestoreError,
} from "@/lib/opsUsage";
import type { Individual, Job } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const INDIVIDUALS_FILE = path.join(DATA_DIR, "individuals.json");

const FS_JOBS = "hire_jobs";
const FS_INDIVIDUALS = "hire_individuals";

/** Avoid full collection scans on every telemetry / status poll. */
const CACHE_TTL_MS = 60_000;

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

function jobsFresh(c: StoreCache) {
  return c.jobs != null && Date.now() - c.jobsAt < CACHE_TTL_MS;
}

function individualsFresh(c: StoreCache) {
  return (
    c.individuals != null && Date.now() - c.individualsAt < CACHE_TTL_MS
  );
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
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
  const db = firestore();
  const keep = new Set(jobs.map((j) => j.id));
  try {
    const existing = await db.collection(FS_JOBS).get();
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

export async function readRawJobs(opts: ReadOpts = {}): Promise<Job[]> {
  const c = cache();
  if (!opts.fresh && jobsFresh(c)) return c.jobs!;

  const jobs = firebaseConfigured()
    ? await readJobsFirestore()
    : await readJsonFile<Job[]>(JOBS_FILE, []);
  c.jobs = jobs;
  c.jobsAt = Date.now();
  return jobs;
}

export async function writeRawJobs(jobs: Job[]) {
  if (firebaseConfigured()) {
    await writeJobsFirestore(jobs);
  } else {
    await writeJsonFile(JOBS_FILE, jobs);
  }
  const c = cache();
  c.jobs = jobs;
  c.jobsAt = Date.now();
}

/** Append/merge jobs without rewriting the whole collection. */
export async function upsertRawJobs(jobs: Job[]) {
  if (!jobs.length) return;
  if (firebaseConfigured()) {
    await upsertJobsFirestore(jobs);
  } else {
    const existing = await readJsonFile<Job[]>(JOBS_FILE, []);
    const byId = new Map(existing.map((j) => [j.id, j]));
    for (const j of jobs) byId.set(j.id, j);
    await writeJsonFile(JOBS_FILE, [...byId.values()]);
  }
  const c = cache();
  if (c.jobs) {
    const byId = new Map(c.jobs.map((j) => [j.id, j]));
    for (const j of jobs) byId.set(j.id, j);
    c.jobs = [...byId.values()];
    c.jobsAt = Date.now();
  } else {
    c.jobsAt = 0; // force refresh next read
  }
}

export async function deleteRawJob(id: string): Promise<boolean> {
  if (firebaseConfigured()) {
    await deleteJobFirestore(id);
    const c = cache();
    if (c.jobs) {
      const next = c.jobs.filter((j) => j.id !== id);
      if (next.length === c.jobs.length) return false;
      c.jobs = next;
      c.jobsAt = Date.now();
      return true;
    }
    return true;
  }
  const existing = await readJsonFile<Job[]>(JOBS_FILE, []);
  const next = existing.filter((j) => j.id !== id);
  if (next.length === existing.length) return false;
  await writeJsonFile(JOBS_FILE, next);
  const c = cache();
  c.jobs = next;
  c.jobsAt = Date.now();
  return true;
}

export async function readRawIndividuals(
  opts: ReadOpts = {},
): Promise<Individual[]> {
  const c = cache();
  if (!opts.fresh && individualsFresh(c)) return c.individuals!;

  const rows = firebaseConfigured()
    ? await readIndividualsFirestore()
    : await readJsonFile<Individual[]>(INDIVIDUALS_FILE, []);
  c.individuals = rows;
  c.individualsAt = Date.now();
  return rows;
}

export async function writeRawIndividuals(rows: Individual[]) {
  if (firebaseConfigured()) {
    await writeIndividualsFirestore(rows);
  } else {
    await writeJsonFile(INDIVIDUALS_FILE, rows);
  }
  const c = cache();
  c.individuals = rows;
  c.individualsAt = Date.now();
}

export async function upsertRawIndividuals(rows: Individual[]) {
  if (!rows.length) return;
  if (firebaseConfigured()) {
    await upsertIndividualsFirestore(rows);
  } else {
    const existing = await readJsonFile<Individual[]>(INDIVIDUALS_FILE, []);
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const r of rows) byId.set(r.id, r);
    await writeJsonFile(INDIVIDUALS_FILE, [...byId.values()]);
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
