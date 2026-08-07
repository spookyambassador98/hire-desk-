import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import { bumpOpsUsage, isFirebaseExhausted, noteFirestoreError } from "@/lib/opsUsage";
import type { HireSegmentId } from "./max";
import { HIRE_SEGMENTS } from "./max";
import type { Job } from "@/lib/types";

export type HarvestIntakeHit = {
  id: string;
  company: string;
  role: string;
  region: string;
  source: string | null;
  at: string;
  fit: number | null;
  pri: number | null;
};

export type HarvestLiveBufferBoard = {
  stackTotal: number;
  bufferTotal: number;
  expectedTotal: number;
  byRegion?: Partial<
    Record<"europe" | "america" | "asia", { stack: number; buffer: number }>
  >;
  remoteBuffered?: number;
};

export type HarvestLiveState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  added: number;
  skipped: number;
  trashed: number;
  segment: string | null;
  message: string;
  logs: string[];
  /** Newest first — live intake for MAX LIVE right rail */
  recentAdds: HarvestIntakeHit[];
  /** WRITE HARVEST live counters */
  mode?: "max_live" | "write_harvest" | null;
  bufferBoard?: HarvestLiveBufferBoard | null;
};

export type HarvestQuotaDay = {
  day: string;
  bySegment: Partial<Record<HireSegmentId, number>>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const LIVE_FILE = path.join(DATA_DIR, "harvest-live.json");
const QUOTA_FILE = path.join(DATA_DIR, "harvest-quotas.json");
const INTAKE_MAX = 48;
const META_LIVE = "harvest_live";
const META_QUOTA = "harvest_quotas";

const g = globalThis as typeof globalThis & {
  __hireHarvestLive?: HarvestLiveState;
  __hireHarvestQuota?: HarvestQuotaDay;
};

function defaultLive(): HarvestLiveState {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    added: 0,
    skipped: 0,
    trashed: 0,
    segment: null,
    message: "idle",
    logs: [],
    recentAdds: [],
    mode: null,
    bufferBoard: null,
  };
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function readHarvestLiveMemory(): HarvestLiveState {
  if (!g.__hireHarvestLive) g.__hireHarvestLive = defaultLive();
  return g.__hireHarvestLive;
}

async function readLiveDisk(): Promise<HarvestLiveState | null> {
  try {
    await ensureDir();
    const raw = await fs.readFile(LIVE_FILE, "utf8");
    return JSON.parse(raw) as HarvestLiveState;
  } catch {
    return null;
  }
}

async function writeLiveDisk(next: HarvestLiveState) {
  try {
    await ensureDir();
    const tmp = `${LIVE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, LIVE_FILE);
  } catch {
    /* memory is enough */
  }
}

async function readLiveFirebase(): Promise<HarvestLiveState | null> {
  if (!firebaseConfigured() || isFirebaseExhausted()) return null;
  try {
    const snap = await firestore().collection("meta").doc(META_LIVE).get();
    await bumpOpsUsage({ reads: 1 });
    if (!snap.exists) return null;
    return snap.data() as HarvestLiveState;
  } catch (err) {
    noteFirestoreError(err);
    return null;
  }
}

async function writeLiveFirebase(next: HarvestLiveState) {
  if (!firebaseConfigured() || isFirebaseExhausted()) return;
  const gLive = globalThis as typeof globalThis & {
    __hireLiveFbTimer?: ReturnType<typeof setTimeout> | null;
    __hireLiveFbPending?: HarvestLiveState | null;
  };
  gLive.__hireLiveFbPending = next;
  const flush = async () => {
    gLive.__hireLiveFbTimer = null;
    const payload = gLive.__hireLiveFbPending;
    gLive.__hireLiveFbPending = null;
    if (!payload) return;
    try {
      await firestore().collection("meta").doc(META_LIVE).set(payload, {
        merge: true,
      });
      await bumpOpsUsage({ writes: 1 });
    } catch (err) {
      noteFirestoreError(err);
    }
  };
  // Force flush when run ends; otherwise debounce to cut write spam.
  if (!next.running) {
    if (gLive.__hireLiveFbTimer) {
      clearTimeout(gLive.__hireLiveFbTimer);
      gLive.__hireLiveFbTimer = null;
    }
    await flush();
    return;
  }
  if (gLive.__hireLiveFbTimer) return;
  gLive.__hireLiveFbTimer = setTimeout(() => {
    void flush();
  }, 3_000);
}

function normalizeLive(disk: HarvestLiveState): HarvestLiveState {
  return {
    ...defaultLive(),
    ...disk,
    logs: Array.isArray(disk.logs) ? disk.logs.slice(-120) : [],
    recentAdds: Array.isArray(disk.recentAdds)
      ? disk.recentAdds.slice(0, INTAKE_MAX)
      : [],
  };
}

export async function readHarvestLive(): Promise<HarvestLiveState> {
  const mem = readHarvestLiveMemory();
  // During an active run, memory is authoritative — skip Firebase read spam.
  if (mem.running && mem.heartbeatAt) {
    const age = Date.now() - Date.parse(mem.heartbeatAt);
    if (Number.isFinite(age) && age < 90_000) return mem;
  }
  const fromFb = await readLiveFirebase();
  if (fromFb) {
    g.__hireHarvestLive = normalizeLive(fromFb);
    return g.__hireHarvestLive;
  }
  const fromDisk = await readLiveDisk();
  if (fromDisk) {
    g.__hireHarvestLive = normalizeLive(fromDisk);
    return g.__hireHarvestLive;
  }
  return mem;
}

export async function writeHarvestLive(
  patch: Partial<HarvestLiveState>,
): Promise<HarvestLiveState> {
  const cur = readHarvestLiveMemory();
  const next: HarvestLiveState = {
    ...cur,
    ...patch,
    logs: patch.logs ?? cur.logs,
    recentAdds: patch.recentAdds ?? cur.recentAdds,
  };
  if (next.logs.length > 120) next.logs = next.logs.slice(-120);
  if (next.recentAdds.length > INTAKE_MAX) {
    next.recentAdds = next.recentAdds.slice(0, INTAKE_MAX);
  }
  g.__hireHarvestLive = next;
  await writeLiveDisk(next);
  await writeLiveFirebase(next);
  return next;
}

export async function patchHarvestLive(patch: Partial<HarvestLiveState>) {
  return writeHarvestLive(patch);
}

export async function pushIntakeHits(
  hits: Omit<HarvestIntakeHit, "at">[],
) {
  if (!hits.length) return readHarvestLiveMemory();
  const cur = readHarvestLiveMemory();
  const at = new Date().toISOString();
  const recentAdds = [
    ...hits.map((h) => ({ ...h, at })),
    ...cur.recentAdds,
  ].slice(0, INTAKE_MAX);
  return writeHarvestLive({ recentAdds, heartbeatAt: at });
}

function stamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function pushHarvestLog(
  line: string,
  extra: Partial<HarvestLiveState> = {},
) {
  const cur = readHarvestLiveMemory();
  const logs = [...cur.logs, `[${stamp()}] ${line}`].slice(-120);
  return writeHarvestLive({
    ...extra,
    logs,
    heartbeatAt: new Date().toISOString(),
  });
}

const SEGMENT_IDS = new Set(HIRE_SEGMENTS.map((s) => s.id));

/** Rebuild today's shelf fills from jobs already in DB (survives Render disk wipe). */
export function rebuildQuotaFromJobs(
  jobs: Job[],
  day = todayKey(),
): HarvestQuotaDay {
  const bySegment: Partial<Record<HireSegmentId, number>> = {};
  for (const j of jobs) {
    if (!j.createdAt?.startsWith(day)) continue;
    const src = j.source || "";
    const m = /^max:([a-z0-9_]+):/i.exec(src);
    if (!m) continue;
    const id = m[1] as HireSegmentId;
    if (!SEGMENT_IDS.has(id)) continue;
    bySegment[id] = (bySegment[id] ?? 0) + 1;
  }
  return { day, bySegment };
}

async function readQuotaFirebase(): Promise<HarvestQuotaDay | null> {
  if (!firebaseConfigured() || isFirebaseExhausted()) return null;
  try {
    const snap = await firestore().collection("meta").doc(META_QUOTA).get();
    await bumpOpsUsage({ reads: 1 });
    if (!snap.exists) return null;
    return snap.data() as HarvestQuotaDay;
  } catch (err) {
    noteFirestoreError(err);
    return null;
  }
}

async function writeQuotaFirebase(next: HarvestQuotaDay) {
  if (!firebaseConfigured() || isFirebaseExhausted()) return;
  try {
    await firestore().collection("meta").doc(META_QUOTA).set(next, {
      merge: true,
    });
    await bumpOpsUsage({ writes: 1 });
  } catch (err) {
    noteFirestoreError(err);
  }
}

async function readQuotaDisk(): Promise<HarvestQuotaDay | null> {
  try {
    await ensureDir();
    const raw = await fs.readFile(QUOTA_FILE, "utf8");
    return JSON.parse(raw) as HarvestQuotaDay;
  } catch {
    return null;
  }
}

async function writeQuotaDisk(next: HarvestQuotaDay) {
  try {
    await ensureDir();
    const tmp = `${QUOTA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, QUOTA_FILE);
  } catch {
    /* ignore */
  }
}

export async function readQuotaDay(
  jobsForRecovery?: Job[],
): Promise<HarvestQuotaDay> {
  const day = todayKey();
  if (g.__hireHarvestQuota?.day === day) {
    return g.__hireHarvestQuota;
  }

  const fromFb = await readQuotaFirebase();
  if (fromFb?.day === day) {
    g.__hireHarvestQuota = fromFb;
    return fromFb;
  }

  const fromDisk = await readQuotaDisk();
  if (fromDisk?.day === day) {
    g.__hireHarvestQuota = fromDisk;
    await writeQuotaFirebase(fromDisk);
    return fromDisk;
  }

  if (jobsForRecovery?.length) {
    const rebuilt = rebuildQuotaFromJobs(jobsForRecovery, day);
    if (Object.keys(rebuilt.bySegment).length > 0) {
      g.__hireHarvestQuota = rebuilt;
      await writeQuotaDisk(rebuilt);
      await writeQuotaFirebase(rebuilt);
      return rebuilt;
    }
  }

  const empty = { day, bySegment: {} as Partial<Record<HireSegmentId, number>> };
  g.__hireHarvestQuota = empty;
  return empty;
}

export async function bumpSegmentQuota(
  id: HireSegmentId,
  n: number,
): Promise<HarvestQuotaDay> {
  const cur = await readQuotaDay();
  const day = todayKey();
  const base: HarvestQuotaDay =
    cur.day === day ? { ...cur, bySegment: { ...cur.bySegment } } : { day, bySegment: {} };
  base.bySegment[id] = (base.bySegment[id] ?? 0) + n;
  g.__hireHarvestQuota = base;
  await writeQuotaDisk(base);
  await writeQuotaFirebase(base);
  return base;
}
