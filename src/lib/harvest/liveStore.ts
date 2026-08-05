import { promises as fs } from "node:fs";
import path from "node:path";
import type { HireSegmentId } from "./max";

export type HarvestIntakeHit = {
  id: string;
  company: string;
  role: string;
  region: string;
  source: string | null;
  at: string;
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
};

export type HarvestQuotaDay = {
  day: string;
  bySegment: Partial<Record<HireSegmentId, number>>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const LIVE_FILE = path.join(DATA_DIR, "harvest-live.json");
const QUOTA_FILE = path.join(DATA_DIR, "harvest-quotas.json");
const INTAKE_MAX = 48;

const g = globalThis as typeof globalThis & {
  __hireHarvestLive?: HarvestLiveState;
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
  };
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function readHarvestLiveMemory(): HarvestLiveState {
  if (!g.__hireHarvestLive) g.__hireHarvestLive = defaultLive();
  return g.__hireHarvestLive;
}

export async function readHarvestLive(): Promise<HarvestLiveState> {
  const mem = readHarvestLiveMemory();
  try {
    await ensureDir();
    const raw = await fs.readFile(LIVE_FILE, "utf8");
    const disk = JSON.parse(raw) as HarvestLiveState;
    g.__hireHarvestLive = {
      ...defaultLive(),
      ...disk,
      logs: Array.isArray(disk.logs) ? disk.logs.slice(-120) : [],
      recentAdds: Array.isArray(disk.recentAdds)
        ? disk.recentAdds.slice(0, INTAKE_MAX)
        : [],
    };
    return g.__hireHarvestLive;
  } catch {
    return mem;
  }
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
  try {
    await ensureDir();
    const tmp = `${LIVE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, LIVE_FILE);
  } catch {
    /* memory is enough */
  }
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readQuotaDay(): Promise<HarvestQuotaDay> {
  try {
    await ensureDir();
    const raw = await fs.readFile(QUOTA_FILE, "utf8");
    const data = JSON.parse(raw) as HarvestQuotaDay;
    if (data.day !== today()) {
      return { day: today(), bySegment: {} };
    }
    return data;
  } catch {
    return { day: today(), bySegment: {} };
  }
}

export async function bumpSegmentQuota(
  id: HireSegmentId,
  n: number,
): Promise<HarvestQuotaDay> {
  const cur = await readQuotaDay();
  const day = today();
  const base =
    cur.day === day ? cur : ({ day, bySegment: {} } as HarvestQuotaDay);
  base.bySegment[id] = (base.bySegment[id] ?? 0) + n;
  try {
    await ensureDir();
    const tmp = `${QUOTA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(base, null, 2), "utf8");
    await fs.rename(tmp, QUOTA_FILE);
  } catch {
    /* ignore */
  }
  return base;
}
