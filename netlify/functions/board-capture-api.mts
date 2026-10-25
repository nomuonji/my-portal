// Quick capture endpoint for the My Portal Chrome extension.
// Auth: the same access key as the My Portal MCP (Authorization: Bearer <access key>),
// checked against AGENT_IDEAS_MCP_ACCESS_KEY_HASH exactly like netlify/functions/mcp.mts.
import { createHash, timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import * as documentDbImport from "../../functions/documentDb.js";
import * as boardCaptureImport from "../../functions/boardCapture.js";

const documentDb: any = (documentDbImport as any).default ?? documentDbImport;
const boardCapture: any = (boardCaptureImport as any).default ?? boardCaptureImport;

// Same fallback as mcp.mts so both accept the same key.
const DEFAULT_ACCESS_KEY_HASH = "4a461bee865d7bcb86e23676790ef53af61b67c3d4f233bcf889cc21b1c71fd7";

function env(name: string): string | undefined {
  try {
    const value = (globalThis as any).Netlify?.env?.get(name);
    return value ? String(value) : process.env[name];
  } catch {
    return process.env[name];
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  // Only extension pages may call this cross-origin (the key is still required).
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
}

function accessKeyHash() {
  return env("AGENT_IDEAS_MCP_ACCESS_KEY_HASH")?.trim() || DEFAULT_ACCESS_KEY_HASH;
}

function authorized(request: Request) {
  const raw = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) return false;
  const left = Buffer.from(createHash("sha256").update(raw).digest("hex"));
  const right = Buffer.from(accessKeyHash());
  return left.length === right.length && timingSafeEqual(left, right);
}

function ensureFirebaseAdmin() {
  if (documentDb.useTurso() || getApps().length) return;
  const raw = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured on Netlify");
  const serviceAccount = JSON.parse(raw);
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id || "my-portal-d05fd" });
}

export default async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!authorized(request)) return json(request, { error: "Unauthorized" }, 401);

  try {
    ensureFirebaseAdmin();
    if (request.method === "GET") {
      return json(request, { boards: await boardCapture.listBoards() });
    }
    if (request.method === "POST") {
      let body: any = {};
      try { body = await request.json(); } catch { body = {}; }
      const result = await boardCapture.capture(body);
      return json(request, { ok: true, ...result }, 201);
    }
    return json(request, { error: "Method not allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /^(Unknown board|content is required)/.test(message) ? 400 : 500;
    return json(request, { error: message }, status);
  }
};

export const config = {
  path: ["/api/board-capture"],
};
