import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { initializeFirestore } from "firebase-admin/firestore";
import * as agentStoreImport from "../../functions/agentIdeasStoreAgentDb.js";
import * as portalStoreImport from "../../functions/portalStore.js";
import * as agentToolsImport from "../../functions/agentIdeasToolSchemas.js";
import * as portalToolsImport from "../../functions/portalMcpTools.js";
import * as socialStoreImport from "../../functions/socialArchiveStore.js";
import * as socialToolsImport from "../../functions/socialArchiveToolSchemas.js";
import * as contextStoreImport from "../../functions/contextStore.js";
import * as contextToolsImport from "../../functions/contextStoreToolSchemas.js";
import * as linearBridgeImport from "../../functions/linearMcpBridge.js";
import * as migrationImport from "../../functions/agentIdeasMigration.js";

const agentStore: any = (agentStoreImport as any).default ?? agentStoreImport;
const portalStore: any = (portalStoreImport as any).default ?? portalStoreImport;
const agentToolsModule: any = (agentToolsImport as any).default ?? agentToolsImport;
const portalToolsModule: any = (portalToolsImport as any).default ?? portalToolsImport;
const socialStore: any = (socialStoreImport as any).default ?? socialStoreImport;
const socialToolsModule: any = (socialToolsImport as any).default ?? socialToolsImport;
const contextStore: any = (contextStoreImport as any).default ?? contextStoreImport;
const contextToolsModule: any = (contextToolsImport as any).default ?? contextToolsImport;
const linearBridge: any = (linearBridgeImport as any).default ?? linearBridgeImport;
const migration: any = (migrationImport as any).default ?? migrationImport;
const TOOLS: any[] = [...agentToolsModule.TOOLS, ...contextToolsModule.TOOLS, ...portalToolsModule.TOOLS, ...socialToolsModule.TOOLS];

const SERVER_NAME = "my-portal";
const SERVER_VERSION = "1.10.0-netlify";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];
const ALLOWED_SCOPES = new Set(["agent-ideas", "offline_access"]);
const DEFAULT_ACCESS_KEY_HASH = "4a461bee865d7bcb86e23676790ef53af61b67c3d4f233bcf889cc21b1c71fd7";

function env(name: string): string | undefined {
  try {
    const value = (globalThis as any).Netlify?.env?.get(name);
    return value ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

function requiredEnv(name: string) {
  const value = env(name)?.trim();
  if (!value) throw new Error(`${name} is not configured on Netlify`);
  return value;
}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  return left.length === right.length && timingSafeEqual(left, right);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function accessKeyHash() {
  return env("AGENT_IDEAS_MCP_ACCESS_KEY_HASH")?.trim() || DEFAULT_ACCESS_KEY_HASH;
}

function signingKey() {
  const dedicated = env("AGENT_IDEAS_MCP_SIGNING_KEY")?.trim();
  if (dedicated) return dedicated;
  // Personal MCP fallback: reuse the already configured access-key hash so
  // OAuth remains operational even when a separate signing secret is absent.
  return accessKeyHash();
}

function sameAccessKey(value: string) {
  return Boolean(value) && safeEqual(sha256(value), accessKeyHash());
}

function b64(value: string) {
  return Buffer.from(value).toString("base64url");
}

function unb64(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(kind: string, claims: Record<string, unknown> = {}) {
  const ttl = kind === "refresh"
    ? 60 * 60 * 24 * 30
    : kind === "access"
      ? 60 * 60
      : kind === "client"
        ? 60 * 60 * 24 * 365
        : 5 * 60;
  const body = b64(JSON.stringify({
    kind,
    exp: Math.floor(Date.now() / 1000) + ttl,
    ...claims,
  }));
  const signature = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySigned(value: unknown, expectedKind: string): any | null {
  const [body, signature] = String(value || "").split(".");
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  } catch {
    return null;
  }
  if (!safeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(unb64(body));
    if (payload.kind !== expectedKind) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeRedirect(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return url;
    return null;
  } catch {
    return null;
  }
}

function requestedScopes(value: unknown) {
  const scopes = String(value || "agent-ideas")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!scopes.length) scopes.push("agent-ideas");
  if (scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) return null;
  return [...new Set(scopes)].join(" ");
}

function canonicalResource(request: Request) {
  return `${new URL(request.url).origin}/mcp`;
}

function requestedResource(value: unknown, request: Request) {
  const expected = canonicalResource(request);
  if (!value) return expected;
  try {
    return new URL(String(value)).toString() === expected ? expected : null;
  } catch {
    return null;
  }
}

function cimdUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "chatgpt.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(url.pathname)
    ) return null;
    return url;
  } catch {
    return null;
  }
}

async function resolveOAuthClient(clientId: string) {
  const legacy = verifySigned(clientId, "client");
  if (legacy && Array.isArray(legacy.redirectUris)) {
    return { clientId, redirectUris: legacy.redirectUris.map(String), kind: "legacy-dcr" };
  }

  const metadataUrl = cimdUrl(clientId);
  if (!metadataUrl) {
    // Some Remote MCP clients (for example Groq) do not use ChatGPT CIMD or
    // dynamic client registration. Treat a bounded opaque client_id as an
    // unregistered public PKCE client. Authorization still requires the
    // My Portal access key, and the issued code remains bound to the exact
    // client_id, redirect_uri, resource, and PKCE challenge.
    const validOpaqueClientId =
      Boolean(clientId) &&
      clientId.length <= 2048 &&
      !Array.from(clientId).some((char) => {
        const code = char.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
      });
    return validOpaqueClientId
      ? { clientId, redirectUris: [], kind: "public-pkce" }
      : null;
  }
  try {
    const response = await fetch(metadataUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const metadata: any = await response.json();
    const redirectUris = Array.isArray(metadata.redirect_uris)
      ? metadata.redirect_uris.map((value: unknown) => safeRedirect(value)).filter(Boolean).map((url: URL) => url.toString())
      : [];
    const authMethods = Array.isArray(metadata.token_endpoint_auth_methods_supported)
      ? metadata.token_endpoint_auth_methods_supported.map(String)
      : metadata.token_endpoint_auth_method
        ? [String(metadata.token_endpoint_auth_method)]
        : [];
    const responseTypes = Array.isArray(metadata.response_types) ? metadata.response_types.map(String) : [];
    const grantTypes = Array.isArray(metadata.grant_types) ? metadata.grant_types.map(String) : [];
    if (
      metadata.client_id !== clientId ||
      !redirectUris.length ||
      !authMethods.includes("none") ||
      !responseTypes.includes("code") ||
      !grantTypes.includes("authorization_code")
    ) return null;
    return { clientId, redirectUris, kind: "cimd" };
  } catch {
    return null;
  }
}

function origin(request: Request) {
  return new URL(request.url).origin;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authorizeForm(request: Request, params: Record<string, string>) {
  const hidden = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Portal MCP</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#eef5f8;color:#18324a;margin:0}.card{max-width:34rem;margin:8vh auto;background:#fff;padding:2rem;border:1px solid #d9e7ef;border-radius:16px;box-shadow:0 18px 60px rgba(39,76,99,.13)}h1{margin-top:0}input,button{box-sizing:border-box;width:100%;padding:.8rem;margin:.45rem 0;font:inherit;border-radius:10px}input{border:1px solid #b9cdd9}button{border:0;background:#5577e8;color:white;font-weight:700;cursor:pointer}small{color:#6e8294}</style></head><body><div class="card"><h1>My Portal を接続</h1><p>ChatGPT に、Agent Idea Space と My Portal 本体データの読み書きを許可します。</p><form method="post" action="${origin(request)}/oauth/authorize">${hidden}<label>アクセスキー<input name="access_key" type="password" autocomplete="current-password" required autofocus></label><small>My Portal MCP 用アクセスキーです。</small><button type="submit">許可して接続</button></form></div></body></html>`;
}

async function bodyObject(request: Request): Promise<Record<string, any>> {
  const raw = await request.text();
  if (!raw) return {};
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function ensureFirebaseAdmin() {
  let app;
  if (getApps().length) {
    app = getApps()[0];
  } else {
    const raw = requiredEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
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

  // Initialize Firestore before any Context Store call. The Agent Idea wrapper
  // uses the same options; doing this here prevents a raw getFirestore() call
  // from locking the app to different serverless transport options.
  initializeFirestore(app, { preferRest: true });
}

function structured(value: unknown) {
  const normalized = value === undefined ? null : value;
  return {
    content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
    structuredContent: Array.isArray(normalized)
      ? { items: normalized }
      : normalized && typeof normalized === "object"
        ? normalized
        : { value: normalized },
  };
}

async function ensureAgentData() {
  const [legacy, youtubeMethod] = await Promise.all([
    migration.bootstrapLegacyAgentData("(default)"),
    contextStore.bootstrapYoutubeEssayMethod(),
  ]);
  return { legacy, youtubeMethod };
}

async function invokeTool(name: string, args: Record<string, any> = {}) {
  ensureFirebaseAdmin();

  if (name === "portal_status") return structured(await portalStore.status());
  if (name === "portal_get") return structured(await portalStore.get(args));
  if (name === "portal_search") return structured(await portalStore.search(args));
  if (name === "portal_create") return structured(await portalStore.create(args));
  if (name === "portal_update") return structured(await portalStore.update(args));
  if (name === "portal_delete") return structured(await portalStore.remove(args));

  if (name === "social_archive_status") return structured(await socialStore.status());
  if (name === "social_post_get") return structured(await socialStore.getPost(args));
  if (name === "social_posts_search") return structured(await socialStore.searchPosts(args));
  if (name === "social_import_posts") return structured(await socialStore.importPosts(args));
  if (name === "social_post_update_metadata") return structured(await socialStore.updateMetadata(args));
  if (name === "social_posts_update_metadata") return structured(await socialStore.bulkUpdateMetadata(args));

  await ensureAgentData();
  switch (name) {
    case "agent_ideas_status": {
      const legacyBootstrap = await contextStore.bootstrapIncomeSearchMigration();
      return structured({
        service: SERVER_NAME,
        serverVersion: SERVER_VERSION,
        databaseId: agentStore.DATABASE_ID,
        collections: agentStore.COLLECTIONS,
        contextCollections: contextStore.COLLECTIONS,
        toolCount: TOOLS.length,
        agentToolCount: agentToolsModule.TOOLS.length,
        contextToolCount: contextToolsModule.TOOLS.length,
        portalToolCount: portalToolsModule.TOOLS.length,
        socialToolCount: socialToolsModule.TOOLS.length,
        database: await agentStore.healthCheck(),
        contextStore: await contextStore.healthCheck(),
        linear: linearBridge.configSummary(),
        legacyBootstrap,
      });
    }
    case "control_plane_overview": return structured(await contextStore.controlPlaneOverview(args));
    case "agent_hq_operating_model": return structured(await contextStore.agentHqOperatingModel(args));
    case "operating_model_get_context": return structured(await contextStore.operatingModelGetContext(args));
    case "operating_model_version_get": return structured(await contextStore.operatingModelVersionGet(args));
    case "operating_model_version_create": return structured(await contextStore.operatingModelVersionCreate(args));
    case "operating_model_version_activate": return structured(await contextStore.operatingModelVersionActivate(args));
    case "system_change_create": return structured(await contextStore.systemChangeCreate(args));
    case "system_change_get": return structured(await contextStore.systemChangeGet(args));
    case "system_change_search": return structured(await contextStore.systemChangeSearch(args));
    case "system_change_update": return structured(await contextStore.systemChangeUpdate(args));
    case "system_incident_search": return structured(await contextStore.systemIncidentSearch(args));
    case "manager_job_create": return structured(await contextStore.managerJobCreate(args));
    case "manager_job_get": return structured(await contextStore.managerJobGet(args));
    case "manager_job_search": return structured(await contextStore.managerJobSearch(args));
    case "manager_job_update": return structured(await contextStore.managerJobUpdate(args));
    case "manager_job_get_context": return structured(await contextStore.managerJobGetContext(args));
    case "manager_job_history": return structured(await contextStore.managerJobHistory(args));
    case "manager_job_start": return structured(await contextStore.managerJobStart(args));
    case "manager_run_get": return structured(await contextStore.managerRunGet(args));
    case "manager_run_claim": return structured(await contextStore.managerRunClaim(args));
    case "manager_run_heartbeat": return structured(await contextStore.managerRunHeartbeat(args));
    case "manager_run_create_work_item": return structured(await contextStore.managerRunCreateWorkItem(args));
    case "manager_run_reconcile_work_item": return structured(await contextStore.managerRunReconcileWorkItem(args));
    case "manager_run_finish": return structured(await contextStore.managerRunFinish(args));
    case "linear_status": return structured(await contextStore.linearStatus(args));
    case "linear_tool_catalog": return structured(await contextStore.linearToolCatalog(args));
    case "linear_tool_call": return structured(await contextStore.linearToolCall(args));
    case "linear_issue_import_to_work_item": return structured(await contextStore.linearIssueImportToWorkItem(args));
    case "work_item_push_to_linear": return structured(await contextStore.workItemPushToLinear(args));
    case "work_item_create": return structured(await contextStore.workItemCreate(args));
    case "work_item_get": return structured(await contextStore.workItemGet(args));
    case "work_item_get_execution_context": return structured(await contextStore.workItemGetExecutionContext(args));
    case "work_item_search": return structured(await contextStore.workItemSearch(args));
    case "work_item_update": return structured(await contextStore.workItemUpdate(args));
    case "work_item_claim": return structured(await contextStore.workItemClaim(args));
    case "work_item_heartbeat": return structured(await contextStore.workItemHeartbeat(args));
    case "work_item_finish": return structured(await contextStore.workItemFinish(args));
    case "work_item_delegate_to_human": return structured(await contextStore.workItemDelegateToHuman(args));
    case "work_item_release": return structured(await contextStore.workItemRelease(args));
    case "work_item_report_problem": return structured(await contextStore.workItemReportProblem(args));
    case "system_incident_create": return structured(await contextStore.systemIncidentCreate(args));
    case "system_incident_update": return structured(await contextStore.systemIncidentUpdate(args));
    case "system_incident_resolve": return structured(await contextStore.systemIncidentResolve(args));
    case "space_create": return structured(await contextStore.spaceCreate(args));
    case "space_get": return structured(await contextStore.spaceGet(args));
    case "space_search": return structured(await contextStore.spaceSearch(args));
    case "space_update": return structured(await contextStore.spaceUpdate(args));
    case "space_get_context": return structured(await contextStore.spaceGetContext(args));
    case "method_create": return structured(await contextStore.methodCreate(args));
    case "method_get": return structured(await contextStore.methodGet(args));
    case "method_search": return structured(await contextStore.methodSearch(args));
    case "method_update": return structured(await contextStore.methodUpdate(args));
    case "method_version_get": return structured(await contextStore.methodVersionGet(args));
    case "method_version_create": return structured(await contextStore.methodVersionCreate(args));
    case "method_version_activate": return structured(await contextStore.methodVersionActivate(args));
    case "method_get_context": return structured(await contextStore.methodGetContext(args));
    case "profile_get_context": return structured(await contextStore.profileGetContext(args));
    case "profile_fact_upsert": return structured(await contextStore.profileFactUpsert(args));
    case "profile_fact_update": return structured(await contextStore.profileFactUpdate(args));
    case "decision_create": return structured(await contextStore.decisionCreate(args));
    case "opportunity_create": return structured(await contextStore.opportunityCreate(args));
    case "opportunity_update": return structured(await contextStore.opportunityUpdate(args));
    case "space_distill_run": return structured(await contextStore.spaceDistillRun(args));
    case "idea_category_list": return structured(await agentStore.categoryList(args));
    case "idea_category_upsert": return structured(await agentStore.categoryUpsert(args));
    case "idea_generation_work": return structured(await agentStore.generationWork(args));
    case "idea_replenish_request": return structured(await agentStore.requestReplenishment(args));
    case "idea_promote_to_portal": return structured(await agentStore.promoteToPortal(args));
    case "idea_create": {
      if (args.spaceId && args.categoryId) throw new Error("idea_create accepts either spaceId or categoryId, not both");
      if (args.spaceId) return structured(await contextStore.spaceIdeaCreate(args));
      return structured(await agentStore.ideaCreate(args));
    }
    case "idea_get": {
      if (await contextStore.spaceIdeaExists(args.id)) return structured(await contextStore.spaceIdeaGet(args));
      return structured(await agentStore.ideaGet(args));
    }
    case "idea_search": {
      const query = String(args.query || "").trim();
      if (query.toLowerCase().startsWith("space:")) {
        const spaceQuery = query.slice("space:".length).trim();
        return structured(await contextStore.spaceSearch({
          query: spaceQuery || undefined,
          tag: args.tag,
          domain: args.domain,
          limit: args.limit,
          scanLimit: args.scanLimit,
        }));
      }
      if (args.spaceId) return structured(await contextStore.spaceIdeaSearch(args));
      return structured(await agentStore.ideaSearch(args));
    }
    case "idea_update": {
      if (await contextStore.spaceIdeaExists(args.id)) return structured(await contextStore.spaceIdeaUpdate(args));
      return structured(await agentStore.ideaUpdate(args));
    }
    case "idea_expand": {
      if (await contextStore.spaceIdeaExists(args.parentIdeaId)) return structured(await contextStore.spaceIdeaExpand(args));
      return structured(await agentStore.ideaExpand(args));
    }
    case "idea_link": {
      const [fromThinking, toThinking] = await Promise.all([
        contextStore.spaceIdeaExists(args.fromIdeaId),
        contextStore.spaceIdeaExists(args.toIdeaId),
      ]);
      if (fromThinking || toThinking) {
        if (!(fromThinking && toThinking)) {
          throw new Error("Cross-layer idea links are not supported; both ideas must be Thinking Space ideas or both Agent Ideas");
        }
        return structured(await contextStore.spaceIdeaLink(args));
      }
      return structured(await agentStore.ideaLink(args));
    }
    case "idea_get_context": {
      const id = String(args.id || "");
      if (id.startsWith("space:")) {
        return structured(await contextStore.spaceGetContext({
          id: id.slice("space:".length),
          ideaLimit: args.maxNeighbors,
          recentLimit: args.maxNeighbors,
          includeArtifacts: args.includeArtifacts ?? true,
          includeInferred: true,
        }));
      }
      if (await contextStore.spaceIdeaExists(id)) return structured(await contextStore.spaceIdeaGetContext(args));
      return structured(await agentStore.ideaGetContext(args));
    }
    case "idea_merge": {
      const sourceIds = Array.isArray(args.sourceIdeaIds) ? args.sourceIdeaIds : [];
      const thinkingFlags = await Promise.all(sourceIds.map((id: string) => contextStore.spaceIdeaExists(id)));
      if (thinkingFlags.some(Boolean)) {
        if (!thinkingFlags.every(Boolean)) {
          throw new Error("Cross-layer idea merge is not supported; all source ideas must be in the same layer");
        }
        return structured(await contextStore.spaceIdeaMerge(args));
      }
      return structured(await agentStore.ideaMerge(args));
    }
    case "idea_archive": {
      if (await contextStore.spaceIdeaExists(args.id)) return structured(await contextStore.spaceIdeaArchive(args));
      return structured(await agentStore.ideaArchive(args));
    }
    case "idea_run_start": {
      if (args.spaceId || args.methodId || args.methodVersionId) return structured(await contextStore.spaceRunStart(args));
      return structured(await agentStore.runStart(args));
    }
    case "idea_run_finish": {
      if (await contextStore.spaceRunExists(args.id)) return structured(await contextStore.spaceRunFinish(args));
      return structured(await agentStore.runFinish(args));
    }
    case "idea_add_source": {
      if (await contextStore.spaceIdeaExists(args.ideaId)) return structured(await contextStore.spaceSourceAdd(args));
      return structured(await agentStore.sourceAdd(args));
    }
    case "idea_evaluate": {
      if (await contextStore.spaceIdeaExists(args.ideaId)) return structured(await contextStore.spaceEvaluationAdd(args));
      return structured(await agentStore.evaluationAdd(args));
    }
    case "idea_add_artifact": {
      if ((args.ideaId && await contextStore.spaceIdeaExists(args.ideaId)) || (!args.ideaId && args.spaceId)) {
        return structured(await contextStore.spaceArtifactAdd(args));
      }
      return structured(await agentStore.artifactAdd(args));
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function authorizeBearer(request: Request) {
  const raw = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    if (sameAccessKey(raw)) return { kind: "access-key", clientId: "direct", scope: "agent-ideas", resource: canonicalResource(request) };
  } catch {
    return null;
  }
  const token = verifySigned(raw, "access");
  if (!token) return null;
  if (token.resource && token.resource !== canonicalResource(request)) return null;
  return token;
}

async function handleRpc(message: any) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  const id = message.id;
  if (message.method.startsWith("notifications/")) return null;
  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: "My Portal is an Agent Control Plane + Context Store + Thinking Workspace. Autonomous work should begin with control_plane_overview. Claim executable agent work with work_item_claim before acting. Claiming moves the Work Item to running, which means an agent is actively executing it now; in_progress means ongoing but not currently being executed. Backlog is only for work deliberately deferred from near-term execution, not for merely paused or ongoing work. Do not take over a running item with an active lease owned by another agent. Heartbeat long work, and finish/release the item with a durable handoff so parallel agents do not duplicate effort. Use archived as the single closed state for completed or withdrawn Work Items. Manager Jobs are schedule-agnostic management definitions: My Portal never owns cron/time/timezone state. External schedulers such as ChatGPT should call manager_job_start(jobId, optional invocationId), claim the returned Manager Run with manager_run_claim, then load manager_job_get_context. A Manager Run observes the current queue/domain, reconciles existing Work Items, decides what work is needed, and delegates zero to many worker Work Items with manager_run_create_work_item. It should not perform the underlying worker task itself. Existing Work Items can be reprioritized or archived with manager_run_reconcile_work_item. Finish the management pass with manager_run_finish; zero new Work Items is valid. Linear is an external task source: control_plane_overview includes open Linear issues when configured; import relevant issues with linear_issue_import_to_work_item before autonomous execution, and use work_item_push_to_linear to create/update linked Linear issues. For broader Linear operations, inspect linear_tool_catalog then call linear_tool_call, which proxies Linear's official Remote MCP without exposing the API key. If Linear setup is missing, the control plane creates a Human Task for the user to store LINEAR_API_KEY directly in Netlify. If a step genuinely requires a person, move it to the Human Tasks box with work_item_delegate_to_human instead of leaving it in the agent queue or only mentioning it in chat. If execution hits a capability, safety, validation, tool, state, or external-dependency problem, Workers should call work_item_report_problem so their Manager can triage it; Workers should not normally create System Incidents directly. Managers should create system_incident records only for structural, recurring, cross-task, or manager-unresolvable failures. Read agent_hq_operating_model when diagnosing Agent HQ behavior. Manager and Worker procedures belong in Method versions, not scheduler prompts. Manager Method protocol.runtimeRequirements and Worker Method protocol.runtimeRequirements declare required capabilities/tools. External runners must report only actually available capabilities/tools when claiming Manager Runs or Work Items. Work Item Worker Method versions are pinned on first successful claim. Use space_search then space_get_context to resume long-running themes. Use profile_get_context for scoped User Model facts, preserving explicit vs inferred evidence. If the host is temporarily exposing an older cached tool schema without the new Context Store tools, use idea_search with query prefixed by `space:` to search Spaces and idea_get_context with id `space:<spaceId>` to fetch the same Space Context Pack. Thinking Spaces and Agent Ideas are separate storage layers, but idea_* tools are interoperable: spaceId targets durable Thinking Space ideas, categoryId targets Agent Ideas board items, and ID-based reads/updates resolve the correct layer automatically. Use space_* / profile_* / decision_* / opportunity_* for long-running thinking themes. Use method_search then method_get_context for reusable, versioned Agent Methods/Protocols; start method executions with idea_run_start + methodId so the exact methodVersionId is persisted for later evaluation and improvement. Agent Ideas mirrors the Portal board hierarchy: ideas/hobbies/stocks as the large categories and the Portal tags beneath them. Use idea_generation_work to find mirrored tag categories that need replenishment, then idea_create with categoryId. When the user adopts an Agent Idea, use idea_promote_to_portal so it is copied into the matching Portal board/tag and marked promoted with provenance retained. Existing portal_* data remains separate; projects are implementation workspaces, not idea bins. A Project may span multiple GitHub repositories and stores repositories[], mcpTools[], spaceIds[], and tags[]; actual execution lives in Work Items linked by projectId. Read a Project with portal_get/portal_search and its work with work_item_search({ projectId }). portal_delete requires explicit confirm=true. social_* tools manage the personal SNS archive: search historical posts, import official X archive posts in batches, and update only review metadata such as category/tags/starred/note.",
      },
    };
  }
  if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (!name) return { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call requires params.name" } };
    try {
      return { jsonrpc: "2.0", id, result: await invokeTool(name, message.params?.arguments || {}) };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        },
      };
    }
  }
  if (id === undefined || id === null) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } };
}

async function handleMcp(request: Request) {
  const auth = authorizeBearer(request);
  if (!auth) {
    return json({ error: "Unauthorized" }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource", scope="agent-ideas"`,
    });
  }
  if (request.method === "GET") return json({ error: "Use POST for Streamable HTTP MCP requests." }, 405, { Allow: "POST, OPTIONS" });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "JSON-RPC body required" }, 400); }
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const message of messages) {
    const response = await handleRpc(message);
    if (response) responses.push(response);
  }
  if (!responses.length) return new Response(null, { status: 202 });
  const requestedProtocol = request.headers.get("mcp-protocol-version") || "";
  const protocol = SUPPORTED_PROTOCOLS.includes(requestedProtocol) ? requestedProtocol : DEFAULT_PROTOCOL;
  return json(Array.isArray(body) ? responses : responses[0], 200, { "Mcp-Protocol-Version": protocol });
}

async function handleRegister(request: Request) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await bodyObject(request);
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.map((value: unknown) => safeRedirect(value)).filter(Boolean) as URL[]
    : [];
  if (!redirectUris.length) return json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" }, 400);
  const authMethod = body.token_endpoint_auth_method || "none";
  if (authMethod !== "none") return json({ error: "invalid_client_metadata", error_description: "Only public PKCE clients are supported" }, 400);
  const clientId = sign("client", {
    redirectUris: redirectUris.map((url) => url.toString()),
    clientName: String(body.client_name || "ChatGPT MCP client").slice(0, 200),
  });
  return json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris.map((url) => url.toString()),
    client_name: String(body.client_name || "ChatGPT MCP client").slice(0, 200),
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "agent-ideas offline_access",
  }, 201);
}

async function handleAuthorize(request: Request) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const redirectUri = safeRedirect(url.searchParams.get("redirect_uri"));
    const clientId = url.searchParams.get("client_id") || "";
    const client = await resolveOAuthClient(clientId);
    const challenge = url.searchParams.get("code_challenge") || "";
    const scope = requestedScopes(url.searchParams.get("scope"));
    const resource = requestedResource(url.searchParams.get("resource"), request);
    const redirectAllowed = Boolean(
      client &&
      redirectUri &&
      (client.kind === "public-pkce" || client.redirectUris.includes(redirectUri.toString()))
    );
    if (
      url.searchParams.get("response_type") !== "code" ||
      !redirectUri ||
      !client ||
      !redirectAllowed ||
      !challenge ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !scope ||
      !resource
    ) return new Response("Invalid OAuth authorization request", { status: 400 });

    const clientProof = sign("client-proof", {
      clientId,
      redirectUri: redirectUri.toString(),
      resource,
    });
    const html = authorizeForm(request, {
      redirect_uri: redirectUri.toString(),
      client_id: clientId,
      client_proof: clientProof,
      state: url.searchParams.get("state") || "",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope,
      resource,
    });
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (request.method === "POST") {
    const body = await bodyObject(request);
    const redirectUri = safeRedirect(body.redirect_uri);
    const clientId = String(body.client_id || "");
    const clientProof = verifySigned(body.client_proof, "client-proof");
    const challenge = String(body.code_challenge || "");
    const scope = requestedScopes(body.scope);
    const resource = requestedResource(body.resource, request);
    let accessGranted = false;
    let accessConfigured = true;
    try {
      accessGranted = sameAccessKey(String(body.access_key || ""));
    } catch {
      accessConfigured = false;
    }

    const failure =
      !redirectUri ? "redirect_uri" :
      !clientProof ? "client_proof" :
      clientProof.clientId !== clientId ? "client_id" :
      clientProof.redirectUri !== redirectUri.toString() ? "redirect_uri_binding" :
      clientProof.resource !== resource ? "resource_binding" :
      !challenge ? "code_challenge" :
      !scope ? "scope" :
      !resource ? "resource" :
      !accessConfigured ? "server_configuration" :
      !accessGranted ? "access_key" :
      null;

    if (failure) return new Response(`Authorization denied (${failure})`, { status: 401 });

    const code = sign("code", { redirectUri: redirectUri.toString(), clientId, challenge, scope, resource });
    redirectUri.searchParams.set("code", code);
    redirectUri.searchParams.set("iss", origin(request));
    if (body.state) redirectUri.searchParams.set("state", String(body.state));
    return Response.redirect(redirectUri.toString(), 302);
  }
  return new Response("Method not allowed", { status: 405 });
}
async function handleToken(request: Request) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await bodyObject(request);
  const grant = String(body.grant_type || "");

  if (grant === "refresh_token") {
    const refresh = verifySigned(body.refresh_token, "refresh");
    if (!refresh) return json({ error: "invalid_grant" }, 400);
    if (body.client_id && String(body.client_id) !== refresh.clientId) return json({ error: "invalid_client" }, 400);
    const resource = requestedResource(body.resource || refresh.resource, request);
    if (!resource || (refresh.resource && refresh.resource !== resource)) return json({ error: "invalid_target" }, 400);
    const scope = requestedScopes(refresh.scope) || "agent-ideas";
    return json({
      access_token: sign("access", { clientId: refresh.clientId, scope, resource }),
      refresh_token: sign("refresh", { clientId: refresh.clientId, scope, resource }),
      token_type: "Bearer",
      expires_in: 3600,
      scope,
    });
  }

  const code = verifySigned(body.code, "code");
  const verifier = String(body.code_verifier || "");
  const redirectUri = String(body.redirect_uri || "");
  const clientId = String(body.client_id || "");
  const actualChallenge = createHash("sha256").update(verifier).digest("base64url");
  const resource = requestedResource(body.resource || code?.resource, request);
  if (
    grant !== "authorization_code" || !code || !resource ||
    code.redirectUri !== redirectUri || code.clientId !== clientId || code.challenge !== actualChallenge ||
    (code.resource && code.resource !== resource)
  ) return json({ error: "invalid_grant" }, 400);

  const scope = requestedScopes(code.scope) || "agent-ideas";
  return json({
    access_token: sign("access", { clientId, scope, resource }),
    refresh_token: sign("refresh", { clientId, scope, resource }),
    token_type: "Bearer",
    expires_in: 3600,
    scope,
  });
}
export default async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const base = origin(request);

  if (
    (path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp") &&
    request.method === "GET"
  ) {
    return json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      scopes_supported: ["agent-ideas", "offline_access"],
      resource_name: "My Portal",
    });
  }

  if (
    (path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/oauth-authorization-server/mcp" ||
      path === "/mcp/.well-known/oauth-authorization-server" ||
      path === "/.well-known/openid-configuration" ||
      path === "/.well-known/openid-configuration/mcp" ||
      path === "/mcp/.well-known/openid-configuration") &&
    request.method === "GET"
  ) {
    return json({
      issuer: base,
      authorization_response_iss_parameter_supported: true,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      client_id_metadata_document_supported: true,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["agent-ideas", "offline_access"],
    });
  }

  if (path === "/oauth/register") return handleRegister(request);
  if (path === "/oauth/authorize") return handleAuthorize(request);
  if (path === "/oauth/token") return handleToken(request);

  if (path === "/health" || path === "/mcp/health") {
    const credentialsConfigured = Boolean(env("FIREBASE_SERVICE_ACCOUNT_JSON"));
    const oauthConfigured = Boolean(accessKeyHash());
    let agentDatabase: any = { ok: false, reason: "Firebase credentials are not configured" };
    let contextDatabase: any = { ok: false, reason: "Firebase credentials are not configured" };
    let portalDatabase: any = { ok: false, reason: "Firebase credentials are not configured" };
    let socialDatabase: any = { ok: false, reason: "Firebase credentials are not configured" };
    let migrationResult: any = null;
    if (credentialsConfigured) {
      try {
        ensureFirebaseAdmin();
        migrationResult = await ensureAgentData();
        [agentDatabase, contextDatabase, portalDatabase, socialDatabase] = await Promise.all([
          agentStore.healthCheck(),
          contextStore.healthCheck(),
          portalStore.status(),
          socialStore.status(),
        ]);
      } catch (error) {
        const failure = { ok: false, error: error instanceof Error ? error.message : String(error) };
        agentDatabase = failure;
        contextDatabase = failure;
        portalDatabase = failure;
        socialDatabase = failure;
      }
    }
    const ok = credentialsConfigured
      && oauthConfigured
      && Boolean(agentDatabase?.ok)
      && Boolean(contextDatabase?.ok)
      && Boolean(portalDatabase?.ok)
      && Boolean(socialDatabase?.ok);
    return json({
      ok,
      service: SERVER_NAME,
      serverVersion: SERVER_VERSION,
      toolCount: TOOLS.length,
      tools: TOOLS.map((tool) => tool.name),
      agentIdeas: { databaseId: agentStore.DATABASE_ID, database: agentDatabase, migration: migrationResult },
      contextStore: { databaseId: contextStore.DATABASE_ID, collections: contextStore.COLLECTIONS, database: contextDatabase },
      portal: { databaseId: portalStore.DATABASE_ID, database: portalDatabase },
      socialArchive: { databaseId: socialStore.DATABASE_ID, collections: socialStore.COLLECTIONS, database: socialDatabase },
      linear: linearBridge.configSummary(),
      oauth: {
        configured: oauthConfigured,
        clientRegistration: "cimd+public-pkce",
        cimd: true,
        legacyDcr: true,
        publicPkceFallback: true,
        directAccessKeyBearer: true,
        pkce: "S256",
        dedicatedSigningKeyConfigured: Boolean(env("AGENT_IDEAS_MCP_SIGNING_KEY")),
      },
      firebaseCredentialsConfigured: credentialsConfigured,
    }, credentialsConfigured ? 200 : 503);
  }

  if (path === "/mcp") return handleMcp(request);
  return json({ error: "Not found" }, 404);
};

export const config = {
  path: [
    "/mcp",
    "/mcp/health",
    "/health",
    "/oauth/register",
    "/oauth/authorize",
    "/oauth/token",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
    "/mcp/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/mcp",
    "/mcp/.well-known/openid-configuration",
  ],
};
