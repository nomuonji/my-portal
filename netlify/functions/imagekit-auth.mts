import { createHmac, randomUUID } from "node:crypto";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function env(name: string): string {
  try {
    return String((globalThis as any).Netlify?.env?.get(name) || process.env[name] || "").trim();
  } catch {
    return String(process.env[name] || "").trim();
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
  if (!raw) throw new Error("Firebase Admin credentials are not configured");
  const serviceAccount = JSON.parse(raw);
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id || "my-portal-d05fd",
  });
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const publicKey = env("IMAGEKIT_PUBLIC_KEY");
  const privateKey = env("IMAGEKIT_PRIVATE_KEY");
  if (!publicKey || !privateKey) {
    return json({ error: "ImageKit is not yet configured by the portal owner." }, 503);
  }

  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Login required." }, 401);

  try {
    const user = await getAuth(ensureFirebaseAdmin()).verifyIdToken(bearer);
    if (!user.email_verified) {
      return json({ error: "A verified Google account is required to upload images." }, 403);
    }

    // Short-lived upload tokens never expose the ImageKit private key.
    const token = randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 120;
    const signature = createHmac("sha1", privateKey).update(token + expire).digest("hex");
    return json({ token, expire, signature, publicKey });
  } catch (error) {
    // Invalid token and Firebase Admin failure must not reveal credentials.
    return json({ error: "Image upload authorization failed." }, 401);
  }
};

export const config = { path: "/api/imagekit-auth" };
