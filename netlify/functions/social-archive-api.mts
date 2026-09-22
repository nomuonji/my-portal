import { createDecipheriv, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, initializeFirestore } from "firebase-admin/firestore";
import * as socialStoreImport from "../../functions/socialArchiveStore.js";
import * as encryptedPayloadImport from "../../functions/_socialArchiveEncryptedPayload.js";

const socialStore: any = (socialStoreImport as any).default ?? socialStoreImport;

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

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left || "", "utf8");
  const b = Buffer.from(right || "", "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function decryptImportPayloads() {
  const keyHex = env("SOCIAL_ARCHIVE_IMPORT_DECRYPT_KEY") || "";
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error("SOCIAL_ARCHIVE_IMPORT_DECRYPT_KEY is not configured");
  }
  const encrypted = (encryptedPayloadImport as any).default ?? encryptedPayloadImport;
  if (typeof encrypted !== "string" || !encrypted) {
    throw new Error("Encrypted social archive payload is unavailable");
  }
  const blob = Buffer.from(encrypted, "base64");
  if (blob.length < 29) throw new Error("Encrypted social archive payload is invalid");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const decoded = gunzipSync(compressed).toString("utf8");
  const payloads = JSON.parse(decoded);
  if (!Array.isArray(payloads) || !payloads.length) throw new Error("Decrypted import bundle is empty");
  return payloads;
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

async function listPosts(limitValue = 5000) {
  const database = getFirestore(getApp());
  const snapshot = await database.collection(socialStore.COLLECTIONS.posts)
    .orderBy("postedAt", "desc")
    .limit(Math.min(Math.max(Number(limitValue) || 5000, 1), 5000))
    .get();
  return snapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() }));
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
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/import-bundle")) {
      const expectedToken = env("SOCIAL_ARCHIVE_IMPORT_TOKEN") || "";
      const providedToken = url.searchParams.get("token") || "";
      if (!expectedToken || !secureEqual(providedToken, expectedToken)) {
        return json({ error: "Unauthorized" }, 401);
      }
      ensureFirebaseAdmin();
      const payloads = decryptImportPayloads();
      const results = [];
      for (const payload of payloads) {
        results.push(await socialStore.importPosts({ ...payload, confirm: true }));
      }
      return json({
        ok: true,
        batches: results.map((item: any) => ({
          importKey: item.importKey,
          received: item.received,
          created: item.created,
          updated: item.updated,
          complete: item.complete,
        })),
        totals: results.reduce((acc: any, item: any) => ({
          received: acc.received + Number(item.received || 0),
          created: acc.created + Number(item.created || 0),
          updated: acc.updated + Number(item.updated || 0),
        }), { received: 0, created: 0, updated: 0 }),
      });
    }

    if (request.method === "POST" && url.pathname.endsWith("/import")) {
      const expectedToken = env("SOCIAL_ARCHIVE_IMPORT_TOKEN") || "";
      const providedToken = request.headers.get("x-social-archive-import-token") || "";
      if (!expectedToken || !secureEqual(providedToken, expectedToken)) {
        return json({ error: "Unauthorized" }, 401);
      }
      ensureFirebaseAdmin();
      const body: any = await parseBody(request);
      return json(await socialStore.importPosts({
        ...body,
        confirm: true,
      }));
    }

    const user = await requireFirebaseUser(request);

    if (request.method === "GET") {
      const resource = url.searchParams.get("resource") || "status";
      if (resource === "status") {
        return json({
          ...(await socialStore.status()),
          user: { uid: user.uid },
        });
      }
      if (resource === "posts") {
        return json({
          items: await listPosts(Number(url.searchParams.get("limit") || 5000)),
          databaseId: socialStore.DATABASE_ID,
        });
      }
      return json({ error: "Unknown resource" }, 400);
    }

    if (request.method === "POST") {
      const body: any = await parseBody(request);
      const action = String(body.action || "");
      if (action === "update_metadata") {
        return json(await socialStore.updateMetadata({
          id: body.id,
          category: body.category,
          tags: body.tags,
          starred: body.starred,
          note: body.note,
          classificationSource: body.classificationSource,
          confirm: true,
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
  path: ["/api/social-archive", "/api/social-archive/*"],
};
