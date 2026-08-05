import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";

export type OpsUsage = {
  day: string;
  readsApprox: number;
  writesApprox: number;
  updatedAt: string;
  /** Where the displayed numbers came from */
  source?: "memory" | "local" | "firebase" | "merged";
  /** Google returned RESOURCE_EXHAUSTED (or soft gate trip) */
  exhausted?: boolean;
  lastError?: string | null;
};

const META_DOC = "ops_usage";
const LOCAL_FILE = path.join(process.cwd(), "data", "ops-usage.json");

type MemState = {
  usage: OpsUsage;
  exhausted: boolean;
  lastError: string | null;
  firebaseHydrated: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  pendingFlush: boolean;
};

const g = globalThis as typeof globalThis & {
  __hireOpsUsage?: MemState;
};

/** Soft-quota day key — flips at 00:00 UTC. */
export function usageDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function emptyUsage(day = usageDayKey()): OpsUsage {
  return {
    day,
    readsApprox: 0,
    writesApprox: 0,
    updatedAt: new Date().toISOString(),
    source: "memory",
    exhausted: false,
    lastError: null,
  };
}

function mem(): MemState {
  if (!g.__hireOpsUsage) {
    g.__hireOpsUsage = {
      usage: emptyUsage(),
      exhausted: false,
      lastError: null,
      firebaseHydrated: false,
      flushTimer: null,
      pendingFlush: false,
    };
  }
  const s = g.__hireOpsUsage;
  const day = usageDayKey();
  if (s.usage.day !== day) {
    s.usage = emptyUsage(day);
    s.exhausted = false;
    s.lastError = null;
    s.firebaseHydrated = false;
  }
  return s;
}

function isQuotaExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|Quota exceeded|8\s+RESOURCE/i.test(msg);
}

export function markFirebaseExhausted(err?: unknown) {
  const s = mem();
  s.exhausted = true;
  s.lastError =
    err instanceof Error
      ? err.message.slice(0, 240)
      : err
        ? String(err).slice(0, 240)
        : s.lastError || "RESOURCE_EXHAUSTED";
  s.usage = {
    ...s.usage,
    exhausted: true,
    lastError: s.lastError,
    updatedAt: new Date().toISOString(),
  };
  void writeLocal(s.usage).catch(() => undefined);
}

export function clearFirebaseExhausted() {
  const s = mem();
  s.exhausted = false;
  s.lastError = null;
  s.usage = {
    ...s.usage,
    exhausted: false,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

export function isFirebaseExhausted() {
  return mem().exhausted;
}

async function readLocal(): Promise<OpsUsage | null> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const data = JSON.parse(raw) as OpsUsage;
    if (!data || data.day !== usageDayKey()) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeLocal(next: OpsUsage) {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  const tmp = `${LOCAL_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, LOCAL_FILE);
}

function mergeUsage(a: OpsUsage, b: OpsUsage): OpsUsage {
  const day = usageDayKey();
  if (a.day !== day && b.day !== day) return emptyUsage(day);
  if (a.day !== day) return { ...b, source: b.source || "merged" };
  if (b.day !== day) return { ...a, source: a.source || "merged" };
  return {
    day,
    readsApprox: Math.max(a.readsApprox || 0, b.readsApprox || 0),
    writesApprox: Math.max(a.writesApprox || 0, b.writesApprox || 0),
    updatedAt:
      Date.parse(a.updatedAt) >= Date.parse(b.updatedAt)
        ? a.updatedAt
        : b.updatedAt,
    source: "merged",
    exhausted: Boolean(a.exhausted || b.exhausted),
    lastError: a.lastError || b.lastError || null,
  };
}

async function hydrateFromFirebaseOnce(): Promise<OpsUsage | null> {
  if (!firebaseConfigured()) return null;
  const s = mem();
  if (s.firebaseHydrated || s.exhausted) return null;
  try {
    const snap = await firestore().collection("meta").doc(META_DOC).get();
    // counting this meta read itself
    s.usage = {
      ...s.usage,
      readsApprox: s.usage.readsApprox + 1,
      updatedAt: new Date().toISOString(),
    };
    s.firebaseHydrated = true;
    clearFirebaseExhausted();
    if (!snap.exists) return null;
    const data = snap.data() as OpsUsage;
    if (!data || data.day !== usageDayKey()) return null;
    return {
      ...data,
      source: "firebase",
      exhausted: false,
      lastError: null,
    };
  } catch (err) {
    s.firebaseHydrated = true;
    if (isQuotaExhaustedError(err)) markFirebaseExhausted(err);
    return null;
  }
}

async function flushToFirebase() {
  if (!firebaseConfigured()) return;
  const s = mem();
  if (s.exhausted) return;
  s.pendingFlush = false;
  const payload = {
    day: s.usage.day,
    readsApprox: s.usage.readsApprox,
    writesApprox: s.usage.writesApprox,
    updatedAt: new Date().toISOString(),
  };
  try {
    await firestore().collection("meta").doc(META_DOC).set(payload, {
      merge: true,
    });
    // absolute set costs 1 write — count it
    s.usage = {
      ...s.usage,
      writesApprox: s.usage.writesApprox + 1,
      updatedAt: new Date().toISOString(),
      source: s.usage.source || "memory",
    };
    await writeLocal(s.usage);
    clearFirebaseExhausted();
  } catch (err) {
    if (isQuotaExhaustedError(err)) markFirebaseExhausted(err);
  }
}

function scheduleFlush() {
  const s = mem();
  if (!firebaseConfigured() || s.exhausted) return;
  s.pendingFlush = true;
  if (s.flushTimer) return;
  s.flushTimer = setTimeout(() => {
    s.flushTimer = null;
    void flushToFirebase();
  }, 2_500);
}

/**
 * Always bumps memory + local disk first (survives Firebase outage).
 * Firebase snapshot is flushed debounced — never blocks harvest on counter I/O.
 */
export async function bumpOpsUsage(delta: {
  reads?: number;
  writes?: number;
}) {
  const reads = Math.max(0, Math.floor(delta.reads ?? 0));
  const writes = Math.max(0, Math.floor(delta.writes ?? 0));
  if (!reads && !writes) return;

  const s = mem();
  const day = usageDayKey();
  const base = s.usage.day === day ? s.usage : emptyUsage(day);
  s.usage = {
    ...base,
    day,
    readsApprox: base.readsApprox + reads,
    writesApprox: base.writesApprox + writes,
    updatedAt: new Date().toISOString(),
    source: "memory",
    exhausted: s.exhausted,
    lastError: s.lastError,
  };
  await writeLocal(s.usage).catch(() => undefined);
  scheduleFlush();
}

export async function readOpsUsage(): Promise<OpsUsage> {
  const s = mem();
  const day = usageDayKey();

  const local = await readLocal();
  if (local) {
    s.usage = mergeUsage(s.usage, { ...local, source: "local" });
  }

  if (!s.firebaseHydrated && firebaseConfigured() && !s.exhausted) {
    const fromFb = await hydrateFromFirebaseOnce();
    if (fromFb) {
      s.usage = mergeUsage(s.usage, fromFb);
      await writeLocal(s.usage).catch(() => undefined);
    }
  }

  return {
    ...s.usage,
    day,
    exhausted: s.exhausted || s.usage.exhausted,
    lastError: s.lastError || s.usage.lastError || null,
    source: s.usage.source || "memory",
  };
}

/** Record a successful/failed Firestore op without double-counting business reads. */
export function noteFirestoreError(err: unknown) {
  if (isQuotaExhaustedError(err)) markFirebaseExhausted(err);
}
