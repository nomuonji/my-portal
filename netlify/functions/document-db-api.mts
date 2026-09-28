import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import * as documentDbImport from "../../functions/documentDb.js";

const documentDb: any = (documentDbImport as any).default ?? documentDbImport;

function env(name: string): string | undefined {
  try {
    const value = (globalThis as any).Netlify?.env?.get(name);
    return value ? String(value) : process.env[name];
  } catch {
    return process.env[name];
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function ensureFirebaseAdmin() {
  if (getApps().length) return getApp();
  const raw = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured on Netlify");
  let serviceAccount: any;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id || "my-portal-d05fd",
  });
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

function collectionPath(value: unknown) {
  const path = String(value || "").replace(/^\/+|\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  if (!path || parts.length % 2 !== 1 || parts.some((part) => part.length > 500)) {
    throw new Error("Invalid collection path");
  }
  return path;
}

function documentId(value: unknown) {
  const id = String(value || "").trim();
  if (!id || id.length > 500 || id.includes("/")) throw new Error("Invalid document id");
  return id;
}

function decodeValue(value: any): any {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === "object") {
    const op = String(value.__portalDbOp || "");
    if (op === "serverTimestamp") return documentDb.FieldValue.serverTimestamp();
    if (op === "increment") return documentDb.FieldValue.increment(Number(value.value) || 0);
    if (op === "arrayUnion") return documentDb.FieldValue.arrayUnion(...(Array.isArray(value.values) ? value.values.map(decodeValue) : []));
    if (op === "arrayRemove") return documentDb.FieldValue.arrayRemove(...(Array.isArray(value.values) ? value.values.map(decodeValue) : []));
    if (op === "delete") return documentDb.FieldValue.delete();
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) out[key] = decodeValue(item);
    return out;
  }
  return value;
}

function serialize(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) out[key] = serialize(item);
    return out;
  }
  return value;
}

function queryFrom(body: any) {
  const database = documentDb.getDocumentDb("(default)");
  let ref: any = database.collection(collectionPath(body.collection));

  for (const filter of Array.isArray(body.filters) ? body.filters.slice(0, 20) : []) {
    const field = String(filter?.field || "");
    const op = String(filter?.op || "");
    if (!field || !["==", "in", ">", ">=", "<", "<="].includes(op)) throw new Error("Invalid query filter");
    ref = ref.where(field, op, decodeValue(filter.value));
  }
  for (const order of Array.isArray(body.orders) ? body.orders.slice(0, 5) : []) {
    const field = String(order?.field || "");
    const direction = String(order?.direction || "asc").toLowerCase();
    if (!field || !["asc", "desc"].includes(direction)) throw new Error("Invalid query order");
    ref = ref.orderBy(field, direction);
  }
  if (Array.isArray(body.cursor) && body.cursor.length) ref = ref.startAfter(...body.cursor.map(decodeValue));
  ref = ref.limit(Math.min(Math.max(Number(body.limit) || 500, 1), 1000));
  return ref;
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
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await requireFirebaseUser(request);
    const body: any = await parseBody(request);
    const action = String(body.action || "");
    const database = documentDb.getDocumentDb("(default)");

    if (action === "status") {
      return json({
        ...(await documentDb.healthCheck("(default)")),
        user: { uid: user.uid },
      });
    }

    if (action === "get") {
      const ref = database.collection(collectionPath(body.collection)).doc(documentId(body.id));
      const snapshot = await ref.get();
      return json({
        exists: Boolean(snapshot.exists),
        id: ref.id,
        data: snapshot.exists ? serialize(snapshot.data()) : null,
      });
    }

    if (action === "query") {
      const snapshot = await queryFrom(body).get();
      return json({
        docs: snapshot.docs.map((item: any) => ({
          id: item.id,
          data: serialize(item.data()),
        })),
        size: snapshot.size,
      });
    }

    if (action === "add") {
      const ref = database.collection(collectionPath(body.collection)).doc();
      await ref.set(decodeValue(body.data || {}));
      return json({ id: ref.id });
    }

    if (action === "set") {
      const ref = database.collection(collectionPath(body.collection)).doc(documentId(body.id));
      await ref.set(decodeValue(body.data || {}), { merge: body.merge === true });
      return json({ id: ref.id });
    }

    if (action === "update") {
      const ref = database.collection(collectionPath(body.collection)).doc(documentId(body.id));
      await ref.update(decodeValue(body.data || {}));
      return json({ id: ref.id });
    }

    if (action === "delete") {
      const ref = database.collection(collectionPath(body.collection)).doc(documentId(body.id));
      await ref.delete();
      return json({ id: ref.id, deleted: true });
    }

    if (action === "batch") {
      const writes = Array.isArray(body.writes) ? body.writes.slice(0, 500) : [];
      const batch = database.batch();
      for (const write of writes) {
        const ref = database.collection(collectionPath(write.collection)).doc(documentId(write.id));
        if (write.type === "set") batch.set(ref, decodeValue(write.data || {}), { merge: write.merge === true });
        else if (write.type === "update") batch.update(ref, decodeValue(write.data || {}));
        else if (write.type === "delete") batch.delete(ref);
        else throw new Error("Invalid batch write");
      }
      await batch.commit();
      return json({ writes: writes.length });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") return json({ error: "Unauthorized" }, 401);
    return json({ error: message }, 500);
  }
};

export const config = {
  path: ["/api/document-db", "/api/document-db/*"],
};
