import { randomUUID } from "node:crypto";
import { firebaseConfigured, firestore } from "@/lib/firebase";
import { promises as fs } from "node:fs";
import path from "node:path";

export type HireActivityType =
  | "view"
  | "copy_apply"
  | "copy_brief"
  | "copy_email"
  | "status_change"
  | "harvest"
  | "open_link";

export type HireActivity = {
  id: string;
  type: HireActivityType;
  entityId: string | null;
  entityLabel: string | null;
  detail: string | null;
  createdAt: string;
};

const FILE = path.join(process.cwd(), "data", "activities.json");
const COL = "hire_activities";
const MAX = 500;

async function readLocal(): Promise<HireActivity[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as HireActivity[];
  } catch {
    return [];
  }
}

async function writeLocal(rows: HireActivity[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows.slice(0, MAX), null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

export async function readActivities(days = 7): Promise<HireActivity[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let rows: HireActivity[];
  if (firebaseConfigured()) {
    try {
      const snap = await firestore()
        .collection(COL)
        .orderBy("createdAt", "desc")
        .limit(MAX)
        .get();
      rows = snap.docs.map((d) => d.data() as HireActivity);
    } catch {
      const snap = await firestore().collection(COL).limit(MAX).get();
      rows = snap.docs.map((d) => d.data() as HireActivity);
    }
  } else {
    rows = await readLocal();
  }
  return rows
    .filter((a) => {
      const t = new Date(a.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function logActivity(input: {
  type: HireActivityType;
  entityId?: string | null;
  entityLabel?: string | null;
  detail?: string | null;
}): Promise<HireActivity> {
  const row: HireActivity = {
    id: `act_${randomUUID().slice(0, 10)}`,
    type: input.type,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    detail: input.detail ?? null,
    createdAt: new Date().toISOString(),
  };
  if (firebaseConfigured()) {
    await firestore().collection(COL).doc(row.id).set(row);
  } else {
    const rows = await readLocal();
    rows.unshift(row);
    await writeLocal(rows);
  }
  return row;
}
