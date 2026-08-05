import { readOpsUsage, type OpsUsage } from "@/lib/opsUsage";

/** Soft Spark free-tier reference (Firestore). */
export const FIRESTORE_SOFT = {
  readsPerDay: 50_000,
  writesPerDay: 20_000,
} as const;

/** Warn / block harvest at this % of daily soft quota. */
export const FIREBASE_QUOTA_BLOCK_PCT = 99;

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
};

export function snapshotFirebaseQuota(usage: OpsUsage): FirebaseQuotaGate {
  const readsLimit = FIRESTORE_SOFT.readsPerDay;
  const writesLimit = FIRESTORE_SOFT.writesPerDay;
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
  const blocked = readsBlocked || writesBlocked;
  let reason: string | null = null;
  if (readsBlocked) {
    reason = `Firebase reads ${readsPct}% (≥${FIREBASE_QUOTA_BLOCK_PCT}%) · ~${usage.readsApprox}/${readsLimit}`;
  } else if (writesBlocked) {
    reason = `Firebase writes ${writesPct}% (≥${FIREBASE_QUOTA_BLOCK_PCT}%) · ~${usage.writesApprox}/${writesLimit}`;
  }
  return {
    blocked,
    day: usage.day,
    readsApprox: usage.readsApprox,
    writesApprox: usage.writesApprox,
    readsPct,
    writesPct,
    readsLeftApprox: Math.max(0, readsLimit - usage.readsApprox),
    writesLeftApprox: Math.max(0, writesLimit - usage.writesApprox),
    reason,
    resetsHint: "Reset ~00:00 UTC (Firebase Console may use another TZ)",
  };
}

export async function getFirebaseQuotaGate(): Promise<FirebaseQuotaGate> {
  const usage = await readOpsUsage();
  return snapshotFirebaseQuota(usage);
}
