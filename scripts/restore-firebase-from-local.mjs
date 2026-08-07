/**
 * Restore local data/jobs.json (+ individuals) into Firestore hire_jobs / hire_individuals.
 * UPSERT only — never deletes cloud docs.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local scripts/restore-firebase-from-local.mjs
 * or set FIREBASE_SERVICE_ACCOUNT_PATH / HIRE_STORAGE=firebase
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] == null) process.env[k] = v;
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, "secrets", "render-paste.env"));

process.env.HIRE_STORAGE = process.env.HIRE_STORAGE || "firebase";
if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = path.join(
    "secrets",
    "hire-deck-firebase-adminsdk.json",
  );
}

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function loadCred() {
  const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  const json = JSON.parse(readFileSync(abs, "utf8"));
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: String(json.private_key).replace(/\\n/g, "\n"),
  };
}

async function upsertCollection(db, name, rows) {
  let writes = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    const chunk = rows.slice(i, i + 400);
    for (const row of chunk) {
      if (!row?.id) continue;
      batch.set(db.collection(name).doc(row.id), row, { merge: true });
      writes += 1;
    }
    await batch.commit();
  }
  return writes;
}

async function main() {
  const jobsPath = path.join(root, "data", "jobs.json");
  const indPath = path.join(root, "data", "individuals.json");
  const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
  const inds = existsSync(indPath)
    ? JSON.parse(readFileSync(indPath, "utf8"))
    : [];

  if (!Array.isArray(jobs) || jobs.length < 1) {
    console.error("ABORT: local jobs.json empty — refuse restore");
    process.exit(1);
  }

  const cred = loadCred();
  if (!getApps().length) {
    initializeApp({ credential: cert(cred), projectId: cred.projectId });
  }
  const db = getFirestore();

  console.log(`project=${cred.projectId}`);
  console.log(`local jobs=${jobs.length} individuals=${inds.length}`);

  let cloudJobs = 0;
  try {
    const snap = await db.collection("hire_jobs").count().get();
    cloudJobs = snap.data().count;
  } catch {
    const snap = await db.collection("hire_jobs").get();
    cloudJobs = snap.size;
  }
  console.log(`cloud hire_jobs before=${cloudJobs}`);

  const jw = await upsertCollection(db, "hire_jobs", jobs);
  const iw = await upsertCollection(db, "hire_individuals", inds);
  console.log(`upserted jobs=${jw} individuals=${iw}`);

  const after = await db.collection("hire_jobs").get();
  console.log(`cloud hire_jobs after=${after.size}`);
  console.log("RESTORE OK");
}

main().catch((err) => {
  console.error("RESTORE FAIL", err);
  process.exit(1);
});
