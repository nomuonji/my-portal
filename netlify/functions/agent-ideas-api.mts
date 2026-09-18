import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, initializeFirestore } from "firebase-admin/firestore";
import * as storeImport from "../../functions/agentIdeasStoreAgentDb.js";
import * as contextStoreImport from "../../functions/contextStore.js";

const store: any = (storeImport as any).default ?? storeImport;
const contextStore: any = (contextStoreImport as any).default ?? contextStoreImport;
const AGENT_DATABASE_ID = "(default)";

function env(name: string): string | undefined {
  try {
    const value = (globalThis as any).Netlify?.env?.get(name);
    return value ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function ensureFirebaseAdmin() {
  let app;
  if (getApps().length) {
    app = getApp();
  } else {
    const raw = env("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured on Netlify");
    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
    app = initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || "my-portal-d05fd",
    });
  }

  // Bind the existing default database to the exact Admin app and prefer REST
  // transport in the serverless runtime.
  initializeFirestore(app, { preferRest: true });
  return app;
}

async function requireFirebaseUser(request: Request) {
  const app = ensureFirebaseAdmin();
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) throw new Error("UNAUTHORIZED");
  try {
    return await getAuth(app).verifyIdToken(bearer);
  } catch {
    throw new Error("UNAUTHORIZED");
  }
}

function serialize(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) result[key] = serialize(item);
    return result;
  }
  return value;
}

async function listCollection(name: string, limitValue: number) {
  const database = getFirestore(getApp());
  const snapshot = await database.collection(name).limit(limitValue).get();
  return snapshot.docs
    .map((doc) => serialize({ id: doc.id, ...doc.data() }))
    .sort((a, b) => {
      const left = Date.parse(a.updatedAt || a.createdAt || a.startedAt || "") || 0;
      const right = Date.parse(b.updatedAt || b.createdAt || b.startedAt || "") || 0;
      return right - left;
    });
}

async function parseBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const user = await requireFirebaseUser(request);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const resource = url.searchParams.get("resource") || "status";
      if (resource === "status") {
        return json({
          ok: true,
          user: { uid: user.uid },
          databaseId: store.DATABASE_ID,
          database: await store.healthCheck(),
          contextStore: await contextStore.healthCheck(),
        });
      }
      if (resource === "ideas") {
        return json({ items: await listCollection("ideas", 300), databaseId: store.DATABASE_ID });
      }
      if (resource === "runs") {
        return json({ items: await listCollection("runs", 150), databaseId: store.DATABASE_ID });
      }
      if (resource === "spaces") {
        return json(await contextStore.spaceSearch({ limit: 100, scanLimit: 300 }));
      }
      if (resource === "space_context") {
        const id = url.searchParams.get("id") || "";
        return json(await contextStore.spaceGetContext({ id, includeArtifacts: true, includeInferred: true }));
      }
      if (resource === "profile") {
        return json(await contextStore.profileGetContext({ includeInferred: true, limit: 200 }));
      }
      if (resource === "context") {
        const id = url.searchParams.get("id") || "";
        return json(await store.ideaGetContext({ id, includeArtifacts: true }));
      }
      return json({ error: "Unknown resource" }, 400);
    }

    if (request.method === "POST") {
      const body: any = await parseBody(request);
      const action = String(body.action || "");
      if (action === "run_start") {
        return json(await store.runStart({
          objective: body.objective,
          instructions: body.instructions,
          agent: "portal-session",
          trigger: "manual",
          seedIdeaIds: body.seedIdeaIds || [],
          spaceId: body.spaceId || null,
          metadata: { source: "my-portal-ui", ...(body.metadata || {}) },
        }, { agent: "portal-session" }));
      }
      if (action === "run_finish") {
        return json(await store.runFinish({
          id: body.id,
          status: body.status || "completed",
          expectedRevision: body.expectedRevision,
          findings: body.findings || [],
          nextActions: body.nextActions || [],
        }));
      }
      if (action === "space_update") {
        return json(await contextStore.spaceUpdate({
          id: body.id,
          expectedRevision: body.expectedRevision,
          patch: body.patch || {},
        }));
      }
      if (action === "profile_update") {
        return json(await contextStore.profileFactUpdate({
          id: body.id,
          patch: body.patch || {},
        }));
      }
      return json({ error: "Unknown action" }, 400);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") return json({ error: "Unauthorized" }, 401);
    return json({ error: message }, 500);
  }
};

export const config = {
  path: ["/api/agent-ideas", "/api/agent-ideas/*"],
};
