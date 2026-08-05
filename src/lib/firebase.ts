import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export function normalizePrivateKey(raw: string): string {
  let key = String(raw).trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");
  key = key.replace(/\\r\\n/g, "\n").replace(/\r\n/g, "\n");
  return key.trim();
}

function loadServiceAccountFromJsonEnv(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  const raw = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  const json = JSON.parse(raw) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing fields");
  }
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: normalizePrivateKey(json.private_key),
  };
}

function loadServiceAccountFromFile(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  const filePath = env("FIREBASE_SERVICE_ACCOUNT_PATH");
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const raw = readFileSync(abs, "utf8");
  const json = JSON.parse(raw) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH JSON missing fields");
  }
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: normalizePrivateKey(json.private_key),
  };
}

export function getFirebaseApp(): App {
  if (getApps().length) return getApps()[0]!;
  const fromJson = loadServiceAccountFromJsonEnv();
  if (fromJson) {
    return initializeApp({
      credential: cert(fromJson),
      projectId: fromJson.projectId,
    });
  }
  const fromFile = loadServiceAccountFromFile();
  if (fromFile) {
    return initializeApp({
      credential: cert(fromFile),
      projectId: fromFile.projectId,
    });
  }
  const projectId = env("FIREBASE_PROJECT_ID");
  const clientEmail = env("FIREBASE_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(env("FIREBASE_PRIVATE_KEY"));
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY",
    );
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("FIREBASE_PRIVATE_KEY malformed");
  }
  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export function firestore(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function firebaseConfigured(): boolean {
  if (env("HIRE_STORAGE") !== "firebase") return false;
  if (env("FIREBASE_SERVICE_ACCOUNT_JSON")) return true;
  if (env("FIREBASE_SERVICE_ACCOUNT_PATH")) return true;
  return Boolean(
    env("FIREBASE_PROJECT_ID") &&
      env("FIREBASE_CLIENT_EMAIL") &&
      env("FIREBASE_PRIVATE_KEY"),
  );
}

export async function probeFirebase(): Promise<{
  ok: boolean;
  error?: string;
  projectId?: string;
}> {
  try {
    if (!firebaseConfigured()) {
      return { ok: false, error: "HIRE_STORAGE not firebase or env missing" };
    }
    const fs = firestore();
    await fs.collection("meta").doc("hire_desk").get();
    const projectId =
      getApps()[0]?.options.projectId ||
      env("FIREBASE_PROJECT_ID") ||
      undefined;
    return { ok: true, projectId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 240) };
  }
}
