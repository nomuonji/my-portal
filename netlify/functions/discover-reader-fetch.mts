// Hourly Discover RSS reader job: fetch due feeds, then purge items past the
// 7-day window (30 days for loved/saved). Reaction signals are never purged.
// No AI involved — this is plain feed polling, so it stays cheap.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import * as documentDbImport from "../../functions/documentDb.js";
import * as discoverReaderImport from "../../functions/discoverReaderStore.js";

const documentDb: any = (documentDbImport as any).default ?? documentDbImport;
const discoverReader: any = (discoverReaderImport as any).default ?? discoverReaderImport;

function env(name: string): string | undefined {
  try {
    const value = (globalThis as any).Netlify?.env?.get(name);
    return value ? String(value) : process.env[name];
  } catch {
    return process.env[name];
  }
}

function ensureFirebaseAdmin() {
  if (documentDb.useTurso() || getApps().length) return;
  const raw = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured on Netlify");
  const serviceAccount = JSON.parse(raw);
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id || "my-portal-d05fd" });
}

export default async () => {
  try {
    ensureFirebaseAdmin();
    const run = await discoverReader.runScheduled();
    console.log("discover-reader-fetch", JSON.stringify(run));
    return new Response(JSON.stringify(run), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("discover-reader-fetch failed", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config = {
  schedule: "@hourly",
};
