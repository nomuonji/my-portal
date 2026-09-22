import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, initializeFirestore } from "firebase-admin/firestore";
import * as socialStoreImport from "../../functions/socialArchiveStore.js";

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

async function archiveFacets() {
  const database = getFirestore(getApp());
  const [accountsSnapshot, newestSnapshot, oldestSnapshot, archiveStatus] = await Promise.all([
    database.collection(socialStore.COLLECTIONS.accounts).limit(200).get(),
    database.collection(socialStore.COLLECTIONS.posts).orderBy("postedAt", "desc").limit(1).get(),
    database.collection(socialStore.COLLECTIONS.posts).orderBy("postedAt", "asc").limit(1).get(),
    socialStore.status(),
  ]);

  const accounts = accountsSnapshot.docs.map((doc) => {
    const item: any = doc.data();
    return {
      accountId: String(item.accountId || ""),
      username: String(item.username || ""),
      displayName: String(item.displayName || ""),
    };
  }).sort((a, b) => (a.username || a.accountId).localeCompare(b.username || b.accountId));

  const newest = newestSnapshot.docs[0]?.get("postedAt")?.toDate?.() || null;
  const oldest = oldestSnapshot.docs[0]?.get("postedAt")?.toDate?.() || null;
  const years: number[] = [];
  if (newest && oldest) {
    for (let year = newest.getUTCFullYear(); year >= oldest.getUTCFullYear(); year -= 1) years.push(year);
  }

  return {
    accounts,
    years,
    totalPosts: archiveStatus.counts.posts,
    totalAccounts: archiveStatus.counts.accounts,
  };
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

    if (request.method === "GET" && url.pathname.endsWith("/verify-import")) {
      const expected = env("SOCIAL_ARCHIVE_VERIFY_TOKEN") || "";
      const provided = url.searchParams.get("token") || "";
      if (!expected || provided !== expected) return json({ error: "Unauthorized" }, 401);
      ensureFirebaseAdmin();
      const database = getFirestore(getApp());
      const [archive, secondAccount, firstRun, secondRun] = await Promise.all([
        socialStore.status(),
        database.collection(socialStore.COLLECTIONS.posts).where("accountId", "==", "1372211341172244484").get(),
        database.collection(socialStore.COLLECTIONS.importRuns).doc("x-archive-1334823231262314497-2023-02-16").get(),
        database.collection(socialStore.COLLECTIONS.importRuns).doc("x-archive-1372211341172244484-2022-11-26").get(),
      ]);
      const secondItems = secondAccount.docs.map((doc) => doc.data());
      return json({
        archive,
        secondAccount: {
          posts: secondItems.length,
          replies: secondItems.filter((item) => item.type === "reply").length,
          reposts: secondItems.filter((item) => item.type === "repost").length,
          quotes: secondItems.filter((item) => item.type === "quote").length,
        },
        firstRun: firstRun.exists ? serialize(firstRun.data()) : null,
        secondRun: secondRun.exists ? serialize(secondRun.data()) : null,
      });
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
        const starredParam = url.searchParams.get("starred");
        return json(await socialStore.searchPosts({
          query: url.searchParams.get("query") || undefined,
          account: url.searchParams.get("account") || undefined,
          category: url.searchParams.get("category") || undefined,
          type: url.searchParams.get("type") || undefined,
          year: url.searchParams.get("year") ? Number(url.searchParams.get("year")) : undefined,
          starred: starredParam === null ? undefined : starredParam === "true",
          cursor: url.searchParams.get("cursor") || undefined,
          limit: Number(url.searchParams.get("limit") || 50),
          scanLimit: Number(url.searchParams.get("scanLimit") || 500),
        }));
      }
      if (resource === "facets") {
        return json(await archiveFacets());
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
