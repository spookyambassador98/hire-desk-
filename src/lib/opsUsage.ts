import { promises as fs } from "node:fs";
import path from "node:path";
import { firebaseConfigured, firestore } from "@/lib/firebase";

export type OpsUsage = {
  day: string;
  readsApprox: number;
  writesApprox: number;
  updatedAt: string;
};

const META_DOC = "ops_usage";
const LOCAL_FILE = path.join(process.cwd(), "data", "ops-usage.json");

/** Soft-quota day key — flips at 00:00 UTC (same as Lead Desk). */
export function usageDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function emptyUsage(day = usageDayKey()): OpsUsage {
  return {
    day,
    readsApprox: 0,
    writesApprox: 0,
    updatedAt: new Date().toISOString(),
  };
}

async function readLocal(): Promise<OpsUsage> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const data = JSON.parse(raw) as OpsUsage;
    const day = usageDayKey();
    if (!data || data.day !== day) return emptyUsage(day);
    return data;
  } catch {
    return emptyUsage();
  }
}

async function writeLocal(next: OpsUsage) {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  const tmp = `${LOCAL_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, LOCAL_FILE);
}

export async function readOpsUsage(): Promise<OpsUsage> {
  const day = usageDayKey();
  if (!firebaseConfigured()) return readLocal();

  try {
    const snap = await firestore().collection("meta").doc(META_DOC).get();
    const data = snap.data() as OpsUsage | undefined;
    if (!data || data.day !== day) return emptyUsage(day);
    return data;
  } catch {
    return emptyUsage(day);
  }
}

export async function bumpOpsUsage(delta: {
  reads?: number;
  writes?: number;
}) {
  const reads = Math.max(0, Math.floor(delta.reads ?? 0));
  const writes = Math.max(0, Math.floor(delta.writes ?? 0));
  if (!reads && !writes) return;

  const day = usageDayKey();

  if (!firebaseConfigured()) {
    const prev = await readLocal();
    const base = prev.day === day ? prev : emptyUsage(day);
    await writeLocal({
      day,
      readsApprox: base.readsApprox + reads,
      writesApprox: base.writesApprox + writes,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const ref = firestore().collection("meta").doc(META_DOC);
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.data() as OpsUsage | undefined;
    const base = prev && prev.day === day ? prev : emptyUsage(day);
    tx.set(ref, {
      day,
      readsApprox: base.readsApprox + reads,
      writesApprox: base.writesApprox + writes,
      updatedAt: new Date().toISOString(),
    });
  });
}
