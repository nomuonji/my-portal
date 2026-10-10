import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { initializeFirestore } from "firebase-admin/firestore";
import * as storeImport from "../../functions/agentIdeasStoreAgentDb.js";
import * as documentDbImport from "../../functions/documentDb.js";
import * as contextStoreImport from "../../functions/contextStore.js";
import * as worldMapImport from "../../functions/worldMap.js";

const store: any = (storeImport as any).default ?? storeImport;
const contextStore: any = (contextStoreImport as any).default ?? contextStoreImport;
const worldMap: any = (worldMapImport as any).default ?? worldMapImport;
const documentDb: any = (documentDbImport as any).default ?? documentDbImport;
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
  const database = documentDb.getDocumentDb(AGENT_DATABASE_ID);
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
        return json(await store.ideaSearch({ limit: 500, scanLimit: 2000 }));
      }
      if (resource === "categories") {
        return json(await store.categoryList({ limit: 300 }));
      }
      if (resource === "generation_work") {
        return json(await store.generationWork({ includeSatisfied: true }));
      }
      if (resource === "runs") {
        return json({ items: await listCollection(store.COLLECTIONS.runs, 150), databaseId: store.DATABASE_ID });
      }
      if (resource === "world_map") {
        return json(await worldMap.get());
      }
      if (resource === "spaces") {
        // Additive, idempotent bootstraps. Loading the Thinking Workspace is
        // enough to make durable starter Spaces/Methods available.
        await Promise.all([
          contextStore.bootstrapIncomeSearchMigration(),
          contextStore.bootstrapYoutubeEssayMethod(),
        ]);
        return json(await contextStore.spaceSearch({ limit: 100, scanLimit: 300 }));
      }
      if (resource === "space_context") {
        const id = url.searchParams.get("id") || "";
        if (id === "youtube-content-methodology") await contextStore.bootstrapYoutubeEssayMethod();
        return json(await contextStore.spaceGetContext({ id, includeArtifacts: true, includeInferred: true }));
      }
      if (resource === "profile") {
        return json(await contextStore.profileGetContext({ includeInferred: true, limit: 200 }));
      }
      if (resource === "organizations") {
        return json(await contextStore.organizationList({ limit: 100 }));
      }
      if (resource === "manager_jobs") {
        return json(await contextStore.managerJobSearch({ limit: 100, scanLimit: 500 }));
      }
      if (resource === "methods") {
        return json(await contextStore.methodSearch({ limit: 100, scanLimit: 300 }));
      }
      if (resource === "method_context") {
        return json(await contextStore.methodGetContext({
          id: url.searchParams.get("id") || "",
          versionLimit: 20,
          runLimit: 20,
        }));
      }
      if (resource === "manager_job_context") {
        return json(await contextStore.managerJobGetContext({
          id: url.searchParams.get("id") || "",
          historyLimit: Math.min(Math.max(Number(url.searchParams.get("historyLimit")) || 20, 1), 100),
        }));
      }
      if (resource === "manager_job_history") {
        return json(await contextStore.managerJobHistory({
          id: url.searchParams.get("id") || "",
          limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 200),
        }));
      }
      if (resource === "manager_run") {
        return json(await contextStore.managerRunGet({ id: url.searchParams.get("id") || "" }));
      }
      if (resource === "control_plane") {
        return json(await contextStore.controlPlaneOverview({
          limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 80, 10), 200),
          includeLinear: url.searchParams.get("includeLinear") !== "false",
        }));
      }
      if (resource === "agent_hq_governance") {
        return json(await contextStore.agentHqGovernanceView());
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
      if (action === "category_upsert") {
        return json(await store.categoryUpsert({
          id: body.id,
          expectedRevision: body.expectedRevision,
          description: body.description,
          instructions: body.instructions,
          targetCount: body.targetCount,
          status: body.status || "active",
        }));
      }
      if (action === "replenish_request") {
        return json(await store.requestReplenishment({
          categoryId: body.categoryId,
          count: body.count,
        }));
      }
      if (action === "idea_archive") {
        return json(await store.ideaArchive({
          id: body.id,
          expectedRevision: body.expectedRevision,
          reason: body.reason || "Archived from Agent Ideas board",
        }));
      }
      if (action === "idea_promote") {
        return json(await store.promoteToPortal({
          id: body.id,
          expectedRevision: body.expectedRevision,
          content: body.content,
        }));
      }
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
      if (action === "world_map_update") {
        return json(await worldMap.update({
          expectedRevision: body.expectedRevision,
          routes: body.routes,
          hiddenRouteIds: body.hiddenRouteIds,
          boundaries: body.boundaries,
          confirm: body.confirm === true,
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
      if (action === "method_update") {
        return json(await contextStore.methodUpdate({
          id: body.id,
          expectedRevision: body.expectedRevision,
          patch: body.patch || {},
        }));
      }
      if (action === "method_version_create") {
        return json(await contextStore.methodVersionCreate({
          methodId: body.methodId,
          label: body.label,
          changeSummary: body.changeSummary,
          instructions: body.instructions,
          protocol: body.protocol || {},
          qualityGates: body.qualityGates || [],
          activate: body.activate === true,
        }, { agent: "portal-ui", model: "my-portal-ui" }));
      }
      if (action === "organization_create") {
        return json(await contextStore.organizationCreate(body));
      }
      if (action === "organization_update") {
        return json(await contextStore.organizationUpdate(body));
      }
      if (action === "organization_graduate") {
        return json(await contextStore.organizationGraduate(body));
      }
      if (action === "manager_job_create") {
        return json(await contextStore.managerJobCreate({
          id: body.id,
          title: body.title,
          objective: body.objective,
          instructions: body.instructions,
          status: body.status || "active",
          priority: body.priority || "medium",
          spaceId: body.spaceId,
          projectId: body.projectId,
          organizationId: body.organizationId,
          methodId: body.methodId,
          defaultWorkerMethodId: body.defaultWorkerMethodId,
          concurrencyPolicy: body.concurrencyPolicy || "skip_if_open",
          rotationTargets: body.rotationTargets || [],
          requireExecutionReceipt: body.requireExecutionReceipt === true,
          allowedActionTypes: body.allowedActionTypes || [],
          tags: body.tags || [],
          metadata: body.metadata || {},
        }, { agent: "portal-ui", model: "my-portal-ui" }));
      }
      if (action === "manager_job_update") {
        return json(await contextStore.managerJobUpdate({
          id: body.id,
          expectedRevision: body.expectedRevision,
          patch: body.patch || {},
        }));
      }
      if (action === "manager_job_start") {
        return json(await contextStore.managerJobStart({
          id: body.id,
          invocationId: body.invocationId,
          requestedBy: body.requestedBy || "portal-ui",
        }, { agent: "portal-ui", model: "my-portal-ui" }));
      }
      if (action === "manager_run_claim") {
        return json(await contextStore.managerRunClaim({
          id: body.id,
          agent: body.agent || "portal-ui",
          model: body.model || "my-portal-ui",
          runnerId: body.runnerId || "my-portal-ui",
          availableCapabilities: body.availableCapabilities || [],
          availableTools: body.availableTools || [],
          leaseMinutes: body.leaseMinutes,
        }));
      }
      if (action === "manager_run_finish") {
        return json(await contextStore.managerRunFinish({
          id: body.id,
          agent: body.agent || "portal-ui",
          status: body.status || "completed",
          summary: body.summary,
          observations: body.observations || [],
          decisions: body.decisions || [],
        }));
      }
      if (action === "linear_issue_import") {
        return json(await contextStore.linearIssueImportToWorkItem({
          issue: body.issue,
          workItemId: body.workItemId,
          executionMode: body.executionMode || "agent",
          humanReason: body.humanReason,
          spaceId: body.spaceId,
          projectId: body.projectId,
          syncStatus: body.syncStatus !== false,
        }, { agent: "portal-ui", model: "my-portal-ui" }));
      }
      if (action === "linear_work_item_push") {
        return json(await contextStore.workItemPushToLinear({
          id: body.id,
          issue: body.issue,
          team: body.team,
          project: body.project,
          assignee: body.assignee,
          syncStatus: body.syncStatus !== false,
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
