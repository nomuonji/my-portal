import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { initializeFirestore } from "firebase-admin/firestore";
import * as consumerModelStoreImport from "../../functions/consumerModelStore.js";
import * as storeImport from "../../functions/agentIdeasStoreAgentDb.js";
import * as documentDbImport from "../../functions/documentDb.js";
import * as contextStoreImport from "../../functions/contextStore.js";
import * as worldMapImport from "../../functions/worldMap.js";
import * as chatContextImport from "../../functions/chatContextRegistry.js";
import * as skillRelationPoliciesImport from "../../functions/chatSkillRelationsStore.js";
import * as contextRegistryImport from "../../functions/contextRegistry.js";
import * as metaStoreImport from "../../functions/metaStrategyStore.js";
import * as personalFeedImport from "../../functions/personalFeedStore.js";
import * as discoverReaderImport from "../../functions/discoverReaderStore.js";
import * as personalTasteImport from "../../functions/personalTasteStore.js";
import * as personalTasteExternalImport from "../../functions/personalTasteExternalStore.js";
import * as anilistImport from "../../functions/anilistIntegration.js";
import * as mediaConnectionsImport from "../../functions/mediaAccountConnections.js";
import * as routineStoreImport from "../../functions/routineJobStore.js";
import * as jobOpportunityStoreImport from "../../functions/jobOpportunityStore.js";
import * as explorationBaseStoreImport from "../../functions/explorationBaseStore.js";
import * as agentIntelligenceRegistryImport from "../../functions/agentIntelligenceRegistry.js";
import * as skillPackImport from "../../functions/skillPackRegistry.js";
import * as submarineStoreImport from "../../functions/submarineStore.js";
import * as submarineFleetImport from "../../functions/submarineFleet.js";

const consumerModels: any = (consumerModelStoreImport as any).default ?? consumerModelStoreImport;
const store: any = (storeImport as any).default ?? storeImport;
const contextStore: any = (contextStoreImport as any).default ?? contextStoreImport;
const worldMap: any = (worldMapImport as any).default ?? worldMapImport;
const chatContext: any = (chatContextImport as any).default ?? chatContextImport;
const skillRelationPolicies: any = (skillRelationPoliciesImport as any).default ?? skillRelationPoliciesImport;
const contextRegistry: any = (contextRegistryImport as any).default ?? contextRegistryImport;
const metaStore: any = (metaStoreImport as any).default ?? metaStoreImport;
const personalFeed: any = (personalFeedImport as any).default ?? personalFeedImport;
const discoverReader: any = (discoverReaderImport as any).default ?? discoverReaderImport;
const personalTaste: any = (personalTasteImport as any).default ?? personalTasteImport;
const externalTaste: any = (personalTasteExternalImport as any).default ?? personalTasteExternalImport;
const anilist: any = (anilistImport as any).default ?? anilistImport;
const mediaConnections: any = (mediaConnectionsImport as any).default ?? mediaConnectionsImport;
const routineStore: any = (routineStoreImport as any).default ?? routineStoreImport;
const jobOpportunityStore: any = (jobOpportunityStoreImport as any).default ?? jobOpportunityStoreImport;
const explorationBaseStore: any = (explorationBaseStoreImport as any).default ?? explorationBaseStoreImport;
const agentIntelligenceRegistry: any = (agentIntelligenceRegistryImport as any).default ?? agentIntelligenceRegistryImport;
const skillPackRegistry: any = (skillPackImport as any).default ?? skillPackImport;
const submarineStore: any = (submarineStoreImport as any).default ?? submarineStoreImport;
const submarineFleet: any = (submarineFleetImport as any).default ?? submarineFleetImport;
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
      if (resource === "lastfm_connection") return json(await mediaConnections.lastfmConnection());
      if (resource === "lastfm_profile") return json(await mediaConnections.lastfmProfile({period:url.searchParams.get("period")||"overall"}));
      if (resource === "filmarks_trakt_migration") return json(await mediaConnections.filmarksImportReport());
      if (resource === "trakt_connection") return json(await mediaConnections.traktConnection());
      if (resource === "trakt_profile") return json(await mediaConnections.traktProfile({limit:Math.min(120,Number(url.searchParams.get("limit"))||80)}));
      if (resource === "anilist_connection") return json(await anilist.connection());
      if (resource === "anilist_profile") return json(await anilist.profile({type:url.searchParams.get("type")||"ALL",limit:20}));
      if (resource === "taste_external_sources") return json(await externalTaste.list({includeItems:url.searchParams.get("includeItems")==="true"}));
      if (resource === "taste_evidence") return json(await personalTaste.list({limit:Number(url.searchParams.get("limit"))||120,includeInactive:url.searchParams.get("includeInactive")==="true",domain:url.searchParams.get("domain")||undefined,evidenceKind:url.searchParams.get("evidenceKind")||undefined,direction:url.searchParams.get("direction")||undefined}));
      if (resource === "taste_profile") return json(await personalTaste.profile({domain:url.searchParams.get("domain")||undefined}));
      if (resource === "taste_evidence_history") return json(await personalTaste.history({id:url.searchParams.get("id")||"",limit:40}));
      if (resource === "discover_reader") return json(await discoverReader.list({
        sort: url.searchParams.get("sort") || "score",
        includeSkipped: url.searchParams.get("includeSkipped") === "true",
        limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 500, 1), 600),
      }));
      if (resource === "discover_queue") return json(await discoverReader.queue({
        sort: url.searchParams.get("sort") || "score",
        view: url.searchParams.get("view") || "unread",
        type: url.searchParams.get("type") || undefined,
        sourceId: url.searchParams.get("sourceId") || undefined,
        q: url.searchParams.get("q") || undefined,
        includeSkipped: url.searchParams.get("includeSkipped") === "true",
        pageSize: Number(url.searchParams.get("pageSize")) || 30,
      }));
      if (resource === "discover_items") return json(await discoverReader.itemsByIds({ ids: url.searchParams.get("ids") || "" }));
      if (resource === "discover_sources") return json(await discoverReader.sourcesList({ includeArchived: url.searchParams.get("includeArchived") === "true" }));
      if (resource === "discover_model") return json(await discoverReader.modelGet({ limit: 20 }));
      if (resource === "personal_feed") return json(await personalFeed.list({limit:Math.min(Math.max(Number(url.searchParams.get("limit"))||160,1),500),includeSkipped:url.searchParams.get("includeSkipped")==="true"}));
      if (resource === "personal_feed_rejected") return json(await personalFeed.rejected({limit:Math.min(Math.max(Number(url.searchParams.get("limit"))||20,1),40)}));
      if (resource === "job_opportunities") return json(await jobOpportunityStore.search({
        query: url.searchParams.get("q") || undefined,
        status: url.searchParams.get("status") || undefined,
        limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 100),
        scanLimit: 1000,
      }));
      if (resource === "exploration_awaiting_trials") return json(await explorationBaseStore.awaitingTrials({ limit: Number(url.searchParams.get("limit")) || 60 }));
      if (resource === "consumer_models") return json(await consumerModels.list());
      if (resource === "consumer_model") return json(await consumerModels.get({id:url.searchParams.get("id")||"",version:url.searchParams.get("version")||undefined}));
      if (resource === "dojo_dependency_audit") return json(await agentIntelligenceRegistry.dependencyAudit({}));
      if (resource === "dojo_cross_learning") return json(await agentIntelligenceRegistry.crossDojoLearning({
        targetBaseId: url.searchParams.get("id") || "",
        limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 5, 1), 10),
      }));
      if (resource === "exploration_skill_graph") return json(await explorationBaseStore.graphGet({baseId:url.searchParams.get("id")||"",view:url.searchParams.get("view")==="full"?"full":"summary"}));
    if (resource === "exploration_bases") return json(await explorationBaseStore.list({ status: url.searchParams.get("status") || undefined }));
      if (resource === "exploration_base") return json(await explorationBaseStore.get({
        id: url.searchParams.get("id") || "",
        view: "full",
        eventLimit: Math.min(Math.max(Number(url.searchParams.get("eventLimit")) || 40, 1), 300),
      }));
      if (resource === "submarines") {
        await submarineFleet.ensureFleet(submarineStore, { actor: "My Portal UI" }).catch((error: any) => console.error("fleet ensure failed", String(error?.message || error)));
        return json(await submarineStore.list({ status: url.searchParams.get("status") || undefined }));
      }
      if (resource === "submarine") return json(await submarineStore.get({ id: url.searchParams.get("id") || "", view: "full" }));
      if (resource === "submarine_haul") return json(await submarineStore.haulList({ status: url.searchParams.get("status") || undefined, submarineId: url.searchParams.get("sub") || undefined, cursor: url.searchParams.get("cursor") || undefined, limit: Number(url.searchParams.get("limit")) || 15 }));
      if (resource === "meta_proposals") return json(await metaStore.list({limit: Math.min(Math.max(Number(url.searchParams.get("limit")) || 150, 1), 200), status: url.searchParams.get("status") || undefined}));
      if (resource === "meta_proposal") return json(await metaStore.get({ id: url.searchParams.get("id") || "" }));
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
      if (resource === "chat_skills") return json(await chatContext.listSkills({ includeArchived: url.searchParams.get("includeArchived") === "true" }));
      if (resource === "chat_skill") return json(await chatContext.getSkill({ id:url.searchParams.get("id")||"" }));
      if (resource === "chat_skill_versions") return json(await chatContext.skillVersions({ id:url.searchParams.get("id")||"" }));
      if (resource === "chat_skill_relation_policy") return json(await skillRelationPolicies.get({id:url.searchParams.get("id")||""}));
      if (resource === "contexts") return json(await contextRegistry.list({projectId:url.searchParams.get("projectId")||undefined,domain:url.searchParams.get("domain")||undefined,includeArchived:url.searchParams.get("includeArchived")==="true"}));
      if (resource === "context") return json(await contextRegistry.get({id:url.searchParams.get("id")||""}));
      if (resource === "context_history") return json(await contextRegistry.listEvents({contextId:url.searchParams.get("id")||""}));
      if (resource === "intelligence") return json(await agentIntelligenceRegistry.getPack({id:url.searchParams.get("id")||""}));
      if (resource === "skill_packs") return json(await skillPackRegistry.list());
      if (resource === "skill_pack") return json(await skillPackRegistry.get({id:url.searchParams.get("id")||"",resolve:url.searchParams.get("resolve")==="true",intent:url.searchParams.get("intent")||undefined,consumerModelId:url.searchParams.get("consumerModelId")||undefined,consumerModelVersion:url.searchParams.get("consumerModelVersion")||undefined}));
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
      if (resource === "routine_jobs") return json(await routineStore.list());
      if (resource === "routine_job_runs") return json(await routineStore.runs({jobId:url.searchParams.get("jobId") || undefined,limit:30}));
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
      if (action === "lastfm_configure") return json(await mediaConnections.lastfmConfigure({apiKey:body.apiKey}));
      if (action === "trakt_client_configure") return json(await mediaConnections.traktConfigure({clientId:body.clientId}));
      if (action === "filmarks_trakt_migration_run") return json(await mediaConnections.filmarksImportBatch({limit:body.limit}));
      if (action === "trakt_authorize_start") return json(await mediaConnections.traktStart());
      if (action === "trakt_authorize_finish") return json(await mediaConnections.traktFinish({code:body.code,state:body.state}));
      if (action === "anilist_client_configure") return json(await anilist.configure({clientId:body.clientId}));
      if (action === "anilist_authorize_url") return json(await anilist.authorizeUrl());
      if (action === "anilist_authorize_token") return json(await anilist.authorize({token:body.token}));
      if (action === "taste_external_import") return json(await externalTaste.importRecords({source:body.source,rows:body.rows}));
      if (action === "taste_evidence_upsert") return json(await personalTaste.upsert({id:body.id,record:body.record,expectedRevision:body.expectedRevision,changeReason:body.changeReason||"Manual user interface edit"}));
      if (action === "discover_feedback" && /^rss-/.test(String(body.id || ""))) {
        const updated = await discoverReader.feedback({ id: body.id, status: body.status, note: body.note, expectedRevision: body.expectedRevision });
        try {
          await personalTaste.fromDiscover({ itemId: updated.id, feedback: updated.feedback, title: updated.title, url: updated.url, note: body.note });
        } catch (error) {
          return json({ error: "Reaction was saved, but taste ledger sync failed; reload before retrying", detail: String((error as any)?.message || error) }, 503);
        }
        return json(updated);
      }
      if (action === "discover_opened") return json(await discoverReader.opened({ id: body.id }));
      if (action === "discover_mark_read") return json(await discoverReader.markRead({ ids: body.ids, read: body.read }));
      if (action === "discover_fetch_now") return json(await discoverReader.fetchDue({ sourceId: body.sourceId, force: body.force === true, budgetMs: 6000 }));
      if (action === "discover_source_test") return json(await discoverReader.sourceTest({ url: body.url }));
      if (action === "discover_source_upsert") return json(await discoverReader.sourceUpsert(body.source || {}));
      if (action === "personal_feed_feedback" || action === "discover_feedback") {
        const updated=await personalFeed.feedback({id:body.id,status:body.status,note:body.note,expectedRevision:body.expectedRevision});
        await discoverReader.signalForLegacy(updated).catch(() => null);
        // Keep the direct-user taste ledger aligned with Discover's explicit reaction.
        // Saved/seen/new are never positive signals; ledger entry becomes inactive.
        try{
          await personalTaste.fromDiscover({itemId:updated.id,feedback:updated.feedback,title:updated.title,url:updated.url,note:updated.feedbackNote});
        }catch(error){
          return json({error:"Discover feedback was saved, but taste ledger sync failed; reload before retrying",detail:String(error?.message||error)},503);
        }
        // A 好き confirms the Discover submarine's haul (mirrored to the 道場 that trains its gear); withdrawing it
        // takes it back. Before the submarine exists, the 道場 records it directly as before.
        const reaction={ref:"personal_feed:"+updated.id,label:String(updated.title||updated.id),url:String(updated.url||""),
          liked:updated.feedback==="loved",evidence:"本人が Discover で「好き」を付けた（"+String(updated.url||"")+"）",actor:"My Portal Discover"};
        const viaSub=await submarineStore.recordReaction({submarineId:"discover",...reaction}).catch((error:any)=>{console.error("discover submarine sync failed",String(error?.message||error));return null;});
        if(!viaSub||(viaSub.changed===false&&!viaSub.haulId)){
          await explorationBaseStore.recordUserReaction({baseId:"personal-discovery",...reaction})
            .catch((error:any)=>console.error("discover base sync failed",String(error?.message||error)));
        }
        return json(updated);
      }
      if (action === "submarine_haul_feedback") {
        // The signed-in owner evaluating in the UI is the user's own feedback.
        const day = new Date().toISOString().slice(0, 10);
        return json(await submarineStore.haulFeedback({
          submarineId: body.submarineId, haulId: body.haulId, action: String(body.feedbackAction || "").trim() || undefined,
          comment: String(body.comment || "").trim().slice(0, 1000),
          userAuthorized: true, authorizationNote: "My Portal の潜水艦画面で本人が評価（" + day + "）", actor: "My Portal UI", light: body.light === true,
        }));
      }
      if (action === "submarine_haul_decide") {
        // The signed-in user deciding in the UI is the owner's own decision, so it is applied directly.
        const decision = body.decision === "confirmed" ? "confirmed" : body.decision === "declined" ? "declined" : "";
        if (!decision) return json({ error: "decision must be confirmed or declined" }, 400);
        const day = new Date().toISOString().slice(0, 10);
        const note = String(body.note || "").trim().slice(0, 500);
        return json(await submarineStore.haulDecide({
          submarineId: body.submarineId, haulId: body.haulId, decision, note,
          userAuthorized: true, authorizationNote: "My Portal の潜水艦画面で本人が判断（" + day + "）" + (note ? "：" + note : ""), actor: "My Portal UI",
        }));
      }
      if (action === "exploration_trial_rate") {
        // A single click and a staged batch share the same underlying per-base transaction.
        // Each submitted choice is the signed-in owner's explicit rating; unselected rows are not sent.
        const inputs = Array.isArray(body.ratings) ? body.ratings : [body];
        if (!inputs.length || inputs.length > 30) return json({ error: "ratings must contain 1 to 30 items" }, 400);
        const ids = new Set();
        const labels = { pass: "合格", partial: "惜しい", fail: "ボツ" };
        const ratings = [];
        for (const input of inputs) {
          const id = String(input?.id || "").trim();
          const verdict = input?.verdict;
          if (!id || !Object.hasOwn(labels, verdict)) return json({ error: "Each rating needs an id and pass, partial or fail verdict" }, 400);
          if (ids.has(id)) return json({ error: "Duplicate trial id in batch: " + id }, 400);
          ids.add(id);
          const comment = String(input?.comment || "").trim().slice(0, 1000);
          ratings.push({ id, verdict, userWords: labels[verdict] + (comment ? "：" + comment : "") + "（道場画面）" });
        }
        return json(await explorationBaseStore.rateTrials({
          baseId: body.baseId, ratings, actor: "My Portal UI",
        }));
      }
      if (action === "exploration_achievement_decide") {
        // The signed-in user deciding in the UI is the owner's own decision, so it is applied directly.
        const decision = body.decision === "confirmed" ? "confirmed" : body.decision === "declined" ? "declined" : "";
        if (!decision) return json({ error: "decision must be confirmed or declined" }, 400);
        const day = new Date().toISOString().slice(0, 10);
        const note = String(body.note || "").trim().slice(0, 500);
        return json(await explorationBaseStore.setOutcome({
          baseId: body.baseId,
          confirmAchievements: [{ id: body.id, decision, note }],
          userAuthorized: true,
          authorizationNote: "My Portal の探索拠点画面で本人が判断（" + day + "）" + (note ? "：" + note : ""),
          actor: "My Portal UI",
        }));
      }
      if (action === "job_opportunity_upsert") return json(await jobOpportunityStore.upsert({
        title: body.title,
        sourcePublisher: body.sourcePublisher,
        sourceUrl: body.sourceUrl,
        summary: body.summary,
        reward: body.reward,
        deadline: body.deadline,
        status: body.status,
        tags: body.tags,
        attributes: body.attributes || {},
      }));
      if (action === "meta_proposal_feedback") return json(await metaStore.feedback({ id:body.id, status:body.status, feedback:body.feedback, expectedRevision:body.expectedRevision }));
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
      if (action === "cleanup_exploration_base") return json(await explorationBaseStore.remove({id:body.id,expectedRevision:body.expectedRevision,confirm:body.confirm===true}));
      if (action === "cleanup_chat_skill") return json(await chatContext.removeSkill({id:body.id,expectedRevision:body.expectedRevision,confirm:body.confirm===true}));
      if (action === "cleanup_context") return json(await contextRegistry.remove({id:body.id,expectedRevision:body.expectedRevision,confirm:body.confirm===true}));
      if (action === "cleanup_routine_job") return json(await routineStore.remove({id:body.id,expectedRevision:body.expectedRevision,confirm:body.confirm===true}));
      if (action === "chat_skill_upsert") return json(await chatContext.upsertSkill({skill:body.skill,expectedRevision:body.expectedRevision,changeReason:body.changeReason,confirm:body.confirm===true}));
      if (action === "chat_skill_relation_policy_publish") return json(await skillRelationPolicies.publish({policy:body.policy,expectedRevision:body.expectedRevision,changeReason:body.changeReason,benchmark:body.benchmark,confirm:body.confirm===true}));
      if (action === "context_save") return json(await contextRegistry.save({id:body.id,context:body.context,expectedRevision:body.expectedRevision,confirm:body.confirm===true}));
      if (action === "context_event_create") return json(await contextRegistry.addEvent({contextId:body.contextId,kind:body.kind,summary:body.summary,detail:body.detail,source:body.source||"portal-ui",sourceUrl:body.sourceUrl,idempotencyKey:body.idempotencyKey,confirm:body.confirm===true}));
      if (action === "world_map_update") {
        return json(await worldMap.update({
          expectedRevision: body.expectedRevision,
          routes: body.routes,
          hiddenRouteIds: body.hiddenRouteIds,
          boundaries: body.boundaries,
          agentGuide: body.agentGuide,
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
      if (action === "routine_job_upsert") return json(await routineStore.upsert({
        id:body.id,title:body.title,description:body.description,instructions:body.instructions,
        targetSystem:body.targetSystem,slots:body.slots,status:body.status,priority:body.priority,
        maxAccountsPerRun:body.maxAccountsPerRun,expectedRevision:body.expectedRevision,
      }));
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
