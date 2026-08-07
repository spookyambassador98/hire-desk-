import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import {
  bumpOpsUsage,
  isFirebaseExhausted,
  noteFirestoreError,
} from "@/lib/opsUsage";
import type { Job, Region } from "@/lib/types";
import type { HireSegmentId } from "./max";
import { HIRE_SEGMENTS } from "./max";

export type HarvestBufferRow = Job & { bufferedAt: string };

export type BufferCountBoard = {
  total: number;
  byRegion: Partial<Record<Region, number>>;
  bySegment: Partial<Record<string, number>>;
  remote: number;
  updatedAt: string;
};

export type HarvestBufferBoard = {
  stackTotal: number;
  bufferTotal: number;
  expectedTotal: number;
  stack: BufferCountBoard;
  buffer: BufferCountBoard;
  byRegion: Record<
    Region,
    { stack: number; buffer: number; expected: number }
  >;
};

const DATA_DIR = path.join(process.cwd(), "data");
const BUFFER_FILE = path.join(DATA_DIR, "harvest-buffer.json");
const STATS_FILE = path.join(DATA_DIR, "harvest-buffer-stats.json");
const FS_BUFFER = "hire_harvest_buffer";
const META_STATS = "harvest_buffer_stats";

const g = globalThis as typeof globalThis & {
  __hireHarvestBuffer?: HarvestBufferRow[];
  __hireHarvestBufferStats?: BufferCountBoard;
};

function emptyBoard(): BufferCountBoard {
  return {
    total: 0,
    byRegion: { europe: 0, america: 0, asia: 0 },
    bySegment: {},
    remote: 0,
    updatedAt: new Date().toISOString(),
  };
}

function segmentFromSource(source: string | null | undefined): string | null {
  const m = /^max:([a-z0-9_]+):/i.exec(source || "");
  return m?.[1] || null;
}

function isRemoteJob(job: Pick<Job, "remote" | "location" | "description">) {
  if (job.remote === true) return true;
  const blob = `${job.location || ""} ${job.description || ""}`;
  return /\bremote\b|\bdistributed\b|\bwork\s+from\s+home\b|\bwfh\b|\banywhere\b/i.test(
    blob,
  );
}

function tallyJobs(jobs: Job[]): BufferCountBoard {
  const board = emptyBoard();
  for (const j of jobs) {
    board.total += 1;
    const r = j.region === "america" || j.region === "asia" ? j.region : "europe";
    board.byRegion[r] = (board.byRegion[r] ?? 0) + 1;
    const seg = segmentFromSource(j.source);
    if (seg) board.bySegment[seg] = (board.bySegment[seg] ?? 0) + 1;
    if (isRemoteJob(j)) board.remote += 1;
  }
  board.updatedAt = new Date().toISOString();
  return board;
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readDiskBuffer(): Promise<HarvestBufferRow[]> {
  try {
    await ensureDir();
    const raw = await fs.readFile(BUFFER_FILE, "utf8");
    const parsed = JSON.parse(raw) as HarvestBufferRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeDiskBuffer(rows: HarvestBufferRow[]) {
  await ensureDir();
  const tmp = `${BUFFER_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(tmp, BUFFER_FILE);
}

async function readDiskStats(): Promise<BufferCountBoard | null> {
  try {
    await ensureDir();
    const raw = await fs.readFile(STATS_FILE, "utf8");
    return JSON.parse(raw) as BufferCountBoard;
  } catch {
    return null;
  }
}

async function writeDiskStats(board: BufferCountBoard) {
  await ensureDir();
  const tmp = `${STATS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(board, null, 2), "utf8");
  await fs.rename(tmp, STATS_FILE);
}

function memRows(): HarvestBufferRow[] {
  if (!g.__hireHarvestBuffer) g.__hireHarvestBuffer = [];
  return g.__hireHarvestBuffer;
}

function setMemRows(rows: HarvestBufferRow[]) {
  g.__hireHarvestBuffer = rows;
}

function setMemStats(board: BufferCountBoard) {
  g.__hireHarvestBufferStats = board;
}

async function tryWriteFirebaseRows(rows: HarvestBufferRow[]) {
  if (!firebaseConfigured() || isFirebaseExhausted()) return;
  if (!rows.length) return;
  try {
    const db = firestore();
    const batchSize = 400;
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const batch = db.batch();
      for (const row of slice) {
        batch.set(db.collection(FS_BUFFER).doc(row.id), row, { merge: true });
      }
      await batch.commit();
      await bumpOpsUsage({ writes: slice.length });
    }
  } catch (err) {
    noteFirestoreError(err);
  }
}

async function tryDeleteFirebaseIds(ids: string[]) {
  if (!firebaseConfigured() || isFirebaseExhausted()) return;
  if (!ids.length) return;
  try {
    const db = firestore();
    for (let i = 0; i < ids.length; i += 400) {
      const slice = ids.slice(i, i + 400);
      const batch = db.batch();
      for (const id of slice) {
        batch.delete(db.collection(FS_BUFFER).doc(id));
      }
      await batch.commit();
      await bumpOpsUsage({ writes: slice.length });
    }
  } catch (err) {
    noteFirestoreError(err);
  }
}

async function tryWriteFirebaseStats(board: BufferCountBoard) {
  if (!firebaseConfigured() || isFirebaseExhausted()) return;
  try {
    await firestore().collection("meta").doc(META_STATS).set(board, {
      merge: true,
    });
    await bumpOpsUsage({ writes: 1 });
  } catch (err) {
    noteFirestoreError(err);
  }
}

async function tryReadFirebaseStats(): Promise<BufferCountBoard | null> {
  if (!firebaseConfigured() || isFirebaseExhausted()) return null;
  try {
    const snap = await firestore().collection("meta").doc(META_STATS).get();
    await bumpOpsUsage({ reads: 1 });
    if (!snap.exists) return null;
    return snap.data() as BufferCountBoard;
  } catch (err) {
    noteFirestoreError(err);
    return null;
  }
}

export async function readHarvestBufferStats(): Promise<BufferCountBoard> {
  if (g.__hireHarvestBufferStats && g.__hireHarvestBufferStats.total >= 0) {
    return g.__hireHarvestBufferStats;
  }
  const disk = await readDiskStats();
  if (disk) {
    setMemStats(disk);
    return disk;
  }
  const fb = await tryReadFirebaseStats();
  if (fb) {
    setMemStats(fb);
    await writeDiskStats(fb).catch(() => undefined);
    return fb;
  }
  const rows = await readHarvestBuffer();
  const board = tallyJobs(rows);
  setMemStats(board);
  return board;
}

export async function readHarvestBuffer(): Promise<HarvestBufferRow[]> {
  if (memRows().length) return memRows();
  const disk = await readDiskBuffer();
  if (disk.length) {
    setMemRows(disk);
    return disk;
  }
  const fb = await tryReadFirebaseBuffer();
  if (fb.length) {
    setMemRows(fb);
    await writeDiskBuffer(fb).catch(() => undefined);
    const board = tallyJobs(fb);
    setMemStats(board);
    await writeDiskStats(board).catch(() => undefined);
    return fb;
  }
  return [];
}

/** Load buffer docs from Firestore (survives Render restarts / other instances). */
async function tryReadFirebaseBuffer(): Promise<HarvestBufferRow[]> {
  if (!firebaseConfigured()) return [];
  try {
    const snap = await firestore().collection(FS_BUFFER).limit(500).get();
    await bumpOpsUsage({ reads: Math.max(1, snap.size) });
    if (snap.empty) return [];
    return snap.docs.map((d) => {
      const data = d.data() as HarvestBufferRow;
      return { ...data, id: data.id || d.id };
    });
  } catch (err) {
    noteFirestoreError(err);
    return [];
  }
}

export async function resetHarvestBufferStats() {
  const empty = emptyBoard();
  setMemStats(empty);
  setMemRows([]);
  await writeDiskStats(empty).catch(() => undefined);
  await writeDiskBuffer([]).catch(() => undefined);
  await tryWriteFirebaseStats(empty);
}

export async function countHarvestBuffer(): Promise<number> {
  const stats = await readHarvestBufferStats();
  if (stats.total > 0) return stats.total;
  const rows = await readHarvestBuffer();
  return rows.length;
}

/** Append jobs to harvest buffer (disk + optional Firebase). */
export async function writeHarvestBuffer(jobs: Job[]): Promise<number> {
  if (!jobs.length) return 0;
  const at = new Date().toISOString();
  const incoming: HarvestBufferRow[] = jobs.map((j) => ({
    ...j,
    bufferedAt: at,
  }));

  const existing = await readHarvestBuffer();
  const seen = new Set(existing.map((j) => j.id));
  const fresh = incoming.filter((j) => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    return true;
  });
  if (!fresh.length) return 0;

  const next = [...fresh, ...existing];
  setMemRows(next);
  await writeDiskBuffer(next);

  const board = tallyJobs(next);
  setMemStats(board);
  await writeDiskStats(board);
  await tryWriteFirebaseRows(fresh);
  await tryWriteFirebaseStats(board);
  return fresh.length;
}

export async function clearHarvestBuffer(ids?: string[]): Promise<number> {
  const existing = await readHarvestBuffer();
  if (!existing.length) {
    const empty = emptyBoard();
    setMemRows([]);
    setMemStats(empty);
    await writeDiskBuffer([]);
    await writeDiskStats(empty);
    return 0;
  }

  let kept: HarvestBufferRow[];
  let clearedIds: string[];
  if (!ids?.length) {
    clearedIds = existing.map((r) => r.id);
    kept = [];
  } else {
    const drop = new Set(ids);
    kept = existing.filter((r) => !drop.has(r.id));
    clearedIds = existing.filter((r) => drop.has(r.id)).map((r) => r.id);
  }

  setMemRows(kept);
  await writeDiskBuffer(kept);
  const board = tallyJobs(kept);
  setMemStats(board);
  await writeDiskStats(board);
  await tryDeleteFirebaseIds(clearedIds);
  await tryWriteFirebaseStats(board);
  return clearedIds.length;
}

export function stackBoardFromJobs(jobs: Job[]): BufferCountBoard {
  return tallyJobs(jobs);
}

export function buildHarvestBufferBoard(
  stackJobs: Job[],
  bufferStats?: BufferCountBoard,
): HarvestBufferBoard {
  const stack = stackBoardFromJobs(stackJobs);
  const buffer = bufferStats || emptyBoard();
  const regions: Region[] = ["europe", "america", "asia"];
  const byRegion = {} as HarvestBufferBoard["byRegion"];
  for (const r of regions) {
    const s = stack.byRegion[r] ?? 0;
    const b = buffer.byRegion[r] ?? 0;
    byRegion[r] = { stack: s, buffer: b, expected: s + b };
  }
  return {
    stackTotal: stack.total,
    bufferTotal: buffer.total,
    expectedTotal: stack.total + buffer.total,
    stack,
    buffer,
    byRegion,
  };
}

export function segmentLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of HIRE_SEGMENTS) out[s.id] = s.label;
  return out;
}

export type { HireSegmentId };
