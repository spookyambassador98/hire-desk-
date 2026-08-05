import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import type { Individual, Job } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const INDIVIDUALS_FILE = path.join(DATA_DIR, "individuals.json");

const FS_JOBS = "hire_jobs";
const FS_INDIVIDUALS = "hire_individuals";

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
  const snap = await firestore().collection(FS_JOBS).get();
  return snap.docs.map((d) => d.data() as Job);
}

async function writeJobsFirestore(jobs: Job[]) {
  const db = firestore();
  const keep = new Set(jobs.map((j) => j.id));
  const existing = await db.collection(FS_JOBS).get();
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
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
    for (const job of jobs.slice(i, i + 400)) {
      batch.set(db.collection(FS_JOBS).doc(job.id), job, { merge: true });
    }
    await batch.commit();
  }
}

async function readIndividualsFirestore(): Promise<Individual[]> {
  const snap = await firestore().collection(FS_INDIVIDUALS).get();
  return snap.docs.map((d) => d.data() as Individual);
}

async function writeIndividualsFirestore(rows: Individual[]) {
  const db = firestore();
  const keep = new Set(rows.map((r) => r.id));
  const existing = await db.collection(FS_INDIVIDUALS).get();
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
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
    for (const row of rows.slice(i, i + 400)) {
      batch.set(db.collection(FS_INDIVIDUALS).doc(row.id), row, { merge: true });
    }
    await batch.commit();
  }
}

export async function readRawJobs(): Promise<Job[]> {
  if (firebaseConfigured()) return readJobsFirestore();
  return readJsonFile<Job[]>(JOBS_FILE, []);
}

export async function writeRawJobs(jobs: Job[]) {
  if (firebaseConfigured()) {
    await writeJobsFirestore(jobs);
    return;
  }
  await writeJsonFile(JOBS_FILE, jobs);
}

export async function readRawIndividuals(): Promise<Individual[]> {
  if (firebaseConfigured()) return readIndividualsFirestore();
  return readJsonFile<Individual[]>(INDIVIDUALS_FILE, []);
}

export async function writeRawIndividuals(rows: Individual[]) {
  if (firebaseConfigured()) {
    await writeIndividualsFirestore(rows);
    return;
  }
  await writeJsonFile(INDIVIDUALS_FILE, rows);
}

export function storageLabel(): "firebase" | "local" {
  return firebaseConfigured() ? "firebase" : "local";
}
