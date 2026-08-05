import {
  readOpsUsage,
  isFirebaseExhausted,
  type OpsUsage,
} from "@/lib/opsUsage";

/** Soft Spark free-tier reference (Firestore). */
export const FIRESTORE_SOFT = {
  readsPerDay: 50_000,
  writesPerDay: 20_000,
} as const;

/** Warn / block harvest at this % of daily soft quota. */
export const FIREBASE_QUOTA_BLOCK_PCT = 95;

export type FirebaseQuotaGate = {
  blocked: boolean;
  day: string;
  readsApprox: number;
  writesApprox: number;
  readsPct: number;
  writesPct: number;
  readsLeftApprox: number;
  writesLeftApprox: number;
  reason: string | null;
  resetsHint: string;
  exhausted: boolean;
  source: string;
};

export function snapshotFirebaseQuota(usage: OpsUsage): FirebaseQuotaGate {
  const readsLimit = FIRESTORE_SOFT.readsPerDay;
  const writesLimit = FIRESTORE_SOFT.writesPerDay;
  const exhausted = Boolean(usage.exhausted || isFirebaseExhausted());
  const readsPct =
    readsLimit > 0
      ? Math.min(100, Math.round((usage.readsApprox / readsLimit) * 1000) / 10)
      : 0;
  const writesPct =
    writesLimit > 0
      ? Math.min(
          100,
          Math.round((usage.writesApprox / writesLimit) * 1000) / 10,
        )
      : 0;
  const readsBlocked = readsPct >= FIREBASE_QUOTA_BLOCK_PCT;
  const writesBlocked = writesPct >= FIREBASE_QUOTA_BLOCK_PCT;
  const blocked = exhausted || readsBlocked || writesBlocked;
  let reason: string | null = null;
  if (exhausted) {
    reason =
      usage.lastError?.slice(0, 160) ||
      "Firebase RESOURCE_EXHAUSTED · wait for 00:00 UTC reset";
  } else if (readsBlocked) {
    reason = `Firebase reads ${readsPct}% (≥${FIREBASE_QUOTA_BLOCK_PCT}%) · ~${usage.readsApprox.toLocaleString("en-US")}/${readsLimit.toLocaleString("en-US")}`;
  } else if (writesBlocked) {
    reason = `Firebase writes ${writesPct}% (≥${FIREBASE_QUOTA_BLOCK_PCT}%) · ~${usage.writesApprox.toLocaleString("en-US")}/${writesLimit.toLocaleString("en-US")}`;
  }
  return {
    blocked,
    day: usage.day,
    readsApprox: usage.readsApprox,
    writesApprox: usage.writesApprox,
    readsPct: exhausted && readsPct < FIREBASE_QUOTA_BLOCK_PCT ? 100 : readsPct,
    writesPct,
    readsLeftApprox: exhausted
      ? 0
      : Math.max(0, readsLimit - usage.readsApprox),
    writesLeftApprox: exhausted
      ? 0
      : Math.max(0, writesLimit - usage.writesApprox),
    reason,
    resetsHint: "Reset ~00:00 UTC (Firebase Console is source of truth)",
    exhausted,
    source: usage.source || "memory",
  };
}

export async function getFirebaseQuotaGate(): Promise<FirebaseQuotaGate> {
  const usage = await readOpsUsage();
  return snapshotFirebaseQuota(usage);
}
